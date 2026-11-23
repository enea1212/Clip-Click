// Pure builders for ffmpeg/ffprobe argument arrays. ffmpeg runs with cwd = project folder,
// so the source and subtitle files are bare names; the gameplay path goes through -i (never a filter).
const { buildFilter, num } = require("./layout");
const { totalDuration } = require("./pauses");

const SOURCE = "source.mp4";
const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];

// With `segments` (pause cutting, times relative to the clip start) the source is trimmed
// to those segments, so the output is shorter and the audio comes from the concat.
function clipArgs({ start, end, srcW, srcH, zoom, split, subtitles, satisfyingPath, satisfyingStart, output, segments, sourceFile = SOURCE }) {
  const cut = Array.isArray(segments) && segments.length > 0;
  const inputs = ["-ss", String(start), "-i", sourceFile];
  if (split) inputs.push("-stream_loop", "-1", "-ss", String(satisfyingStart), "-i", satisfyingPath);
  const graph = buildFilter({ srcW, srcH, zoom, split, subtitles, segments });
  const length = cut ? num(totalDuration(segments)) : String(end - start);
  return ["-y", ...inputs, "-t", length, "-filter_complex", graph, "-map", "[v]", "-map", cut ? "[ca]" : "0:a?", ...ENCODE, output];
}

function rawPreviewArgs({ start, end, output, sourceFile = SOURCE }) {
  return ["-y", "-ss", String(start), "-i", sourceFile, "-t", String(end - start), "-vf", "scale=640:-2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output];
}

function satPreviewArgs({ satisfyingPath, satisfyingStart, length, output }) {
  return ["-y", "-stream_loop", "-1", "-ss", String(satisfyingStart), "-i", satisfyingPath, "-t", String(length), "-vf", "scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,scale=640:-2", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-movflags", "+faststart", output];
}

function probeArgs(file) {
  return ["-v", "error", "-print_format", "json", "-show_entries", "stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration", "-select_streams", "v:0", file];
}

// ffmpeg auto-rotates phone videos tagged ±90°, so the displayed size is width/height swapped.
function parseProbe(text) {
  const info = JSON.parse(text);
  const stream = info.streams?.[0] || {};
  let width = Number(stream.width);
  let height = Number(stream.height);
  if (!(width > 0 && height > 0)) throw new Error("Nu am putut citi dimensiunile videoclipului.");
  const rotation = Number((stream.side_data_list || []).find((item) => "rotation" in item)?.rotation) || 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const [num, den] = String(stream.r_frame_rate || "0/1").split("/").map(Number);
  const fps = den > 0 && num > 0 ? num / den : 0;
  return { width, height, duration: Number(info.format?.duration) || 0, fps };
}

module.exports = { clipArgs, rawPreviewArgs, satPreviewArgs, probeArgs, parseProbe };
