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

// 12 lines of 4 s each starting at 100 s (line i: 100+4i .. 103.5+4i).
const LINES = Array.from({ length: 12 }, (_, i) => ({ i, start: 100 + 4 * i, end: 103.5 + 4 * i, text: `line ${i}` }));

test("buildPrompt: numbered lines with mm:ss, the 20–50 s rule and the reply fields", () => {
  const prompt = A.buildPrompt(LINES);
  assert.match(prompt, /\[0\] 01:40 line 0/);
  assert.match(prompt, /\[11\] 02:24 line 11/);
  assert.match(prompt, /20.*50 seconds/);
  for (const field of ["start_line", "end_line", "score", "title", "reason", "kind"]) assert.match(prompt, new RegExp(field));
  assert.deepEqual(A.ANSWER_SCHEMA.required.sort(), ["end_line", "kind", "reason", "score", "start_line", "title"]);
});

test("parseAnswer: a valid answer becomes a clip on line boundaries", () => {
  const clip = A.parseAnswer({ kind: "podcast", score: 8, start_line: 2, end_line: 7, title: " Big idea ", reason: "Idee clară" }, LINES);
  // Lines 2–7 span 23.8 s, so one line is added after and one before to reach ≥ 30 s.
  assert.deepEqual(clip, { kind: "podcast", score: 8, start: 103.9, end: 135.7, title: "Big idea", reason: "Idee clară" });
});

test("parseAnswer: out of range, reversed or malformed answers are rejected", () => {
  for (const bad of [
    { kind: "podcast", score: 8, start_line: -1, end_line: 5, title: "t", reason: "r" },
    { kind: "podcast", score: 8, start_line: 3, end_line: 20, title: "t", reason: "r" },
    { kind: "podcast", score: 8, start_line: 7, end_line: 2, title: "t", reason: "r" },
    { kind: "podcast", score: "great", start_line: 1, end_line: 6, title: "t", reason: "r" },
    null, "not json",
  ]) assert.equal(A.parseAnswer(bad, LINES), null, JSON.stringify(bad));
});

test("parseAnswer: too short is widened to ≥ 20 s, too long trimmed to ≤ 50 s, by whole lines", () => {
  const short = A.parseAnswer({ kind: "stream", score: 6, start_line: 5, end_line: 5, title: "t", reason: "r" }, LINES);
  assert.ok(short.end - short.start >= 20 && short.end - short.start <= 50, `${short.end - short.start}`);
  const long = A.parseAnswer({ kind: "stream", score: 6, start_line: 0, end_line: 11, title: "t", reason: "r" }, LINES);
  assert.ok(long.end - long.start <= 50 && long.end - long.start >= 20, `${long.end - long.start}`);
  const tiny = [{ i: 0, start: 0, end: 3, text: "only" }];
  assert.equal(A.parseAnswer({ kind: "stream", score: 6, start_line: 0, end_line: 0, title: "t", reason: "r" }, tiny), null, "cannot reach 20 s");
});

test("parseAnswer: score clamped to 0–10, unknown kind becomes other, long texts cut", () => {
  const clip = A.parseAnswer({ kind: "music", score: 14, start_line: 0, end_line: 6, title: "x".repeat(300), reason: "y".repeat(300) }, LINES);
  assert.equal(clip.score, 10);
  assert.equal(clip.kind, "other");
  assert.ok(clip.title.length <= 100 && clip.reason.length <= 160);
});

test("pickFinal: AI clips first by score, no overlaps, rules fill the rest, ranks 1–3", () => {
  const ai = [
    { start: 100, end: 130, score: 6, title: "B", reason: "rb", kind: "stream" },
    { start: 300, end: 340, score: 9, title: "A", reason: "ra", kind: "stream" },
    { start: 310, end: 345, score: 8, title: "overlaps A", reason: "x", kind: "stream" },
  ];
  const rules = [{ start: 120, end: 154, score: 5 }, { start: 500, end: 534, score: 3 }, { start: 700, end: 734, score: 4 }];
  const final = A.pickFinal(ai, rules);
  assert.deepEqual(final.map((c) => [c.start, c.source, c.rank]), [[100, "ai", 2], [300, "ai", 1], [700, "reguli", 3]]);
  assert.equal(final[0].title, "B");
  assert.equal(final[2].title, undefined);
});

test("pickFinal: no AI answers → three rule clips", () => {
  const rules = [{ start: 0, end: 34, score: 1 }, { start: 100, end: 134, score: 3 }, { start: 200, end: 234, score: 2 }];
  const final = A.pickFinal([], rules);
  assert.deepEqual(final.map((c) => [c.start, c.source, c.rank]), [[0, "reguli", 3], [100, "reguli", 1], [200, "reguli", 2]]);
});

test("buildPrompt names the title language explicitly when it is known", () => {
  assert.match(A.buildPrompt(LINES, { language: "en" }), /title[^\n]*in English/);
  assert.match(A.buildPrompt(LINES, { language: "ro" }), /title[^\n]*in Romanian/);
  assert.match(A.buildPrompt(LINES, {}), /same language as the transcript/);
});

