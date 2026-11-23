(() => {
  "use strict";

  const DB_NAME = "roadvision-ai";
  const STORE_NAME = "analyses";
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const DAMAGE_CLASSES = [
    { code: "D00", name: "Longitudinal crack", color: "#51d5f7" },
    { code: "D10", name: "Transverse crack", color: "#7794ff" },
    { code: "D20", name: "Alligator crack", color: "#af8aff" },
    { code: "D40", name: "Pothole", color: "#31d6b0" }
  ];

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser does not support local result storage."));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Could not open local result storage."));
    });
  }

  async function saveAnalysis(analysis) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(analysis);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error("Could not save this analysis in the browser."));
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error("Saving this analysis was interrupted."));
      };
    });
  }

  async function getAnalyses() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        database.close();
        resolve(request.result.sort((left, right) => right.createdAt - left.createdAt));
      };
      request.onerror = () => {
        database.close();
        reject(new Error("Could not load saved analyses from this browser."));
      };
    });
  }

  function refreshIcons(root = document) {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ root });
    }
  }

  function initializeFactCounters() {
    const counters = document.querySelectorAll("[data-count]");
    if (!counters.length) return;
    const animate = counter => {
      const target = Number(counter.dataset.count);
      const suffix = counter.dataset.suffix || "";
      const start = performance.now();
      const duration = 850;
      const tick = now => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        counter.textContent = `${Math.round(target * eased)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!("IntersectionObserver" in window)) {
      counters.forEach(animate);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        animate(entry.target);
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.6 });
    counters.forEach(counter => observer.observe(counter));
  }

  function formatBytes(bytes) {
    return bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp));
  }

  function makeIcon(name, className = "") {
    const icon = document.createElement("i");
    icon.dataset.lucide = name;
    if (className) icon.className = className;
    return icon;
  }

  function makeEmptyState(iconName, title, description) {
    const container = document.createElement("div");
    container.className = "analytics-empty";
    const visual = document.createElement("span");
    visual.className = "empty-visual";
    visual.append(makeIcon(iconName));
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("span");
    copy.textContent = description;
    container.append(visual, heading, copy);
    return container;
  }

  async function initializeModelStatus() {
    const message = document.getElementById("model-status-text");
    if (!message) return;
    const dot = document.getElementById("model-status-dot");
    const notice = document.getElementById("model-notice");
    const noticeMessage = document.getElementById("model-notice-message");
    try {
      const response = await fetch("/api/status");
      const status = await response.json();
      message.textContent = status.configured ? "Ready for analysis" : "Not configured";
      if (dot) dot.classList.toggle("is-ready", status.configured);
      if (notice && !status.configured) {
        notice.hidden = false;
        if (noticeMessage) noticeMessage.textContent = status.message;
      }
    } catch (_error) {
      message.textContent = "Status unavailable";
      if (notice) {
        notice.hidden = false;
        if (noticeMessage) noticeMessage.textContent = "Could not reach the Flask server. Check that the app is running.";
      }
    }
  }

  function setImageStage(stage, image, source) {
    image.src = source;
    image.hidden = false;
    stage.classList.remove("empty-stage");
    const emptyVisual = stage.querySelector(":scope > .empty-visual");
    const emptyTitle = stage.querySelector(":scope > strong");
    const emptyCopy = stage.querySelector(":scope > span");
    if (emptyVisual) emptyVisual.hidden = true;
    if (emptyTitle) emptyTitle.hidden = true;
    if (emptyCopy) emptyCopy.hidden = true;
  }

  function resetImageStage(stage, image) {
    image.hidden = true;
    image.removeAttribute("src");
    stage.classList.add("empty-stage");
    stage.querySelector(":scope > .empty-visual")?.removeAttribute("hidden");
    stage.querySelector(":scope > strong")?.removeAttribute("hidden");
    stage.querySelector(":scope > span")?.removeAttribute("hidden");
  }

  function renderDetections(rows, detections) {
    rows.replaceChildren();
    if (detections.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "no-detections";
      cell.textContent = "No damage detected by the model in this image.";
      row.append(cell);
      rows.append(row);
      return;
    }
    for (const detection of detections) {
      const row = document.createElement("tr");
      const classCell = document.createElement("td");
      const tag = document.createElement("span");
      tag.className = "damage-tag";
      tag.textContent = detection.class_code
        ? `${detection.class_code} · ${detection.class_name}`
        : detection.model_class_name;
      classCell.append(tag);
      const confidence = document.createElement("td");
      const confidenceValue = document.createElement("span");
      confidenceValue.className = "confidence-value";
      confidenceValue.textContent = `${(detection.confidence * 100).toFixed(1)}%`;
      confidence.append(confidenceValue);
      const bounds = document.createElement("td");
      bounds.className = "coordinate-cell";
      bounds.textContent = detection.bbox.map(value => Math.round(value)).join(", ");
      row.append(classCell, confidence, bounds);
      rows.append(row);
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [header, encoded] = dataUrl.split(",", 2);
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  async function initializeDashboard() {
    const dropzone = document.getElementById("dropzone");
    if (!dropzone) return;

    const input = document.getElementById("image-input");
    const browse = document.getElementById("browse-button");
    const analyze = document.getElementById("analyze-button");
    const filePanel = document.getElementById("selected-file");
    const errorPanel = document.getElementById("upload-error");
    const processing = document.getElementById("processing-overlay");
    const originalImage = document.getElementById("original-preview");
    const detectedImage = document.getElementById("detected-preview");
    const originalStage = document.getElementById("original-stage");
    const detectedStage = document.getElementById("detected-stage");
    let selectedFile = null;
    let previewUrl = null;
    let annotatedUrl = null;

    function showError(message) {
      errorPanel.textContent = message;
      errorPanel.hidden = !message;
    }

    function selectFile(file) {
      showError("");
      if (!file) return;
      const extension = file.name.split(".").pop().toLowerCase();
      if (!["jpg", "jpeg", "png"].includes(extension)) {
        showError("Choose a JPG, JPEG, or PNG image.");
        return;
      }
      if (file.size === 0) {
        showError("This image file is empty.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        showError("This image is too large. Maximum file size is 10 MB.");
        return;
      }
      selectedFile = file;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      document.getElementById("selected-filename").textContent = file.name;
      document.getElementById("selected-filesize").textContent = formatBytes(file.size);
      filePanel.hidden = false;
      analyze.disabled = false;
      setImageStage(originalStage, originalImage, previewUrl);
      document.getElementById("original-label").textContent = "SOURCE";
      if (annotatedUrl) {
        URL.revokeObjectURL(annotatedUrl);
        annotatedUrl = null;
      }
      resetImageStage(detectedStage, detectedImage);
      document.getElementById("detected-label").textContent = "AWAITING ANALYSIS";
      document.getElementById("result-context").textContent = "Ready when you are";
      document.getElementById("detection-details").hidden = true;
    }

    browse.addEventListener("click", event => {
      event.stopPropagation();
      input.click();
    });
    dropzone.addEventListener("click", event => {
      if (event.target !== browse) input.click();
    });
    dropzone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => selectFile(input.files[0]));
    document.getElementById("remove-file").addEventListener("click", () => {
      selectedFile = null;
      input.value = "";
      filePanel.hidden = true;
      analyze.disabled = true;
      showError("");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (annotatedUrl) URL.revokeObjectURL(annotatedUrl);
      previewUrl = annotatedUrl = null;
      resetImageStage(originalStage, originalImage);
      resetImageStage(detectedStage, detectedImage);
      document.getElementById("original-label").textContent = "WAITING";
      document.getElementById("detected-label").textContent = "AWAITING ANALYSIS";
      document.getElementById("result-context").textContent = "Results appear after an analysis";
      document.getElementById("detection-details").hidden = true;
    });
    for (const eventName of ["dragenter", "dragover"]) {
      dropzone.addEventListener(eventName, event => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      dropzone.addEventListener(eventName, event => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
      });
    }
    dropzone.addEventListener("drop", event => {
      const file = event.dataTransfer.files[0];
      selectFile(file);
    });

    analyze.addEventListener("click", async () => {
      if (!selectedFile) return;
      showError("");
      analyze.disabled = true;
      analyze.classList.add("is-loading");
      analyze.querySelector("span").textContent = "Analyzing…";
      processing.hidden = false;
      document.getElementById("detected-label").textContent = "PROCESSING";
      try {
        const formData = new FormData();
        formData.append("image", selectedFile);
        const response = await fetch("/api/analyze", { method: "POST", body: formData });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "The analysis request failed.");

        const resultResponse = await fetch(payload.annotated_image_url);
        if (!resultResponse.ok) throw new Error("The annotated model output could not be loaded.");
        const annotatedBlob = await resultResponse.blob();
        annotatedUrl = URL.createObjectURL(annotatedBlob);
        setImageStage(detectedStage, detectedImage, annotatedUrl);
        document.getElementById("detected-label").textContent = "MODEL OUTPUT";
        document.getElementById("result-context").textContent = `${formatDate(Date.now())} · ${payload.filename}`;
        document.getElementById("detection-count").textContent = String(payload.detections.length);
        document.getElementById("detection-details").hidden = false;
        renderDetections(document.getElementById("detection-rows"), payload.detections);

        const analysis = {
          id: payload.result_id,
          filename: payload.filename,
          createdAt: Date.now(),
          detections: payload.detections,
          originalImage: selectedFile,
          annotatedImage: annotatedBlob
        };
        try {
          await saveAnalysis(analysis);
          document.getElementById("open-results-link").classList.remove("is-muted");
        } catch (storageError) {
          document.getElementById("open-results-link").classList.add("is-muted");
          showError(`Analysis completed, but this browser could not save it for the Results and Analytics pages. ${storageError.message}`);
        }
        document.getElementById("detected-stage").scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        showError(error.message || "The image could not be analyzed.");
        document.getElementById("detected-label").textContent = "ANALYSIS FAILED";
      } finally {
        processing.hidden = true;
        analyze.disabled = !selectedFile;
        analyze.classList.remove("is-loading");
        analyze.querySelector("span").textContent = "Analyze road";
        refreshIcons();
      }
    });
    await initializeModelStatus();
  }

  function categoryCounts(analyses) {
    const counts = new Map(DAMAGE_CLASSES.map(item => [item.code, 0]));
    const other = new Map();
    for (const analysis of analyses) {
      for (const detection of analysis.detections) {
        if (detection.class_code && counts.has(detection.class_code)) {
          counts.set(detection.class_code, counts.get(detection.class_code) + 1);
        } else {
          const label = detection.model_class_name || detection.class_name || "Other";
          other.set(label, (other.get(label) || 0) + 1);
        }
      }
    }
    return { counts, other };
  }

  function buildDistributionChart(container, analyses) {
    container.replaceChildren();
    const { counts, other } = categoryCounts(analyses);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
      + [...other.values()].reduce((sum, value) => sum + value, 0);
    if (total === 0) {
      container.append(makeEmptyState("chart-no-axes-column-increasing", "No detection data yet", "Analyze a road image to populate this chart."));
      return;
    }
    for (const item of DAMAGE_CLASSES) {
      const count = counts.get(item.code);
      const line = document.createElement("div");
      line.className = "distribution-row";
      const label = document.createElement("div");
      label.className = "distribution-label";
      const name = document.createElement("span");
      name.textContent = item.name;
      const code = document.createElement("small");
      code.textContent = item.code;
      label.append(name, code);
      const track = document.createElement("div");
      track.className = "distribution-track";
      const fill = document.createElement("span");
      fill.style.width = `${count / total * 100}%`;
      fill.style.backgroundColor = item.color;
      track.append(fill);
      const value = document.createElement("strong");
      value.textContent = String(count);
      line.append(label, track, value);
      container.append(line);
    }
    for (const [labelText, count] of other) {
      const line = document.createElement("div");
      line.className = "distribution-row";
      const label = document.createElement("div");
      label.className = "distribution-label";
      const name = document.createElement("span");
      name.textContent = labelText;
      const code = document.createElement("small");
      code.textContent = "MODEL CLASS";
      label.append(name, code);
      const track = document.createElement("div");
      track.className = "distribution-track";
      const fill = document.createElement("span");
      fill.style.width = `${count / total * 100}%`;
      fill.style.backgroundColor = "#92a4bc";
      track.append(fill);
      const value = document.createElement("strong");
      value.textContent = String(count);
      line.append(label, track, value);
      container.append(line);
    }
  }

  function buildConfidenceChart(container, detections) {
    container.replaceChildren();
    if (!detections.length) {
      container.append(makeEmptyState("scan-line", "Confidence data unavailable", "Scores appear after successful detection."));
      return;
    }
    const ranges = [
      { label: "0–50%", min: 0, max: 0.5 },
      { label: "50–70%", min: 0.5, max: 0.7 },
      { label: "70–85%", min: 0.7, max: 0.85 },
      { label: "85–100%", min: 0.85, max: 1.01 }
    ];
    const counts = ranges.map(range => detections.filter(detection =>
      detection.confidence >= range.min && detection.confidence < range.max).length);
    const peak = Math.max(...counts, 1);
    const chart = document.createElement("div");
    chart.className = "confidence-bars";
    ranges.forEach((range, index) => {
      const column = document.createElement("div");
      column.className = "confidence-column";
      const value = document.createElement("strong");
      value.textContent = String(counts[index]);
      const bar = document.createElement("div");
      bar.className = "confidence-bar-track";
      const fill = document.createElement("span");
      fill.style.height = `${Math.max(counts[index] / peak * 100, counts[index] ? 12 : 0)}%`;
      bar.append(fill);
      const label = document.createElement("small");
      label.textContent = range.label;
      column.append(value, bar, label);
      chart.append(column);
    });
    container.append(chart);
  }

  function buildHistory(container, analyses) {
    container.replaceChildren();
    if (!analyses.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "history-empty";
      cell.append(makeIcon("history"));
      const strong = document.createElement("strong");
      strong.textContent = "Nothing analyzed yet";
      const span = document.createElement("span");
      span.textContent = "Successful analyses saved in this browser will appear here.";
      cell.append(strong, span);
      row.append(cell);
      container.append(row);
      return;
    }
    for (const analysis of analyses.slice(0, 8)) {
      const row = document.createElement("tr");
      const date = document.createElement("td");
      date.textContent = formatDate(analysis.createdAt);
      const filename = document.createElement("td");
      filename.className = "history-filename";
      filename.textContent = analysis.filename;
      const count = document.createElement("td");
      count.textContent = String(analysis.detections.length);
      const confidence = document.createElement("td");
      const top = analysis.detections.reduce((best, detection) => Math.max(best, detection.confidence), 0);
      confidence.textContent = analysis.detections.length ? `${(top * 100).toFixed(1)}%` : "—";
      const linkCell = document.createElement("td");
      const link = document.createElement("a");
      link.href = `/results#${encodeURIComponent(analysis.id)}`;
      link.className = "icon-button history-open";
      link.setAttribute("aria-label", `Open results for ${analysis.filename}`);
      link.append(makeIcon("arrow-up-right"));
      linkCell.append(link);
      row.append(date, filename, count, confidence, linkCell);
      container.append(row);
    }
  }

  async function initializeAnalytics() {
    const chart = document.getElementById("distribution-chart");
    if (!chart) return;
    try {
      const analyses = await getAnalyses();
      const detections = analyses.flatMap(analysis => analysis.detections);
      const { counts, other } = categoryCounts(analyses);
      document.getElementById("metric-images").textContent = String(analyses.length);
      document.getElementById("metric-detections").textContent = String(detections.length);
      const average = detections.length
        ? detections.reduce((sum, item) => sum + item.confidence, 0) / detections.length
        : null;
      document.getElementById("metric-confidence").textContent = average === null
        ? "—"
        : `${(average * 100).toFixed(1)}%`;
      const classCount = [...counts.values()].filter(Boolean).length + other.size;
      document.getElementById("metric-classes").textContent = detections.length ? String(classCount) : "—";
      const total = detections.length;
      document.getElementById("distribution-total").textContent = total
        ? `${total} detection${total === 1 ? "" : "s"}`
        : "No detections";
      buildDistributionChart(chart, analyses);
      buildConfidenceChart(document.getElementById("confidence-chart"), detections);
      buildHistory(document.getElementById("history-rows"), analyses);
    } catch (error) {
      chart.replaceChildren(makeEmptyState("database-zap", "Local data unavailable", error.message));
    }
  }

  function createDetectionTable(rows, detections) {
    renderDetections(rows, detections);
  }

  async function initializeResults() {
    const empty = document.getElementById("results-empty");
    if (!empty) return;
    const view = document.getElementById("results-view");
    const download = document.getElementById("download-result");
    try {
      const analyses = await getAnalyses();
      const requestedId = decodeURIComponent(window.location.hash.slice(1));
      const analysis = analyses.find(item => item.id === requestedId) || analyses[0];
      if (!analysis) return;
      empty.hidden = true;
      view.hidden = false;
      const originalUrl = URL.createObjectURL(analysis.originalImage);
      const annotatedUrl = URL.createObjectURL(analysis.annotatedImage);
      document.getElementById("result-filename").textContent = analysis.filename;
      document.getElementById("result-date").textContent = formatDate(analysis.createdAt);
      document.getElementById("result-total").textContent =
        `${analysis.detections.length} detection${analysis.detections.length === 1 ? "" : "s"}`;
      document.getElementById("result-original").src = originalUrl;
      document.getElementById("result-annotated").src = annotatedUrl;
      document.getElementById("result-detection-count").textContent = String(analysis.detections.length);
      createDetectionTable(document.getElementById("result-detection-rows"), analysis.detections);
      download.disabled = false;
      download.addEventListener("click", () => {
        const link = document.createElement("a");
        link.href = annotatedUrl;
        link.download = `roadvision-${analysis.id}.jpg`;
        link.click();
      });
    } catch (error) {
      empty.querySelector("p").textContent = error.message;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshIcons();
    initializeFactCounters();
    initializeDashboard();
    initializeAnalytics();
    initializeResults();
  });
})();
