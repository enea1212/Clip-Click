// Animated stories („Povești animate”): paths to the Python studio (its own venv and models)
// and the story.json format. The heavy work runs in studio/*.py; this file orchestrates it.
const fs = require("node:fs");
const path = require("node:path");
const W = require("./whisper");
const crypto = require("node:crypto");
const { run } = require("./proc");

const ROOT = __dirname;
const MODELS_DIR = process.env.CLIPTREI_MODELS_DIR || path.join(ROOT, "models");

const studioPython = () => process.env.CLIPTREI_STUDIO_PYTHON
  || path.join(ROOT, "studio", "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const script = (name) => path.join(ROOT, "studio", name);

const CAMERAS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "static"];
const EXPRESSIONS = ["neutral", "happy", "angry", "surprised", "sad", "smug"];
const POSITIONS = ["left", "center", "right"];
const OVERLAYS = ["badge", "sign", "money", "flash", "emoji"];
const HAIR = ["short", "long", "bald", "cap"];
const LANGUAGES = ["en", "ro"];
const MAX_SCENE_WORDS = 40;

// Kokoro voices: the narrator's default, then distinct ones for characters, in order.
const EN_NARRATOR = "am_michael";
const EN_CHARACTER_VOICES = ["am_fenrir", "af_bella", "bm_george", "af_nicole", "am_puck", "bf_emma", "am_eric", "af_sky"];
// Piper has one Romanian voice: characters differ by pitch and speed.
const RO_NARRATOR = { pitch: 1, speed: 1 };
const RO_CHARACTER_VOICES = [{ pitch: 0.85, speed: 0.95 }, { pitch: 1.2, speed: 1.05 }, { pitch: 0.92, speed: 1.1 }, { pitch: 1.1, speed: 0.9 }];
const SKINS = ["#f2d3b1", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
const SHIRTS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6"];

const isColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const words = (text) => String(text).trim().split(/\s+/).filter(Boolean);

function fail(message) { throw new Error(message); }

function oneOf(value, list, label, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!list.includes(value)) fail(`Valoare nepermisă pentru ${label}: „${value}” (permise: ${list.join(", ")}).`);
  return value;
}

// Checks a hand-written (or AI-written) story.json and fills the defaults. Throws in Romanian.
function validateStory(raw) {
  if (!raw || typeof raw !== "object") fail("story.json nu e un obiect.");
  const language = oneOf(raw.language, LANGUAGES, "limba", "en");
  const en = language === "en";
  const decors = (raw.decors || []).map((decor) => {
    if (!decor || !/^[a-z0-9-]+$/i.test(decor.id || "")) fail(`Decorul „${decor && decor.id}” are un id invalid (litere, cifre, cratimă).`);
    if (!String(decor.prompt || "").trim()) fail(`Decorul „${decor.id}” nu are descriere (prompt).`);
    return { id: decor.id, prompt: String(decor.prompt).trim() };
  });
  if (!decors.length) fail("Povestea nu are niciun decor.");
  const decorIds = new Set(decors.map((decor) => decor.id));
  if (decorIds.size !== decors.length) fail("Două decoruri au același id.");

  const characters = (raw.characters || []).map((character, index) => {
    if (!String(character.name || "").trim()) fail("Un personaj nu are nume.");
    const look = character.look || {};
    const voices = en ? EN_CHARACTER_VOICES : RO_CHARACTER_VOICES;
    return {
      name: String(character.name).trim(),
      look: {
        skin: isColor(look.skin) ? look.skin.toLowerCase() : SKINS[index % SKINS.length],
        hair: oneOf(look.hair, HAIR, "păr", HAIR[index % HAIR.length]),
        shirt: isColor(look.shirt) ? look.shirt.toLowerCase() : SHIRTS[index % SHIRTS.length],
      },
      voice: character.voice ?? voices[index % voices.length],
    };
  });
  const names = new Set(characters.map((character) => character.name));
  if (names.size !== characters.length) fail("Două personaje au același nume.");
  const knownCharacter = (name) => { if (!names.has(name)) fail(`Scena folosește personajul „${name}”, care nu e în lista de personaje.`); return name; };

  const scenes = (raw.scenes || []).map((scene, index) => {
    const text = String(scene.text || "").trim();
    if (!text) fail(`Scena ${index + 1} nu are text.`);
    if (words(text).length > MAX_SCENE_WORDS) fail(`Scena ${index + 1} are peste ${MAX_SCENE_WORDS} de cuvinte; împarte-o.`);
    if (!decorIds.has(scene.decor)) fail(`Scena ${index + 1} folosește decorul „${scene.decor}”, care nu există.`);
    const overlay = scene.overlay ? { type: oneOf(scene.overlay.type, OVERLAYS, "elementul grafic", undefined), text: String(scene.overlay.text || "") } : null;
    if (overlay && !overlay.type) fail(`Scena ${index + 1}: elementul grafic nu are tip.`);
    return {
      text,
      speaker: scene.speaker ? knownCharacter(scene.speaker) : null,
      decor: scene.decor,
      camera: oneOf(scene.camera, CAMERAS, "cameră", "static"),
      characters: (scene.characters || []).map((c) => ({
        name: knownCharacter(c.name),
        expression: oneOf(c.expression, EXPRESSIONS, "expresia", "neutral"),
        position: oneOf(c.position, POSITIONS, "poziție", "center"),
      })),
      overlay,
    };
  });
  if (!scenes.length) fail("Povestea nu are nicio scenă.");
  const narratorVoice = raw.narrator && raw.narrator.voice !== undefined ? raw.narrator.voice : (en ? EN_NARRATOR : RO_NARRATOR);
  return { language, narrator: { voice: narratorVoice }, characters, decors, scenes };
}

