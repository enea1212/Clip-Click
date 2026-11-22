// Shared by the server (ffmpeg filter) and the browser preview (window.Layout),
// so both use exactly the same zoom formula.
(function () {
  const CANVAS = { w: 1080, h: 1920 };

  function boxFor(split) {
    return { w: CANVAS.w, h: split ? CANVAS.h / 2 : CANVAS.h };
  }

  const even = (value) => Math.max(2, Math.round(value / 2) * 2);

  // zoom 0 = whole video visible (fit), zoom 1 = box filled (fill, edges cut).
  function zoomSize(srcW, srcH, boxW, boxH, zoom) {
    const fit = Math.min(boxW / srcW, boxH / srcH);
    const fill = Math.max(boxW / srcW, boxH / srcH);
    const z = Math.min(1, Math.max(0, Number(zoom) || 0));
    const scale = fit + z * (fill - fit);
    return { w: even(srcW * scale), h: even(srcH * scale) };
  }

  const num = (value) => String(Math.round(value * 1000) / 1000);

  // Optional pause cutting: keep only the speech segments (video + audio) and join them;
  // the layout then reads [cv] instead of the raw source, and the audio comes from [ca].
  function cutParts(segments) {
    const parts = [];
    let inputs = "";
    segments.forEach((seg, i) => {
      parts.push(`[0:v]trim=start=${num(seg.start)}:end=${num(seg.end)},setpts=PTS-STARTPTS[v${i}]`);
      parts.push(`[0:a]atrim=start=${num(seg.start)}:end=${num(seg.end)},asetpts=PTS-STARTPTS[a${i}]`);
      inputs += `[v${i}][a${i}]`;
    });
    parts.push(`${inputs}concat=n=${segments.length}:v=1:a=1[cv][ca]`);
    return parts;
  }

  function buildFilter({ srcW, srcH, zoom, split, subtitles, segments }) {
    const box = boxFor(split);
    const size = zoomSize(srcW, srcH, box.w, box.h, zoom);
    const cut = Array.isArray(segments) && segments.length > 0;
    const parts = [
      ...(cut ? cutParts(segments) : []),
      `${cut ? "[cv]" : "[0:v]"}split[a][b]`,
      `[a]scale=${box.w}:${box.h}:force_original_aspect_ratio=increase,crop=${box.w}:${box.h},boxblur=20:2,eq=brightness=-0.12[bg]`,
      `[b]scale=${size.w}:${size.h},crop=${Math.min(size.w, box.w)}:${Math.min(size.h, box.h)}[fg]`,
    ];
    if (split) {
      parts.push("[bg][fg]overlay=(W-w)/2:(H-h)/2[top]");
      parts.push(`[1:v]scale=${box.w}:${box.h}:force_original_aspect_ratio=increase,crop=${box.w}:${box.h},setsar=1[bot]`);
      parts.push(`[top][bot]vstack,setsar=1,subtitles=${subtitles}[v]`);
    } else {
      parts.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,subtitles=${subtitles}[v]`);
    }
    return parts.join(";");
  }

  const api = { CANVAS, boxFor, zoomSize, buildFilter, num };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Layout = api;
})();
