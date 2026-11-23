// Audio-based preselection: loud moments (shouting, laughter, big reactions) often have little
// speech, so the speech-density rules miss them. On a 6 h GTA stream only 1 of the 12 loudest
// moments reached the AI before this. Everything here is pure except the ffmpeg arguments.

const WINDOW = 60;     // seconds on each side for the local baseline (median)
const MIN_DELTA = 9;   // dB above the baseline
const MIN_LEVEL = -25; // dB: a jump that stays quiet is not a reaction
const MERGE_GAP = 8;   // seconds: louder seconds this close form one event
const BEFORE = 40;     // the candidate window starts this long before the peak (the build-up)

// ffmpeg: audio only, one RMS level per second (16 kHz × 16000 samples) printed to `output`.
function loudnessArgs(output) {
  return ["-v", "error", "-nostdin", "-i", "source.mp4", "-vn", "-af",
    `aresample=16000,asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=${output}`,
    "-f", "null", "-"];
}

// ffmpeg's ametadata print → dB per second (index = second). Silence (-inf) → -90.
function parseLoudness(text) {
  const levels = [];
  let second = null;
  for (const line of String(text).split(/\r?\n/)) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) { second = Math.round(Number(time[1])); continue; }
    const level = line.match(/RMS_level=(\S+)/);
    if (level && second !== null) {
      const value = Number(level[1]);
      levels[second] = Number.isFinite(value) ? value : -90;
    }
  }
  return Array.from(levels, (value) => (value === undefined ? -90 : value));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : -90;
}

// Loud events, best first: seconds clearly louder than the surrounding minute(s), merged when
// close. score = biggest jump × √duration (a long outburst beats a single bang).
function loudEvents(rms) {
  const events = [];
  for (let i = 0; i < rms.length; i += 1) {
    if (rms[i] <= MIN_LEVEL) continue;
    const around = rms.slice(Math.max(0, i - WINDOW), i + WINDOW).filter((value) => value > -80);
    const delta = rms[i] - median(around);
    if (delta < MIN_DELTA) continue;
    const last = events.at(-1);
    if (last && i - last.end <= MERGE_GAP) {
      last.end = i;
      if (delta > last.peak) { last.peak = delta; last.at = i; }
    } else {
      events.push({ start: i, end: i, at: i, peak: delta });
    }
  }
  for (const event of events) event.score = event.peak * Math.sqrt(event.end - event.start + 1);
  return events.sort((a, b) => b.score - a.score);
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Final candidate list: the best `speech` speech windows, then windows around the loudest events
// (marked with loudAt), then more speech windows to reach `count`. Never overlapping.
function mixCandidates(speechCandidates, events, { count = 10, speech = 5, length = 75, duration = Infinity } = {}) {
  const chosen = [];
  const add = (candidate) => {
    if (chosen.length < count && chosen.every((other) => !overlaps(other, candidate))) chosen.push(candidate);
  };
  speechCandidates.slice(0, speech).forEach((candidate) => add({ ...candidate }));
  for (const event of events) {
    const peak = event.at ?? event.start;
    // Already inside a chosen window: that window gets the hint instead of a second window.
    const holder = chosen.find((candidate) => peak >= candidate.start && peak < candidate.end);
    if (holder) {
      if (holder.loudAt === undefined) holder.loudAt = peak;
      continue;
    }
    if (chosen.length >= count) break;
    const start = Math.max(0, Math.min(peak - BEFORE, duration - length));
    add({ start, end: Math.min(duration, start + length), score: event.score, loudAt: peak });
  }
  speechCandidates.slice(speech).forEach((candidate) => add({ ...candidate }));
  return chosen;
}

module.exports = { loudnessArgs, parseLoudness, loudEvents, mixCandidates };
