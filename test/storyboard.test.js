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
  assert.ok(!story.scenes[1].characters.some((c) => c.name === "GHOST"), "unknown character dropped");
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

test("cleanDecorPrompt removes people from decor descriptions", () => {
  assert.equal(B.cleanDecorPrompt("a night scene with the station lights on, a small team working"), "a night scene with the station lights on");
  assert.equal(B.cleanDecorPrompt("a morning scene with people walking and a man stepping on the stairs"), "a morning scene");
  assert.equal(B.cleanDecorPrompt("an empty subway station with an escalator and stairs"), "an empty subway station with an escalator and stairs");
  assert.equal(B.cleanDecorPrompt("a crowd"), "", "a decor that is only people is unusable");
  // Seen 2026-11-27 ("The Coffee Shop Trick"): customers and busy rooms ended up full of people.
  assert.equal(B.cleanDecorPrompt("the coffee shop in summer with more customers"), "the coffee shop in summer");
  assert.equal(B.cleanDecorPrompt("a busy morning in the coffee shop"), "a quiet morning in the coffee shop");
  assert.equal(B.cleanDecorPrompt("a customer holding a cup with a name on it"), "", "the subject is a person");
  assert.equal(B.cleanDecorPrompt("post online"), "", "no place in it");
});

test("parseStoryboard drops unusable decors; their scenes keep the previous decor", () => {
  const split = B.splitScript("One. Two. Three.");
  const raw = JSON.stringify({ decors: [{ id: "shop", prompt: "a cozy coffee shop" }, { id: "online", prompt: "post online" }], characters: [],
    scenes: [{ from: 0, to: 0, decor: "shop" }, { from: 1, to: 1, decor: "online" }, { from: 2, to: 2, decor: "shop" }] });
  const story = B.parseStoryboard(raw, split, "en");
  assert.deepEqual(story.decors.map((d) => d.id), ["shop"]);
  assert.deepEqual(story.scenes.map((s) => s.decor), ["shop", "shop", "shop"]);
});

test("a story with no characters at all gets a main character from the text", () => {
  const split = B.splitScript("A small coffee shop was about to close. Every morning, the owner sold only forty cups. Then she tried one trick.");
  const raw = JSON.stringify({ decors: [{ id: "shop", prompt: "a cozy coffee shop" }], characters: [], scenes: [{ from: 0, to: 2, decor: "shop" }] });
  const story = B.parseStoryboard(raw, split, "en");
  assert.equal(story.characters.length, 1);
  assert.equal(story.characters[0].name, "OWNER");
  assert.equal(story.characters[0].look.hair, "long", "she → long hair");
  assert.ok(story.scenes.every((s) => s.characters.some((c) => c.name === "OWNER")));
  const ro = B.parseStoryboard(raw, B.splitScript("Șoferul a mers prea repede. El a primit o amendă. A plătit."), "ro");
  assert.equal(ro.characters[0].name, "DRIVER", "Romanian roles get the same English labels");
  assert.equal(B.parseStoryboard(raw, B.splitScript("It rained. Then it stopped. The end."), "en").characters[0].name, "HERO");
  assert.equal(B.rulesStoryboard(split, "en").scenes.filter((s) => s.characters.length).length, split.sentences.length, "rules too");
});

test("parseStoryboard puts a character in most scenes when the AI left them empty", () => {
  const split = B.splitScript("One. Two. Three. Four. Five. Six.");
  const raw = JSON.stringify({ decors: [{ id: "a", prompt: "a place" }], characters: [{ name: "TOM", hair: "short", shirt: "#ff0000" }],
    scenes: [0, 1, 2, 3, 4, 5].map((i) => ({ from: i, to: i, decor: "a", camera: "zoom-in", characters: i === 2 ? [{ name: "TOM", expression: "happy", position: "left" }] : [] })) });
  const scenes = B.parseStoryboard(raw, split, "en").scenes;
  const withPeople = scenes.filter((s) => s.characters.length).length;
  assert.ok(withPeople >= 4, `${withPeople}/6`);
  assert.deepEqual(scenes[2].characters, [{ name: "TOM", expression: "happy", position: "left" }], "the AI's choice is kept");
});

test("buildStoryboardPrompt asks for one decor every 2-3 scenes", () => {
  const prompt = B.buildStoryboardPrompt(B.splitScript(Array.from({ length: 18 }, (_, i) => `Sentence ${i}.`).join(" ")).sentences, "en");
  assert.match(prompt, /at least 6 decors/);
});

const overlayOf = (text, overlay_type, overlay_text = "") => {
  const split = B.splitScript(text);
  const raw = JSON.stringify({ decors: [{ id: "a", prompt: "a place" }], characters: [], scenes: [{ from: 0, to: split.sentences.length - 1, decor: "a", camera: "zoom-in", overlay_type, overlay_text }] });
  return B.parseStoryboard(raw, split, "en").scenes[0].overlay;
};

test("overlays fit the text: money only for money, numbers become a badge", () => {
  assert.deepEqual(overlayOf("That day, sixty-six percent more people chose the stairs.", "money"), { type: "badge", text: "+66%" });
  assert.deepEqual(overlayOf("The fine was 500 dollars.", "money"), { type: "money", text: "" }, "money stays when the text is about money");
  assert.deepEqual(overlayOf("Average speed dropped from thirty-two to twenty-five.", "money"), { type: "badge", text: "25" });
  assert.equal(overlayOf("So one night, a team came.", "money"), null, "no money, no number: no overlay");
});

test("a badge without any digit becomes a sign; a number in the text with no overlay gets a badge", () => {
  assert.deepEqual(overlayOf("So one night, a team came.", "badge", "MUSIC STAIRS"), { type: "sign", text: "MUSIC STAIRS" });
  assert.deepEqual(overlayOf("Speed dropped by 22 percent.", ""), { type: "badge", text: "-22%" });
  assert.equal(overlayOf("In 2009, a station had a problem.", ""), null, "a year is not a badge");
});

test("numberWords reads English and Romanian number words", () => {
  assert.equal(B.numberWords("sixty-six"), 66);
  assert.equal(B.numberWords("twenty five"), 25);
  assert.equal(B.numberWords("one hundred"), 100);
  assert.equal(B.numberWords("treizeci și doi"), 32);
  assert.equal(B.numberWords("hello"), null);
});
