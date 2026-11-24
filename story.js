// Animated story from story.json: decors → voice → word timings → captions → render.
// Usage: node story.js <folder> [--preview]
// Every stage reuses what is already on disk (decor-*.png, voice.json, words.json), so a re-run
// after a crash or after editing only the camera/overlays just renders again.
const fs = require("node:fs");
const path = require("node:path");
const S = require("./studio");
const { buildAss } = require("./subtitles");
const { run } = require("./proc");

const FULL = { width: 1080, height: 1920, fps: 30, out: "story.mp4" };
const PREVIEW = { width: 540, height: 960, fps: 15, out: "story-preview.mp4" };

async function timed(log, label, work) {
  const started = Date.now();
  const result = await work();
  log(`[poveste] ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

async function buildStory(folder, { preview = false, log = console.log } = {}) {
  const story = S.validateStory(JSON.parse(fs.readFileSync(path.join(folder, "story.json"), "utf8")));
  await timed(log, "decoruri", () => S.generateDecors(folder, story, { log }));
  const durations = await timed(log, "voce", () => S.synthesizeVoices(folder, story, { log }));
  const timeline = S.sceneTimeline(durations);
  const words = await timed(log, "timpi pe cuvânt", () => S.storyWords(folder, story, timeline));
  const total = timeline.at(-1).end;
  fs.writeFileSync(path.join(folder, "captions.ass"), buildAss(words, 0, total, { maxGroup: 2, top: 560 }), "utf8");

  const size = preview ? PREVIEW : FULL;
  const lookOf = (name) => story.characters.find((character) => character.name === name).look;
  const job = {
    ...size, voice: "voice.wav", subtitles: "captions.ass",
    scenes: story.scenes.map((scene, index) => ({
      start: timeline[index].start,
      end: timeline[index].end,
      decor_file: S.decorFile(scene.decor),
      camera: scene.camera,
      characters: scene.characters.map((c) => ({ ...c, look: lookOf(c.name), talking: c.name === scene.speaker })),
      overlay: scene.overlay,
    })),
  };
  fs.writeFileSync(path.join(folder, "render.json"), JSON.stringify(job, null, 2));
  await timed(log, preview ? "randare (previzualizare)" : "randare", async () => {
    try {
      await run(S.studioPython(), [S.script("render_story.py"), "render.json"], { cwd: folder });
    } catch (error) {
      throw new Error(`Randarea poveștii a eșuat: ${error.message}`);
    }
  });
  return { video: size.out, seconds: total };
}

if (require.main === module) {
  const [folder, flag] = process.argv.slice(2);
  if (!folder) {
    console.error("Folosire: node story.js <folder cu story.json> [--preview]");
    process.exit(2);
  }
  buildStory(path.resolve(folder), { preview: flag === "--preview" })
    .then((result) => console.log(`Gata: ${path.join(folder, result.video)} (${result.seconds.toFixed(1)} s)`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = { buildStory };
