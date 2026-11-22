const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { parseVttWords, groupWords, buildAss, pickCaptionTrack } = require("./subtitles");
const { chooseClips } = require("./clips");
const { clipArgs, rawPreviewArgs, satPreviewArgs, probeArgs, parseProbe } = require("./render");
const P = require("./projects");
const { resolveStatic, decodePath, parseRange } = require("./http-utils");
const W = require("./whisper");
const { speechSegments, remapWords, totalDuration } = require("./pauses");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SATISFYING_DIR = path.join(ROOT, "satisfying");
const PORT = Number(process.env.PORT || 4173);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mp4": "video/mp4", ".json": "application/json; charset=utf-8" };
fs.mkdirSync(DATA_DIR, { recursive: true });

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout.trim());
      const error = new Error(stderr.trim().split("\n").slice(-5).join("\n") || `${command} exited with ${code}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(url.hostname) && url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function timestamp(value) { return new Date(value * 1000).toISOString().slice(11, 19); }
const publicPath = (id, name) => `/data/${id}/${name}`;
const folderOf = (id) => path.join(DATA_DIR, id);

async function probe(file, cwd) {
  try {
    return parseProbe(await run("ffprobe", probeArgs(file), { cwd }));
  } catch (error) {
    throw new UserError(error.message.includes("dimensiunile") ? error.message : "Nu am putut citi videoclipul.");
  }
}

// One job per clip at a time, and no deleting a project while any of its jobs runs.
const locks = P.createLocks();
async function withLock(key, busyMessage, job) {
  if (!locks.acquire(key)) throw new UserError(busyMessage, 409);
  try { return await job(); } finally { locks.release(key); }
}

// Transcribes [start, end] of source.mp4 (or the whole file) with local Whisper.
async function whisperWords(folder, { start, end, wav }) {
  await run("ffmpeg", W.audioArgs({ start, end, output: wav }), { cwd: folder });
  try {
    const out = await run("python", [path.join(ROOT, "transcribe.py"), wav], { cwd: folder, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    return W.parseTranscript(out, start || 0);
  } catch (error) {
    if (error.exitCode === W.MISSING_EXIT_CODE) {
      const missing = new UserError(W.WHISPER_MISSING);
      missing.whisperMissing = true;
      throw missing;
    }
    throw error;
  } finally {
    fs.rmSync(path.join(folder, wav), { force: true });
  }
}

const clipWordsFile = (folder, n) => path.join(folder, `words-${n}.json`);

// Exact word timings for one clip: Whisper on the clip's audio, or the YouTube words as fallback.
async function prepareClipWords(folder, clip, fallbackWords) {
  let words = [];
  let wordsSource = "whisper";
  try {
    words = await whisperWords(folder, { start: clip.start, end: clip.end, wav: `clip-${clip.n}.wav` });
  } catch (error) {
    console.warn(`[whisper] clip ${clip.n}: ${error.message}`);
  }
  if (!words.length) {
    wordsSource = "youtube";
    words = fallbackWords.filter((word) => word.end > clip.start && word.start < clip.end);
  }
  fs.writeFileSync(clipWordsFile(folder, clip.n), JSON.stringify(words), "utf8");
  return { wordsSource };
}

// Renders one clip and returns the fields to store; the caller saves them.
// With cutPauses the silences are removed (needs Whisper timings) and the clip gets shorter.
async function renderClip(project, clip, words, { zoom, split, cutPauses = false }) {
  const folder = folderOf(project.id);
  const subtitles = `captions-${clip.n}.ass`;
  const output = `short-${clip.n}-${Date.now()}.mp4`;
  let segments = null;
  let duration = clip.end - clip.start;
  let ass = buildAss(words, clip.start, clip.end, { split });
  if (cutPauses) {
    const found = speechSegments(words, clip.start, clip.end);
    if (found.length) {
      segments = found;
      duration = totalDuration(found);
      ass = buildAss(remapWords(words, clip.start, found), 0, duration, { split });
    } else {
      console.warn(`[pauses] clip ${clip.n}: no speech found, rendering uncut`);
    }
  }
  fs.writeFileSync(path.join(folder, subtitles), ass, "utf8");
  try {
    await run("ffmpeg", clipArgs({
      start: clip.start, end: clip.end, srcW: project.sourceWidth, srcH: project.sourceHeight, zoom, split, subtitles, output,
      satisfyingPath: split ? path.join(SATISFYING_DIR, clip.satisfying.file) : undefined,
      satisfyingStart: split ? clip.satisfying.start : undefined,
      segments,
    }), { cwd: folder });
  } catch (error) {
    fs.rmSync(path.join(folder, output), { force: true });
    throw error;
  }
  return { video: publicPath(project.id, output), zoom, satisfyingOn: split, cutPauses: Boolean(segments), duration };
}

function removePublicFile(id, publicUrl) {
  if (!publicUrl) return;
  try { fs.rmSync(path.join(folderOf(id), path.basename(publicUrl.split("?")[0])), { force: true }); } catch { /* still in use: leave it */ }
}

// Metadata only (no download): is there an original-language RO/EN track, and how long would
// a full Whisper transcription take on this machine?
async function inspectVideo(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) throw new UserError("Te rog introdu un link https valid de YouTube.");
  const info = JSON.parse(await run("python", ["-m", "yt_dlp", "--no-playlist", "--no-warnings", "--skip-download", "--dump-json", url], { windowsHide: true }));
  return { title: info.title || "", duration: Number(info.duration) || 0, hasSubtitles: W.hasOriginalSubtitles(info), estimateMinutes: W.estimateMinutes(info.duration) };
}

async function processVideo(rawUrl, { transcribe = false } = {}) {
  const url = safeUrl(rawUrl);
  if (!url) throw new UserError("Te rog introdu un link https valid de YouTube.");
  const id = randomUUID();
  const folder = folderOf(id);
  fs.mkdirSync(folder, { recursive: true });
  try {
    return await withLock(`${id}:process`, "Proiectul se procesează deja.", () => downloadAndBuild(id, folder, url, transcribe === true));
  } catch (error) {
    // A failed run leaves nothing usable, possibly a multi-GB source: clean it up.
    try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* listed as incomplete; deletable later */ }
    throw error;
  }
}

async function downloadAndBuild(id, folder, url, transcribe) {
  const outputTemplate = path.join(folder, "source.%(ext)s");
  const printed = await run("python", ["-m", "yt_dlp", "--ignore-errors", "--no-playlist", "--no-warnings", "--write-auto-subs", "--write-subs", "--sub-langs", "ro,ro-orig,ro-RO,en,en-orig,en-US,en-GB", "--sub-format", "vtt/best", "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", outputTemplate, "--print", "after_move:title", "--print", "after_move:filepath", url], { cwd: folder, windowsHide: true });
  const title = printed.split(/\r?\n/)[0]?.trim() || "Video fără titlu";
  const files = fs.readdirSync(folder);
  const video = files.find((name) => /^source\.(mp4|mkv|webm)$/i.test(name));
  const captions = files.filter((name) => name.startsWith("source.") && name.endsWith(".vtt")).map((name) => ({ name, text: fs.readFileSync(path.join(folder, name), "utf8") }));
  if (!video) throw new UserError("YouTube nu a furnizat un fișier video compatibil.");
  if (!transcribe && !captions.length) throw new UserError("Nu am găsit subtitrări pentru acest videoclip.");
  // render.js reads "source.mp4"; ffmpeg detects the real container from the content.
  if (video !== "source.mp4") fs.renameSync(path.join(folder, video), path.join(folder, "source.mp4"));
  let track;
  let words;
  if (transcribe) {
    // No original-language subtitles: transcribe the whole video (the user confirmed the estimate).
    track = "whisper";
    words = await whisperWords(folder, { wav: "full.wav" });
    if (!words.length) throw new UserError("Whisper nu a găsit vorbire în acest videoclip.");
  } else {
    track = pickCaptionTrack(captions);
    words = parseVttWords(captions.find((item) => item.name === track).text);
  }
  fs.writeFileSync(path.join(folder, "words.json"), JSON.stringify(words), "utf8");
  const transcript = groupWords(words).map((group) => ({ start: group[0].start, end: group.at(-1).end, caption: group.map((item) => item.word).join(" ") }));
  const chosen = chooseClips(transcript);
  if (chosen.length < 3) throw new UserError("Videoclipul e prea scurt sau subtitrările nu conțin destulă vorbire pentru trei momente.");
  const source = await probe("source.mp4", folder);
  const project = {
    id, title, url, createdAt: new Date().toISOString(), track, sourceWidth: source.width, sourceHeight: source.height,
    clips: chosen.map((clip, index) => ({
      n: index + 1, start: clip.start, end: clip.end,
      time: `${timestamp(clip.start)} — ${timestamp(clip.end)}`,
      score: `${Math.min(99, Math.round(70 + clip.score * 2))}%`,
      caption: clip.entries.map((entry) => entry.caption).join(" ").slice(0, 180),
      zoom: 1, satisfyingOn: false, satisfying: null, video: null, raw: null,
    })),
  };
  for (const clip of project.clips) {
    if (transcribe) {
      // Already Whisper words: no second transcription, just this clip's slice.
      fs.writeFileSync(clipWordsFile(folder, clip.n), JSON.stringify(words.filter((word) => word.end > clip.start && word.start < clip.end)), "utf8");
      clip.wordsSource = "whisper";
    } else {
      Object.assign(clip, await prepareClipWords(folder, clip, words));
    }
    const clipWords = JSON.parse(fs.readFileSync(clipWordsFile(folder, clip.n), "utf8"));
    Object.assign(clip, await renderClip(project, clip, clipWords, { zoom: 1, split: false, cutPauses: clip.wordsSource === "whisper" }));
    const raw = `raw-${clip.n}.mp4`;
    await run("ffmpeg", rawPreviewArgs({ start: clip.start, end: clip.end, output: raw }), { cwd: folder });
    clip.raw = publicPath(id, raw);
  }
  P.saveProject(DATA_DIR, project);
  return project;
}

function loadProject(id) {
  const project = P.readProject(DATA_DIR, id);
  if (!project) throw new UserError("Proiectul nu există.", 404);
  return project;
}

function clipOf(project, n) {
  if (![1, 2, 3].includes(n) || !project.clips[n - 1]) throw new UserError("Clip invalid.");
  return project.clips[n - 1];
}

async function chooseSatisfying({ id, clip: n }) {
  const project = loadProject(id);
  const clip = clipOf(project, n);
  return withLock(`${id}:${n}`, "Clipul e ocupat (se randează). Încearcă după ce termină.", async () => {
    const files = P.listSatisfying(SATISFYING_DIR);
    const pick = await P.pickSatisfying(files, async (file) => (await probe(path.join(SATISFYING_DIR, file), SATISFYING_DIR)).duration, clip.end - clip.start);
    const preview = `sat-${n}.mp4`;
    await run("ffmpeg", satPreviewArgs({ satisfyingPath: path.join(SATISFYING_DIR, pick.file), satisfyingStart: pick.start, length: clip.end - clip.start, output: preview }), { cwd: folderOf(id) });
    const satisfyingChoice = { ...pick, preview: `${publicPath(id, preview)}?v=${Date.now()}` };
    P.updateClip(DATA_DIR, id, n, { satisfying: satisfyingChoice });
    return satisfyingChoice;
  });
}

async function rerender({ id, clip: n, zoom, satisfying, cutPauses }) {
  const project = loadProject(id);
  clipOf(project, n);
  if (typeof zoom !== "number" || !(zoom >= 0 && zoom <= 1)) throw new UserError("Zoom invalid.");
  const split = satisfying === true;
  if (cutPauses !== undefined && typeof cutPauses !== "boolean") throw new UserError("Valoare invalidă pentru tăierea pauzelor.");
  return withLock(`${id}:${n}`, "Clipul se randează deja.", async () => {
    // Re-read under the lock so the gameplay choice is the latest one.
    const fresh = loadProject(id);
    const clip = fresh.clips[n - 1];
    if (split && !(clip.satisfying && P.safeSatisfyingName(clip.satisfying.file) && fs.existsSync(path.join(SATISFYING_DIR, clip.satisfying.file)))) {
      throw new UserError("Alege întâi un video pentru partea de jos.");
    }
    if (split) {
      const { duration } = await probe(path.join(SATISFYING_DIR, clip.satisfying.file), SATISFYING_DIR);
      clip.satisfying.start = P.clampSatisfyingStart(clip.satisfying.start, duration, clip.end - clip.start);
    }
    const folder = folderOf(id);
    // Projects made before Whisper have no per-clip words yet: create them on the first render.
    if (!fs.existsSync(clipWordsFile(folder, n))) {
      const fallback = JSON.parse(fs.readFileSync(path.join(folder, "words.json"), "utf8"));
      Object.assign(clip, await prepareClipWords(folder, clip, fallback));
      P.updateClip(DATA_DIR, id, n, { wordsSource: clip.wordsSource });
    }
    const wantCut = typeof cutPauses === "boolean" ? cutPauses : clip.cutPauses === true;
    if (wantCut && clip.wordsSource !== "whisper") throw new UserError("Necesită transcriere Whisper.");
    const words = JSON.parse(fs.readFileSync(clipWordsFile(folder, n), "utf8"));
    const previous = clip.video;
    const updated = P.updateClip(DATA_DIR, id, n, await renderClip(fresh, clip, words, { zoom, split, cutPauses: wantCut }));
    removePublicFile(id, previous);
    return updated;
  });
}

function serveFile(req, res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); res.end("Not found"); return; }
  const stat = fs.statSync(filePath);
  const range = path.extname(filePath) === ".mp4" ? parseRange(req.headers.range, stat.size) : null;
  if (range === "invalid") { res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); res.end(); return; }
  if (range) {
    const { start, end } = range;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Type": MIME[".mp4"] });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  // App files are tiny: always refetch so the browser never runs an old app.js/ui.css after an update.
  const cache = path.extname(filePath) === ".mp4" ? {} : { "Cache-Control": "no-cache" };
  res.writeHead(200, { "Content-Length": stat.size, "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", ...cache });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return; // keep draining so the 413 answer can still be sent
      body += chunk;
      if (body.length > 10_000) { tooLarge = true; body = ""; reject(new UserError("Cerere prea mare.", 413)); }
    });
    req.on("end", () => {
      if (tooLarge) return; try { resolve(JSON.parse(body || "{}")); } catch { reject(new UserError("Cerere invalidă.")); } });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": MIME[".json"] });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, pathname) {
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "POST" && pathname === "/api/inspect") return inspectVideo((await readJson(req)).url);
  if (req.method === "POST" && pathname === "/api/process") {
    const body = await readJson(req);
    return processVideo(body.url, { transcribe: body.transcribe === true });
  }
  if (req.method === "GET" && pathname === "/api/projects") return P.listProjects(DATA_DIR);
  if (projectMatch && !P.isValidId(projectMatch[1])) throw new UserError("Proiect invalid.");
  if (req.method === "GET" && projectMatch) return loadProject(projectMatch[1]);
  if (req.method === "DELETE" && projectMatch) {
    if (locks.isProjectBusy(projectMatch[1])) throw new UserError("Proiectul se procesează sau se randează acum. Încearcă după ce termină.", 409);
    try {
      if (!P.deleteProject(DATA_DIR, projectMatch[1])) throw new UserError("Proiectul nu există.", 404);
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError("Nu am putut șterge tot proiectul (un fișier e folosit). Încearcă din nou.");
    }
    return { ok: true };
  }
  if (req.method === "POST" && pathname === "/api/satisfying") return chooseSatisfying(await readJson(req));
  if (req.method === "POST" && pathname === "/api/render") return rerender(await readJson(req));
  throw new UserError("Not found", 404);
}

const server = http.createServer(async (req, res) => {
  const pathname = decodePath(new URL(req.url, "http://localhost").pathname);
  if (pathname === null) { res.writeHead(400); res.end("Bad request"); return; }
  if (pathname.startsWith("/api/")) {
    try {
      sendJson(res, 200, await handleApi(req, res, pathname));
    } catch (error) {
      console.error(`[${req.method} ${pathname}] ${error.message}`);
      sendJson(res, error.status || 400, { error: error.message || "Procesarea a eșuat." });
    }
    return;
  }
  try {
    serveFile(req, res, resolveStatic(ROOT, pathname));
  } catch (error) {
    console.error(`[GET ${pathname}] ${error.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`ClipTrei rulează pe http://localhost:${PORT} (${os.platform()})`));
