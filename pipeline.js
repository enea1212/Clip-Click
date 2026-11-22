// Resumable processing: which stages of a project still need to run, judged from the files
// already on disk, and how to show a project whose job is no longer running.

const INTERRUPTED = "Procesarea a fost întreruptă.";
const RUNNING = new Set(["downloading", "transcribing", "rendering"]);

const fileOf = (publicUrl) => String(publicUrl || "").split("?")[0].split("/").pop();

// files: Set of file names in the project folder.
function resumePlan(project, files) {
  const clips = project.clips || [];
  return {
    download: !files.has("source.mp4"),
    words: !files.has("words.json"),
    choose: clips.length === 0,
    renderClips: clips.filter((clip) => !clip.video || !files.has(fileOf(clip.video)) || !files.has(`raw-${clip.n}.mp4`)).map((clip) => clip.n),
  };
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

module.exports = { resumePlan, missingChunks, normalizeStatus, INTERRUPTED };
