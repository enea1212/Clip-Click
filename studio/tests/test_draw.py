import os
import random
import sys
import unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import characters  # noqa: E402
import overlays  # noqa: E402

LOOK = {"skin": "#f2d3b1", "hair": "short", "shirt": "#3b82f6"}
WHITE = (255, 255, 255)


def draw(expression="neutral", blink=False, mouth=0.0):
    image = Image.new("RGB", (540, 960), WHITE)
    box = characters.draw_character(image, LOOK, expression, x=270, y=800, height=360, blink=blink, mouth=mouth)
    return image, box


def crop(image, box):
    return image.crop(tuple(int(v) for v in box)).tobytes()


class DrawTest(unittest.TestCase):
    def test_character_stays_in_its_box(self):
        image, (left, top, right, bottom) = draw()
        self.assertTrue(0 <= left < right <= 540 and 0 <= top < bottom <= 800 + 1)
        pixels = image.load()
        for x in range(0, 540, 6):
            for y in range(0, 960, 6):
                if not (left <= x <= right and top <= y <= bottom):
                    self.assertEqual(pixels[x, y], WHITE, (x, y))
        self.assertNotEqual(crop(image, (left, top, right, bottom)), crop(Image.new("RGB", (540, 960), WHITE), (left, top, right, bottom)))

    def test_expressions_differ_in_the_mouth(self):
        happy, _ = draw("happy")
        angry, _ = draw("angry")
        mouth = characters.face_regions(270, 800, 360)["mouth"]
        self.assertNotEqual(crop(happy, mouth), crop(angry, mouth))

    def test_blink_changes_the_eyes(self):
        open_eyes, _ = draw()
        closed, _ = draw(blink=True)
        eyes = characters.face_regions(270, 800, 360)["eyes"]
        self.assertNotEqual(crop(open_eyes, eyes), crop(closed, eyes))

    def test_flash_is_white_then_gone(self):
        base = Image.new("RGB", (540, 960), (10, 20, 30))
        at0 = base.copy()
        overlays.draw_overlay(at0, {"type": "flash", "text": ""}, 0.0, random.Random(1))
        self.assertEqual(at0.getpixel((270, 480)), WHITE)
        later = base.copy()
        overlays.draw_overlay(later, {"type": "flash", "text": ""}, 0.3, random.Random(1))
        self.assertEqual(later.tobytes(), base.tobytes())

    def test_badge_draws_something(self):
        image = Image.new("RGB", (540, 960), (10, 20, 30))
        overlays.draw_overlay(image, {"type": "badge", "text": "112 MPH"}, 0.5, random.Random(1))
        self.assertNotEqual(image.tobytes(), Image.new("RGB", (540, 960), (10, 20, 30)).tobytes())


if __name__ == "__main__":
    unittest.main()
