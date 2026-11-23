"""One-time setup for animated stories: studio/venv + models/ (~5-6 GB).

Usage (system Python): python studio/setup.py
Every step skips what already exists, so it can be re-run after a failure.
Set HF_HOME to reuse an existing Hugging Face cache (otherwise a temporary one is used and deleted).
"""
import os
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV = os.path.join(ROOT, "studio", "venv")
PY = os.path.join(VENV, "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
MODELS = os.environ.get("CLIPTREI_MODELS_DIR") or os.path.join(ROOT, "models")
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
CONVERT = """
import sys
from optimum.intel import OVStableDiffusionPipeline
OVStableDiffusionPipeline.from_pretrained("stabilityai/sd-turbo", export=True, compile=False).save_pretrained(sys.argv[1])
"""


def step(title):
    print(f"\n== {title}", flush=True)


def run(*args, env=None):
    subprocess.run(args, check=True, env=env)


def main():
    # Romanian messages: the Windows console/pipe default (cp1252) can't encode ă, ș, ț.
    sys.stdout.reconfigure(encoding="utf-8")
    step("Mediul Python (studio/venv)")
    if not os.path.exists(PY):
        run(sys.executable, "-m", "venv", VENV)
        run(PY, "-m", "pip", "install", "--upgrade", "pip")
    run(PY, "-m", "pip", "install", "-r", os.path.join(ROOT, "studio", "requirements.txt"),
        "--extra-index-url", "https://download.pytorch.org/whl/cpu")

    step("Vocile Kokoro (engleză)")
    kokoro = os.path.join(MODELS, "kokoro")
    os.makedirs(kokoro, exist_ok=True)
    for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
        target = os.path.join(kokoro, name)
        if not os.path.exists(target):
            print(f"descarc {name}", flush=True)
            urllib.request.urlretrieve(KOKORO_URL + name, target + ".part")
            os.replace(target + ".part", target)

    step("Vocea Piper (română, ro_RO-mihai-medium, CC0)")
    piper = os.path.join(MODELS, "piper")
    if not os.path.exists(os.path.join(piper, "ro_RO-mihai-medium.onnx")):
        run(PY, "-m", "piper.download_voices", "ro_RO-mihai-medium", "--data-dir", piper)

    step("SD-Turbo pentru OpenVINO (models/sd-turbo-ov)")
    target = os.path.join(MODELS, "sd-turbo-ov")
    if not os.path.exists(os.path.join(target, "model_index.json")):
        own_cache = "HF_HOME" not in os.environ
        cache = os.environ.get("HF_HOME") or os.path.join(MODELS, ".hf-tmp")
        run(PY, "-c", CONVERT, target, env={**os.environ, "HF_HOME": cache})
        if own_cache:
            shutil.rmtree(cache, ignore_errors=True)

    print("\nGata. Verificare:", flush=True)
    run(PY, "-c", "import openvino, kokoro_onnx, PIL, numpy; print('ok', openvino.__version__)")


if __name__ == "__main__":
    main()
