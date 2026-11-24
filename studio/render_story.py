"""Renders a story video frame by frame and pipes the frames into ffmpeg (voice + burned captions).

Usage: render_story.py <render.json>   (run from the project folder; paths are relative to it)
render = { width, height, fps, voice, subtitles, out,
           scenes: [{ start, end, decor_file, camera, characters: [{ name, look, expression, position, talking }], overlay }] }
Prints {"frames", "seconds"} when done.
"""
import json
import math
import random
import subprocess
import sys
import time
import wave
import zlib

import numpy as np
from PIL import Image

import characters
import overlays
import scene as S

POSITIONS = {"left": 0.25, "center": 0.5, "right": 0.75}
FEET = 0.82          # feet line, as a share of the frame height
CHAR_HEIGHT = 0.38   # character height, as a share of the frame height
COVER_MARGIN = 1.16  # decors are prepared a bit larger than the frame, so zoom/pan never shows edges


def voice_envelope(path, fps):
    """Loudness per frame, 0..1 (95th percentile = 1), for the talking mouths."""
    with wave.open(path) as handle:
        rate = handle.getframerate()
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    per = max(1, int(rate / fps))
    frames = len(samples) // per
    if frames == 0:
        return []
    rms = np.sqrt(np.mean(samples[: frames * per].reshape(frames, per) ** 2, axis=1))
    top = np.percentile(rms, 95) or 1.0
    return np.clip(rms / top, 0, 1).tolist()


def prepare_decor(path, width, height):
    """The decor scaled to cover the frame (with margin for camera moves), as an RGB image."""
    try:
        image = Image.open(path).convert("RGB")
    except Exception as error:
        raise SystemExit(f"Decorul {path} nu poate fi citit: {error}")
    scale = max(width / image.width, height / image.height) * COVER_MARGIN
    return image.resize((int(math.ceil(image.width * scale)), int(math.ceil(image.height * scale))), Image.LANCZOS)


def camera_frame(decor, width, height, camera, progress):
    """The part of the prepared decor seen by the camera, resized to the frame."""
    scale, dx, dy = S.camera_transform(camera, progress)
    # the prepared decor is COVER_MARGIN times the frame: at scale 1 we see 1/COVER_MARGIN of it
    view_w, view_h = decor.width / COVER_MARGIN / scale, decor.height / COVER_MARGIN / scale
    cx = decor.width / 2 + dx * decor.width / COVER_MARGIN
    cy = decor.height / 2 + dy * decor.height / COVER_MARGIN
    left = min(max(0, cx - view_w / 2), decor.width - view_w)
    top = min(max(0, cy - view_h / 2), decor.height - view_h)
    return decor.resize((width, height), Image.BILINEAR, box=(left, top, left + view_w, top + view_h))


def blink_at(name, t):
    """Blinks of 0.12 s every 3-5 s, the period fixed per character (by name)."""
    period = 3 + (zlib.crc32(name.encode("utf-8")) % 200) / 100
    return (t % period) < 0.12


def character_y(feet, height, local_t, t):
    """Feet position: a small hop when the scene starts, then a gentle sway (±2 % of the height)."""
    hop = 0.0
    if local_t < 0.3:
        p = local_t / 0.3
        hop = -math.sin(p * math.pi) * 0.06 * height
    return feet + hop + math.sin(t * math.pi) * 0.02 * height


def render_frame(job, decors, envelope, frame_index):
    width, height, fps = job["width"], job["height"], job["fps"]
    t = frame_index / fps
    index, local_t = S.scene_at(job["scenes"], t)
    scene = job["scenes"][index]
    length = max(0.001, scene["end"] - scene["start"])
    image = camera_frame(decors[scene["decor_file"]], width, height, scene["camera"], local_t / length)
    char_h = int(height * CHAR_HEIGHT)
    for person in scene["characters"]:
        x = width * POSITIONS[person["position"]]
        y = character_y(height * FEET, char_h, local_t, t)
        mouth = S.mouth_open(envelope, fps, t) if person.get("talking") else 0.0
        characters.draw_character(image, person["look"], person["expression"], x, y, char_h, blink=blink_at(person["name"], t), mouth=mouth)
    if scene.get("overlay"):
        overlays.draw_overlay(image, scene["overlay"], local_t, random.Random(index))
    return image


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(sys.argv[1], encoding="utf-8") as handle:
        job = json.load(handle)
    width, height, fps = job["width"], job["height"], job["fps"]
    started = time.time()
    decors = {}
    for scene in job["scenes"]:
        if scene["decor_file"] not in decors:
            decors[scene["decor_file"]] = prepare_decor(scene["decor_file"], width, height)
    envelope = voice_envelope(job["voice"], fps)
    total = int(math.ceil(job["scenes"][-1]["end"] * fps))
    ffmpeg = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
         "-i", job["voice"], "-vf", f"ass={job['subtitles']}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", job["out"]],
        stdin=subprocess.PIPE)
    try:
        for frame_index in range(total):
            ffmpeg.stdin.write(render_frame(job, decors, envelope, frame_index).tobytes())
    finally:
        ffmpeg.stdin.close()
    if ffmpeg.wait() != 0:
        raise SystemExit("ffmpeg a eșuat la randarea poveștii.")
    print(json.dumps({"frames": total, "seconds": round(time.time() - started, 1)}))


if __name__ == "__main__":
    main()
