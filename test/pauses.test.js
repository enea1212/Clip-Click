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
  const segs = speechSegments([w("x", 9.5, 10.3), w("y", 19.8, 20.6)], 10, 20);
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
