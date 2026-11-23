// Resumable processing: which stages of a project still need to run, judged from the files
// already on disk, and how to show a project whose job is no longer running.

const INTERRUPTED = "Procesarea a fost întreruptă.";
const RUNNING = new Set(["downloading", "downloadingSegments", "transcribing", "choosing", "rendering"]);

const fileOf = (publicUrl) => String(publicUrl || "").split("?")[0].split("/").pop();
const AUDIO_SOURCE = /^source\.(m4a|m4b|webm|opus|ogg|mp3|aac|wav|mka|mp4)$/i;

// files: Set of file names in the project folder.
function resumePlan(project, files) {
  const clips = project.clips || [];
  const hasAudio = project.audioFile ? files.has(project.audioFile) : [...files].some((name) => AUDIO_SOURCE.test(name));
  const plan = {
    download: project.mediaMode === "segments" ? !hasAudio : !files.has("source.mp4"),
    words: !files.has("words.json"),
    choose: clips.length === 0,
    renderClips: clips.filter((clip) => !clip.video || !files.has(fileOf(clip.video)) || !files.has(`raw-${clip.n}.mp4`)).map((clip) => clip.n),
  };
  if (project.mediaMode === "segments") {
    plan.downloadSegments = clips.filter((clip) => clip.sourceFile !== `segment-${clip.n}.mp4` || !files.has(clip.sourceFile)).map((clip) => clip.n);
  }
  return plan;
}

// chunkFiles: Set of file names in the project's chunks/ folder.
function missingChunks(plan, chunkFiles) {
  return plan.map((_, index) => index).filter((index) => !chunkFiles.has(`chunk-${index}.json`));
}

// Projects from before resumable processing have no status: they're finished.
// A running stage without a running job means the server stopped mid-way.
function normalizeStatus(project, jobRunning) {
  const status = project.status || "ready";
  if (RUNNING.has(status) && !jobRunning) return { ...project, status: "failed", error: INTERRUPTED };
  return { ...project, status };
}

// After a failure: keep the project for „Reia” only when there is something to reuse and
// retrying can succeed. Permanent errors (video too short, no speech) would fail on every
// „Reia” while keeping GB of video, so those projects are removed, as before.
function keepForResume({ firstRun, hasSource, permanent }) {
  if (permanent) return false;
  return hasSource || !firstRun;
}

// Files a crash can leave behind: temporary audio, and rendered clips no project entry uses
// (half-written by a killed ffmpeg, or superseded). files: names in the project folder.
function leftoverFiles(project, files) {
  const used = new Set((project.clips || []).map((clip) => fileOf(clip.video)).filter(Boolean));
  return files.filter((name) => /\.wav$/i.test(name) || (/^short-\d+-\d+\.mp4$/.test(name) && !used.has(name)));
}

module.exports = { resumePlan, missingChunks, normalizeStatus, keepForResume, leftoverFiles, INTERRUPTED };
