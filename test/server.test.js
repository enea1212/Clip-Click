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

// Fake Ollama in this process. mode: "down" (default: tests that don't care about AI use rules),
// "up" (answers every candidate), "garbage-first" (first answer invalid, the rest good).
const ollama = { mode: "down", calls: 0 };
const OLLAMA_PORT = PORT + 1;
const http = require("node:http");
const fakeOllama = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (ollama.mode === "down") { res.writeHead(503); res.end(); return; }
    // "dies-after-2": the model answers twice, then Ollama crashes (HTTP 500 from then on).
    if (ollama.mode === "dies-after-2" && req.url === "/api/generate" && ollama.calls >= 2) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] })); return; }
    const request = JSON.parse(body);
    if (request.format?.required?.includes("order")) {
      // Ranking pass: best = the first candidate listed (so it differs from the per-candidate scores).
      ollama.rankCalls = (ollama.rankCalls || 0) + 1;
      const count = (request.prompt.match(/^\[\d+\]/gm) || []).length;
      res.end(JSON.stringify({ response: JSON.stringify({ order: Array.from({ length: count }, (_, i) => i) }) }));
      return;
    }
    ollama.calls += 1;
    (ollama.prompts = ollama.prompts || []).push(request.prompt);
    const lines = (JSON.parse(body).prompt.match(/^\[\d+\]/gm) || []).length;
    // Score grows with the call number so the pick is deterministic; span: lines 2..9 (~30 s).
    const answer = ollama.mode === "garbage-first" && ollama.calls === 1
      ? "not json at all"
      : JSON.stringify({ kind: "podcast", score: Math.min(10, ollama.calls), start_line: 2, end_line: Math.min(9, lines - 1), title: `Titlu ${ollama.calls}`, reason: `Motiv ${ollama.calls}` });
    res.end(JSON.stringify({ response: answer }));
  });
});
const calls = () => (fs.existsSync(`${CONTROL}.log`) ? fs.readFileSync(`${CONTROL}.log`, "utf8").trim().split("\n") : []);
const post = (p, body, headers = {}) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(BASE + p).then((r) => r.json());
const folders = () => (fs.existsSync(DATA) ? fs.readdirSync(DATA) : []);

test.before(async () => {
  fs.mkdirSync(SATISFYING, { recursive: true });
  setControl({});
  await new Promise((resolve) => fakeOllama.listen(OLLAMA_PORT, "127.0.0.1", resolve));
  server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    // CLIPTREI_OLLAMA_URL always points at the fake: the tests must never call a real model.
    env: { ...process.env, PORT: String(PORT), CLIPTREI_DATA_DIR: DATA, CLIPTREI_SATISFYING_DIR: SATISFYING, CLIPTREI_FAKE_TOOLS: path.join(ROOT, "testing", "fake-tools.js"), CLIPTREI_FAKE_CONTROL: CONTROL, CLIPTREI_OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("rulează")) resolve(); });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});

