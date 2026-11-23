"""Local speech-to-text for ClipClick.

Usage: python transcribe.py <audio.wav> [language]
(language, e.g. "ro" or "en", skips auto-detection when it is already known)
Prints JSON to stdout: {"language": "en", "words": [{"word", "start", "end"}]}
(times in seconds, relative to the audio file). Exits with code 3 when
faster-whisper is not installed, so the server can show an install hint.
"""
import json
import sys
import wave

MISSING_EXIT_CODE = 3


def read_wav(path):
    """Read the 16 kHz mono 16-bit WAV that ffmpeg produced (see whisper.js audioArgs).

    Passing samples directly avoids faster-whisper's PyAV decoder, which breaks
    with newer `av` releases (open() lost the `metadata_errors` argument).
    """
    import numpy as np

    with wave.open(path, "rb") as audio:
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        frames = audio.readframes(audio.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> int:
    # Romanian diacritics must survive the Windows console encoding.
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) not in (2, 3):
        print("usage: transcribe.py <audio.wav> [language]", file=sys.stderr)
        return 2
    language = sys.argv[2] if len(sys.argv) == 3 else None
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("MISSING_FASTER_WHISPER", file=sys.stderr)
        return MISSING_EXIT_CODE

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(read_wav(sys.argv[1]), language=language, word_timestamps=True, vad_filter=True)
    words = [
        {"word": word.word, "start": round(word.start, 3), "end": round(word.end, 3)}
        for segment in segments
        for word in (segment.words or [])
    ]
    json.dump({"language": info.language, "words": words}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
