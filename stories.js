// Stories in the app („Povești animate”): create from a script, edit the storyboard, regenerate
// or upload decors, preview and render. A story project is data/<id>/ with project.json
// (type "story", clips []) and story.json (the storyboard); story.js does the rendering.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const S = require("./studio");
const B = require("./storyboard");
const AI = require("./ai");
const P = require("./projects");
const { buildStory } = require("./story");

const STORYBOARD_BUDGET_MS = Number(process.env.CLIPTREI_STORYBOARD_BUDGET_MS) || 360_000;
const MIN_SCRIPT = 20;
const MAX_SCRIPT = 5000;
const MAX_SENTENCES = 40;
const MAX_UPLOAD = 15 * 1024 * 1024;
const IMAGE_MAGIC = [
  (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, // PNG
  (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // JPEG
  (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
];

function createStories({ dataDir, locks, withLock, UserError, worker, busyMessage }) {
  const folderOf = (id) => path.join(dataDir, id);
  const storyFile = (id) => path.join(folderOf(id), "story.json");
  const readStory = (id) => JSON.parse(fs.readFileSync(storyFile(id), "utf8"));
  const writeStory = (id, story) => P.writeJsonAtomic(storyFile(id), story);
  const save = (project, changes) => { Object.assign(project, changes); P.saveProject(dataDir, project); return project; };
  const runner = (jobs) => worker.run(jobs);

  function load(id) {
    if (!P.isValidId(id)) throw new UserError("Proiect invalid.");
    const project = P.readProject(dataDir, id);
    if (!project || project.type !== "story") throw new UserError("Povestea nu există.", 404);
    return project;
  }

  // The project as the UI needs it: + the storyboard, decor versions (cache-busting) and which
  // decors are images placed by hand.
  function view(project) {
    const out = { ...project };
    try {
      const story = readStory(project.id);
      const record = S.readDecorRecord(folderOf(project.id));
      out.story = story;
      out.decorVersions = {};
      out.handPlaced = [];
      for (const decor of story.decors) {
        const file = path.join(folderOf(project.id), S.decorFile(decor.id));
        const exists = fs.existsSync(file);
        out.decorVersions[decor.id] = exists ? Math.round(fs.statSync(file).mtimeMs) : 0;
        if (exists && record.prompts[decor.id] === undefined) out.handPlaced.push(decor.id);
      }
    } catch { /* no storyboard yet */ }
    return out;
  }

  // The AI groups the sentences into scenes; any problem → the rules, with the reason as a note.
  async function storyboard(language, script) {
    const split = B.splitScript(script);
    let note;
    const status = await AI.ollamaStatus();
    if (status.ok) {
      try {
        const raw = await AI.askOllama(B.buildStoryboardPrompt(split.sentences, language), { schema: B.STORYBOARD_SCHEMA, timeoutMs: STORYBOARD_BUDGET_MS, options: { num_ctx: 8192 } });
        const parsed = B.parseStoryboard(raw, split, language);
        if (parsed) return { story: S.validateStory(parsed) };
        note = "AI-ul a dat un răspuns nefolosibil";
      } catch (error) {
        note = /timeout|abort/i.test(`${error.name} ${error.message}`) ? `AI-ul n-a terminat în ${Math.round(STORYBOARD_BUDGET_MS / 60_000)} minute` : "AI-ul nu a răspuns";
      }
    } else {
      note = status.reason;
    }
    return { story: S.validateStory(B.rulesStoryboard(split, language)), note };
  }

  // Storyboard (if missing) → decors (missing ones) → editing. Every stage is kept on failure.
  async function pipeline(project) {
    const folder = folderOf(project.id);
    try {
      if (!fs.existsSync(storyFile(project.id))) {
        save(project, { status: "storyboarding", error: undefined });
        const { story, note } = await storyboard(project.language, fs.readFileSync(path.join(folder, "script.txt"), "utf8"));
        writeStory(project.id, story);
        save(project, { storyNote: note, sceneCount: story.scenes.length });
      }
      save(project, { status: "decors", error: undefined });
      await S.generateDecors(folder, readStory(project.id), { runner });
      save(project, { status: "editing", error: undefined });
      return view(project);
    } catch (error) {
      try { save(project, { status: "failed", error: error.message }); } catch { /* folder gone */ }
      error.resumable = true;
      throw error;
    }
  }

  async function heavy(id, work) {
    if (!locks.acquireHeavy()) throw new UserError(busyMessage, 409);
    try {
      return await withLock(`${id}:process`, "Povestea se procesează deja.", work);
    } finally {
      locks.releaseHeavy();
    }
  }

  async function create({ language, script, title } = {}) {
    if (!S.LANGUAGES.includes(language)) throw new UserError("Alege limba poveștii: engleză sau română.");
    const text = String(script || "").trim();
    if (text.length < MIN_SCRIPT) throw new UserError("Povestea e prea scurtă.");
    if (text.length > MAX_SCRIPT) throw new UserError(`Povestea e prea lungă (cel mult ${MAX_SCRIPT} de caractere).`);
    const { sentences } = B.splitScript(text);
    if (sentences.length > MAX_SENTENCES) throw new UserError(`Povestea e prea lungă: ${sentences.length} de propoziții (cel mult ${MAX_SENTENCES}, adică ~1,5 minute).`);
    const id = randomUUID();
    const name = String(title || "").trim() || sentences[0].text.split(/\s+/).slice(0, 6).join(" ");
    return heavy(id, async () => {
      fs.mkdirSync(folderOf(id), { recursive: true });
      fs.writeFileSync(path.join(folderOf(id), "script.txt"), text, "utf8");
      const project = { id, type: "story", title: name, language, createdAt: new Date().toISOString(), status: "storyboarding", clips: [] };
      P.saveProject(dataDir, project);
      return pipeline(project);
    });
  }

  async function resume(id) {
    return heavy(id, () => pipeline(load(id)));
  }

  function editable(project) {
    if (!["editing", "ready"].includes(project.status)) throw new UserError("Povestea nu e gata de editat.");
  }

  async function editScene(id, { index, camera, overlay, characters } = {}) {
    const project = load(id);
    editable(project);
    if (locks.isHeld(`${id}:process`)) throw new UserError("Povestea se randează acum. Încearcă după ce termină.", 409);
    const story = readStory(id);
    if (!Number.isInteger(index) || !story.scenes[index]) throw new UserError("Scenă invalidă.");
    const scene = story.scenes[index];
    if (camera !== undefined) scene.camera = camera;
    if (overlay !== undefined) scene.overlay = overlay && overlay.type ? { type: overlay.type, text: String(overlay.text || "").slice(0, 40) } : null;
    if (characters !== undefined) scene.characters = Array.isArray(characters) ? characters.slice(0, 3) : [];
    let valid;
    try { valid = S.validateStory(story); } catch (error) { throw new UserError(error.message); }
    if (scene.speaker && !valid.scenes[index].characters.some((c) => c.name === scene.speaker)) {
      // the speaker stays on screen in his own scene (his mouth moves with the voice)
      valid.scenes[index].characters.push({ name: scene.speaker, expression: "neutral", position: "center" });
    }
    writeStory(id, valid);
    return view(save(project, { status: "editing" }));
  }

  async function regenerateDecor(id, { decor, prompt } = {}) {
    const project = load(id);
    editable(project);
    return withLock(`${id}:decor`, "Decorul se generează deja. Așteaptă puțin.", async () => {
      const story = readStory(id);
      const target = story.decors.find((d) => d.id === decor);
      if (!target) throw new UserError("Decor necunoscut.");
      const text = String(prompt ?? target.prompt).trim();
      if (!text || text.length > 300) throw new UserError("Descrierea decorului trebuie să aibă între 1 și 300 de caractere.");
      target.prompt = text;
      writeStory(id, story);
      await S.generateDecors(folderOf(id), story, { runner, force: [decor] });
      return view(save(load(id), { status: "editing" }));
    });
  }

  async function uploadDecor(id, { decor, data } = {}) {
    const project = load(id);
    editable(project);
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
    if (!match) throw new UserError("Fișierul trebuie să fie o imagine PNG, JPEG sau WebP.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_UPLOAD) throw new UserError("Imaginea e prea mare (cel mult 15 MB).", 413);
    if (!IMAGE_MAGIC.some((test) => test(bytes))) throw new UserError("Fișierul trebuie să fie o imagine PNG, JPEG sau WebP.");
    return withLock(`${id}:decor`, "Decorul se generează deja. Așteaptă puțin.", async () => {
      const story = readStory(id);
      if (!story.decors.some((d) => d.id === decor)) throw new UserError("Decor necunoscut.");
      const file = path.join(folderOf(id), S.decorFile(decor));
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
      const record = S.readDecorRecord(folderOf(id));
      delete record.prompts[decor];
      S.writeDecorRecord(folderOf(id), record);
      return view(save(load(id), { status: "editing" }));
    });
  }

  async function render(id, { preview }) {
    const project = load(id);
    editable(project);
    return heavy(id, async () => {
      if (locks.isHeld(`${id}:decor`)) throw new UserError("Un decor se generează acum. Încearcă după ce termină.", 409);
      const before = project.status;
      save(project, { status: "rendering", error: undefined });
      try {
        const result = await buildStory(folderOf(id), { preview, log: () => {} });
        const url = `/data/${id}/${result.video}?v=${Date.now()}`;
        return view(save(project, preview ? { status: before === "ready" ? "ready" : "editing", preview: url } : { status: "ready", video: url, seconds: result.seconds }));
      } catch (error) {
        save(project, { status: before, error: error.message });
        throw new UserError(error.message);
      }
    });
  }

  // Routes under /api/stories; returns undefined when the path isn't a story route.
  async function handle(req, pathname, readJson) {
    if (req.method !== "POST") return undefined;
    if (pathname === "/api/stories") return create(await readJson(req, 50_000));
    const match = pathname.match(/^\/api\/stories\/([^/]+)\/(scene|decor|upload|preview|render)$/);
    if (!match) return undefined;
    const [, id, action] = match;
    if (!P.isValidId(id)) throw new UserError("Proiect invalid.");
    if (action === "scene") return editScene(id, await readJson(req, 50_000));
    if (action === "decor") return regenerateDecor(id, await readJson(req, 10_000));
    if (action === "upload") return uploadDecor(id, await readJson(req, Math.ceil(MAX_UPLOAD * 1.4)));
    await readJson(req, 1000);
    return render(id, { preview: action === "preview" });
  }

  return { handle, view, resume };
}

module.exports = { createStories };
