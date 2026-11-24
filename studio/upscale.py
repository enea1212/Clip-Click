"""Decor upscaling with Real-ESRGAN (realesr-general-x4v3, BSD-3-Clause, ~5 MB).

SD-Turbo makes 576x1024 decors; the video needs ~2.2x that (more with camera zoom), and a
plain resize looks blurry and blocky next to the sharp characters. Real-ESRGAN rebuilds the
edges at 4x; the result is resized to the size the renderer needs.
Runs on the CPU with torch (~6 s per decor). On the Iris Xe through OpenVINO it gave a wrong
image (also in fp32), so the GPU is not used for this step.
"""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

SCALE = 4
COVER = 2.1875  # 576x1024 -> 1260x2240: covers 1080x1920 with the renderer's 1.16 camera margin


class SRVGGNetCompact(nn.Module):
    """The compact Real-ESRGAN network (same layout as the published weights)."""

    def __init__(self, num_feat=64, num_conv=32, upscale=SCALE):
        super().__init__()
        self.upscale = upscale
        body = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        for _ in range(num_conv):
            body += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.body = nn.ModuleList(body)
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def load(model_path):
    net = SRVGGNetCompact()
    state = torch.load(model_path, map_location="cpu", weights_only=True)
    net.load_state_dict(state.get("params", state.get("params_ema", state)))
    return net.eval()


def target_size(width, height):
    return (int(round(width * COVER)), int(round(height * COVER)))


def upscale_image(image, net, size):
    """The image upscaled 4x by the network, then resized to `size` (width, height)."""
    x = torch.from_numpy(np.asarray(image.convert("RGB"), dtype=np.float32) / 255).permute(2, 0, 1)[None]
    with torch.no_grad():
        y = net(x)[0].clamp(0, 1).permute(1, 2, 0).numpy()
    big = Image.fromarray((y * 255).round().astype(np.uint8))
    return big.resize(size, Image.LANCZOS)
