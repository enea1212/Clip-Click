const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const S = require("../studio");

const minimal = (extra = {}) => ({
  language: "en",
  decors: [{ id: "road", prompt: "a highway" }],
  scenes: [{ text: "In 2010, Stockholm had a speeding problem.", decor: "road" }],
  ...extra,
});

test("validateStory accepts a minimal story and fills defaults", () => {
  const story = S.validateStory(minimal());
  assert.equal(story.narrator.voice, "am_michael");
  assert.deepEqual(story.characters, []);
  assert.deepEqual(story.scenes[0], { text: "In 2010, Stockholm had a speeding problem.", speaker: null, decor: "road", camera: "static", characters: [], overlay: null });
  assert.deepEqual(S.validateStory(minimal({ language: "ro" })).narrator.voice, { pitch: 1, speed: 1 });
});

test("validateStory rejects unknown decor / character / expression with a Romanian message", () => {
  assert.throws(() => S.validateStory(minimal({ scenes: [{ text: "Hi.", decor: "sea" }] })), /decorul.*sea/);
  const withChar = (c) => minimal({ characters: [{ name: "MAYOR" }], scenes: [{ text: "Hi.", decor: "road", characters: [c] }] });
  assert.throws(() => S.validateStory(withChar({ name: "BOB", expression: "happy", position: "left" })), /personajul.*BOB/);
  assert.throws(() => S.validateStory(withChar({ name: "MAYOR", expression: "furious", position: "left" })), /expresia.*furious/);
  assert.throws(() => S.validateStory(minimal({ scenes: [{ text: "Hi.", decor: "road", speaker: "BOB" }] })), /personajul.*BOB/);
});

test("validateStory rejects empty scene text and scenes over 40 words", () => {
  assert.throws(() => S.validateStory(minimal({ scenes: [{ text: "  ", decor: "road" }] })), /text/);
  const long = Array.from({ length: 41 }, () => "word").join(" ");
  assert.throws(() => S.validateStory(minimal({ scenes: [{ text: long, decor: "road" }] })), /40/);
});

test("characters without a voice get distinct default voices", () => {
  const story = S.validateStory(minimal({ characters: [{ name: "A" }, { name: "B" }, { name: "C" }] }));
  const voices = story.characters.map((c) => c.voice);
  assert.equal(new Set(voices).size, 3);
  assert.ok(!voices.includes(story.narrator.voice));
  for (const c of story.characters) {
    assert.match(c.look.skin, /^#[0-9a-f]{6}$/);
    assert.ok(S.HAIR.includes(c.look.hair));
  }
});

test("studioPython honours CLIPTREI_STUDIO_PYTHON", () => {
  const old = process.env.CLIPTREI_STUDIO_PYTHON;
  process.env.CLIPTREI_STUDIO_PYTHON = "X:/py.exe";
  try { assert.equal(S.studioPython(), "X:/py.exe"); } finally {
    if (old === undefined) delete process.env.CLIPTREI_STUDIO_PYTHON; else process.env.CLIPTREI_STUDIO_PYTHON = old;
  }
  assert.equal(path.basename(S.script("imagegen.py")), "imagegen.py");
});

// --- with the fake tools (no real Python studio) ------------------------------------------
const fs = require("node:fs");
const os = require("node:os");
const FAKE = path.join(__dirname, "..", "testing", "fake-tools.js");

function fakeEnv(control = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cliptrei-studio-"));
  const controlFile = path.join(dir, "control.json");
  fs.writeFileSync(controlFile, JSON.stringify(control));
  const saved = { ...process.env };
  Object.assign(process.env, { CLIPTREI_FAKE_TOOLS: FAKE, CLIPTREI_FAKE_CONTROL: controlFile, CLIPTREI_STUDIO_PYTHON: "studio-python" });
  const folder = path.join(dir, "story");
  fs.mkdirSync(folder);
  return {
    folder,
    calls: () => (fs.existsSync(`${controlFile}.log`) ? fs.readFileSync(`${controlFile}.log`, "utf8").trim().split("\n") : []),
    restore: () => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); },
  };
}

const threeDecors = () => S.validateStory(minimal({
  decors: [{ id: "a", prompt: "a highway" }, { id: "b", prompt: "a house" }, { id: "c", prompt: "a living room" }],
  scenes: [{ text: "One.", decor: "a" }, { text: "Two.", decor: "b" }, { text: "Three.", decor: "c" }],
}));

test("generateDecors writes one image per missing decor, in one imagegen run", async () => {
  const env = fakeEnv();
  try {
    fs.writeFileSync(path.join(env.folder, "decor-b.png"), "old");
    const result = await S.generateDecors(env.folder, threeDecors());
    assert.deepEqual(result.generated.sort(), ["a", "c"]);
    assert.equal(env.calls().filter((line) => line.includes("imagegen.py")).length, 1);
    const jobs = JSON.parse(fs.readFileSync(path.join(env.folder, "decor-jobs.json"), "utf8"));
    assert.equal(jobs.items.length, 2);
    assert.equal(jobs.items[0].prompt, `a highway, ${S.DECOR_STYLE}`);
    assert.equal(fs.readFileSync(path.join(env.folder, "decor-b.png"), "utf8"), "old", "existing decor kept");
    assert.ok(fs.existsSync(path.join(env.folder, "decor-a.png")) && fs.existsSync(path.join(env.folder, "decor-c.png")));
  } finally { env.restore(); }
});

