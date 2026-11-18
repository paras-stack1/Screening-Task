// Automatically resolve API URL:
// - If running via frontend dev server on port 5500: use local backend on :8000
// - If served directly from FastAPI (e.g. on AWS EC2): use current origin
// - Otherwise fallback to http://127.0.0.1:8000
const API_URL = (window.location.port === "5500")
  ? "http://127.0.0.1:8000"
  : window.location.origin.startsWith("http")
    ? window.location.origin
    : "http://127.0.0.1:8000";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CHART_COLORS = [
  "#2563eb", "#0d9488", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#10b981", "#64748b",
];

document.querySelectorAll(".card[data-endpoint]").forEach(setupCard);

function setupCard(card) {
  const endpoint = card.dataset.endpoint;
  const uploadBox = card.querySelector(".upload-box");
  const fileInput = card.querySelector(".file-input");
  const previewImage = card.querySelector(".preview-image");
  const predictBtn = card.querySelector(".predict-btn");
  const defaultBtnText = predictBtn.textContent;
  const statusText = card.querySelector(".status");

  const resultPanel = card.querySelector(".result-panel");
  const statusBanner = card.querySelector(".status-banner");
  const statusTitle = card.querySelector(".status-title");
  const predictionText = card.querySelector(".prediction-text");
  const adviceText = card.querySelector(".advice-text");
  const barCanvas = card.querySelector(".bar-canvas");
  const doughnutCanvas = card.querySelector(".doughnut-canvas");

  let selectedFile = null;
  let previewUrl = null;
  let barChart = null;
  let doughnutChart = null;

  function setStatus(msg, isError = false) {
    statusText.textContent = msg;
    statusText.classList.toggle("error", isError);
  }

  function handleFile(file) {
    selectedFile = file || null;
    resultPanel.hidden = true;
    setStatus("");

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    if (!selectedFile) {
      previewImage.style.display = "none";
      predictBtn.disabled = true;
      return;
    }

    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      selectedFile = null;
      previewImage.style.display = "none";
      predictBtn.disabled = true;
      setStatus("Please choose a JPG, PNG, or WEBP image.", true);
      return;
    }

    previewUrl = URL.createObjectURL(selectedFile);
    previewImage.src = previewUrl;
    previewImage.style.display = "inline-block";
    predictBtn.disabled = false;
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((evt) => {
    uploadBox.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadBox.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    uploadBox.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadBox.classList.remove("dragover");
    });
  });

  uploadBox.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  predictBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("file", selectedFile);

    predictBtn.disabled = true;
    predictBtn.textContent = "Analyzing...";
    setStatus("");

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Prediction failed.");
      }

      // 1. Update GREEN / YELLOW / RED status banner
      statusBanner.className = `status-banner ${data.screening_status}`;
      statusTitle.textContent = `Status: ${data.screening_status}`;
      const ttaNote = data.tta_horizontal_flip ? " · Flip TTA" : "";
      predictionText.textContent =
        `Detected: ${data.predicted_class} (${Number(data.confidence).toFixed(2)}% confidence${ttaNote})`;
      adviceText.textContent = data.advice;

      resultPanel.hidden = false;

      // 2. Render Bar + Doughnut graphs with Chart.js
      if (typeof Chart !== "undefined") {
        const sorted = Object.entries(data.all_predictions).sort((a, b) => b[1] - a[1]);
        const labels = sorted.map(([name]) => name);
        const values = sorted.map(([, score]) => Number(score));
        const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

        if (barChart) barChart.destroy();
        if (doughnutChart) doughnutChart.destroy();

        barChart = new Chart(barCanvas, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              label: "Confidence (%)",
              data: values,
              backgroundColor: colors,
              borderRadius: 6,
            }],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
            },
          },
        });

        doughnutChart = new Chart(doughnutCanvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: values,
              backgroundColor: colors,
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
            },
          },
        });
      }

      setStatus("Analysis complete.");
    } catch (err) {
      setStatus(err.message || "Could not connect to FastAPI server.", true);
    } finally {
      predictBtn.disabled = !selectedFile;
      predictBtn.textContent = defaultBtnText;
    }
  });
}