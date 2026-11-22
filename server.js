const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { run } = require("./proc");
const { randomUUID } = require("node:crypto");
const { parseVttWords, groupWords, buildAss, pickCaptionTrack } = require("./subtitles");
const { chooseClips, chooseCandidates } = require("./clips");
const AI = require("./ai");
const { clipArgs, rawPreviewArgs, satPreviewArgs, probeArgs, parseProbe } = require("./render");
const P = require("./projects");
const { resolveStatic, decodePath, parseRange, checkRequest } = require("./http-utils");
const W = require("./whisper");
const { speechSegments, remapWords, totalDuration, snapSegments } = require("./pauses");
const { resumePlan, missingChunks, normalizeStatus, keepForResume, leftoverFiles } = require("./pipeline");

// Errors that will happen again on every „Reia” (the video itself is the problem).
const permanent = (error) => Object.assign(error, { permanent: true });

const ROOT = __dirname;
// Overridable only so the automated tests never touch the real projects.
const DATA_DIR = process.env.CLIPTREI_DATA_DIR || path.join(ROOT, "data");
const SATISFYING_DIR = process.env.CLIPTREI_SATISFYING_DIR || path.join(ROOT, "satisfying");
const PORT = Number(process.env.PORT || 4173);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mp4": "video/mp4", ".json": "application/json; charset=utf-8" };
fs.mkdirSync(DATA_DIR, { recursive: true });

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
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
const BUSY_MESSAGE = "Se procesează deja un video. Încearcă după ce termină.";
async function withLock(key, busyMessage, job) {
  if (!locks.acquire(key)) throw new UserError(busyMessage, 409);
  try { return await job(); } finally { locks.release(key); }
}

// Is faster-whisper importable? Checked before any download so a missing package
// never costs a multi-GB download first.
async function whisperAvailable() {
  try {
    await run("python", ["-c", "import faster_whisper"]);
    return true;
  } catch {
    return false;
  }
}

