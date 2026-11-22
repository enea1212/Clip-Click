"""Local speech-to-text for ClipTrei.

Usage: python transcribe.py <audio.wav>
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
    if len(sys.argv) != 2:
        print("usage: transcribe.py <audio.wav>", file=sys.stderr)
        return 2
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("MISSING_FASTER_WHISPER", file=sys.stderr)
        return MISSING_EXIT_CODE

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(read_wav(sys.argv[1]), word_timestamps=True, vad_filter=True)
    words = [
        {"word": word.word, "start": round(word.start, 3), "end": round(word.end, 3)}
        for segment in segments
        for word in (segment.words or [])
    ]
    json.dump({"language": info.language, "words": words}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
