const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseCandidates } = require("../clips");
const A = require("../ai");

const w = (word, start, end) => ({ word, start, end });

// A transcript of word groups like the server builds (caption + start/end), dense enough to score.
function transcript(seconds, busyFrom = -1, busyTo = -1) {
  const entries = [];
  for (let t = 0; t + 2 <= seconds; t += 2) {
    const busy = t >= busyFrom && t < busyTo;
    entries.push({ start: t, end: t + 2, caption: busy ? "the secret problem is never what you think because" : "and then we went" });
  }
  return entries;
}

test("chooseCandidates: up to `count` non-overlapping 75 s windows, best rule score first", () => {
  const list = chooseCandidates(transcript(1200, 600, 700), { count: 10, length: 75 });
  assert.equal(list.length, 10);
  for (const c of list) assert.equal(c.end - c.start, 75);
  const sorted = [...list].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].start >= sorted[i - 1].end, "no overlap");
  assert.ok(list[0].start >= 540 && list[0].start <= 640, `best window covers the busy part, got ${list[0].start}`);
  for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].score >= list[i].score, "ordered by score");
});

test("chooseCandidates: a short video gives only what fits", () => {
  const list = chooseCandidates(transcript(160), { count: 10, length: 75 });
  assert.ok(list.length >= 1 && list.length <= 2, `got ${list.length}`);
});

test("buildLines: splits at sentence ends, pauses over 0.5 s and every 15 words", () => {
  const words = [
    w("Hello", 10, 10.3), w("there.", 10.3, 10.6),
    w("So", 10.7, 10.9), w("anyway", 10.9, 11.2),
    w("after", 12, 12.2), w("pause", 12.2, 12.5),
    ...Array.from({ length: 17 }, (_, i) => w(`x${i}`, 13.1 + i * 0.2, 13.25 + i * 0.2)),
  ];
  const lines = A.buildLines(words, 10, 40);
  assert.deepEqual(lines.map((l) => l.text), ["Hello there.", "So anyway", "after pause", Array.from({ length: 15 }, (_, i) => `x${i}`).join(" "), "x15 x16"]);
  assert.deepEqual(lines.map((l) => l.i), [0, 1, 2, 3, 4]);
  assert.equal(lines[0].start, 10);
  assert.equal(lines[1].end, 11.2);
});

test("buildLines: only words inside the window", () => {
  const lines = A.buildLines([w("out", 5, 5.5), w("in", 10, 10.4), w("late", 50, 50.3)], 10, 40);
  assert.deepEqual(lines.map((l) => l.text), ["in"]);
});
