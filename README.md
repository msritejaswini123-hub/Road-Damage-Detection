# RoadVision AI

A Flask application for road-damage image analysis using a trained Ultralytics YOLO model. The interface does not generate sample predictions: analysis remains unavailable until a valid model is configured.

## Project layout

- `app.py` — Flask pages, upload validation, model status, and analysis/result-image API.
- `model.py` — lazy YOLO adapter, model label mapping, prediction formatting, and temporary annotation storage.
- `templates/` — landing page, detection dashboard, analytics, technology guide, and result detail.
- `static/style.css` — responsive visual system and dashboard styling.
- `static/script.js` — drag-and-drop upload, API requests, local result storage, result download, and data-driven analytics.
- `requirements.txt` — Python dependencies.
- `tests/test_app.py` — focused checks for routes, upload validation, and explicit model-unavailable behavior.

## Run locally

1. Use Python 3.10 or newer and install the dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

2. Set `ROAD_DAMAGE_MODEL` to an Ultralytics-compatible trained weights file:

   ```powershell
   $env:ROAD_DAMAGE_MODEL = "C:\models\road_damage.pt"
   ```

   On macOS or Linux, use `export ROAD_DAMAGE_MODEL=/path/to/road_damage.pt`.

3. Start the server:

   ```powershell
   py app.py
   ```

4. Open <http://127.0.0.1:5000>.

Run the backend checks with `py -m unittest discover -s tests -v`.

If `ROAD_DAMAGE_MODEL` is unset, points to a missing file, or Ultralytics cannot load it, the dashboard reports that state and `/api/analyze` returns an explicit error. The app does not download weights or substitute a different model.

## Model classes

The detector uses class names exposed by the loaded model. Names containing `D00` / `longitudinal`, `D10` / `transverse`, `D20` / `alligator`, or `D40` / `pothole` are displayed with the corresponding road-damage label. Other class names remain visible as provided by the model.

## Analysis data

Images are validated and processed in memory. The original upload is not written to the server. YOLO's annotated image is kept in a temporary directory for up to one hour so the browser can retrieve it. Successful analysis details and image blobs are saved in the current browser's IndexedDB for the Results and Analytics pages. Clearing browser site data removes those saved results.

Supported uploads are JPG, JPEG, and PNG, up to 10 MB. Set `ROAD_DAMAGE_RESULTS_DIR` to change the temporary annotated-image directory.