test.after(() => {
  server?.kill();
  fakeOllama.close();
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
  assert.deepEqual(body.clips.map((clip) => clip.rank).sort(), [1, 2, 3]);
  assert.ok(body.clips.every((clip) => clip.score === undefined), "no invented percentage");
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

test("resume gives a title to a project whose download step never saved one", async () => {
  setControl({ duration: 900 });
  const id = "44444444-5555-4666-8777-888888888888";
  fs.mkdirSync(path.join(DATA, id), { recursive: true });
  fs.writeFileSync(path.join(DATA, id, "source.mp4"), "fake video");
  fs.writeFileSync(path.join(DATA, id, "project.json"), JSON.stringify({ id, title: "", url: URL_A, transcribe: false, createdAt: new Date().toISOString(), status: "failed", error: "x", clips: [] }));
  const { status, body } = await post(`/api/projects/${id}/resume`, {});
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.title, "Video fără titlu");
});

test("without faster-whisper, YouTube timings are used but not locked in for later", async () => {
  setControl({ duration: 900, noWhisper: true });
  const { status, body } = await post("/api/process", { url: URL_A });
  assert.equal(status, 200, JSON.stringify(body));
  // Not marked "youtube": the UI must still offer „Taie pauzele”, so the next Apply can try Whisper.
  assert.ok(body.clips.every((clip) => clip.wordsSource === undefined && clip.cutPauses === false), JSON.stringify(body.clips.map((c) => c.wordsSource)));
  assert.equal(fs.existsSync(path.join(DATA, body.id, "words-1.json")), false);
  setControl({ duration: 900 });
  const render = await post("/api/render", { id: body.id, clip: 1, zoom: 1, satisfying: false, cutPauses: true });
  assert.equal(render.status, 200, JSON.stringify(render.body));
  assert.equal(render.body.wordsSource, "whisper");
  assert.equal(render.body.cutPauses, true);
});

test("full transcription doesn't ask YouTube for subtitles it won't use", async () => {
  setControl({ duration: 900, noSubs: true });
  const { status } = await post("/api/process", { url: URL_A, transcribe: true });
  assert.equal(status, 200);
  const download = calls().find((line) => line.startsWith("python -m yt_dlp") && !line.includes("--dump-json"));
  assert.ok(download && !download.includes("--write-subs"), download);
});

test("a crash's leftovers (temp audio, orphan clips) are cleaned when the project resumes", async () => {
  setControl({ duration: 900 });
  const first = await post("/api/process", { url: URL_A });
  const folder = path.join(DATA, first.body.id);
  fs.writeFileSync(path.join(folder, "chunk-3.wav"), "x");
  fs.writeFileSync(path.join(folder, "short-2-1.mp4"), "half-written");
  const project = JSON.parse(fs.readFileSync(path.join(folder, "project.json"), "utf8"));
  fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify({ ...project, status: "failed", error: "x" }));
  const resumed = await post(`/api/projects/${first.body.id}/resume`, {});
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(fs.existsSync(path.join(folder, "chunk-3.wav")), false);
  assert.equal(fs.existsSync(path.join(folder, "short-2-1.mp4")), false);
});

test("AI picks the moments: titles, reasons, 20–50 s clips, rank by the AI's ranking pass", async () => {
  ollama.mode = "up"; ollama.calls = 0; ollama.rankCalls = 0;
  setControl({ duration: 900 });
  const { status, body } = await post("/api/process", { url: URL_A });
  ollama.mode = "down";
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.selection, "ai");
  assert.ok(ollama.calls >= 3 && ollama.calls <= 10, `calls ${ollama.calls}`);
  assert.deepEqual(body.aiProgress, { done: ollama.calls, total: ollama.calls });
  for (const clip of body.clips) {
    assert.equal(clip.source, "ai");
    assert.match(clip.title, /^Titlu \d+$/);
    assert.match(clip.reason, /^Motiv \d+$/);
    assert.ok(clip.end - clip.start >= 20 && clip.end - clip.start <= 50, `${clip.end - clip.start}`);
  }
  assert.deepEqual(body.clips.map((c) => c.rank).sort(), [1, 2, 3]);
  // The ranking pass (best = first listed) decides, not the per-candidate scores (which grow).
  assert.equal(body.clips.find((c) => c.rank === 1).title, "Titlu 1");
  assert.equal(ollama.rankCalls, 1);
});

test("Ollama down: rules choose, the project still finishes, with a note", async () => {
  ollama.mode = "down";
  setControl({ duration: 900 });
  const { status, body } = await post("/api/process", { url: URL_A });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "ready");
  assert.equal(body.selection, "reguli");
  assert.ok(body.selectionNote);
  assert.ok(body.clips.every((c) => c.source === "reguli"));
});

test("one garbage AI answer only drops that candidate", async () => {
  ollama.mode = "garbage-first"; ollama.calls = 0;
  setControl({ duration: 900 });
  const { status, body } = await post("/api/process", { url: URL_A });
  ollama.mode = "down";
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.selection, "ai");
  assert.ok(body.clips.every((c) => c.title !== "Titlu 1"));
});

