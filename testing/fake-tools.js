// Stand-in for yt-dlp, ffmpeg, ffprobe and transcribe.py in the server tests.
// Usage (from proc.js when CLIPTREI_FAKE_TOOLS is set): node fake-tools.js <command> <args...>
// Behaviour is steered by the JSON file in CLIPTREI_FAKE_CONTROL (re-read on every call):
//   { duration, noSubs, noWhisper, downloadFails, transcribeFailOnce, slowDownloadMs, slowRenderMs }
// Every call is appended to <control>.log so tests can check what ran.
const fs = require("node:fs");
const path = require("node:path");

const [command, ...args] = process.argv.slice(2);
const controlFile = process.env.CLIPTREI_FAKE_CONTROL;
const control = controlFile && fs.existsSync(controlFile) ? JSON.parse(fs.readFileSync(controlFile, "utf8")) : {};
const duration = control.duration || 900;
if (controlFile) fs.appendFileSync(`${controlFile}.log`, `${command} ${args.join(" ")}\n`);

const after = (flag) => args[args.indexOf(flag) + 1];
const out = (text) => process.stdout.write(text);
const fail = (message, code = 1) => { process.stderr.write(message); process.exit(code); };

// Speech pattern: 10 words of 0.3 s, then a 1.2 s pause — gives clips and pauses to cut.
function wordsBetween(start, end) {
  const words = [];
  for (let t = 0; t < duration; t += 4.2) {
    for (let i = 0; i < 10; i += 1) {
      const s = t + i * 0.3;
      if (s >= start && s + 0.3 <= end) words.push({ word: ` w${Math.round(s * 10)}`, start: s, end: s + 0.28 });
    }
  }
  return words;
}

function vtt() {
  const lines = ["WEBVTT", ""];
  for (let t = 0; t + 3 <= duration; t += 4.2) {
    const stamp = (x) => new Date(x * 1000).toISOString().slice(11, 23);
    lines.push(`${stamp(t)} --> ${stamp(t + 3)}`);
    lines.push(Array.from({ length: 10 }, (_, i) => (i ? `<${stamp(t + i * 0.3)}><c> w${Math.round((t + i * 0.3) * 10)}</c>` : `w${Math.round(t * 10)}`)).join(""));
    lines.push("");
  }
  return lines.join("\n");
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

if (command === "python" && args[0] === "-c") {
  if (control.noWhisper) fail("No module named faster_whisper");
  process.exit(0);
}

if (command === "python" && args[0] === "-m" && args[1] === "yt_dlp") {
  const url = args.at(-1);
  if (args.includes("--dump-json")) {
    out(JSON.stringify({ title: "FAKE VIDEO", duration, language: "en", subtitles: {}, automatic_captions: control.noSubs ? {} : { "en-orig": [] } }));
    process.exit(0);
  }
  const folder = path.dirname(after("-o"));
  if (control.downloadFails) fail(`ERROR: [youtube] ${url}: This video is unavailable`);
  const section = args.includes("--download-sections");
  if (!section && !control.noSubs && args.includes("--write-subs")) fs.writeFileSync(path.join(folder, "source.en-orig.vtt"), vtt());
  if (!args.includes("--skip-download")) {
    if (control.slowDownloadMs) sleep(control.slowDownloadMs);
    const template = path.basename(after("-o"));
    const file = section ? template.replace("%(ext)s", "mp4") : template.replace("%(ext)s", "webm");
    fs.writeFileSync(path.join(folder, file), section ? "fake segment" : "fake audio");
    out(`FAKE VIDEO\n${path.join(folder, file)}\n`);
  }
  process.exit(0);
}

if (command === "python" && /transcribe\.py$/.test(args[0])) {
  if (control.noWhisper) process.exit(3);
  if (control.transcribeFailOnce && fs.existsSync(control.transcribeFailOnce)) {
    fs.rmSync(control.transcribeFailOnce);
    fail("RuntimeError: simulated Whisper crash");
  }
  const { start, length } = JSON.parse(fs.readFileSync(args[1], "utf8"));
  const words = wordsBetween(start, start + length).map((w) => ({ ...w, start: w.start - start, end: w.end - start }));
  out(JSON.stringify({ language: "en", words }));
  process.exit(0);
}

if (command === "ffprobe") {
  if (args.includes("-of")) { out(`${duration}\n`); process.exit(0); }
  out(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: String(duration) } }));
  process.exit(0);
}

if (command === "ffmpeg" && args.some((arg) => arg.includes("astats"))) {
  // Loudness analysis: quiet (-35 dB) with a 5 s burst (-12 dB) at control.loudAt seconds.
  const file = args.find((arg) => arg.includes("astats")).match(/file=([^,:]+)$/)[1];
  if (control.loudnessFails) fail("Error: simulated loudness failure");
  if (control.loudnessEmpty) { fs.writeFileSync(file, ""); process.exit(0); }
  const lines = [];
  for (let s = 0; s < duration; s += 1) {
    const loud = control.loudAt !== undefined && s >= control.loudAt && s < control.loudAt + 5;
    lines.push(`frame:${s} pts:${s * 16000} pts_time:${s}`, `lavfi.astats.Overall.RMS_level=${loud ? -12 : -35}`);
  }
  fs.writeFileSync(file, lines.join("\n"));
  process.exit(0);
}

if (command === "ffmpeg") {
  const output = args.at(-1);
  if (output.endsWith(".wav")) {
    const start = args.includes("-ss") ? Number(after("-ss")) : 0;
    const length = args.includes("-t") ? Number(after("-t")) : duration - start;
    fs.writeFileSync(output, JSON.stringify({ start, length }));
  } else {
    if (control.slowRenderMs && /short-\d+-\d+\.mp4$/.test(output)) sleep(control.slowRenderMs);
    fs.writeFileSync(output, "fake mp4");
  }
  process.exit(0);
}

fail(`fake-tools: unknown call ${command} ${args.join(" ")}`, 9);
