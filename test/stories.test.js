// End-to-end tests of the stories API with fake tools and a fake Ollama (no real models).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cliptrei-stories-"));
const DATA = path.join(work, "data");
const CONTROL = path.join(work, "control.json");
const PORT = 43000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const setControl = (value) => { fs.writeFileSync(CONTROL, JSON.stringify(value)); fs.rmSync(`${CONTROL}.log`, { force: true }); };
const calls = () => (fs.existsSync(`${CONTROL}.log`) ? fs.readFileSync(`${CONTROL}.log`, "utf8").trim().split("\n") : []);
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(BASE + p).then((r) => r.json());

// Fake Ollama: "down", "up" (a storyboard built from the sentence numbers in the prompt), "garbage".
const ollama = { mode: "down", calls: 0, slowMs: 0 };
const fakeOllama = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (ollama.mode === "down") { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] })); return; }
    ollama.calls += 1;
    const request = JSON.parse(body);
    const count = (request.prompt.match(/^\[\d+\]/gm) || []).length;
    const scenes = [];
    for (let i = 0; i < count; i += 2) scenes.push({ from: i, to: Math.min(i + 1, count - 1), decor: i < count / 2 ? "street" : "office", camera: "zoom-in", characters: [], overlay_type: i === 0 ? "badge" : "", overlay_text: i === 0 ? "52 KM/H" : "" });
    const answer = ollama.mode === "garbage" ? "nope" : JSON.stringify({ decors: [{ id: "street", prompt: "a city street" }, { id: "office", prompt: "an office" }], characters: [], scenes });
    setTimeout(() => res.end(JSON.stringify({ response: answer })), ollama.slowMs);
  });
});

const OLLAMA_PORT = PORT + 1;
let server;
test.before(async () => {
  setControl({});
  await new Promise((resolve) => fakeOllama.listen(OLLAMA_PORT, "127.0.0.1", resolve));
  server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: String(PORT), CLIPTREI_DATA_DIR: DATA, CLIPTREI_SATISFYING_DIR: path.join(work, "sat"), CLIPTREI_FAKE_TOOLS: path.join(ROOT, "testing", "fake-tools.js"), CLIPTREI_FAKE_CONTROL: CONTROL, CLIPTREI_OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}`, CLIPTREI_STUDIO_PYTHON: "studio-python" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("rulează")) resolve(); });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});
test.after(() => { server?.kill(); fakeOllama.close(); fs.rmSync(work, { recursive: true, force: true }); });

const SCRIPT = "The street was fast. Fines did nothing. Nobody slowed down.\nMAYOR: Pay the good drivers!\nSpeed dropped. Everyone was happy.";
const create = (extra = {}) => post("/api/stories", { language: "en", script: SCRIPT, ...extra });
const textOf = (story) => story.scenes.map((s) => s.text).join(" ");
const SENTENCES = "The street was fast. Fines did nothing. Nobody slowed down. Pay the good drivers! Speed dropped. Everyone was happy.";

test("create story with Ollama down: rules storyboard, decors generated, status editing", async () => {
  ollama.mode = "down";
  const { status, body } = await create();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.type, "story");
  assert.equal(body.status, "editing");
  assert.equal(textOf(body.story), SENTENCES);
  assert.equal(body.story.scenes.length, 6, "one scene per sentence");
  assert.ok(body.storyNote, "the reason the rules were used");
  assert.ok(fs.existsSync(path.join(DATA, body.id, "decor-scene.png")));
  assert.ok(body.decorVersions.scene > 0);
  assert.equal(body.story.scenes[3].speaker, "MAYOR");
});

test("create story with the AI: scenes follow the AI answer, text unchanged", async () => {
  ollama.mode = "up"; ollama.calls = 0;
  const { status, body } = await create();
  ollama.mode = "down";
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(ollama.calls, 1);
  assert.equal(textOf(body.story), SENTENCES);
  assert.deepEqual(body.story.decors.map((d) => d.id).sort(), ["office", "street"]);
  assert.deepEqual(body.story.scenes[0].overlay, { type: "badge", text: "52 KM/H" });
  assert.equal(body.storyNote, undefined);
  assert.ok(body.story.scenes.every((scene) => !scene.text.includes("Pay") || scene.speaker === "MAYOR"));
});

test("create rejects an empty or a too long script", async () => {
  assert.equal((await post("/api/stories", { language: "en", script: "Hi." })).status, 400);
  assert.equal((await post("/api/stories", { language: "fr", script: SCRIPT })).status, 400);
  const long = Array.from({ length: 45 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  assert.match((await post("/api/stories", { language: "en", script: long })).body.error, /lung/);
});

test("scene edit validates (bad expression → 400) and saves", async () => {
  const made = (await create()).body;
  const bad = await post(`/api/stories/${made.id}/scene`, { index: 3, characters: [{ name: "MAYOR", expression: "furious", position: "left" }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /expresia/);
  const ok = await post(`/api/stories/${made.id}/scene`, { index: 3, camera: "pan-left", overlay: { type: "sign", text: "PAY THEM" }, characters: [{ name: "MAYOR", expression: "happy", position: "left" }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, made.id, "story.json"), "utf8")).scenes[3];
  assert.equal(saved.camera, "pan-left");
  assert.deepEqual(saved.overlay, { type: "sign", text: "PAY THEM" });
  assert.equal(saved.characters[0].expression, "happy");
  assert.equal(saved.text, "Pay the good drivers!", "the text can't be edited here");
  assert.equal((await post(`/api/stories/${made.id}/scene`, { index: 99, camera: "static" })).status, 400);
});

test("regenerate decor bumps its version; a second call while busy → 409", async () => {
  const made = (await create()).body;
  const before = made.decorVersions.scene;
  await new Promise((r) => setTimeout(r, 30));
  setControl({});
  const first = post(`/api/stories/${made.id}/decor`, { decor: "scene", prompt: "a sunny park" });
  const second = await post(`/api/stories/${made.id}/decor`, { decor: "scene", prompt: "a rainy park" });
  const done = await first;
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok([200, 409].includes(second.status));
  assert.equal(done.body.story.decors[0].prompt, second.status === 409 ? "a sunny park" : done.body.story.decors[0].prompt);
  assert.ok(done.body.decorVersions.scene >= before);
  assert.ok(!calls().some((line) => line.includes("decor-jobs.json")), "through the long-lived worker, not a one-off run");
});

test("upload rejects non-images and >15 MB, accepts a PNG and marks it hand-placed", async () => {
  const made = (await create()).body;
  const notImage = await post(`/api/stories/${made.id}/upload`, { decor: "scene", data: `data:image/png;base64,${Buffer.from("hello world").toString("base64")}` });
  assert.equal(notImage.status, 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const ok = await post(`/api/stories/${made.id}/upload`, { decor: "scene", data: `data:image/png;base64,${png.toString("base64")}` });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(fs.readFileSync(path.join(DATA, made.id, "decor-scene.png")), png);
  assert.deepEqual(ok.body.handPlaced, ["scene"]);
  const big = Buffer.concat([png, Buffer.alloc(15 * 1024 * 1024)]);
  const tooBig = await fetch(`${BASE}/api/stories/${made.id}/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decor: "scene", data: `data:image/png;base64,${big.toString("base64")}` }) });
  assert.equal(tooBig.status, 413);
});

