const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../whisper");

const has = (args, ...seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v));

test("parseTranscript offsets, cleans and orders words", () => {
  const out = W.parseTranscript(JSON.stringify({ language: "ro", words: [
    { word: " Bună", start: 0.2, end: 0.5 },
    { word: " -", start: 0.5, end: 0.6 },
    { word: " ziua,", start: 0.6, end: 0.6 },
    { word: " ăștia", start: 0.6, end: 1.0 },
  ] }), 100);
  assert.deepEqual(out.map((w) => w.word), ["Bună", "ziua,", "ăștia"]);
  assert.equal(out[0].start, 100.2);
  for (let i = 0; i < out.length; i += 1) {
    assert.ok(out[i].end - out[i].start >= 0.05 - 1e-9, `${out[i].word} too short`);
    if (i) assert.ok(out[i].start > out[i - 1].start, "starts strictly increasing");
  }
});

test("parseTranscript joins word pieces Whisper splits without a leading space", () => {
  const out = W.parseTranscript(JSON.stringify({ language: "en", words: [
    { word: " the", start: 0, end: 0.2 },
    { word: " non", start: 0.2, end: 0.4 },
    { word: "-procrastinators", start: 0.4, end: 1.1 },
    { word: " don't", start: 1.2, end: 1.4 },
  ] }));
  assert.deepEqual(out.map((w) => w.word), ["the", "non-procrastinators", "don't"]);
  assert.equal(out[1].start, 0.2);
  assert.equal(out[1].end, 1.1);
});

test("parseTranscript: empty or broken output gives []", () => {
  assert.deepEqual(W.parseTranscript(JSON.stringify({ language: "en", words: [] })), []);
  assert.throws(() => W.parseTranscript("not json"));
});

test("hasOriginalSubtitles: manual en counts", () => {
  assert.equal(W.hasOriginalSubtitles({ language: "de", subtitles: { "en-US": [] }, automatic_captions: {} }), true);
});

test("hasOriginalSubtitles: only auto-translated ro/en on a German video does not count", () => {
  assert.equal(W.hasOriginalSubtitles({ language: "de", subtitles: {}, automatic_captions: { ro: [], en: [], "de-orig": [], de: [] } }), false);
});

test("hasOriginalSubtitles: en-orig counts, and auto en counts when the video language is en", () => {
  assert.equal(W.hasOriginalSubtitles({ language: null, subtitles: {}, automatic_captions: { "en-orig": [] } }), true);
  assert.equal(W.hasOriginalSubtitles({ language: "en", subtitles: {}, automatic_captions: { en: [], ro: [] } }), true);
  assert.equal(W.hasOriginalSubtitles({ language: "en", subtitles: {}, automatic_captions: {} }), false);
  assert.equal(W.hasOriginalSubtitles({}), false);
});

test("estimateMinutes rounds up and is at least 1", () => {
  assert.equal(W.estimateMinutes(0), 1);
  assert.equal(W.estimateMinutes(10), 1);
  assert.equal(W.estimateMinutes(3600), Math.ceil(3600 * W.FACTOR / 60));
});

test("audioArgs extracts 16 kHz mono wav for a range", () => {
  const args = W.audioArgs({ start: 10, end: 44, output: "clip-1.wav" });
  assert.ok(has(args, "-ss", "10", "-i", "source.mp4"));
  assert.ok(has(args, "-t", "34"));
  assert.ok(has(args, "-ar", "16000"));
  assert.ok(has(args, "-ac", "1"));
  assert.ok(args.includes("-vn"));
  assert.equal(args.at(-1), "clip-1.wav");
  const whole = W.audioArgs({ output: "all.wav" });
  assert.ok(!whole.includes("-ss"));
  assert.ok(!whole.includes("-t"));
});

test("chunkPlan: 10-minute windows overlap 5 s on both sides of each seam", () => {
  // Audio starts before keepFrom so a word that began just before the seam is heard whole
  // (and dropped, it belongs to the previous window) instead of as a new truncated word.
  assert.deepEqual(W.chunkPlan(1250, 600, 5), [
    { start: 0, end: 605, keepFrom: 0, keepTo: 600 },
    { start: 595, end: 1205, keepFrom: 600, keepTo: 1200 },
    { start: 1195, end: 1250, keepFrom: 1200, keepTo: Infinity },
  ]);
  assert.deepEqual(W.chunkPlan(30, 600, 5), [{ start: 0, end: 30, keepFrom: 0, keepTo: Infinity }]);
});

test("mergeChunks keeps each word once, from the chunk that owns its start", () => {
  const plan = W.chunkPlan(1250, 600, 5);
  const merged = W.mergeChunks([
    { chunk: plan[0], words: [{ word: "a", start: 10, end: 11 }, { word: "edge", start: 599.5, end: 600.4 }, { word: "dup", start: 601, end: 602 }] },
    // Real seam case: the word started at 599.95, so the next window hears it whole and skips it.
    { chunk: plan[1], words: [{ word: "edge", start: 599.5, end: 600.4 }, { word: "dup", start: 601, end: 602 }, { word: "b", start: 900, end: 901 }] },
    { chunk: plan[2], words: [{ word: "c", start: 1210, end: 1211 }] },
  ]);
  assert.deepEqual(merged.map((x) => x.word), ["a", "edge", "dup", "b", "c"]);
});

test("trackLanguage reads the language of a subtitle track file name", () => {
  assert.equal(W.trackLanguage("source.en-orig.vtt"), "en");
  assert.equal(W.trackLanguage("source.ro.vtt"), "ro");
  assert.equal(W.trackLanguage("source.ro-RO.vtt"), "ro");
  assert.equal(W.trackLanguage("whisper"), null);
  assert.equal(W.trackLanguage(undefined), null);
});

test("hasOriginalSubtitles uses exactly the languages that get downloaded", () => {
  assert.equal(W.hasOriginalSubtitles({ language: "en", subtitles: { "en-CA": [] }, automatic_captions: {} }), false, "en-CA is not downloaded");
  assert.equal(W.hasOriginalSubtitles({ language: "ro", subtitles: { "ro-MD": [] }, automatic_captions: {} }), false);
  assert.equal(W.hasOriginalSubtitles({ language: "en", subtitles: { "en-GB": [] }, automatic_captions: {} }), true);
  assert.equal(W.SUB_LANGS, "ro,ro-orig,ro-RO,en,en-orig,en-US,en-GB");
});
