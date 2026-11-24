"""Story voices: one WAV per scene plus the joined track with pauses.

Usage: tts.py <tts.json>   (run from the project folder; paths are relative to it)
tts = { language: "en"|"ro", models_dir, gap, last_gap, items: [{ text, voice, out }], combined }
- en: Kokoro (kokoro-onnx), `voice` is a Kokoro voice name.
- ro: Piper, voice ro_RO-mihai-medium, run as a separate process (piper-tts is GPL); `voice` is
  { pitch, speed }: speed via --length-scale, pitch via ffmpeg (asetrate + atempo, same length).
Prints {"durations": [seconds per item, without pauses], "sampleRate"}.
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np


def read_wav(path):
    with wave.open(path) as handle:
        rate = handle.getframerate()
        data = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if handle.getnchannels() > 1:
            data = data.reshape(-1, handle.getnchannels()).mean(axis=1)
    return data, rate


def write_wav(path, samples, rate):
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())


def speakable(text):
    """The text sent to the voice: Piper produces no audio at all when it meets „ ” (seen on
    2026-11-23), so typographic quotes are dropped and ’ becomes '. Captions keep the original."""
    for mark in "„”“«»":
        text = text.replace(mark, "")
    return text.replace("’", "'").strip()


def kokoro_voices(models_dir, items):
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(os.path.join(models_dir, "kokoro", "kokoro-v1.0.onnx"), os.path.join(models_dir, "kokoro", "voices-v1.0.bin"))
    for item in items:
        samples, rate = kokoro.create(speakable(item["text"]), voice=item["voice"], lang="en-us")
        write_wav(item["out"], samples, rate)


def piper_voices(models_dir, items):
    model = os.path.join(models_dir, "piper", "ro_RO-mihai-medium.onnx")
    for item in items:
        voice = item["voice"] if isinstance(item["voice"], dict) else {}
        speed, pitch = float(voice.get("speed", 1)), float(voice.get("pitch", 1))
        raw = item["out"] + ".raw.wav"
        subprocess.run([sys.executable, "-m", "piper", "-m", model, "-f", raw, "--length-scale", str(round(1 / speed, 3))],
                       input=speakable(item["text"]).encode("utf-8"), check=True, capture_output=True)
        if abs(pitch - 1) < 0.01:
            os.replace(raw, item["out"])
            continue
        _, rate = read_wav(raw)
        # Higher pitch without changing the length: play faster (asetrate), then slow back down (atempo).
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af",
                        f"asetrate={int(rate * pitch)},aresample={rate},atempo={1 / pitch:.4f}", item["out"]], check=True)
        os.remove(raw)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(sys.argv[1], encoding="utf-8") as handle:
        jobs = json.load(handle)
    if jobs["language"] == "en":
        kokoro_voices(jobs["models_dir"], jobs["items"])
    else:
        piper_voices(jobs["models_dir"], jobs["items"])

    parts, durations, rate = [], [], None
    for index, item in enumerate(jobs["items"]):
        samples, item_rate = read_wav(item["out"])
        if rate is None:
            rate = item_rate
        elif item_rate != rate:
            raise SystemExit(f"Rate diferit în {item['out']}: {item_rate} vs {rate}")
        durations.append(round(len(samples) / rate, 3))
        pause = jobs["last_gap"] if index == len(jobs["items"]) - 1 else jobs["gap"]
        parts += [samples, np.zeros(int(round(pause * rate)), dtype=np.float32)]
    write_wav(jobs["combined"], np.concatenate(parts), rate)
    print(json.dumps({"durations": durations, "sampleRate": rate}))


if __name__ == "__main__":
    main()