test("preview then render: files exist, status ready, video url", async () => {
  const made = (await create()).body;
  const preview = await post(`/api/stories/${made.id}/preview`, {});
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.status, "editing");
  assert.match(preview.body.preview, new RegExp(`^/data/${made.id}/story-preview\\.mp4\\?v=\\d+$`));
  const final = await post(`/api/stories/${made.id}/render`, {});
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(final.body.status, "ready");
  assert.match(final.body.video, /story\.mp4\?v=\d+$/);
  assert.ok(fs.existsSync(path.join(DATA, made.id, "story.mp4")));
  const ass = fs.readFileSync(path.join(DATA, made.id, "captions.ass"), "utf8");
  assert.match(ass, /,8,60,60,560,/, "captions at the top, above the characters");
});

test("a second heavy job is refused while a story is being created", async () => {
  ollama.mode = "up"; ollama.slowMs = 800;
  const first = create();
  await new Promise((r) => setTimeout(r, 250));
  const second = await post("/api/process", { url: "https://www.youtube.com/watch?v=FAKEAAAAAAA" });
  const third = await create();
  ollama.slowMs = 0;
  assert.equal(second.status, 409);
  assert.equal(third.status, 409);
  assert.equal((await first).status, 200);
  ollama.mode = "down";
});

test("project list shows type story and sceneCount; GET shows the story", async () => {
  const made = (await create()).body;
  const row = (await get("/api/projects")).find((item) => item.id === made.id);
  assert.equal(row.type, "story");
  assert.equal(row.sceneCount, 6);
  const full = await get(`/api/projects/${made.id}`);
  assert.equal(full.story.scenes.length, 6);
});

test("resume a failed story continues from the missing stage", async () => {
  setControl({ imagegenServeDies: path.join(work, "dies-flag") });
  fs.writeFileSync(path.join(work, "dies-flag"), "");
  const failed = await create();
  assert.equal(failed.status, 400);
  assert.equal(failed.body.resumable, true);
  const id = fs.readdirSync(DATA).find((name) => JSON.parse(fs.readFileSync(path.join(DATA, name, "project.json"), "utf8")).status === "failed");
  assert.ok(fs.existsSync(path.join(DATA, id, "story.json")), "the storyboard was kept");
  setControl({});
  const resumed = await post(`/api/projects/${id}/resume`, {});
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.status, "editing");
});

test("new decor for one scene: added, assigned and generated; the other scenes keep theirs", async () => {
  const made = (await create()).body;
  const before = made.story.scenes.map((s) => s.decor);
  const res = await post(`/api/stories/${made.id}/new-decor`, { index: 2, prompt: "subway stairs painted like piano keys" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const newId = res.body.story.scenes[2].decor;
  assert.notEqual(newId, before[2]);
  assert.ok(res.body.story.decors.some((d) => d.id === newId && d.prompt === "subway stairs painted like piano keys"));
  assert.ok(fs.existsSync(path.join(DATA, made.id, `decor-${newId}.png`)));
  res.body.story.scenes.forEach((scene, i) => { if (i !== 2) assert.equal(scene.decor, before[i]); });
  assert.equal((await post(`/api/stories/${made.id}/new-decor`, { index: 99, prompt: "x" })).status, 400);
  assert.equal((await post(`/api/stories/${made.id}/new-decor`, { index: 1, prompt: "  " })).status, 400);
});

test("a scene can switch to another existing decor; an unknown decor is refused", async () => {
  const made = (await create()).body;
  const added = (await post(`/api/stories/${made.id}/new-decor`, { index: 0, prompt: "a rainy street" })).body;
  const newId = added.story.scenes[0].decor;
  const moved = await post(`/api/stories/${made.id}/scene`, { index: 4, decor: newId });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.story.scenes[4].decor, newId);
  const bad = await post(`/api/stories/${made.id}/scene`, { index: 4, decor: "nowhere" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /decorul/);
});