test("Reia after some candidates were scored asks the AI only for the missing ones", async () => {
  ollama.mode = "up"; ollama.calls = 0;
  setControl({ duration: 900 });
  const first = await post("/api/process", { url: URL_A });
  const total = ollama.calls;
  const folder = path.join(DATA, first.body.id);
  // Stand in for a crash after 2 scored candidates: drop the clips and the later answers.
  for (const name of fs.readdirSync(path.join(folder, "ai"))) if (!/^candidate-[01]\.json$/.test(name)) fs.rmSync(path.join(folder, "ai", name));
  const project = JSON.parse(fs.readFileSync(path.join(folder, "project.json"), "utf8"));
  fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify({ ...project, status: "failed", error: "x", clips: [] }));
  ollama.calls = 0;
  const resumed = await post(`/api/projects/${first.body.id}/resume`, {});
  ollama.mode = "down";
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(ollama.calls, total - 2);
  assert.equal(resumed.body.selection, "ai");
});

test("Alege din nou cu AI: refused while Ollama is down (clips untouched), works when it is up", async () => {
  ollama.mode = "down";
  setControl({ duration: 900 });
  const made = await post("/api/process", { url: URL_A });
  assert.equal(made.body.selection, "reguli");
  const refused = await post(`/api/projects/${made.body.id}/rechoose`, {});
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /AI/);
  const still = await get(`/api/projects/${made.body.id}`);
  assert.deepEqual(still.clips.map((c) => c.video), made.body.clips.map((c) => c.video));

  ollama.mode = "up"; ollama.calls = 0;
  setControl({ duration: 900 }); // clears the tool-call log: only the rechoose's calls count below
  const redone = await post(`/api/projects/${made.body.id}/rechoose`, {});
  ollama.mode = "down";
  assert.equal(redone.status, 200, JSON.stringify(redone.body));
  assert.equal(redone.body.selection, "ai");
  assert.equal(calls().filter((line) => line.startsWith("python -m yt_dlp")).length, 0, "no re-download");
  for (const clip of made.body.clips) assert.equal(fs.existsSync(path.join(DATA, made.body.id, clip.video.split("/").pop())), false, "old clip files removed");
});

test("Ollama crashing mid-way: the unanswered candidates are not cached as failures", async () => {
  ollama.mode = "dies-after-2"; ollama.calls = 0;
  setControl({ duration: 900 });
  const { status, body } = await post("/api/process", { url: URL_A });
  ollama.mode = "down";
  assert.equal(status, 200, JSON.stringify(body));
  const cached = fs.readdirSync(path.join(DATA, body.id, "ai")).filter((name) => name.startsWith("candidate-"));
  assert.equal(cached.length, 2, `cached: ${cached}`);
});

test("Alege din nou cu AI is refused while a clip of the project is being re-rendered", async () => {
  ollama.mode = "down";
  setControl({ duration: 900 });
  const made = await post("/api/process", { url: URL_A });
  setControl({ duration: 900, slowRenderMs: 1500 });
  const render = post("/api/render", { id: made.body.id, clip: 1, zoom: 0.5, satisfying: false });
  await new Promise((r) => setTimeout(r, 300));
  ollama.mode = "up";
  const refused = await post(`/api/projects/${made.body.id}/rechoose`, {});
  ollama.mode = "down";
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal((await render).status, 200);
});

test("loud moments are sent to the AI as extra candidates, with a hint", async () => {
  ollama.mode = "up"; ollama.calls = 0; ollama.prompts = [];
  setControl({ duration: 900, loudAt: 450 });
  const { status, body } = await post("/api/process", { url: URL_A });
  ollama.mode = "down";
  assert.equal(status, 200, JSON.stringify(body));
  const hinted = ollama.prompts.filter((p) => /audio gets suddenly loud around 07:30/.test(p));
  assert.equal(hinted.length, 1, `prompts with the hint: ${hinted.length}`);
  assert.ok(fs.existsSync(path.join(DATA, body.id, "loudness.json")));
});
