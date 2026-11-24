// Story script → scenes. The local AI (Ollama) groups the sentences into scenes and picks decors,
// characters, camera and overlays; it only answers with sentence indices, so Enea's text can
// never be changed. Whatever the answer, the result covers every sentence once, in order.
// Without a usable answer, rulesStoryboard makes one scene per sentence.
const S = require("./studio");

const LONG = 12;        // sentences longer than this many words are cut (~4 s of voice)
const FORCE_CUT = 30;   // no comma or conjunction at all: cut in the middle above this
const MAX_SCENE_SENTENCES = 2;
const MAX_SCENE_WORDS = 40;
const MAX_DECORS = 10;
const CONJUNCTIONS = new Set(["and", "but", "și", "dar"]);
const SPEAKER = /^([A-Z][A-Z0-9_]{1,19}):\s+(.*)$/;

const wordsOf = (text) => text.split(/\s+/).filter(Boolean);

// A long sentence is cut where a pause is natural: after a comma or before and/but/și/dar,
// as close to the middle as possible, leaving at least 3 words on each side.
function cut(words) {
  if (words.length <= LONG) return [words];
  const candidates = [];
  for (let k = 3; k <= words.length - 3; k += 1) {
    if (/,$/.test(words[k - 1]) || CONJUNCTIONS.has(words[k].toLowerCase())) candidates.push(k);
  }
  let at = candidates.sort((a, b) => Math.abs(a - words.length / 2) - Math.abs(b - words.length / 2))[0];
  if (at === undefined) {
    if (words.length <= FORCE_CUT) return [words];
    at = Math.floor(words.length / 2);
  }
  return [...cut(words.slice(0, at)), ...cut(words.slice(at))];
}

function splitScript(text) {
  const sentences = [];
  const characters = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    let lineSpeaker = null;
    const dialogue = line.match(SPEAKER);
    if (dialogue) [, lineSpeaker, line] = dialogue;
    for (let sentence of line.split(/(?<=[.!?…])\s+/)) {
      let speaker = lineSpeaker;
      const inline = sentence.match(SPEAKER);
      if (inline) [, speaker, sentence] = inline;
      if (speaker && !characters.includes(speaker)) characters.push(speaker);
      for (const piece of cut(wordsOf(sentence))) {
        if (piece.length) sentences.push({ i: sentences.length, text: piece.join(" "), speaker });
      }
    }
  }
  return { sentences, characters };
}

const STORYBOARD_SCHEMA = {
  type: "object",
  properties: {
    decors: { type: "array", items: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" } }, required: ["id", "prompt"] } },
    characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, hair: { type: "string" }, shirt: { type: "string" } }, required: ["name"] } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "integer" }, to: { type: "integer" }, decor: { type: "string" }, camera: { type: "string" },
          characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, expression: { type: "string" }, position: { type: "string" } }, required: ["name"] } },
          overlay_type: { type: "string" }, overlay_text: { type: "string" },
        },
        required: ["from", "to", "decor", "camera"],
      },
    },
  },
  required: ["decors", "scenes"],
};

const minDecors = (sentences) => Math.min(8, Math.max(3, Math.ceil(sentences / 3)));

// Decors must not contain people (the characters are drawn on top); the 7b model still writes
// "…, a small team working" or "with people walking". Clauses about people are dropped.
const PEOPLE = /\b(people|persons?|man|men|woman|women|team|crowd|kids?|child|children|boys?|girls?|commuters?|workers?|drivers?|mayor|officers?|engineers?|someone|guys?|family|students?|passengers?|pedestrians?|tourists?)\b/i;
function cleanDecorPrompt(prompt) {
  const parts = String(prompt).split(/(,\s*|\s+with\s+|\s+and\s+|\s+where\s+|\s+while\s+)/i);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    if (PEOPLE.test(parts[i])) continue;
    out += (out && i > 0 ? parts[i - 1] : "") + parts[i];
  }
  return out.trim() || String(prompt).trim();
}

