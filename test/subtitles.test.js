const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVttWords } = require("../subtitles");

const AUTO = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%

hello<00:00:01.500><c> world</c><00:00:02.200><c> &amp;again</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
hello world &amp;again


00:00:03.010 --> 00:00:05.000 align:start position:0%
hello world &amp;again
this<00:00:03.600><c> is</c><00:00:03.600><c> fine</c>
`;

test("auto subs: words with timings, repeated lines dropped, entities decoded", () => {
  const words = parseVttWords(AUTO);
  assert.deepEqual(words.map((w) => w.word), ["hello", "world", "&again", "this", "is", "fine"]);
  assert.deepEqual(words.slice(0, 3).map((w) => [w.start, w.end]), [[1, 1.5], [1.5, 2.2], [2.2, 3]]);
  assert.equal(words[3].start, 3.01);
});

test("same-timestamp words get at least 0.05 s", () => {
  const words = parseVttWords(AUTO);
  for (const w of words) assert.ok(w.end - w.start >= 0.05 - 1e-9, `${w.word} too short`);
});

test("manual subs fallback: duration split by letter count", () => {
  const words = parseVttWords("WEBVTT\n\n00:00:00.000 --> 00:00:01.800\nSalut lume\n");
  assert.deepEqual(words.map((w) => w.word), ["Salut", "lume"]);
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 1.0) < 1e-6);
  assert.ok(Math.abs(words[1].end - 1.8) < 1e-6);
});

const { groupWords, buildAss } = require("../subtitles");
const w = (word, start, end) => ({ word, start, end });

test("groups: max 4, break on punctuation and pauses > 0.6 s", () => {
  const g = groupWords([w("a",0,.2), w("b",.2,.4), w("c,",.4,.6), w("d",.6,.8), w("e",.8,1), w("f",1,1.2), w("g",1.2,1.4), w("h",1.4,1.6), w("i",2.5,2.7)]);
  assert.deepEqual(g.map((x) => x.map((y) => y.word)), [["a","b","c,"], ["d","e","f","g"], ["h"], ["i"]]);
});

test("ass: header style and one Dialogue per word with active highlight", () => {
  const ass = buildAss([w("asta",10,10.4), w("e",10.4,10.6), w("greșeala",10.6,11.2)], 10, 20);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Default,Arial Black,90,&H00FFFFFF,/);
  const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /0:00:00\.00,0:00:00\.40/);
  assert.match(lines[2], /ASTA E \{\\c&H00E6FF&\\fscx112\\fscy112\}GREȘEALA\{\\r\}/);
});

test("ass: words clamped to clip window", () => {
  const ass = buildAss([w("x",9.5,10.3), w("y",19.8,20.6)], 10, 20);
  const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.match(lines[0], /0:00:00\.00,/);
  assert.match(lines.at(-1), /,0:00:10\.00,/);
});

test("ass: braces and backslashes stripped, diacritics uppercased", () => {
  const ass = buildAss([w("{\\b1}țară\\", 0, 1)], 0, 5);
  assert.match(ass, /ȚARĂ\{\\r\}/);
  assert.doesNotMatch(ass, /\\b1/);
});

test("ass: every event ends after it starts, even for same-timestamp words", () => {
  const lines = buildAss(parseVttWords(AUTO), 0, 10).split("\n").filter((l) => l.startsWith("Dialogue:"));
  const secs = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };
  for (const line of lines) {
    const [, start, end] = line.split(",");
    assert.ok(secs(end) > secs(start), line);
  }
});

test("ass: split layout centres text on the middle line", () => {
  const style = (ass) => ass.split("\n").find((l) => l.startsWith("Style:")).split(",");
  const normal = style(buildAss([w("a", 0, 1)], 0, 5));
  const split = style(buildAss([w("a", 0, 1)], 0, 5, { split: true }));
  assert.equal(normal[18], "2");
  assert.equal(normal[21], "480");
  assert.equal(split[18], "5");
  assert.equal(split[21], "0");
});

const { pickCaptionTrack } = require("../subtitles");

test("track choice: word-timed track beats a Romanian one without word timings", () => {
  const manualRo = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSalut lume\n";
  assert.equal(pickCaptionTrack([{ name: "source.ro.vtt", text: manualRo }, { name: "source.en-orig.vtt", text: AUTO }]), "source.en-orig.vtt");
});

test("track choice: Romanian preferred when both are equally timed", () => {
  const plain = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello\n";
  assert.equal(pickCaptionTrack([{ name: "source.en.vtt", text: plain }, { name: "source.ro.vtt", text: plain }]), "source.ro.vtt");
  assert.equal(pickCaptionTrack([{ name: "source.en-orig.vtt", text: AUTO }, { name: "source.ro-orig.vtt", text: AUTO }]), "source.ro-orig.vtt");
});

test("groupWords with maxGroup 2 never groups more than 2 words", () => {
  const { groupWords } = require("../subtitles");
  const words = "one two three four five six seven".split(" ").map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const groups = groupWords(words, { maxGroup: 2 });
  assert.ok(groups.every((group) => group.length <= 2));
  assert.equal(groups.flat().length, 7);
  assert.ok(groupWords(words).some((group) => group.length > 2), "default still groups up to 4");
});
