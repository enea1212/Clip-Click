// End-to-end tests of the server's processing with fake external tools (no network, no ffmpeg).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cliptrei-server-"));
const DATA = path.join(work, "data");
const SATISFYING = path.join(work, "satisfying");
const CONTROL = path.join(work, "control.json");
const PORT = 41000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
// Video ids that don't exist: even if the fake tools were not used, nothing real is downloaded.
const URL_A = "https://www.youtube.com/watch?v=FAKEAAAAAAA";

let server;
const setControl = (value) => { fs.writeFileSync(CONTROL, JSON.stringify(value)); fs.rmSync(`${CONTROL}.log`, { force: true }); };
const calls = () => (fs.existsSync(`${CONTROL}.log`) ? fs.readFileSync(`${CONTROL}.log`, "utf8").trim().split("\n") : []);
const post = (p, body, headers = {}) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(BASE + p).then((r) => r.json());
const folders = () => (fs.existsSync(DATA) ? fs.readdirSync(DATA) : []);

test.before(async () => {
  fs.mkdirSync(SATISFYING, { recursive: true });
  setControl({});
  server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: String(PORT), CLIPTREI_DATA_DIR: DATA, CLIPTREI_SATISFYING_DIR: SATISFYING, CLIPTREI_FAKE_TOOLS: path.join(ROOT, "testing", "fake-tools.js"), CLIPTREI_FAKE_CONTROL: CONTROL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("rulează")) resolve(); });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});

test.after(() => {
  server?.kill();
  fs.rmSync(work, { recursive: true, force: true });
});

test("tools are faked (safety check before anything else)", async () => {
  const info = await post("/api/inspect", { url: URL_A });
  assert.equal(info.status, 200);
  assert.equal(info.body.title, "FAKE VIDEO");
});

test("video with subtitles: 3 clips, Whisper timings per clip, pauses cut", async () => {
  setControl({ duration: 900 });
  const { status, body } = await post("/api/process", { url: URL_A });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "ready");
  assert.equal(body.clips.length, 3);
  for (const clip of body.clips) {
    assert.equal(clip.wordsSource, "whisper");
    assert.equal(clip.cutPauses, true);
    assert.ok(clip.duration < 34, `clip ${clip.n} not cut: ${clip.duration}`);
    assert.ok(fs.existsSync(path.join(DATA, body.id, clip.video.split("/").pop())));
  }
});

test("a second video while one is processing is refused at once, without a folder", async () => {
  setControl({ duration: 900, slowDownloadMs: 1500 });
  const before = folders().length;
  const first = post("/api/process", { url: URL_A });
  await new Promise((r) => setTimeout(r, 300));
  const second = await post("/api/process", { url: URL_A });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /Se procesează deja un video/);
  assert.equal(folders().length, before + 1, "only the first job's folder");
  assert.equal((await first).status, 200);
});

test("no subtitles: whole-video Whisper in 10-minute windows", async () => {
  setControl({ duration: 900, noSubs: true });
  const { status, body } = await post("/api/process", { url: URL_A, transcribe: true });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.track, "whisper");
  assert.deepEqual(fs.readdirSync(path.join(DATA, body.id, "chunks")).sort(), ["chunk-0.json", "chunk-1.json"]);
});

test("Whisper crash mid-way keeps the project; Reia redoes only the missing window", async () => {
  // A full run first (both windows saved), then window 1 is removed to stand in for a crash
  // that happened after window 0; the fake Whisper then crashes once on the next call.
  const flag = path.join(work, "fail-once");
  fs.writeFileSync(flag, "");
  setControl({ duration: 900, noSubs: true });
  const okRun = await post("/api/process", { url: URL_A, transcribe: true });
  assert.equal(okRun.status, 200);
  // Now simulate: delete window 1 and words.json, mark failed, and make the next transcription crash once.
  const folder = path.join(DATA, okRun.body.id);
  fs.rmSync(path.join(folder, "chunks", "chunk-1.json"));
  fs.rmSync(path.join(folder, "words.json"));
  const project = JSON.parse(fs.readFileSync(path.join(folder, "project.json"), "utf8"));
  fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify({ ...project, status: "failed", error: "x", clips: [] }));
  setControl({ duration: 900, noSubs: true, transcribeFailOnce: flag });
  const crashed = await post(`/api/projects/${okRun.body.id}/resume`, {});
  assert.equal(crashed.status, 400);
  assert.equal(crashed.body.resumable, true);
  assert.equal((await get(`/api/projects/${okRun.body.id}`)).status, "failed");

  setControl({ duration: 900, noSubs: true });
  const resumed = await post(`/api/projects/${okRun.body.id}/resume`, {});
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.status, "ready");
  const log = calls();
  assert.equal(log.filter((line) => line.startsWith("python -m yt_dlp")).length, 0, "no re-download");
  assert.equal(log.filter((line) => /transcribe\.py chunk-/.test(line)).length, 1, "only the missing window");
});

test("download failure leaves no folder", async () => {
  setControl({ downloadFails: true });
  const before = folders().length;
  const { status } = await post("/api/process", { url: URL_A });
  assert.equal(status, 400);
  assert.equal(folders().length, before);
});

test("too short (permanent): the project is not kept", async () => {
  setControl({ duration: 40 });
  const before = folders().length;
  const { status, body } = await post("/api/process", { url: URL_A });
  assert.equal(status, 400);
  assert.match(body.error, /prea scurt/);
  assert.equal(body.resumable, undefined);
  assert.equal(folders().length, before);
});

test("missing faster-whisper is reported before any download", async () => {
  setControl({ noWhisper: true, noSubs: true });
  const before = folders().length;
  const { status, body } = await post("/api/process", { url: URL_A, transcribe: true });
  assert.equal(status, 400);
  assert.match(body.error, /faster-whisper/);
  assert.equal(calls().filter((line) => line.startsWith("python -m yt_dlp")).length, 0);
  assert.equal(folders().length, before);
});

test("requests from another site are refused", async () => {
  const { status } = await post("/api/inspect", { url: URL_A }, { Origin: "http://evil.com" });
  assert.equal(status, 403);
});
