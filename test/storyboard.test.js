const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../storyboard");
const S = require("../studio");

const joined = (story) => story.scenes.map((scene) => scene.text).join(" ");

test("splitScript splits sentences and dialogue lines", () => {
  const split = B.splitScript("Hello there. How are you?\nMAYOR: Pay them!");
  assert.deepEqual(split.sentences.map((s) => [s.i, s.text, s.speaker]), [[0, "Hello there.", null], [1, "How are you?", null], [2, "Pay them!", "MAYOR"]]);
  assert.deepEqual(split.characters, ["MAYOR"]);
});

test("splitScript cuts long sentences at commas and conjunctions", () => {
  const long = "In the summer of that year the whole city council met, and nobody had a single idea about the traffic.";
  const { sentences } = B.splitScript(long);
  assert.equal(sentences.length, 2);
  assert.equal(sentences.map((s) => s.text).join(" "), long);
  assert.ok(sentences.every((s) => s.text.split(" ").length >= 3));
});

const SCRIPT = "The street was fast. Fines did nothing. MAYOR: Pay the good drivers! Speed dropped.";

test("parseStoryboard keeps every sentence exactly once, in order", () => {
  const split = B.splitScript(SCRIPT);
  const raw = JSON.stringify({
    decors: [{ id: "street", prompt: "a city street" }, { id: "office", prompt: "an office" }],
    characters: [{ name: "MAYOR", hair: "cap", shirt: "#ff0000" }],
    scenes: [
      { from: 0, to: 1, decor: "street", camera: "zoom-in", characters: [], overlay_type: "badge", overlay_text: "52 KM/H" },
      { from: 3, to: 3, decor: "street", camera: "pan-left", characters: [], overlay_type: "", overlay_text: "" },
    ],
  });
  const story = B.parseStoryboard(raw, split, "en");
  assert.ok(story);
  assert.equal(joined(story), split.sentences.map((s) => s.text).join(" "));
  assert.equal(story.scenes.length, 3);
  assert.equal(story.scenes[1].speaker, "MAYOR");
  assert.doesNotThrow(() => S.validateStory(story));
});

test("parseStoryboard drops unknown expressions/cameras to defaults and adds the speaker to his scene", () => {
  const split = B.splitScript("MAYOR: Pay them!\nThe end.");
  const raw = JSON.stringify({
    decors: [{ id: "office", prompt: "an office" }],
    characters: [],
    scenes: [
      { from: 0, to: 0, decor: "office", camera: "spin", characters: [{ name: "MAYOR", expression: "furious", position: "top" }] },
      { from: 1, to: 1, decor: "nowhere", camera: "static", characters: [{ name: "GHOST", expression: "happy", position: "left" }] },
    ],
  });
  const story = S.validateStory(B.parseStoryboard(raw, split, "en"));
  assert.ok(S.CAMERAS.includes(story.scenes[0].camera) && story.scenes[0].camera !== "static", story.scenes[0].camera);
  assert.deepEqual(story.scenes[0].characters, [{ name: "MAYOR", expression: "neutral", position: "center" }]);
  assert.equal(story.scenes[1].decor, "office", "unknown decor → previous scene's decor");
  assert.deepEqual(story.scenes[1].characters, [], "unknown character dropped");
});

test("parseStoryboard returns null for garbage", () => {
  const split = B.splitScript(SCRIPT);
  assert.equal(B.parseStoryboard("not json", split, "en"), null);
  assert.equal(B.parseStoryboard(JSON.stringify({ decors: [], scenes: [] }), split, "en"), null);
});

test("rulesStoryboard makes one scene per sentence and passes validateStory", () => {
  const split = B.splitScript(SCRIPT);
  const story = S.validateStory(B.rulesStoryboard(split, "ro"));
  assert.equal(story.scenes.length, split.sentences.length);
  assert.equal(story.language, "ro");
  assert.equal(joined(story), split.sentences.map((s) => s.text).join(" "));
  assert.deepEqual(story.scenes[2].characters, [{ name: "MAYOR", expression: "neutral", position: "center" }]);
});

test("buildStoryboardPrompt lists sentences with indices and the allowed values", () => {
  const prompt = B.buildStoryboardPrompt(B.splitScript(SCRIPT).sentences, "en");
  assert.match(prompt, /\[0\] The street was fast\./);
  assert.match(prompt, /\[2\] \(MAYOR\) Pay the good drivers!/);
  for (const value of [...S.CAMERAS, ...S.EXPRESSIONS, ...S.OVERLAYS]) assert.ok(prompt.includes(value), value);
});

test("parseStoryboard turns static cameras into a varied rotation (no two equal in a row)", () => {
  const split = B.splitScript("One. Two. Three. Four. Five.");
  const raw = JSON.stringify({ decors: [{ id: "a", prompt: "a place" }], characters: [], scenes: [0, 1, 2, 3, 4].map((i) => ({ from: i, to: i, decor: "a", camera: i === 2 ? "pan-left" : "static" })) });
  const cams = B.parseStoryboard(raw, split, "en").scenes.map((s) => s.camera);
  assert.ok(!cams.includes("static"), cams.join(","));
  for (let i = 1; i < cams.length; i += 1) assert.notEqual(cams[i], cams[i - 1], cams.join(","));
  assert.equal(cams[2], "pan-left", "a chosen move is kept");
});
