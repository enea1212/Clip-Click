const test = require("node:test");
const assert = require("node:assert/strict");
const { resumePlan, missingChunks, normalizeStatus, INTERRUPTED } = require("../pipeline");

const clip = (n, video) => ({ n, start: n * 100, end: n * 100 + 34, video });

test("resumePlan: a fresh project needs every stage", () => {
  assert.deepEqual(resumePlan({ clips: [] }, new Set()), { download: true, words: true, choose: true, renderClips: [] });
});

test("resumePlan: downloaded only → no re-download, transcribe and choose next", () => {
  assert.deepEqual(resumePlan({ clips: [] }, new Set(["source.mp4"])), { download: false, words: true, choose: true, renderClips: [] });
});

test("resumePlan: words ready, clips chosen, two rendered → only the missing clip", () => {
  const project = { clips: [clip(1, "/data/x/short-1-1.mp4"), clip(2, "/data/x/short-2-1.mp4"), clip(3, null)] };
  const files = new Set(["source.mp4", "words.json", "short-1-1.mp4", "raw-1.mp4", "short-2-1.mp4", "raw-2.mp4"]);
  assert.deepEqual(resumePlan(project, files), { download: false, words: false, choose: false, renderClips: [3] });
});

test("resumePlan: a clip whose video file vanished or has no preview is rendered again", () => {
  const project = { clips: [clip(1, "/data/x/short-1-1.mp4"), clip(2, "/data/x/short-2-1.mp4")] };
  const files = new Set(["source.mp4", "words.json", "raw-1.mp4", "short-2-1.mp4"]);
  assert.deepEqual(resumePlan(project, files).renderClips, [1, 2]);
});

test("resumePlan: everything done → nothing to do", () => {
  const project = { clips: [clip(1, "/data/x/short-1-1.mp4")] };
  assert.deepEqual(resumePlan(project, new Set(["source.mp4", "words.json", "short-1-1.mp4", "raw-1.mp4"])), { download: false, words: false, choose: false, renderClips: [] });
});

test("missingChunks: only windows without a saved transcript", () => {
  const plan = [{}, {}, {}, {}];
  assert.deepEqual(missingChunks(plan, new Set(["chunk-0.json", "chunk-2.json"])), [1, 3]);
  assert.deepEqual(missingChunks(plan, new Set()), [0, 1, 2, 3]);
});

test("normalizeStatus: old projects without status are ready", () => {
  assert.equal(normalizeStatus({ clips: [] }, false).status, "ready");
});

test("normalizeStatus: an unfinished project with no running job was interrupted", () => {
  const out = normalizeStatus({ status: "transcribing", clips: [] }, false);
  assert.equal(out.status, "failed");
  assert.equal(out.error, INTERRUPTED);
});

test("normalizeStatus: a running job keeps its stage; failed keeps its own error", () => {
  assert.equal(normalizeStatus({ status: "rendering", clips: [] }, true).status, "rendering");
  assert.deepEqual(normalizeStatus({ status: "failed", error: "x", clips: [] }, false), { status: "failed", error: "x", clips: [] });
});

const { keepForResume } = require("../pipeline");

test("keepForResume: keep only when there is something to reuse and retrying could help", () => {
  assert.equal(keepForResume({ firstRun: true, hasSource: false, permanent: false }), false, "nothing downloaded");
  assert.equal(keepForResume({ firstRun: false, hasSource: true, permanent: false }), true, "crash or temporary error: resume");
  assert.equal(keepForResume({ firstRun: true, hasSource: true, permanent: false }), true);
  assert.equal(keepForResume({ firstRun: false, hasSource: true, permanent: true }), false, "too short / no speech: Reia would fail forever");
  assert.equal(keepForResume({ firstRun: true, hasSource: true, permanent: true }), false);
});

const { leftoverFiles } = require("../pipeline");

test("leftoverFiles: temp audio and clips no project entry points to", () => {
  const project = { clips: [{ n: 1, video: "/data/x/short-1-200.mp4" }, { n: 2, video: null }] };
  const files = ["source.mp4", "chunk-1.wav", "clip-2.wav", "full.wav", "short-1-100.mp4", "short-1-200.mp4", "short-2-300.mp4", "raw-1.mp4", "words.json"];
  assert.deepEqual(leftoverFiles(project, files).sort(), ["chunk-1.wav", "clip-2.wav", "full.wav", "short-1-100.mp4", "short-2-300.mp4"]);
});

test("normalizeStatus: a project stopped while the AI was choosing is interrupted too", () => {
  const out = normalizeStatus({ status: "choosing", clips: [] }, false);
  assert.equal(out.status, "failed");
  assert.equal(out.error, INTERRUPTED);
});

test("resumePlan, segments mode: the audio file replaces source.mp4; clips without their section need one", () => {
  const clips = [
    { n: 1, start: 100, end: 134, sourceFile: "segment-1.mp4", segmentStart: 95 },
    { n: 2, start: 200, end: 234 },
    { n: 3, start: 300, end: 334, sourceFile: "segment-3.mp4", segmentStart: 295 },
  ];
  const project = { mediaMode: "segments", audioFile: "source.webm", clips };
  const plan = resumePlan(project, new Set(["source.webm", "words.json", "segment-1.mp4"]));
  assert.equal(plan.download, false);
  assert.deepEqual(plan.downloadSegments, [2, 3], "segment-3.mp4 is recorded but missing on disk");
  assert.equal(resumePlan({ ...project, audioFile: undefined }, new Set(["source.m4a"])).download, false, "audio found by name");
  assert.equal(resumePlan(project, new Set(["source.mp4"])).download, true, "a full video does not count as the audio");
  assert.equal(resumePlan({ clips: [] }, new Set()).downloadSegments, undefined, "old projects: no segments");
});