// The reference style has a character in almost every scene; the 7b model leaves most empty.
// Empty scenes get the story's main character (most present), with his last expression/position.
function fillCharacters(scenes, names) {
  if (!names.size) return;
  const count = new Map();
  for (const scene of scenes) for (const c of scene.characters) count.set(c.name, (count.get(c.name) || 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || [...names][0];
  let last = { expression: "neutral", position: "center" };
  for (const scene of scenes) {
    const present = scene.characters.find((c) => c.name === main);
    if (present) last = present;
    else if (!scene.characters.length) scene.characters.push({ name: main, expression: last.expression, position: last.position });
  }
}

function buildStoryboardPrompt(sentences, language) {
  const speakers = [...new Set(sentences.map((s) => s.speaker).filter(Boolean))];
  return [
    "You turn a short narrated story into a storyboard for a vertical TikTok video with simple 2D cartoon characters over illustrated backgrounds.",
    `The story is in ${language === "ro" ? "Romanian" : "English"}. Do NOT rewrite it: refer to sentences only by their [number].`,
    `1. decors: the places of the story. Make a NEW decor every time the place or the moment changes, and for the key image of the story: at least ${minDecors(sentences.length)} decors (about one for every 2-3 sentences, up to 8). id: short lowercase slug. prompt: a short visual description IN ENGLISH of the place or object only: NO people, no text.`,
    `2. characters: the speakers (${speakers.join(", ") || "none"}) plus 1 or 2 invented characters the story talks about (e.g. DRIVER, KID, BOSS; name in CAPITALS). hair: one of ${S.HAIR.join(", ")}. shirt: a #rrggbb color.`,
    "3. scenes: in order, each covering 1 or 2 consecutive sentences (from, to = sentence numbers, inclusive), together covering every sentence exactly once.",
    `   camera: one of ${S.CAMERAS.join(", ")}; vary it, never the same twice in a row. characters on screen: show the people the sentence is about in MOST scenes, [{name, expression, position}], expression one of ${S.EXPRESSIONS.join(", ")} matching the mood, position one of ${S.POSITIONS.join(", ")}. A sentence said by a character must show that character.`,
    `   overlay_type: one of ${S.OVERLAYS.join(", ")} or "" (in about a third of the scenes: badge for numbers, sign for rules or labels, money for money, flash for a camera or a shock, emoji for a feeling). overlay_text: at most 4 words ("" for money and flash).`,
    "Reply in JSON only.",
    "",
    "Example for a different story ([0] Tom loved fast cars. [1] Every night he raced on the highway. [2] (OFFICER) Pull over, now! [3] The fine was 500 dollars. [4] He never raced again.):",
    JSON.stringify({
      decors: [{ id: "garage", prompt: "a home garage with a shiny red sports car" }, { id: "highway", prompt: "a highway at night with city lights" }, { id: "roadside", prompt: "a police car parked on a dark roadside" }, { id: "kitchen", prompt: "a quiet kitchen in the morning" }],
      characters: [{ name: "TOM", hair: "short", shirt: "#3b82f6" }, { name: "OFFICER", hair: "cap", shirt: "#1e3a8a" }],
      scenes: [
        { from: 0, to: 0, decor: "garage", camera: "zoom-in", characters: [{ name: "TOM", expression: "happy", position: "left" }], overlay_type: "", overlay_text: "" },
        { from: 1, to: 1, decor: "highway", camera: "pan-right", characters: [{ name: "TOM", expression: "smug", position: "center" }], overlay_type: "badge", overlay_text: "180 KM/H" },
        { from: 2, to: 2, decor: "roadside", camera: "zoom-in", characters: [{ name: "OFFICER", expression: "angry", position: "right" }, { name: "TOM", expression: "surprised", position: "left" }], overlay_type: "flash", overlay_text: "" },
        { from: 3, to: 3, decor: "roadside", camera: "zoom-out", characters: [{ name: "TOM", expression: "sad", position: "center" }], overlay_type: "money", overlay_text: "" },
        { from: 4, to: 4, decor: "kitchen", camera: "pan-left", characters: [{ name: "TOM", expression: "neutral", position: "center" }], overlay_type: "", overlay_text: "" },
      ],
    }),
    "",
    "Story (sentence number, speaker if any, text):",
    ...sentences.map((s) => `[${s.i}] ${s.speaker ? `(${s.speaker}) ` : ""}${s.text}`),
  ].join("\n");
}

const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);

// Scenes over [from..to]: split so a scene never mixes speakers, never has more than 2 sentences
// or more than 40 words.
function chunks(sentences, from, to) {
  const out = [];
  let current = [];
  for (let i = from; i <= to; i += 1) {
    const s = sentences[i];
    const words = current.reduce((n, x) => n + wordsOf(x.text).length, 0) + wordsOf(s.text).length;
    if (current.length && (current.length >= MAX_SCENE_SENTENCES || current[0].speaker !== s.speaker || words > MAX_SCENE_WORDS)) {
      out.push(current);
      current = [];
    }
    current.push(s);
  }
  if (current.length) out.push(current);
  return out;
}

function sceneFrom(group, attrs, names) {
  const speaker = group[0].speaker;
  const seen = new Set();
  const characters = [];
  for (const c of attrs.characters || []) {
    if (!c || !names.has(c.name) || seen.has(c.name)) continue;
    seen.add(c.name);
    characters.push({ name: c.name, expression: pick(c.expression, S.EXPRESSIONS, "neutral"), position: pick(c.position, S.POSITIONS, "center") });
  }
  if (speaker && !seen.has(speaker)) characters.push({ name: speaker, expression: "neutral", position: "center" });
  const type = pick(attrs.overlay_type, S.OVERLAYS, null);
  return {
    text: group.map((s) => s.text).join(" "),
    speaker,
    decor: attrs.decor,
    camera: pick(attrs.camera, S.CAMERAS, "static"),
    characters: characters.slice(0, 3),
    overlay: type ? { type, text: ["money", "flash"].includes(type) ? "" : String(attrs.overlay_text || "").trim().slice(0, 30) } : null,
  };
}

// The 7b model tends to answer "static" everywhere (seen on 2026-11-24: 15/15 scenes): a static
// camera becomes the next move of a rotation, and no two scenes in a row get the same move.
const ROTATION = ["zoom-in", "pan-left", "zoom-out", "pan-right"];
function varyCameras(scenes) {
  let next = 0;
  scenes.forEach((scene, index) => {
    const previous = index > 0 ? scenes[index - 1].camera : null;
    if (scene.camera !== "static" && scene.camera !== previous) return;
    for (let tries = 0; tries < ROTATION.length; tries += 1) {
      const candidate = ROTATION[next % ROTATION.length];
      next += 1;
      const following = scenes[index + 1]?.camera;
      if (candidate !== previous && candidate !== following) { scene.camera = candidate; return; }
    }
  });
}

function parseStoryboard(raw, split, language) {
  let answer = raw;
  if (typeof answer === "string") { try { answer = JSON.parse(answer); } catch { return null; } }
  if (!answer || !Array.isArray(answer.decors) || !Array.isArray(answer.scenes)) return null;
  const decors = [];
  for (const decor of answer.decors) {
    const id = slug(decor && decor.id);
    const prompt = cleanDecorPrompt(String((decor && decor.prompt) || "").trim());
    if (id && prompt && !decors.some((d) => d.id === id) && decors.length < MAX_DECORS) decors.push({ id, prompt });
  }
  if (!decors.length) return null;
  const decorIds = new Set(decors.map((d) => d.id));

  const characters = split.characters.map((name) => ({ name }));
  for (const c of answer.characters || []) {
    const name = String((c && c.name) || "").trim().toUpperCase();
    const known = characters.find((x) => x.name === name);
    const look = {};
    if (S.HAIR.includes(c && c.hair)) look.hair = c.hair;
    if (/^#[0-9a-f]{6}$/i.test((c && c.shirt) || "")) look.shirt = c.shirt;
    if (known) known.look = look;
    else if (/^[A-Z][A-Z0-9_]{1,19}$/.test(name) && characters.length < split.characters.length + 2) characters.push({ name, look });
  }
  const names = new Set(characters.map((c) => c.name));

  const { sentences } = split;
  const scenes = [];
  let cursor = 0;
  let lastDecor = decors[0].id;
  const fill = (until) => {
    if (until <= cursor) return;
    for (const group of chunks(sentences, cursor, until - 1)) scenes.push(sceneFrom(group, { decor: lastDecor, camera: "static" }, names));
    cursor = until;
  };
  const ordered = answer.scenes.filter((s) => s && Number.isInteger(s.from) && Number.isInteger(s.to)).sort((a, b) => a.from - b.from);
  for (const scene of ordered) {
    const from = Math.max(scene.from, cursor);
    const to = Math.min(scene.to, sentences.length - 1);
    if (to < from) continue;
    fill(from);
    const decor = decorIds.has(slug(scene.decor)) ? slug(scene.decor) : lastDecor;
    for (const group of chunks(sentences, from, to)) {
      scenes.push(sceneFrom(group, { ...scene, decor, characters: (scene.characters || []).map((c) => ({ ...c, name: String((c && c.name) || "").toUpperCase() })) }, names));
    }
    lastDecor = decor;
    cursor = to + 1;
  }
  fill(sentences.length);
  fillCharacters(scenes, names);
  varyCameras(scenes);
  const used = new Set(scenes.map((s) => s.decor));
  return { language, characters, decors: decors.filter((d) => used.has(d.id)), scenes };
}

function rulesStoryboard(split, language) {
  const names = new Set(split.characters);
  const scenes = split.sentences.map((s, index) => sceneFrom([s], { decor: "scene", camera: index % 2 ? "zoom-out" : "zoom-in" }, names));
  return {
    language,
    characters: split.characters.map((name) => ({ name })),
    decors: [{ id: "scene", prompt: "a simple colorful background for a short story" }],
    scenes,
  };
}

module.exports = { splitScript, buildStoryboardPrompt, parseStoryboard, rulesStoryboard, cleanDecorPrompt, STORYBOARD_SCHEMA };
