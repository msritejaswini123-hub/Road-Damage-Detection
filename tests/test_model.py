import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
from PIL import Image

from model import RoadDamageDetector


class RoadDamageDetectorTests(unittest.TestCase):
    def test_predict_formats_model_boxes_and_saves_annotation(self):
        box = Mock()
        box.cls = np.array([0])
        box.conf = np.array([0.875])
        box.xyxy = np.array([[1.25, 2.5, 8.0, 9.75]])

        model_result = Mock()
        model_result.boxes = [box]
        model_result.names = {0: "D00"}
        model_result.plot.return_value = np.zeros((12, 12, 3), dtype=np.uint8)
        model = Mock()
        model.predict.return_value = [model_result]

        with tempfile.TemporaryDirectory() as temporary_directory:
            detector = RoadDamageDetector()
            detector._model = model
            detector._results_dir = Path(temporary_directory)

            response = detector.predict(Image.new("RGB", (12, 12)))
            annotation_path = detector.result_path(response["result_id"])

            self.assertEqual(response["detections"], [{
                "class_id": 0,
                "class_code": "D00",
                "class_name": "Longitudinal Crack",
                "model_class_name": "D00",
                "confidence": 0.875,
                "bbox": [1.25, 2.5, 8.0, 9.75],
            }])
            self.assertIsNotNone(annotation_path)
            with Image.open(annotation_path) as annotation:
                self.assertEqual(annotation.format, "JPEG")


if __name__ == "__main__":
    unittest.main()
