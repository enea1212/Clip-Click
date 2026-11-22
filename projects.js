const fs = require("node:fs");
const path = require("node:path");

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const SATISFYING_EXT = /\.(mp4|mov|webm|mkv)$/i;
const EMPTY_SATISFYING = "Pune cel puțin un video în folderul satisfying/";

function isValidId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function readProject(dataDir, id) {
  if (!isValidId(id)) return null;
  try {
    const project = JSON.parse(fs.readFileSync(path.join(dataDir, id, "project.json"), "utf8"));
    return project && Array.isArray(project.clips) ? project : null;
  } catch {
    return null;
  }
}

// Write to a unique temp file, then rename, so a crash never leaves a half-written project.json.
function saveProject(dataDir, project) {
  if (!isValidId(project.id)) throw new Error("Id de proiect invalid.");
  const file = path.join(dataDir, project.id, "project.json");
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(project, null, 2), "utf8");
  fs.renameSync(temp, file);
}

// Re-reads the saved project and changes only one clip, synchronously (no await between
// read and write), so concurrent jobs on other clips never overwrite each other.
function updateClip(dataDir, id, n, changes) {
  const project = readProject(dataDir, id);
  if (!project || !project.clips[n - 1]) throw new Error("Proiectul nu există.");
  Object.assign(project.clips[n - 1], changes);
  saveProject(dataDir, project);
  return project.clips[n - 1];
}

// In-memory job locks. Keys are "<id>:<clip>" for renders/picks and "<id>:process" for processing.
// Plus one global "heavy" slot: only one video is processed (download + Whisper) at a time.
function createLocks() {
  const held = new Set();
  let heavy = false;
  return {
    acquire(key) { if (held.has(key)) return false; held.add(key); return true; },
    release(key) { held.delete(key); },
    isProjectBusy(id) { return [...held].some((key) => key.startsWith(`${id}:`)); },
    acquireHeavy() { if (heavy) return false; heavy = true; return true; },
    releaseHeavy() { heavy = false; },
    heavyBusy() { return heavy; },
  };
}

function listProjects(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  const items = [];
  for (const id of fs.readdirSync(dataDir)) {
    try {
      const folder = path.join(dataDir, id);
      if (!isValidId(id) || !fs.statSync(folder).isDirectory()) continue;
      const project = readProject(dataDir, id);
      if (project) {
        items.push({ id, title: project.title, createdAt: project.createdAt, clipCount: project.clips.length, legacy: false });
        continue;
      }
      // Older or unfinished folders can't be edited (no saved start times), but must stay visible
      // so they can be watched or deleted — they may hold a multi-GB source video.
      const files = fs.readdirSync(folder).filter((name) => !/^project\.json/.test(name));
      if (!files.length) continue;
      const shorts = files.filter((name) => /^short-\d+(-\d+)?\.mp4$/.test(name)).sort();
      items.push({ id, title: id, createdAt: fs.statSync(folder).mtime.toISOString(), clipCount: shorts.length, legacy: true, videos: shorts.map((name) => `/data/${id}/${name}`) });
    } catch {
      // A folder removed while listing is simply skipped.
    }
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function deleteProject(dataDir, id) {
  if (!isValidId(id)) return false;
  const folder = path.join(dataDir, id);
  if (!fs.existsSync(folder)) return false;
  fs.rmSync(folder, { recursive: true, force: true });
  return true;
}

function safeSatisfyingName(name) {
  return typeof name === "string" && SATISFYING_EXT.test(name) && !/[\\/]/.test(name) && !name.includes("..");
}

function listSatisfying(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => safeSatisfyingName(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
}

async function pickSatisfying(files, durationOf, clipLength, random = Math.random) {
  if (!files.length) throw new Error(EMPTY_SATISFYING);
  const file = files[Math.floor(random() * files.length) % files.length];
  const duration = await durationOf(file);
  const start = Math.round(random() * Math.max(0, duration - clipLength) * 100) / 100;
  return { file, start };
}

// The file may have been replaced by a shorter one since it was picked.
function clampSatisfyingStart(start, duration, clipLength) {
  return Math.max(0, Math.min(start, duration - clipLength));
}

module.exports = { clampSatisfyingStart, isValidId, readProject, saveProject, updateClip, createLocks, listProjects, deleteProject, safeSatisfyingName, listSatisfying, pickSatisfying, EMPTY_SATISFYING };
