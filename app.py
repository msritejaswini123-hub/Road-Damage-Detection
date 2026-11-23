import io
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

from model import ModelNotConfiguredError, RoadDamageDetector


ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 1024 * 1024

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
app.config["JSON_SORT_KEYS"] = False
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

detector = RoadDamageDetector()


@app.errorhandler(RequestEntityTooLarge)
def handle_upload_too_large(_error):
    return jsonify(error="Image is too large. Maximum upload size is 10 MB."), 413


@app.get("/")
def landing():
    return render_template("index.html")


@app.get("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.get("/analytics")
def analytics():
    return render_template("analytics.html")


@app.get("/about")
def about():
    return render_template("about.html")


@app.get("/results")
def results():
    return render_template("results.html")


@app.get("/api/status")
def api_status():
    return jsonify(detector.status())


@app.post("/api/analyze")
def analyze():
    upload = request.files.get("image")
    if upload is None or not upload.filename:
        return jsonify(error="Choose a road image to analyze."), 400

    filename = secure_filename(upload.filename)
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify(error="Upload a JPG, JPEG, or PNG image."), 415

    image_bytes = upload.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes:
        return jsonify(error="The uploaded file is empty."), 400
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return jsonify(error="Image is too large. Maximum upload size is 10 MB."), 413

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                return jsonify(error="Image dimensions are too large to process safely."), 400
            source.verify()
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGB")
            image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        return jsonify(error="This file could not be decoded as a valid image."), 400

    try:
        result = detector.predict(image)
    except ModelNotConfiguredError as error:
        return jsonify(error=str(error), code="model_not_configured"), 503
    except Exception:
        logger.exception("Road damage inference failed")
        return jsonify(error="The model could not analyze this image. Check the server logs."), 500

    return jsonify(
        filename=filename,
        image_width=image.width,
        image_height=image.height,
        detections=result["detections"],
        annotated_image_url="/api/results/" + result["result_id"],
        result_id=result["result_id"],
    )


@app.get("/api/results/<result_id>")
def get_result_image(result_id):
    image_path = detector.result_path(result_id)
    if image_path is None:
        return jsonify(error="This result image is no longer available. Analyze the image again."), 404
    return send_file(image_path, mimetype="image/jpeg", max_age=0)


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
    )
