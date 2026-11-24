"""Story decors: SDXL-Turbo (or SD-Turbo) through OpenVINO, Intel GPU first, CPU as fallback.

Usage: imagegen.py <jobs.json>   (`out` paths absolute or relative to the current folder)
       imagegen.py --serve         (one JSON job per stdin line; answers {"ok", "items"|"error"} per line)
jobs = { model_dir, pipeline: "sdxl"|"sd", vae_f32, width, height, steps, device_order: ["GPU", "CPU"], upscale?, items: [{ prompt, out, seed }] }
Loads the model once, writes each PNG and prints one JSON line per image: {"out", "seconds", "device"}.
"""
import json
import sys
import time


def log(message):
    print(message, file=sys.stderr, flush=True)


def load(model_dir, device, width, height, pipeline="sd", vae_f32=False):
    """The OpenVINO pipeline, compiled for one image size (static shapes: no slow first image).

    Turbo models run without classifier-free guidance (guidance_scale 0): one latent per step. The
    library's reshape assumes guidance and doubles the UNet batch, which then fails at inference;
    so everything is reshaped, then the UNet is read again from disk and given batch 1 (a graph
    already made static with batch 2 can't be reshaped again).
    SDXL-Turbo: its VAE decoder overflows in f16 on the Iris Xe (black images), so it alone runs
    in f32; the UNet stays in f16 (~16 s per image instead of ~36 s with everything in f32).
    """
    import os
    import openvino
    from optimum.intel import OVStableDiffusionPipeline, OVStableDiffusionXLPipeline
    cls = OVStableDiffusionXLPipeline if pipeline == "sdxl" else OVStableDiffusionPipeline
    pipe = cls.from_pretrained(model_dir, device=device, compile=False)
    pipe.reshape(batch_size=1, height=height, width=width, num_images_per_prompt=1)
    unet = openvino.Core().read_model(os.path.join(model_dir, "unet", "openvino_model.xml"))
    shapes = {}
    for model_input in unet.inputs:
        name, shape = model_input.get_any_name(), model_input.get_partial_shape()
        dims = [shape[i].get_length() if shape[i].is_static else -1 for i in range(shape.rank.get_length())]
        if name == "sample":
            dims = [1, dims[1] if dims[1] > 0 else 4, height // 8, width // 8]
        elif dims:
            dims[0] = 1
            if name == "encoder_hidden_states":
                dims[1] = 77
        shapes[name] = dims
    unet.reshape(shapes)
    pipe.unet.model = unet
    if vae_f32:
        pipe.vae_decoder.ov_config = {**(pipe.vae_decoder.ov_config or {}), "INFERENCE_PRECISION_HINT": "f32"}
    pipe.compile()
    pipe.set_progress_bar_config(disable=True)
    return pipe


class Generator:
    """The loaded model (+ upscaler) for one image size; generates the items of a job."""

    def __init__(self, jobs):
        self.width, self.height, self.steps = jobs["width"], jobs["height"], jobs.get("steps", 2)
        self.pipe, self.device, errors = None, None, []
        started = time.time()
        for candidate in jobs.get("device_order", ["GPU", "CPU"]):
            try:
                self.pipe, self.device = load(jobs["model_dir"], candidate, self.width, self.height, jobs.get("pipeline", "sd"), jobs.get("vae_f32", False)), candidate
                break
            except Exception as error:  # GPU missing or driver too old: try the next device
                errors.append(f"{candidate}: {error}")
        if self.pipe is None:
            raise RuntimeError("Nu am putut încărca modelul de imagini: " + " | ".join(errors))
        log(f"device={self.device}" + ("" if self.device == "GPU" else " (placa video indisponibilă)") + f" load={time.time() - started:.1f}s")
        self.upscaler, self.upscale_size = None, None
        if jobs.get("upscale"):
            import upscale
            self.upscale = upscale
            self.upscaler = upscale.load(jobs["upscale"]["model"])
            self.upscale_size = (jobs["upscale"]["width"], jobs["upscale"]["height"])

    def generate(self, items):
        import torch
        done = []
        for item in items:
            t = time.time()
            image = self.pipe(prompt=item["prompt"], num_inference_steps=self.steps, guidance_scale=0.0, width=self.width, height=self.height,
                              generator=torch.Generator().manual_seed(int(item.get("seed", 0)))).images[0]
            if self.upscaler is not None:
                image = self.upscale.upscale_image(image, self.upscaler, self.upscale_size)
            image.save(item["out"])
            done.append({"out": item["out"], "seconds": round(time.time() - t, 2), "device": self.device})
        return done


def serve():
    """One JSON job per stdin line, one JSON answer per stdout line; the model stays loaded."""
    generator = None
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            jobs = json.loads(line)
            if generator is None or (generator.width, generator.height) != (jobs["width"], jobs["height"]):
                generator = Generator(jobs)
            answer = {"ok": True, "items": generator.generate(jobs["items"])}
        except Exception as error:
            answer = {"ok": False, "error": str(error)}
        print(json.dumps(answer), flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "--serve":
        sys.stdin.reconfigure(encoding="utf-8")
        return serve()
    with open(sys.argv[1], encoding="utf-8") as handle:
        jobs = json.load(handle)
    try:
        generator = Generator(jobs)
    except RuntimeError as error:
        raise SystemExit(str(error))
    for item in jobs["items"]:
        print(json.dumps(generator.generate([item])[0]), flush=True)


if __name__ == "__main__":
    main()
