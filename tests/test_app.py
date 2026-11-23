import io
import unittest
from unittest.mock import patch

from PIL import Image

import app as roadvision_app
from model import ModelNotConfiguredError


class UnconfiguredDetector:
    def status(self):
        return {
            "configured": False,
            "message": "The YOLO model is not configured.",
        }

    def predict(self, _image):
        raise ModelNotConfiguredError("The YOLO model is not configured.")


class RoadVisionRoutesTests(unittest.TestCase):
    def setUp(self):
        self.detector_patch = patch.object(roadvision_app, "detector", UnconfiguredDetector())
        self.detector_patch.start()
        roadvision_app.app.config.update(TESTING=True)
        self.client = roadvision_app.app.test_client()

    def tearDown(self):
        self.detector_patch.stop()

    def make_png(self):
        image = Image.new("RGB", (4, 4), color=(28, 42, 58))
        content = io.BytesIO()
        image.save(content, format="PNG")
        content.seek(0)
        return content

    def test_all_pages_render(self):
        for path in ("/", "/dashboard", "/analytics", "/about", "/results"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_model_status_is_explicitly_unconfigured(self):
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["configured"])

    def test_invalid_extension_is_rejected_before_inference(self):
        response = self.client.post(
            "/api/analyze",
            data={"image": (self.make_png(), "road.gif")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 415)
        self.assertIn("JPG, JPEG, or PNG", response.json["error"])

    def test_valid_image_reports_missing_model_without_fake_result(self):
        response = self.client.post(
            "/api/analyze",
            data={"image": (self.make_png(), "road.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["code"], "model_not_configured")
        self.assertNotIn("detections", response.json)

    def test_corrupt_image_is_rejected(self):
        response = self.client.post(
            "/api/analyze",
            data={"image": (io.BytesIO(b"not an image"), "road.jpg")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("valid image", response.json["error"])


if __name__ == "__main__":
    unittest.main()