test("buildPrompt asks for a 30–45 s target inside the 20–50 s limits", () => {
  assert.match(A.buildPrompt(LINES, { language: "en" }), /aim for 30.45 seconds/i);
});

test("buildRankPrompt lists every candidate with its title and opening words", () => {
  const prompt = A.buildRankPrompt([{ title: "Panic monster", text: "So the panic monster wakes up when the deadline is close and" }, { title: "Funny fail", text: "I had this plan" }]);
  assert.match(prompt, /\[0\] Panic monster — So the panic monster/);
  assert.match(prompt, /\[1\] Funny fail — I had this plan/);
  assert.match(prompt, /order/);
  assert.deepEqual(A.RANK_SCHEMA.required, ["order"]);
});

test("parseRanking: valid order kept; duplicates, unknown indices and missing ones handled", () => {
  assert.deepEqual(A.parseRanking({ order: [2, 0, 1] }, 3), [2, 0, 1]);
  assert.deepEqual(A.parseRanking({ order: [2, 2, 7, 0] }, 3), [2, 0, 1], "dupes and out-of-range dropped, missing appended in original order");
  assert.deepEqual(A.parseRanking("{\"order\":[1]}", 3), [1, 0, 2]);
  assert.equal(A.parseRanking("garbage", 3), null);
  assert.equal(A.parseRanking({ order: "x" }, 3), null);
});

test("pickFinal follows the AI ranking order when given, not the per-candidate score", () => {
  const ai = [
    { start: 100, end: 130, score: 7, order: 2, title: "B", reason: "r", kind: "podcast" },
    { start: 300, end: 340, score: 7, order: 0, title: "A", reason: "r", kind: "podcast" },
    { start: 500, end: 530, score: 7, order: 1, title: "C", reason: "r", kind: "podcast" },
  ];
  const final = A.pickFinal(ai, []);
  assert.deepEqual(final.map((c) => [c.title, c.rank]), [["B", 3], ["A", 1], ["C", 2]]);
});

test("chooseFinal: AI clips crowding out the rule picks fall back to the rules (never fewer than 3)", () => {
  const rules = [{ start: 0, end: 34, score: 3 }, { start: 45, end: 79, score: 2 }, { start: 90, end: 124, score: 1 }];
  const ai = [{ start: 20, end: 60, score: 8, title: "straddles two rule clips", reason: "r", kind: "podcast" }];
  assert.equal(A.pickFinal(ai, rules).length, 2, "the plain pick would come up short");
  const final = A.chooseFinal(ai, rules);
  assert.equal(final.length, 3);
  assert.ok(final.every((clip) => clip.source === "reguli"));
  assert.equal(A.chooseFinal([], rules.slice(0, 2)).length, 2, "genuinely too short stays short");
});

test("parseAnswer widens a short pick to at least 30 s around the AI's core (the 7b model always picks ~20 s)", () => {
  const clip = A.parseAnswer({ kind: "podcast", score: 7, start_line: 5, end_line: 6, title: "t", reason: "r" }, LINES);
  assert.ok(clip.end - clip.start >= 30 && clip.end - clip.start <= 50, `${clip.end - clip.start}`);
  assert.ok(clip.start <= 120 - 0.1 + 1e-9 && clip.end >= 127.5 + 0.2 - 1e-9, "keeps the chosen lines");
});

test("buildPrompt adds a hint when the candidate is around a loud moment", () => {
  assert.match(A.buildPrompt(LINES, { language: "en", loudAt: 125 }), /audio gets suddenly loud around 02:05/);
  assert.doesNotMatch(A.buildPrompt(LINES, { language: "en" }), /suddenly loud/);
});

test("timeLeft caps one answer at 3 min and at the time left minus the reserve", () => {
  assert.equal(A.timeLeft(1_000_000, 0), 180_000);
  assert.equal(A.timeLeft(100_000, 0, 20_000), 80_000);
  assert.equal(A.timeLeft(100_000, 90_000, 20_000), -10_000);
});

test("askOrder alternates speech and loud, leftovers at the end", () => {
  const s = {};
  const L = { origin: "loud" };
  assert.deepEqual(A.askOrder([s, s, s, s, s, L, L, L, L, L]), [0, 5, 1, 6, 2, 7, 3, 8, 4, 9]);
  assert.deepEqual(A.askOrder([s, s, L]), [0, 2, 1]);
  assert.deepEqual(A.askOrder([L, L, s]), [2, 0, 1]);
  assert.deepEqual(A.askOrder([]), []);
});

test("AI budget: 12 minutes by default, a sixth kept for the ranking pass", () => {
  assert.equal(A.AI_BUDGET_MS, 720_000);
  assert.equal(A.RANK_RESERVE_MS, 120_000);
});

test("timeLeft is a whole number of ms (AbortSignal.timeout rejects fractions)", () => {
  assert.equal(A.timeLeft(4000, 0, 4000 / 6), 3333);
});
