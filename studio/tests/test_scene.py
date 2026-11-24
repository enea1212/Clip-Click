import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scene  # noqa: E402

SCENES = [{"start": 0, "end": 2}, {"start": 2, "end": 5}]


class SceneTest(unittest.TestCase):
    def test_scene_at_boundaries(self):
        self.assertEqual(scene.scene_at(SCENES, 0), (0, 0))
        self.assertEqual(scene.scene_at(SCENES, 2), (1, 0))
        self.assertEqual(scene.scene_at(SCENES, 4.5), (1, 2.5))
        self.assertEqual(scene.scene_at(SCENES, 9), (1, 7))

    def test_zoom_in_is_monotonic(self):
        self.assertEqual(scene.camera_transform("zoom-in", 0), (1.0, 0.0, 0.0))
        self.assertAlmostEqual(scene.camera_transform("zoom-in", 1)[0], 1.15)
        values = [scene.camera_transform("zoom-in", p / 10)[0] for p in range(11)]
        self.assertEqual(values, sorted(values))
        self.assertAlmostEqual(scene.camera_transform("zoom-out", 0)[0], 1.15)

    def test_pans_are_symmetric(self):
        left0, left1 = scene.camera_transform("pan-left", 0), scene.camera_transform("pan-left", 1)
        right0 = scene.camera_transform("pan-right", 0)
        self.assertAlmostEqual(left0[1], -left1[1])
        self.assertAlmostEqual(left0[1], -right0[1])
        self.assertEqual(scene.camera_transform("static", 0.5), (1.0, 0.0, 0.0))

    def test_unknown_camera(self):
        with self.assertRaises(ValueError):
            scene.camera_transform("spin", 0.5)

    def test_mouth_open_follows_the_envelope(self):
        envelope = [0.0, 0.5, 1.0]
        self.assertEqual(scene.mouth_open(envelope, 30, 0), 0.0)
        self.assertEqual(scene.mouth_open(envelope, 30, 2 / 30), 1.0)
        self.assertEqual(scene.mouth_open(envelope, 30, 99), 0.0)


if __name__ == "__main__":
    unittest.main()