// --- decors (studio/imagegen.py: SD-Turbo through OpenVINO, Intel GPU first) ---------------
const DECOR_STYLE = "stylized 3D render, bright daylight, clean cartoonish realism, cinematic lighting, no people, no text";
const DECOR_SIZE = { width: 576, height: 1024 };
const DECOR_STEPS = 2;
const decorFile = (id) => `decor-${id}.png`;
const seedOf = (text) => crypto.createHash("sha1").update(text).digest().readUInt32BE(0) % 2147483647;

// Generates every decor that has no decor-<id>.png yet, in one imagegen run (the model loads once).
async function generateDecors(folder, story, { log = () => {} } = {}) {
  const missing = story.decors.filter((decor) => !fs.existsSync(path.join(folder, decorFile(decor.id))));
  if (!missing.length) return { generated: [] };
  const jobs = {
    model_dir: path.join(MODELS_DIR, "sd-turbo-ov"),
    ...DECOR_SIZE, steps: DECOR_STEPS, device_order: ["GPU", "CPU"],
    items: missing.map((decor) => ({ prompt: `${decor.prompt}, ${DECOR_STYLE}`, out: decorFile(decor.id), seed: seedOf(decor.id) })),
  };
  fs.writeFileSync(path.join(folder, "decor-jobs.json"), JSON.stringify(jobs, null, 2));
  try {
    const out = await run(studioPython(), [script("imagegen.py"), "decor-jobs.json"], { cwd: folder });
    for (const line of out.split(/\r?\n/).filter(Boolean)) log(`[decor] ${line}`);
  } catch (error) {
    throw new Error(`Generarea decorurilor a eșuat (imagegen): ${error.message}`);
  }
  const absent = missing.filter((decor) => !fs.existsSync(path.join(folder, decorFile(decor.id))));
  if (absent.length) throw new Error(`Decorul „${absent[0].id}” n-a fost generat.`);
  return { generated: missing.map((decor) => decor.id) };
}

// --- voice (studio/tts.py: Kokoro for English, Piper as a separate process for Romanian) ----
const GAP = 0.25;
const LAST_GAP = 0.6;
const round3 = (value) => Math.round(value * 1000) / 1000;

// Scene times on the joined voice track: each scene lasts its speech plus a short pause.
function sceneTimeline(durations, gap = GAP, lastGap = LAST_GAP) {
  let start = 0;
  return durations.map((duration, index) => {
    const speechEnd = round3(start + duration);
    const end = round3(speechEnd + (index === durations.length - 1 ? lastGap : gap));
    const scene = { start: round3(start), end, speechEnd };
    start = end;
    return scene;
  });
}

const voiceOf = (story, scene) => (scene.speaker ? story.characters.find((c) => c.name === scene.speaker).voice : story.narrator.voice);

