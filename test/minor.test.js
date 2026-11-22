const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVttWords, buildAss, pickCaptionTrack } = require("../subtitles");
const { countHooks, scoreWindow } = require("../clips");

const dialogues = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const words = (list) => list.map(([word, start, end]) => ({ word, start, end }));

test("ass: word starting right at clip end produces no zero-length event", () => {
  const lines = dialogues(buildAss(words([["a", 10, 19.5], ["b", 19.998, 20.5]]), 10, 20));
  assert.equal(lines.length, 1);
});

test("vtt: NOTE blocks and text cue ids are not words", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nsalut\n\nNOTE comentariu aici\ncontinuare\n\nintro\n00:00:01.000 --> 00:00:02.000\nlume\n";
  assert.deepEqual(parseVttWords(vtt).map((w) => w.word), ["salut", "lume"]);
});

test("vtt: translator credit cue is skipped", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nTraducător: Ana Pop\nCorector: Ion Ionescu\n\n00:00:04.000 --> 00:00:05.000\nBună ziua\n";
  assert.deepEqual(parseVttWords(vtt).map((w) => w.word), ["Bună", "ziua"]);
});

test("vtt: speaker-change markers (>>) and lone dashes are not words", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n&gt;&gt; No, bro. - You have\n";
  assert.deepEqual(parseVttWords(vtt).map((w) => w.word), ["No,", "bro.", "You", "have"]);
});

test("vtt: numeric and hex entities decoded", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nit&#x27;s caf&#233;\n";
  assert.deepEqual(parseVttWords(vtt).map((w) => w.word), ["it's", "café"]);
});

test("track choice: regional Romanian code counts as Romanian", () => {
  const plain = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello\n";
  assert.equal(pickCaptionTrack([{ name: "source.en-US.vtt", text: plain }, { name: "source.ro-RO.vtt", text: plain }]), "source.ro-RO.vtt");
});

test("ass: long groups get one fixed line break so the bigger word cannot re-wrap", () => {
  const ass = buildAss(words([["GOVERNMENT", 0, 0.5], ["MAJOR", 0.5, 1], ["WHICH", 1, 1.5], ["MEANS", 1.5, 2]]), 0, 5);
  assert.match(ass, /WrapStyle: 2/);
  const lines = dialogues(ass);
  assert.equal(lines.length, 4);
  for (const line of lines) assert.ok(line.replace(/\{[^}]*\}/g, "").endsWith("GOVERNMENT MAJOR\\NWHICH MEANS"), line);
});

test("ass: short groups stay on one line", () => {
  for (const line of dialogues(buildAss(words([["asta", 0, 0.5], ["e", 0.5, 1]]), 0, 5))) assert.doesNotMatch(line, /\\N/);
});

test("hooks: Romanian words ending in diacritics are matched", () => {
  assert.equal(countHooks("asta e o greșeală mare"), 1);
  assert.equal(countHooks("nimeni nu știe"), 1);
  assert.equal(countHooks("secretariat"), 0);
});

test("scoring: a two-word hook split across groups still counts", () => {
  const entry = (caption, start) => ({ caption, start, end: start + 2 });
  const withHook = scoreWindow([entry("am plecat pentru", 1), entry("că era târziu", 3)], 0, 34);
  const without = scoreWindow([entry("am plecat acasă", 1), entry("și era târziu", 3)], 0, 34);
  assert.ok(withHook > without);
});

const { rankClips } = require("../clips");

test("rankClips: 1 = best score, keeps the chronological order of the clips", () => {
  const clips = [{ start: 10, score: 2.1 }, { start: 200, score: 3.4 }, { start: 500, score: 1.2 }];
  assert.deepEqual(rankClips(clips), [2, 1, 3]);
  assert.deepEqual(rankClips([]), []);
});
