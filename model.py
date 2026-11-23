import logging
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

DAMAGE_CATEGORIES = {
    "D00": "Longitudinal Crack",
    "D10": "Transverse Crack",
    "D20": "Alligator Crack",
    "D40": "Pothole",
}

_CLASS_ALIASES = {
    "D00": ("d00", "longitudinal"),
    "D10": ("d10", "transverse"),
    "D20": ("d20", "alligator"),
    "D40": ("d40", "pothole"),
}
_RESULT_TTL_SECONDS = 60 * 60


class ModelNotConfiguredError(RuntimeError):
    pass


def _category_for_name(name: str) -> tuple[str | None, str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
    for code, aliases in _CLASS_ALIASES.items():
        if any(alias in normalized for alias in aliases):
            return code, DAMAGE_CATEGORIES[code]
    return None, name.strip() or "Unknown class"


class RoadDamageDetector:
    """Lazy YOLO adapter. Set ROAD_DAMAGE_MODEL to a trained Ultralytics model file."""

    def __init__(self) -> None:
        configured_path = os.environ.get("ROAD_DAMAGE_MODEL", "").strip()
        self._model_path = Path(configured_path).expanduser() if configured_path else None
        self._model: Any = None
        self._unavailable_reason: str | None = None
        self._model_lock = Lock()
        self._results_dir = Path(
            os.environ.get("ROAD_DAMAGE_RESULTS_DIR", tempfile.gettempdir())
        ) / "roadvision-ai-results"
        self._results_dir.mkdir(parents=True, exist_ok=True)

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        if self._unavailable_reason is not None:
            raise ModelNotConfiguredError(self._unavailable_reason)

        if self._model_path is None:
            self._unavailable_reason = (
                "The YOLO model is not configured. Set ROAD_DAMAGE_MODEL to the path "
                "of a trained Ultralytics model file."
            )
            raise ModelNotConfiguredError(self._unavailable_reason)
        if not self._model_path.is_file():
            self._unavailable_reason = (
                f"The configured YOLO model was not found: {self._model_path}"
            )
            raise ModelNotConfiguredError(self._unavailable_reason)

        try:
            from ultralytics import YOLO

            self._model = YOLO(str(self._model_path))
        except ImportError as error:
            self._unavailable_reason = (
                "Ultralytics is not installed. Install the project requirements to enable detection."
            )
            logger.warning("YOLO model unavailable: %s", error)
            raise ModelNotConfiguredError(self._unavailable_reason) from error
        except Exception as error:
            self._unavailable_reason = f"The YOLO model could not be loaded: {error}"
            logger.exception("Unable to load YOLO model from %s", self._model_path)
            raise ModelNotConfiguredError(self._unavailable_reason) from error
        return self._model

    def status(self) -> dict[str, Any]:
        if self._model is not None:
            return {"configured": True, "message": "YOLO model ready."}
        try:
            self._load_model()
        except ModelNotConfiguredError as error:
            return {"configured": False, "message": str(error)}
        return {"configured": True, "message": "YOLO model ready."}

    def predict(self, image: Image.Image) -> dict[str, Any]:
        with self._model_lock:
            model = self._load_model()
            results = model.predict(source=np.asarray(image), verbose=False)
            if not results:
                raise RuntimeError("The YOLO model returned no result for the image.")
            result = results[0]
            boxes = result.boxes
            names = result.names
            detections = []

            if boxes is not None:
                for box in boxes:
                    class_id = int(box.cls.item())
                    class_name = str(
                        names.get(class_id, f"Class {class_id}")
                        if isinstance(names, dict)
                        else names[class_id] if class_id < len(names) else f"Class {class_id}"
                    )
                    category_code, category_name = _category_for_name(class_name)
                    coordinates = [round(float(value), 2) for value in box.xyxy[0].tolist()]
                    detections.append(
                        {
                            "class_id": class_id,
                            "class_code": category_code,
                            "class_name": category_name,
                            "model_class_name": class_name,
                            "confidence": round(float(box.conf.item()), 4),
                            "bbox": coordinates,
                        }
                    )

            annotated = result.plot()
            output = Image.fromarray(np.ascontiguousarray(annotated[:, :, ::-1]))
            result_id = uuid.uuid4().hex
            output_path = self._results_dir / f"{result_id}.jpg"
            output.save(output_path, format="JPEG", quality=90, optimize=True)
            self._prune_old_results()
            return {"result_id": result_id, "detections": detections}

    def result_path(self, result_id: str) -> Path | None:
        if not re.fullmatch(r"[a-f0-9]{32}", result_id):
            return None
        path = self._results_dir / f"{result_id}.jpg"
        if not path.is_file():
            return None
        return path

    def _prune_old_results(self) -> None:
        try:
            for path in self._results_dir.glob("*.jpg"):
                if path.stat().st_mtime < time.time() - _RESULT_TTL_SECONDS:
                    path.unlink()
        except OSError:
            logger.exception("Could not clean up expired result images")