// Transcribes [start, end] of source.mp4 with local Whisper. `language` (e.g. "en") skips
// auto-detection; returns the words (absolute times) and the language Whisper used.
async function whisperWords(folder, { start, end, wav, language }) {
  await run("ffmpeg", W.audioArgs({ start, end, output: wav }), { cwd: folder });
  try {
    const args = [path.join(ROOT, "transcribe.py"), wav, ...(language ? [language] : [])];
    const out = await run("python", args, { cwd: folder, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    return { words: W.parseTranscript(out, start || 0), language: JSON.parse(out).language || language || null };
  } catch (error) {
    if (error.exitCode === W.MISSING_EXIT_CODE) {
      const missing = new UserError(W.WHISPER_MISSING);
      missing.whisperMissing = true;
      throw missing;
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Transcrierea Whisper a eșuat: ${error.message.split("\n").at(-1)}`);
  } finally {
    fs.rmSync(path.join(folder, wav), { force: true });
  }
}

// Whole video in 10-minute windows (bounded memory); the language detected on the first
// window is reused so the whole transcript stays in one language.
// Each finished window is saved in chunks/chunk-N.json, so „Reia” after a crash or a server
// stop only transcribes the windows that are still missing.
async function transcribeWholeVideo(folder, duration) {
  const plan = W.chunkPlan(duration);
  const chunkDir = path.join(folder, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });
  const todo = new Set(missingChunks(plan, new Set(fs.readdirSync(chunkDir))));
  const chunkFile = (index) => path.join(chunkDir, `chunk-${index}.json`);
  let language = null;
  for (const [index, chunk] of plan.entries()) {
    if (!todo.has(index)) {
      language = language || JSON.parse(fs.readFileSync(chunkFile(index), "utf8")).language;
      continue;
    }
    console.log(`[whisper] fragmentul ${index + 1}/${plan.length} (${Math.round(chunk.start / 60)}–${Math.round(chunk.end / 60)} min)`);
    const result = await whisperWords(folder, { start: chunk.start, end: chunk.end, wav: `chunk-${index}.wav`, language });
    language = language || result.language;
    P.writeJsonAtomic(chunkFile(index), { language: result.language, words: result.words });
  }
  return W.mergeChunks(plan.map((chunk, index) => ({ chunk, words: JSON.parse(fs.readFileSync(chunkFile(index), "utf8")).words })));
}

const clipWordsFile = (folder, n) => path.join(folder, `words-${n}.json`);

// Exact word timings for one clip: Whisper on the clip's audio, or the YouTube words as fallback.
// The language comes from the subtitle track already chosen, so a 34 s clip with music
// isn't detected as another language.
async function prepareClipWords(folder, clip, fallbackWords, language) {
  let words = [];
  let wordsSource = "whisper";
  let whisperMissing = false;
  try {
    ({ words } = await whisperWords(folder, { start: clip.start, end: clip.end, wav: `clip-${clip.n}.wav`, language }));
  } catch (error) {
    whisperMissing = error.whisperMissing === true;
    console.warn(`[whisper] clip ${clip.n}: ${error.message}`);
  }
  if (!words.length) {
    // Missing faster-whisper is not a final verdict: leave the source unset (like projects from
    // before Whisper) so the UI keeps offering „Taie pauzele” and the next Apply tries Whisper.
    wordsSource = whisperMissing ? undefined : "youtube";
    words = fallbackWords.filter((word) => word.end > clip.start && word.start < clip.end);
  }
  // Without faster-whisper the YouTube fallback is not saved: once Whisper is installed, the next
  // „Aplică” gets exact timings (and „Taie pauzele”) instead of staying on YouTube timings forever.
  if (!whisperMissing) P.writeJsonAtomic(clipWordsFile(folder, clip.n), words);
  return { wordsSource, words };
}

// A clip's words: the saved words-N.json, or prepared now (Whisper, else YouTube timings).
async function clipWordsFor(folder, clip, fallbackWords, language) {
  if (fs.existsSync(clipWordsFile(folder, clip.n))) return { words: JSON.parse(fs.readFileSync(clipWordsFile(folder, clip.n), "utf8")), wordsSource: clip.wordsSource };
  return prepareClipWords(folder, clip, fallbackWords, language);
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
    const found = snapSegments(speechSegments(words, clip.start, clip.end), project.fps, clip.end - clip.start);
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
  return { title: info.title || "", duration: Number(info.duration) || 0, hasSubtitles: W.hasOriginalSubtitles(info), estimateMinutes: W.estimateMinutes(info.duration), whisperAvailable: await whisperAvailable(), ai: await AI.ollamaStatus() };
}

async function processVideo(rawUrl, { transcribe = false } = {}) {
  const url = safeUrl(rawUrl);
  if (!url) throw new UserError("Te rog introdu un link https valid de YouTube.");
  // One heavy job at a time: refuse before creating a folder or downloading anything.
  if (!locks.acquireHeavy()) throw new UserError(BUSY_MESSAGE, 409);
  try {
    if (transcribe && !(await whisperAvailable())) throw new UserError(W.WHISPER_MISSING);
    const id = randomUUID();
    fs.mkdirSync(folderOf(id), { recursive: true });
    // Saved from the start so a failure or a server stop leaves a project that can be resumed.
    P.saveProject(DATA_DIR, { id, title: "", url, transcribe: transcribe === true, createdAt: new Date().toISOString(), status: "downloading", clips: [] });
    return await runPipeline(id, { firstRun: true });
  } finally {
    locks.releaseHeavy();
  }
}

// „Reia”: run only the stages that are still missing.
async function resumeProject(id) {
  const project = loadProject(id);
  if (normalizeStatus(project, locks.isProjectBusy(id)).status !== "failed") throw new UserError("Proiectul nu trebuie reluat.");
  if (!locks.acquireHeavy()) throw new UserError(BUSY_MESSAGE, 409);
  try {
    // Hold the project's lock from the start, so it can't be deleted during the Whisper check.
    return await withLock(`${id}:resume`, "Proiectul se reia deja.", async () => {
      if (project.transcribe && !fs.existsSync(path.join(folderOf(id), "words.json")) && !(await whisperAvailable())) throw new UserError(W.WHISPER_MISSING);
      return runPipeline(id, { firstRun: false });
    });
  } finally {
    locks.releaseHeavy();
  }
}

// „Alege din nou cu AI”: re-choose the moments of a finished project with the AI, reusing the
// downloaded video and the transcript (no download, no Whisper). The AI is checked first, so the
// existing clips stay untouched if it is still unavailable.
async function rechooseProject(id) {
  const project = loadProject(id);
  if (normalizeStatus(project, locks.isProjectBusy(id)).status !== "ready") throw new UserError("Proiectul nu e gata încă.");
  const ai = await AI.ollamaStatus();
  if (!ai.ok) throw new UserError(`AI-ul nu e disponibil: ${ai.reason}.`);
  if (!locks.acquireHeavy()) throw new UserError(BUSY_MESSAGE, 409);
  try {
    return await withLock(`${id}:rechoose`, "Proiectul se procesează deja.", async () => {
      const folder = folderOf(id);
      const fresh = loadProject(id);
      for (const clip of fresh.clips) {
        for (const name of [fileOfUrl(clip.video), fileOfUrl(clip.raw), `sat-${clip.n}.mp4`, `captions-${clip.n}.ass`, `words-${clip.n}.json`]) {
          if (name) try { fs.rmSync(path.join(folder, name), { force: true }); } catch { /* in use: cleaned on a later run */ }
        }
      }
      fs.rmSync(path.join(folder, "ai"), { recursive: true, force: true });
      saveStage(fresh, { clips: [], selection: undefined, selectionNote: undefined, aiProgress: undefined, status: "failed", error: "Se aleg din nou momentele." });
      return runPipeline(id, { firstRun: false });
    });
  } finally {
    locks.releaseHeavy();
  }
}

const fileOfUrl = (publicUrl) => (publicUrl ? path.basename(String(publicUrl).split("?")[0]) : null);

// Download flags: full transcription doesn't need YouTube's subtitles at all.
const subtitleArgs = (transcribe) => (transcribe ? [] : ["--write-auto-subs", "--write-subs", "--sub-langs", W.SUB_LANGS, "--sub-format", "vtt/best"]);

const saveStage = (project, changes) => { Object.assign(project, changes); P.saveProject(DATA_DIR, project); };

// Language of the transcript, so the AI writes titles in it: the subtitle track's language, or
// the one Whisper detected for a full transcription.
function transcriptLanguage(project, folder) {
  const fromTrack = W.trackLanguage(project.track);
  if (fromTrack) return fromTrack;
  try { return JSON.parse(fs.readFileSync(path.join(folder, "chunks", "chunk-0.json"), "utf8")).language || null; } catch { return null; }
}

// Stage "choosing": the AI scores 10 rule-preselected candidates (each answer saved in ai/, so
// „Reia” only asks for the missing ones); the best 3 AI clips win, rules fill any gap. If the AI
// isn't available the rules choose, exactly as before — processing never fails because of it.
async function chooseMoments(project, folder, words) {
  saveStage(project, { status: "choosing", error: undefined });
  const transcript = groupWords(words).map((group) => ({ start: group[0].start, end: group.at(-1).end, caption: group.map((item) => item.word).join(" ") }));
  const ruleClips = chooseClips(transcript);
  const ai = await AI.ollamaStatus();
  const aiClips = [];
  let note = ai.ok ? undefined : ai.reason;
  if (ai.ok) {
    const candidates = chooseCandidates(transcript, { count: 10, length: 75 });
    const aiDir = path.join(folder, "ai");
    fs.mkdirSync(aiDir, { recursive: true });
    const language = transcriptLanguage(project, folder);
    let done = 0;
    for (const [index, candidate] of candidates.entries()) {
      const file = path.join(aiDir, `candidate-${index}.json`);
      let clip;
      if (fs.existsSync(file)) {
        ({ clip } = JSON.parse(fs.readFileSync(file, "utf8")));
      } else {
        saveStage(project, { aiProgress: { done, total: candidates.length } });
        const lines = AI.buildLines(words, candidate.start, candidate.end);
        try {
          clip = lines.length ? AI.parseAnswer(await AI.askOllama(AI.buildPrompt(lines, { language })), lines) : null;
        } catch (error) {
          console.warn(`[ai] candidatul ${index + 1}: ${error.message}`);
          clip = null;
        }
        P.writeJsonAtomic(file, { clip });
      }
      if (clip) aiClips.push(clip);
      done += 1;
    }
    saveStage(project, { aiProgress: { done, total: candidates.length } });
    if (!aiClips.length) note = "AI-ul n-a găsit momente potrivite";
  }
  const final = AI.pickFinal(aiClips, ruleClips);
  if (final.length < 3) throw permanent(new UserError("Videoclipul e prea scurt sau subtitrările nu conțin destulă vorbire pentru trei momente."));
  const source = await probe("source.mp4", folder);
  const captionOf = (clip) => (clip.entries
    ? clip.entries.map((entry) => entry.caption).join(" ")
    : words.filter((word) => word.start >= clip.start && word.start < clip.end).map((word) => word.word).join(" ")).slice(0, 180);
  saveStage(project, {
    sourceWidth: source.width, sourceHeight: source.height, fps: source.fps,
    selection: final.some((clip) => clip.source === "ai") ? "ai" : "reguli",
    selectionNote: final.some((clip) => clip.source === "reguli") ? note : undefined,
    clips: final.map((clip, index) => ({
      n: index + 1, start: clip.start, end: clip.end,
      time: `${timestamp(clip.start)} — ${timestamp(clip.end)}`,
      rank: clip.rank, source: clip.source, title: clip.title, reason: clip.reason, aiScore: clip.aiScore,
      caption: captionOf(clip),
      zoom: 1, satisfyingOn: false, satisfying: null, video: null, raw: null,
    })),
  });
}

// The whole processing, stage by stage. Every stage checks the files on disk (resumePlan)
// and skips what is already done; progress is saved after each stage.
async function runPipeline(id, { firstRun }) {
  const folder = folderOf(id);
  return withLock(`${id}:process`, "Proiectul se procesează deja.", async () => {
    const project = loadProject(id);
    try {
      // Leftovers of a crash: temporary audio, half-written or superseded clips.
      // A file held open by another app (e.g. a media player) just stays; it must not block „Reia”.
      for (const name of leftoverFiles(project, fs.readdirSync(folder))) {
        try { fs.rmSync(path.join(folder, name), { force: true }); } catch { /* in use: try next time */ }
      }
      const filesNow = () => new Set(fs.readdirSync(folder));
      let plan = resumePlan(project, filesNow());

      if (plan.download) {
        saveStage(project, { status: "downloading", error: undefined });
        const outputTemplate = path.join(folder, "source.%(ext)s");
        const printed = await run("python", ["-m", "yt_dlp", "--ignore-errors", "--no-playlist", "--no-warnings", ...subtitleArgs(project.transcribe), "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", outputTemplate, "--print", "after_move:title", "--print", "after_move:filepath", project.url], { cwd: folder, windowsHide: true });
        const video = fs.readdirSync(folder).find((name) => /^source\.(mp4|mkv|webm)$/i.test(name));
        if (!video) throw new UserError("YouTube nu a furnizat un fișier video compatibil.");
        // render.js reads "source.mp4"; ffmpeg detects the real container from the content.
        if (video !== "source.mp4") fs.renameSync(path.join(folder, video), path.join(folder, "source.mp4"));
        saveStage(project, { title: printed.split(/\r?\n/)[0]?.trim() || "Video fără titlu" });
      }
      // A download that failed after the video arrived may have left no title.
      if (!project.title) saveStage(project, { title: "Video fără titlu" });

      plan = resumePlan(project, filesNow());
      if (plan.words) {
        saveStage(project, { status: "transcribing", error: undefined });
        let words;
        if (project.transcribe) {
          // No original-language subtitles: transcribe the whole video (the user confirmed the estimate).
          project.track = "whisper";
          words = await transcribeWholeVideo(folder, (await probe("source.mp4", folder)).duration);
          if (!words.length) throw permanent(new UserError("Whisper nu a găsit vorbire în acest videoclip."));
        } else {
          const readCaptions = () => fs.readdirSync(folder).filter((name) => name.startsWith("source.") && name.endsWith(".vtt")).map((name) => ({ name, text: fs.readFileSync(path.join(folder, name), "utf8") }));
          let captions = readCaptions();
          if (!captions.length) {
            // Subtitles can be missing because YouTube refused them (HTTP 429), not because they
            // don't exist: fetch only the subtitles again (no video), so „Reia” can succeed.
            await run("python", ["-m", "yt_dlp", "--ignore-errors", "--no-playlist", "--no-warnings", "--skip-download", ...subtitleArgs(false), "-o", path.join(folder, "source.%(ext)s"), project.url], { cwd: folder, windowsHide: true }).catch(() => {});
            captions = readCaptions();
          }
          if (!captions.length) throw new UserError("Nu am găsit subtitrări pentru acest videoclip. Dacă YouTube a refuzat temporar descărcarea, încearcă „Reia” mai târziu.");
          project.track = pickCaptionTrack(captions);
          words = parseVttWords(captions.find((item) => item.name === project.track).text);
        }
        P.writeJsonAtomic(path.join(folder, "words.json"), words);
        saveStage(project, {});
      }
      const words = JSON.parse(fs.readFileSync(path.join(folder, "words.json"), "utf8"));

      if (plan.choose) await chooseMoments(project, folder, words);

      saveStage(project, { status: "rendering", error: undefined });
      for (const n of resumePlan(project, filesNow()).renderClips) {
        const clip = project.clips[n - 1];
        let clipWords;
        if (project.transcribe && !fs.existsSync(clipWordsFile(folder, n))) {
          // Already Whisper words: no second transcription, just this clip's slice.
          clipWords = words.filter((word) => word.end > clip.start && word.start < clip.end);
          P.writeJsonAtomic(clipWordsFile(folder, n), clipWords);
          clip.wordsSource = "whisper";
        } else {
          const prepared = await clipWordsFor(folder, clip, words, W.trackLanguage(project.track));
          clipWords = prepared.words;
          clip.wordsSource = prepared.wordsSource;
        }
        // Save at once: words-N.json may now exist, so after a crash this step is skipped and
        // wordsSource must already be on disk (it decides whether pauses can be cut).
        saveStage(project, {});
        const previous = clip.video;
        Object.assign(clip, await renderClip(project, clip, clipWords, { zoom: 1, split: false, cutPauses: clip.wordsSource === "whisper" }));
        removePublicFile(id, previous !== clip.video ? previous : null);
        const raw = `raw-${n}.mp4`;
        await run("ffmpeg", rawPreviewArgs({ start: clip.start, end: clip.end, output: raw }), { cwd: folder });
        clip.raw = publicPath(id, raw);
        saveStage(project, {});
      }

      saveStage(project, { status: "ready", error: undefined });
      return project;
    } catch (error) {
      if (!keepForResume({ firstRun, hasSource: fs.existsSync(path.join(folder, "source.mp4")), permanent: error.permanent === true })) {
        // Nothing to reuse, or „Reia” would hit the same error forever: don't keep GB on disk.
        try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* listed as incomplete; deletable later */ }
        if (!firstRun) error.message += " Proiectul a fost șters, pentru că reluarea n-ar schimba rezultatul.";
        throw error;
      }
      // Keep everything done so far (possibly GB of video and hours of transcription).
      try { saveStage(project, { status: "failed", error: error.message }); } catch { /* folder gone */ }
      error.resumable = true;
      throw error;
    }
  });
}

function loadProject(id) {
  const project = P.readProject(DATA_DIR, id);
  if (!project) throw new UserError("Proiectul nu există.", 404);
  return project;
}

function clipOf(project, n) {
  if (normalizeStatus(project, locks.isProjectBusy(project.id)).status !== "ready") throw new UserError("Proiectul nu e gata încă. Reia procesarea din „Proiectele mele”.");
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
    // Clips without saved words (projects from before Whisper, or made while it wasn't installed)
    // get them now: Whisper if available, else YouTube timings.
    const hadWords = fs.existsSync(clipWordsFile(folder, n));
    const fallback = hadWords ? [] : JSON.parse(fs.readFileSync(path.join(folder, "words.json"), "utf8"));
    const { words, wordsSource } = await clipWordsFor(folder, clip, fallback, W.trackLanguage(fresh.track));
    if (!hadWords) {
      clip.wordsSource = wordsSource;
      P.updateClip(DATA_DIR, id, n, { wordsSource });
    }
    const wantCut = typeof cutPauses === "boolean" ? cutPauses : clip.cutPauses === true;
    if (wantCut && clip.wordsSource !== "whisper") throw new UserError("Necesită transcriere Whisper.");
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
  const resumeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/resume$/);
  if (req.method === "POST" && resumeMatch) {
    if (!P.isValidId(resumeMatch[1])) throw new UserError("Proiect invalid.");
    return resumeProject(resumeMatch[1]);
  }
  const rechooseMatch = pathname.match(/^\/api\/projects\/([^/]+)\/rechoose$/);
  if (req.method === "POST" && rechooseMatch) {
    if (!P.isValidId(rechooseMatch[1])) throw new UserError("Proiect invalid.");
    return rechooseProject(rechooseMatch[1]);
  }
  if (req.method === "POST" && pathname === "/api/inspect") return inspectVideo((await readJson(req)).url);
  if (req.method === "POST" && pathname === "/api/process") {
    const body = await readJson(req);
    return processVideo(body.url, { transcribe: body.transcribe === true });
  }
  if (req.method === "GET" && pathname === "/api/projects") {
    return P.listProjects(DATA_DIR).map((item) => (item.legacy ? item : normalizeStatus(item, locks.isProjectBusy(item.id))));
  }
  if (projectMatch && !P.isValidId(projectMatch[1])) throw new UserError("Proiect invalid.");
  if (req.method === "GET" && projectMatch) return normalizeStatus(loadProject(projectMatch[1]), locks.isProjectBusy(projectMatch[1]));
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
  const refused = checkRequest(req.method, req.headers, PORT);
  if (refused) {
    console.warn(`[blocat] ${req.method} ${req.url} host=${req.headers.host} origin=${req.headers.origin || "-"}`);
    sendJson(res, refused.status, { error: refused.message });
    req.resume();
    return;
  }
  const pathname = decodePath(new URL(req.url, "http://localhost").pathname);
  if (pathname === null) { res.writeHead(400); res.end("Bad request"); return; }
  if (pathname.startsWith("/api/")) {
    try {
      sendJson(res, 200, await handleApi(req, res, pathname));
    } catch (error) {
      console.error(`[${req.method} ${pathname}] ${error.message}`);
      sendJson(res, error.status || 400, { error: error.message || "Procesarea a eșuat.", ...(error.resumable ? { resumable: true } : {}) });
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
