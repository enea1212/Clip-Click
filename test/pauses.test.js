const test = require("node:test");
const assert = require("node:assert/strict");
const { speechSegments, remapWords, totalDuration } = require("../pauses");

const w = (word, start, end) => ({ word, start, end });
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length, JSON.stringify(actual));
  actual.forEach((seg, i) => {
    assert.ok(Math.abs(seg.start - expected[i].start) < 1e-9, `start ${i}: ${seg.start}`);
    assert.ok(Math.abs(seg.end - expected[i].end) < 1e-9, `end ${i}: ${seg.end}`);
  });
};
const WORDS = [w("a", 101, 101.5), w("b", 101.6, 102), w("c", 103, 103.4)];

test("segments: gaps over 0.4 s split speech, padding 0.1 s, edges trimmed", () => {
  near(speechSegments(WORDS, 100, 110), [{ start: 0.9, end: 2.1 }, { start: 2.9, end: 3.5 }]);
});

test("segments: overlapping paddings merge, gap exactly 0.4 does not split", () => {
  near(speechSegments([w("a", 0, 1), w("b", 1.4, 2)], 0, 10), [{ start: 0, end: 2.1 }]);
});

test("segments: words straddling clip edges are clamped", () => {
  // Mostly inside the clip (words mostly outside are dropped, see the sliver test below).
  const segs = speechSegments([w("x", 9.9, 10.6), w("y", 19.5, 20.1)], 10, 20);
  assert.equal(segs[0].start, 0);
  assert.equal(segs.at(-1).end, 10);
  for (const s of segs) assert.ok(s.end > s.start);
});

test("segments: no words gives []", () => {
  assert.deepEqual(speechSegments([], 0, 10), []);
  assert.deepEqual(speechSegments([w("far", 50, 51)], 0, 10), []);
});

test("remap: words move onto the cut timeline", () => {
  const segs = speechSegments(WORDS, 100, 110);
  const out = remapWords(WORDS, 100, segs);
  assert.deepEqual(out.map((x) => x.word), ["a", "b", "c"]);
  const expected = [[0.1, 0.6], [0.7, 1.1], [1.3, 1.7]];
  out.forEach((x, i) => {
    assert.ok(Math.abs(x.start - expected[i][0]) < 1e-9, `${x.word} start ${x.start}`);
    assert.ok(Math.abs(x.end - expected[i][1]) < 1e-9, `${x.word} end ${x.end}`);
  });
});

test("totalDuration sums segments", () => {
  assert.ok(Math.abs(totalDuration(speechSegments(WORDS, 100, 110)) - 1.8) < 1e-9);
});

test("segments: a sliver of a word mostly outside the clip is ignored (no flash at the start)", () => {
  // Real case: "Why." 179.84–180.06 before a clip starting at 180, next word at 180.64.
  const words = [w("Why.", 179.84, 180.06), w("And", 180.64, 180.9), w("then", 180.9, 181.2)];
  const segs = speechSegments(words, 180, 214);
  assert.equal(segs.length, 1);
  assert.ok(Math.abs(segs[0].start - 0.54) < 1e-9, `starts at ${segs[0].start}`);
  assert.deepEqual(remapWords(words, 180, segs).map((x) => x.word), ["And", "then"]);
});

test("segments: a word mostly inside the clip is kept even if it starts just before", () => {
  const segs = speechSegments([w("long", 99.9, 100.8)], 100, 110);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].start, 0);
});
