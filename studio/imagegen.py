"""Story decors: SD-Turbo (OpenVINO) text-to-image, Intel GPU first, CPU as fallback.

Usage: imagegen.py <jobs.json>   (run from the project folder; `out` paths are relative to it)
jobs = { model_dir, width, height, steps, device_order: ["GPU", "CPU"], items: [{ prompt, out, seed }] }
Loads the model once, writes each PNG and prints one JSON line per image: {"out", "seconds", "device"}.
"""
import json
import sys
import time


def log(message):
    print(message, file=sys.stderr, flush=True)


def load(model_dir, device, width, height):
    from optimum.intel import OVStableDiffusionPipeline
    pipe = OVStableDiffusionPipeline.from_pretrained(model_dir, device=device, compile=False)
    # SD-Turbo runs without classifier-free guidance (guidance_scale 0): one latent per step. The
    # default reshape assumes guidance and doubles the UNet batch, which then fails at inference.
    # So: reshape everything, then reload the UNet from disk and give it batch 1 ourselves (a graph
    # already made static with batch 2 can't be reshaped again).
    import os
    import openvino
    pipe.reshape(batch_size=1, height=height, width=width, num_images_per_prompt=1)
    unet = openvino.Core().read_model(os.path.join(model_dir, "unet", "openvino_model.xml"))
    shapes = {}
    for model_input in unet.inputs:
        name, shape = model_input.get_any_name(), model_input.get_partial_shape()
        if name == "sample":
            shapes[name] = [1, shape[1].get_length() if shape[1].is_static else 4, height // 8, width // 8]
        elif name == "encoder_hidden_states":
            shapes[name] = [1, 77, shape[2].get_length()]
        elif name == "timestep" and shape.rank.get_length() == 1:
            shapes[name] = [1]
    unet.reshape(shapes)
    pipe.unet.model = unet
    pipe.compile()
    pipe.set_progress_bar_config(disable=True)
    return pipe


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(sys.argv[1], encoding="utf-8") as handle:
        jobs = json.load(handle)
    width, height, steps = jobs["width"], jobs["height"], jobs.get("steps", 2)
    pipe, device, errors = None, None, []
    started = time.time()
    for candidate in jobs.get("device_order", ["GPU", "CPU"]):
        try:
            pipe, device = load(jobs["model_dir"], candidate, width, height), candidate
            break
        except Exception as error:  # GPU missing or driver too old: try the next device
            errors.append(f"{candidate}: {error}")
    if pipe is None:
        raise SystemExit("Nu am putut încărca modelul de imagini: " + " | ".join(errors))
    log(f"device={device}" + ("" if device == "GPU" else " (placa video indisponibilă)") + f" load={time.time() - started:.1f}s")

    import torch
    upscaler, upscale_size = None, None
    if jobs.get("upscale"):
        import upscale
        upscaler = upscale.load(jobs["upscale"]["model"])
        upscale_size = (jobs["upscale"]["width"], jobs["upscale"]["height"])
    for item in jobs["items"]:
        t = time.time()
        image = pipe(prompt=item["prompt"], num_inference_steps=steps, guidance_scale=0.0, width=width, height=height,
                     generator=torch.Generator().manual_seed(int(item.get("seed", 0)))).images[0]
        if upscaler is not None:
            image = upscale.upscale_image(image, upscaler, upscale_size)
        image.save(item["out"])
        print(json.dumps({"out": item["out"], "seconds": round(time.time() - t, 2), "device": device}), flush=True)


if __name__ == "__main__":
    main()
