import os
import sys
import unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import upscale  # noqa: E402


class UpscaleTest(unittest.TestCase):
    def test_network_multiplies_the_size_by_four(self):
        import torch
        net = upscale.SRVGGNetCompact(num_conv=2).eval()
        with torch.no_grad():
            out = net(torch.zeros(1, 3, 8, 12))
        self.assertEqual(tuple(out.shape), (1, 3, 32, 48))

    def test_upscale_image_returns_the_requested_size(self):
        net = upscale.SRVGGNetCompact(num_conv=2).eval()
        image = Image.new("RGB", (24, 40), (200, 100, 50))
        out = upscale.upscale_image(image, net, (60, 100))
        self.assertEqual(out.size, (60, 100))
        self.assertEqual(out.mode, "RGB")

    def test_target_size_keeps_the_frame_cover_margin(self):
        # 576x1024 decors become 1260x2240: enough to cover 1080x1920 with the 1.16 camera margin.
        self.assertEqual(upscale.target_size(576, 1024), (1260, 2240))



class CoverScaleTest(unittest.TestCase):
    def test_small_images_are_enlarged_to_cover_the_frame(self):
        self.assertAlmostEqual(upscale.cover_scale(630, 1120), 2.0)
        self.assertAlmostEqual(upscale.cover_scale(1000, 1000), 2.24)

    def test_big_enough_images_are_left_alone(self):
        self.assertIsNone(upscale.cover_scale(1260, 2240))
        self.assertIsNone(upscale.cover_scale(1220, 2200))


if __name__ == "__main__":
    unittest.main()