// One WAV per scene plus the joined voice.wav. Cached in voice.json: the same texts and voices
// are not spoken again (Kokoro on the CPU takes about as long as the audio).
async function synthesizeVoices(folder, story, { log = () => {} } = {}) {
  const items = story.scenes.map((scene, index) => ({ text: scene.text, voice: voiceOf(story, scene), out: `voice-${index + 1}.wav` }));
  const key = crypto.createHash("sha1").update(JSON.stringify([story.language, items, GAP, LAST_GAP])).digest("hex");
  const cacheFile = path.join(folder, "voice.json");
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (cached.key === key && fs.existsSync(path.join(folder, "voice.wav"))) return cached.durations;
  } catch { /* no cache yet */ }
  const jobs = { language: story.language, models_dir: MODELS_DIR, gap: GAP, last_gap: LAST_GAP, items, combined: "voice.wav" };
  fs.writeFileSync(path.join(folder, "tts.json"), JSON.stringify(jobs, null, 2));
  let result;
  try {
    result = JSON.parse(await run(studioPython(), [script("tts.py"), "tts.json"], { cwd: folder }));
  } catch (error) {
    throw new Error(`Generarea vocii a eșuat (tts): ${error.message}`);
  }
  if (!Array.isArray(result.durations) || result.durations.length !== items.length) throw new Error("Vocea nu are durate pentru toate scenele.");
  log(`[voce] ${items.length} scene, ${round3(result.durations.reduce((a, b) => a + b, 0))} s`);
  fs.writeFileSync(cacheFile, JSON.stringify({ key, durations: result.durations }));
  return result.durations;
}

// --- word timings: Whisper hears the voice; the script decides the words ------------------
const normal = (word) => String(word).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Longest common subsequence of the normalized words: [[scriptIndex, heardIndex], ...].
function commonWords(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] && a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] && a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; } else if (table[i + 1][j] >= table[i][j + 1]) i += 1; else j += 1;
  }
  return pairs;
}

// Exactly the script words, in order, with times: matched words take Whisper's times, the rest
// share the time between their matched neighbours (or the range ends) evenly.
function alignWords(scriptWords, heardWords, rangeStart, rangeEnd) {
  const heard = heardWords.filter((word) => word.end > rangeStart && word.start < rangeEnd);
  const times = new Array(scriptWords.length).fill(null);
  for (const [i, j] of commonWords(scriptWords.map(normal), heard.map((word) => normal(word.word)))) {
    times[i] = { start: Math.max(rangeStart, heard[j].start), end: Math.min(rangeEnd, heard[j].end) };
  }
  for (let i = 0; i < times.length;) {
    if (times[i]) { i += 1; continue; }
    let j = i;
    while (j < times.length && !times[j]) j += 1;
    const from = i > 0 ? times[i - 1].end : rangeStart;
    const to = j < times.length ? times[j].start : rangeEnd;
    const step = Math.max(0, to - from) / (j - i);
    for (let k = i; k < j; k += 1) times[k] = { start: from + step * (k - i), end: from + step * (k - i + 1) };
    i = j;
  }
  return scriptWords.map((word, i) => ({ word, start: round3(times[i].start), end: round3(Math.max(times[i].end, times[i].start + 0.05)) }));
}

// Whisper on the joined voice (16 kHz copy), then alignment scene by scene, so a mishearing
// never moves words into another scene. Cached in words.json (keyed like the voice).
async function storyWords(folder, story, timeline) {
  const cacheFile = path.join(folder, "words.json");
  const voiceKey = (() => { try { return JSON.parse(fs.readFileSync(path.join(folder, "voice.json"), "utf8")).key; } catch { return null; } })();
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (voiceKey && cached.key === voiceKey) return cached.words;
  } catch { /* not cached */ }
  await run("ffmpeg", W.audioArgs({ output: "voice16.wav", source: "voice.wav" }), { cwd: folder });
  let heard = [];
  try {
    const out = await run("python", [path.join(ROOT, "transcribe.py"), "voice16.wav", story.language], { cwd: folder, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    heard = W.parseTranscript(out);
  } catch (error) {
    // No Whisper: the words are spread evenly over each scene's speech (still in sync per scene).
    console.warn(`[voce] Whisper: ${error.message}`);
  } finally {
    fs.rmSync(path.join(folder, "voice16.wav"), { force: true });
  }
  const words = story.scenes.flatMap((scene, index) => alignWords(scene.text.split(/\s+/).filter(Boolean), heard, timeline[index].start, timeline[index].speechEnd));
  fs.writeFileSync(cacheFile, JSON.stringify({ key: voiceKey, words }));
  return words;
}

module.exports = {
  alignWords, storyWords,
  sceneTimeline, synthesizeVoices, GAP, LAST_GAP,
  ROOT, MODELS_DIR, studioPython, script, validateStory, generateDecors, decorFile, DECOR_STYLE, DECOR_SIZE,
  CAMERAS, EXPRESSIONS, POSITIONS, OVERLAYS, HAIR, LANGUAGES,
};
