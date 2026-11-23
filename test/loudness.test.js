const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../loudness");

const has = (args, ...seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v));

test("loudnessArgs: audio only, per-second RMS written to the given file", () => {
  const args = L.loudnessArgs("loudness.txt");
  assert.ok(args.includes("-vn"));
  assert.ok(has(args, "-i", "source.mp4"));
  const filter = args[args.indexOf("-af") + 1];
  assert.match(filter, /asetnsamples=n=16000/);
  assert.match(filter, /astats=metadata=1:reset=1/);
  assert.match(filter, /ametadata=mode=print:key=lavfi\.astats\.Overall\.RMS_level:file=loudness\.txt/);
});

test("parseLoudness: one dB value per second, -inf becomes -90", () => {
  const text = [
    "frame:0    pts:0       pts_time:0", "lavfi.astats.Overall.RMS_level=-27.9",
    "frame:1    pts:16016   pts_time:1.001", "lavfi.astats.Overall.RMS_level=-inf",
    "frame:2    pts:32032   pts_time:2.002", "lavfi.astats.Overall.RMS_level=-12.5",
  ].join("\r\n");
  assert.deepEqual(L.parseLoudness(text), [-27.9, -90, -12.5]);
});

const quiet = (seconds, level = -35) => new Array(seconds).fill(level);

test("loudEvents: an isolated loud burst over a quiet background is found", () => {
  const rms = quiet(600);
  for (let i = 300; i < 303; i += 1) rms[i] = -15;
  const events = L.loudEvents(rms);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, 300);
  assert.equal(events[0].end, 302);
  assert.equal(events[0].at, 300);
  assert.ok(events[0].peak >= 19);
});

test("loudEvents: constant loud noise and quiet blips are not events", () => {
  assert.deepEqual(L.loudEvents(quiet(600, -15)), [], "always loud = baseline");
  const rms = quiet(600, -60);
  rms[300] = -40; // a jump, but still quiet in absolute terms
  assert.deepEqual(L.loudEvents(rms), []);
});

test("loudEvents: bursts a few seconds apart merge; stronger/longer events rank first", () => {
  const rms = quiet(1200);
  rms[100] = -18; rms[105] = -18;              // merged: 100..105
  for (let i = 700; i < 708; i += 1) rms[i] = -10; // long and loud
  const events = L.loudEvents(rms);
  assert.deepEqual(events.map((e) => [e.start, e.end]), [[700, 707], [100, 105]]);
});

test("mixCandidates: 5 speech + audio windows around peaks, no overlaps, filled from speech", () => {
  const speech = Array.from({ length: 10 }, (_, i) => ({ start: i * 100, end: i * 100 + 75, score: 10 - i }));
  const events = [{ start: 2040, end: 2045, peak: 20, score: 40 }, { start: 30, end: 32, peak: 18, score: 30 }, { start: 3000, end: 3002, peak: 15, score: 20 }];
  const mixed = L.mixCandidates(speech, events, { count: 10, speech: 5, length: 75, duration: 4000 });
  assert.equal(mixed.length, 10);
  const audio = mixed.filter((c) => c.loudAt !== undefined);
  // The event at 30 s lies inside the first speech window (0–75): that window gets the hint.
  assert.deepEqual(audio.map((c) => [c.start, c.end, c.loudAt]), [[0, 75, 30], [2000, 2075, 2040], [2960, 3035, 3000]]);
  const sorted = [...mixed].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].start >= sorted[i - 1].end, "no overlap");
  assert.equal(mixed.length - 2, 8, "5 speech (one hinted) + 3 filled from speech, besides the 2 audio windows");
  assert.equal(speech[0].loudAt, undefined, "input not modified");
});

test("mixCandidates: windows are clamped to the video", () => {
  const mixed = L.mixCandidates([], [{ start: 10, end: 12, peak: 20, score: 40 }, { start: 990, end: 995, peak: 20, score: 30 }], { count: 10, speech: 5, length: 75, duration: 1000 });
  assert.deepEqual(mixed.map((c) => [c.start, c.end]), [[0, 75], [925, 1000]]);
});

test("mixCandidates: a loud moment inside an already chosen window marks that window instead of being dropped", () => {
  const speech = [{ start: 405, end: 480, score: 5 }];
  const mixed = L.mixCandidates(speech, [{ start: 450, end: 454, at: 450, peak: 23, score: 50 }], { count: 10, speech: 5, length: 75, duration: 900 });
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].loudAt, 450);
});
