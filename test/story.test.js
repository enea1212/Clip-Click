// node story.js <folder>: the whole pipeline with the fake tools (no real models).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildStory } = require("../story");

const FAKE = path.join(__dirname, "..", "testing", "fake-tools.js");
const STORY = {
  language: "en",
  characters: [{ name: "MAYOR" }],
  decors: [{ id: "road", prompt: "a highway" }, { id: "office", prompt: "a city hall office" }],
  scenes: [
    { text: "In 2010, Stockholm had a speeding problem.", decor: "road", camera: "zoom-in", overlay: { type: "badge", text: "112 MPH" } },
    { text: "What if we paid the good drivers instead?", decor: "office", speaker: "MAYOR", characters: [{ name: "MAYOR", expression: "smug", position: "right" }] },
  ],
};

function setup(control = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cliptrei-story-"));
  const controlFile = path.join(dir, "control.json");
  const folder = path.join(dir, "story");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "story.json"), JSON.stringify(STORY));
  const saved = { ...process.env };
  const setControl = (value) => { fs.writeFileSync(controlFile, JSON.stringify(value)); fs.rmSync(`${controlFile}.log`, { force: true }); };
  setControl(control);
  Object.assign(process.env, { CLIPTREI_FAKE_TOOLS: FAKE, CLIPTREI_FAKE_CONTROL: controlFile, CLIPTREI_STUDIO_PYTHON: "studio-python" });
  return {
    folder,
    setControl,
    calls: () => (fs.existsSync(`${controlFile}.log`) ? fs.readFileSync(`${controlFile}.log`, "utf8").trim().split("\n") : []),
    restore: () => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); },
  };
}

const quiet = { log: () => {} };
const stepOf = (line) => ["imagegen.py", "tts.py", "transcribe.py", "voice16.wav", "render_story.py"].find((name) => line.includes(name));

test("buildStory runs decors, voice, whisper and render in order and writes render.json", async () => {
  const env = setup();
  try {
    const result = await buildStory(env.folder, quiet);
    assert.equal(result.video, "story.mp4");
    const steps = env.calls().map(stepOf).filter(Boolean);
    assert.deepEqual(steps.filter((s, i) => steps.indexOf(s) === i), ["imagegen.py", "tts.py", "voice16.wav", "transcribe.py", "render_story.py"]);
    const job = JSON.parse(fs.readFileSync(path.join(env.folder, "render.json"), "utf8"));
    assert.equal(job.scenes.length, 2);
    assert.deepEqual([job.width, job.height, job.fps], [1080, 1920, 30]);
    assert.ok(job.scenes[0].start === 0 && job.scenes[0].end <= job.scenes[1].start + 1e-9 && job.scenes[1].end > job.scenes[1].start);
    assert.equal(job.scenes[0].decor_file, "decor-road.png");
    assert.deepEqual(job.scenes[0].overlay, { type: "badge", text: "112 MPH" });
    assert.equal(job.scenes[1].characters[0].talking, true);
    assert.match(job.scenes[1].characters[0].look.skin, /^#/);
    assert.ok(fs.readFileSync(path.join(env.folder, "captions.ass"), "utf8").includes("Dialogue:"));
    assert.ok(fs.existsSync(path.join(env.folder, "story.mp4")));
  } finally { env.restore(); }
});

test("buildStory resumes: a second run only renders", async () => {
  const env = setup();
  try {
    await buildStory(env.folder, quiet);
    env.setControl({});
    await buildStory(env.folder, quiet);
    const steps = env.calls().map(stepOf).filter(Boolean);
    assert.deepEqual(steps, ["render_story.py"]);
  } finally { env.restore(); }
});

test("buildStory with failing imagegen stops and names the decors", async () => {
  const env = setup({ imagegenFails: true });
  try {
    await assert.rejects(buildStory(env.folder, quiet), /decor/i);
    assert.ok(!env.calls().some((line) => line.includes("render_story.py")), "nothing rendered");
  } finally { env.restore(); }
});

test("buildStory --preview renders 540×960 at 15 fps into story-preview.mp4", async () => {
  const env = setup();
  try {
    const result = await buildStory(env.folder, { ...quiet, preview: true });
    assert.equal(result.video, "story-preview.mp4");
    const job = JSON.parse(fs.readFileSync(path.join(env.folder, "render.json"), "utf8"));
    assert.deepEqual([job.width, job.height, job.fps, job.out], [540, 960, 15, "story-preview.mp4"]);
  } finally { env.restore(); }
});