test("generateDecors names the decor step when imagegen fails", async () => {
  const env = fakeEnv({ imagegenFails: true });
  try {
    await assert.rejects(S.generateDecors(env.folder, threeDecors()), /decoruri|imagegen/i);
  } finally { env.restore(); }
});

test("sceneTimeline adds 0.25 s after each scene and 0.6 s after the last", () => {
  assert.deepEqual(S.sceneTimeline([2, 3]), [{ start: 0, end: 2.25, speechEnd: 2 }, { start: 2.25, end: 5.85, speechEnd: 5.25 }]);
});

const dialogue = () => S.validateStory(minimal({
  characters: [{ name: "MAYOR" }],
  scenes: [{ text: "The city had a problem.", decor: "road" }, { text: "What if we paid them?", decor: "road", speaker: "MAYOR" }],
}));

test("synthesizeVoices uses the speaker's voice per scene and the narrator otherwise", async () => {
  const env = fakeEnv();
  try {
    const story = dialogue();
    const durations = await S.synthesizeVoices(env.folder, story);
    assert.equal(durations.length, 2);
    const jobs = JSON.parse(fs.readFileSync(path.join(env.folder, "tts.json"), "utf8"));
    assert.equal(jobs.items[0].voice, story.narrator.voice);
    assert.equal(jobs.items[1].voice, story.characters[0].voice);
    assert.deepEqual(jobs.items.map((item) => item.out), ["voice-1.wav", "voice-2.wav"]);
    assert.equal(jobs.combined, "voice.wav");
    assert.equal(jobs.gap, 0.25);
    assert.equal(jobs.last_gap, 0.6);
  } finally { env.restore(); }
});

test("synthesizeVoices is skipped when voice.json matches", async () => {
  const env = fakeEnv();
  try {
    const first = await S.synthesizeVoices(env.folder, dialogue());
    const second = await S.synthesizeVoices(env.folder, dialogue());
    assert.deepEqual(second, first);
    assert.equal(env.calls().filter((line) => line.includes("tts.py")).length, 1);
    const changed = dialogue();
    changed.scenes[0].text = "The city had a big problem.";
    await S.synthesizeVoices(env.folder, changed);
    assert.equal(env.calls().filter((line) => line.includes("tts.py")).length, 2, "a changed text is spoken again");
  } finally { env.restore(); }
});

const heard = (list) => list.map(([word, start, end]) => ({ word, start, end }));
const increasing = (words) => words.every((w, i) => w.end > w.start && (i === 0 || w.start >= words[i - 1].end - 1e-9));

test("alignWords keeps the script words and their order when Whisper mishears", () => {
  const script = ["Stockholm", "had", "a", "speeding", "problem."];
  const out = S.alignWords(script, heard([["stock", 0, 0.3], ["home", 0.3, 0.6], ["had", 0.7, 0.9], ["a", 0.9, 1.0], ["speeding", 1.0, 1.5], ["problem", 1.5, 2.0]]), 0, 2.2);
  assert.deepEqual(out.map((w) => w.word), script);
  assert.ok(increasing(out), JSON.stringify(out));
  assert.deepEqual([out[1].start, out[1].end], [0.7, 0.9]);
  assert.ok(out[0].start >= 0 && out[0].end <= 0.7);
});

test("alignWords interpolates when nothing matches", () => {
  const out = S.alignWords(["one", "two", "three", "four", "five"], [], 0, 4);
  assert.equal(out.length, 5);
  assert.ok(increasing(out));
  assert.ok(out[0].start >= 0 && out.at(-1).end <= 4);
});

test("alignWords keeps diacritics and quotes in the output", () => {
  const out = S.alignWords(["„Nimic”", "nu", "s-a", "schimbat."], heard([["Nimic", 0, 0.4], ["nu", 0.4, 0.6], ["s-a", 0.6, 0.8], ["schimbat", 0.8, 1.3]]), 0, 1.5);
  assert.deepEqual(out.map((w) => w.word), ["„Nimic”", "nu", "s-a", "schimbat."]);
  assert.deepEqual([out[0].start, out[0].end], [0, 0.4]);
});

test("generateDecors regenerates a decor whose prompt changed, but keeps a hand-placed image", async () => {
  const env = fakeEnv();
  try {
    fs.writeFileSync(path.join(env.folder, "decor-c.png"), "my own image");
    assert.deepEqual((await S.generateDecors(env.folder, threeDecors())).generated.sort(), ["a", "b"]);
    assert.deepEqual((await S.generateDecors(env.folder, threeDecors())).generated, [], "nothing changed: no run");
    const edited = threeDecors();
    edited.decors[0].prompt = "a highway at night";
    edited.decors[2].prompt = "a kitchen";
    assert.deepEqual((await S.generateDecors(env.folder, edited)).generated, ["a"]);
    assert.equal(fs.readFileSync(path.join(env.folder, "decor-c.png"), "utf8"), "my own image");
  } finally { env.restore(); }
});

test("generateDecors asks imagegen to upscale every decor with Real-ESRGAN", async () => {
  const env = fakeEnv();
  try {
    await S.generateDecors(env.folder, threeDecors());
    const jobs = JSON.parse(fs.readFileSync(path.join(env.folder, "decor-jobs.json"), "utf8"));
    assert.equal(path.basename(jobs.upscale.model), "realesr-general-x4v3.pth");
    assert.deepEqual([jobs.upscale.width, jobs.upscale.height], [1260, 2240]);
  } finally { env.restore(); }
});
