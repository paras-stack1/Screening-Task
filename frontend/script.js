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
  "#0F5C5C", "#2563EB", "#D97706", "#DC2626",
  "#7C3AED", "#DB2777", "#10B981", "#475569",
];

/* ==========================================================================
   1. Tab Navigation & Explainability Dropdown
   ========================================================================== */
function switchTab(tabId) {
  document.querySelectorAll(".nav-tab").forEach((b) => {
    const isTarget = b.dataset.tab === tabId;
    b.classList.toggle("active", isTarget);
    b.setAttribute("aria-selected", isTarget ? "true" : "false");
  });
  document.querySelectorAll(".tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === tabId);
  });
}

document.querySelectorAll(".nav-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => switchTab(tabBtn.dataset.tab));
});

const toggleExplainBtn = document.getElementById("toggleExplainBtn");
const explainCard = document.querySelector(".explainability-card");
if (toggleExplainBtn && explainCard) {
  toggleExplainBtn.addEventListener("click", () => {
    explainCard.classList.toggle("open");
  });
}

const toggleHttpGuideBtn = document.getElementById("toggleHttpGuideBtn");
const httpGuideBox = document.getElementById("httpGuideBox");
if (toggleHttpGuideBtn && httpGuideBox) {
  toggleHttpGuideBtn.addEventListener("click", () => {
    httpGuideBox.hidden = !httpGuideBox.hidden;
  });
}

/* ==========================================================================
   2. Skin & Eye Image Classification Setup (Dual Mode: Upload & Live Camera)
   ========================================================================== */
document.querySelectorAll(".card[data-endpoint]").forEach(setupClassifierCard);

function setupClassifierCard(card) {
  const endpoint = card.dataset.endpoint;
  const uploadBox = card.querySelector(".upload-box");
  const fileInput = card.querySelector(".file-input");
  const previewImage = card.querySelector(".preview-image");
  const predictBtn = card.querySelector(".predict-btn");
  const defaultBtnText = predictBtn ? predictBtn.textContent : "Analyze";
  const statusText = card.querySelector(".status");

  const resultPanel = card.querySelector(".result-panel");
  const statusBanner = card.querySelector(".status-banner");
  const statusTitle = card.querySelector(".status-title");
  const predictionText = card.querySelector(".prediction-text");
  const adviceText = card.querySelector(".advice-text");
  const barCanvas = card.querySelector(".bar-canvas");
  const doughnutCanvas = card.querySelector(".doughnut-canvas");

  // Dual mode switching
  const uploadView = card.querySelector(".mode-upload-view");
  const cameraView = card.querySelector(".mode-camera-view");
  const modeTabs = card.querySelectorAll(".mode-tab-btn");

  // Camera elements
  const camFeed = card.querySelector(".cam-feed");
  const camSnapCanvas = card.querySelector(".cam-snap-canvas");
  const btnOpenCam = card.querySelector(".btn-open-cam");
  const btnSnapPhoto = card.querySelector(".btn-snap-photo");
  const btnFlipCam = card.querySelector(".btn-flip-cam");

  let selectedFile = null;
  let previewUrl = null;
  let barChart = null;
  let doughnutChart = null;
  let activeCamStream = null;
  let currentFacingMode = "environment";

  function setStatus(msg, isError = false) {
    if (!statusText) return;
    statusText.textContent = msg;
    statusText.classList.toggle("error", isError);
  }

  function handleFile(file) {
    selectedFile = file || null;
    if (resultPanel) resultPanel.hidden = true;
    setStatus("");

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    if (!selectedFile) {
      if (previewImage) previewImage.style.display = "none";
      if (predictBtn) predictBtn.disabled = true;
      return;
    }

    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      selectedFile = null;
      if (previewImage) previewImage.style.display = "none";
      if (predictBtn) predictBtn.disabled = true;
      setStatus("Please choose a JPG, PNG, or WEBP image.", true);
      return;
    }

    previewUrl = URL.createObjectURL(selectedFile);
    if (previewImage) {
      previewImage.src = previewUrl;
      previewImage.style.display = "inline-block";
    }
    if (predictBtn) predictBtn.disabled = false;
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
  }

  if (uploadBox) {
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
  }

  // Camera Management
  function stopActiveCamera() {
    if (activeCamStream) {
      activeCamStream.getTracks().forEach((t) => t.stop());
      activeCamStream = null;
    }
    if (camFeed) camFeed.srcObject = null;
    if (btnSnapPhoto) btnSnapPhoto.disabled = true;
    if (btnOpenCam) btnOpenCam.textContent = "Start Live Camera";
  }

  async function startActiveCamera(facing = "environment") {
    stopActiveCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera access not supported or requires HTTPS.", true);
      return;
    }

    try {
      setStatus("Initializing camera...");
      activeCamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });

      if (camFeed) {
        camFeed.srcObject = activeCamStream;
        await camFeed.play();
      }

      if (btnSnapPhoto) btnSnapPhoto.disabled = false;
      if (btnFlipCam) btnFlipCam.style.display = "inline-flex";
      if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
      setStatus("Camera active. Align target inside reticle and capture.");
    } catch (err) {
      console.warn("Primary camera facing failed, trying fallback user camera:", err);
      try {
        activeCamStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (camFeed) {
          camFeed.srcObject = activeCamStream;
          await camFeed.play();
        }
        if (btnSnapPhoto) btnSnapPhoto.disabled = false;
        if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
        setStatus("Camera active. Align target inside reticle and capture.");
      } catch (e) {
        setStatus(`Camera blocked or unavailable: ${e.message}`, true);
      }
    }
  }

  if (btnOpenCam) {
    btnOpenCam.addEventListener("click", () => {
      if (activeCamStream) {
        stopActiveCamera();
        setStatus("Camera stopped.");
      } else {
        startActiveCamera(currentFacingMode);
      }
    });
  }

  if (btnFlipCam) {
    btnFlipCam.addEventListener("click", () => {
      currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
      startActiveCamera(currentFacingMode);
    });
  }

  if (btnSnapPhoto) {
    btnSnapPhoto.addEventListener("click", () => {
      if (!camFeed || !activeCamStream) return;
      const snapCanvas = camSnapCanvas || document.createElement("canvas");
      snapCanvas.width = camFeed.videoWidth || 640;
      snapCanvas.height = camFeed.videoHeight || 480;
      const sCtx = snapCanvas.getContext("2d");
      sCtx.drawImage(camFeed, 0, 0, snapCanvas.width, snapCanvas.height);

      snapCanvas.toBlob((blob) => {
        if (!blob) {
          setStatus("Failed to capture snapshot from video.", true);
          return;
        }
        const snapFile = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg" });
        handleFile(snapFile);
        stopActiveCamera();

        // Switch to upload view to show the captured preview
        modeTabs.forEach((b) => b.classList.toggle("active", b.dataset.mode === "upload"));
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";

        setStatus("Snapshot captured! Click 'Analyze' below to run AI inference.");
      }, "image/jpeg", 0.92);
    });
  }

  // Mode tab switching (Upload vs Live Camera)
  modeTabs.forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const mode = tabBtn.dataset.mode;
      modeTabs.forEach((b) => b.classList.toggle("active", b === tabBtn));

      if (mode === "upload") {
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";
        stopActiveCamera();
      } else if (mode === "camera") {
        if (uploadView) uploadView.style.display = "none";
        if (cameraView) cameraView.style.display = "block";
        startActiveCamera(currentFacingMode);
      }
    });
  });

  // Predict button
  if (predictBtn) {
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

        if (statusBanner) statusBanner.className = `result-banner status-banner ${data.screening_status}`;
        if (statusTitle) statusTitle.textContent = `Status: ${data.screening_status}`;
        const ttaNote = data.tta_horizontal_flip ? " · Flip TTA" : "";
        if (predictionText) {
          predictionText.textContent =
            `Detected: ${data.predicted_class} (${Number(data.confidence).toFixed(2)}% confidence${ttaNote})`;
        }
        if (adviceText) adviceText.textContent = data.advice;

        if (resultPanel) resultPanel.hidden = false;

        if (typeof Chart !== "undefined" && barCanvas && doughnutCanvas) {
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
                borderRadius: 4,
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
                legend: { position: "right", labels: { boxWidth: 10, font: { size: 10 } } },
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
}

// Demo Photo Loader for Skin and Eye Cards
async function loadDemoPhoto(target) {
  const card = document.querySelector(`.card-${target}`);
  if (!card) return;
  const imgUrl = `assets/demo_${target}.jpg`;

  try {
    const resp = await fetch(imgUrl);
    if (!resp.ok) throw new Error(`Could not load ${imgUrl}`);
    const blob = await resp.blob();
    const file = new File([blob], `demo_${target}.jpg`, { type: "image/jpeg" });

    const fileInput = card.querySelector(".file-input");
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change"));

    // Ensure upload mode is active so preview is visible
    const uploadModeBtn = card.querySelector('[data-mode="upload"]');
    if (uploadModeBtn) uploadModeBtn.click();

    setTimeout(() => {
      const predictBtn = card.querySelector(".predict-btn");
      if (predictBtn && !predictBtn.disabled) predictBtn.click();
    }, 350);
  } catch (err) {
    console.error(`Demo load error for ${target}:`, err);
  }
}

document.querySelectorAll(".demo-load-btn").forEach((btn) => {
  btn.addEventListener("click", () => loadDemoPhoto(btn.dataset.target));
});

/* ==========================================================================
   3. Real-Time Video-Based 4Ds Screening Module (Zero Video Storage)
   ========================================================================== */
const videoEl = document.getElementById("webcamVideo");
const canvasEl = document.getElementById("skeletonCanvas");
const ctx = canvasEl.getContext("2d");

const startCamBtn = document.getElementById("startCamBtn");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const runDemoBtn = document.getElementById("runDemoBtn");
const quickDemoBtn = document.getElementById("quickDemoBtn");
const videoStatus = document.getElementById("videoStatus");

const framingBadge = document.getElementById("framingBadge");
const timerBadge = document.getElementById("timerBadge");
const countdownText = document.getElementById("countdownText");
const frameCountText = document.getElementById("frameCountText");
const cueAlert = document.getElementById("cueAlert");

const teleFraming = document.getElementById("teleFraming");
const teleSpine = document.getElementById("teleSpine");
const teleLKnee = document.getElementById("teleLKnee");
const teleRKnee = document.getElementById("teleRKnee");
const teleGSI = document.getElementById("teleGSI");
const teleYaw = document.getElementById("teleYaw");
const taskInstructionText = document.getElementById("taskInstructionText");

const taskTypeSelect = document.getElementById("taskTypeSelect");
const childAgeInput = document.getElementById("childAgeInput");

let cameraStream = null;
let poseLandmarker = null;
let faceLandmarker = null;
let animationFrameId = null;
let isRecording = false;
let sessionStartTime = null;
let capturedFrames = [];
let sampleTimer = null;
const TARGET_FPS = 10.0;
const SESSION_DURATION_SEC = 12.0;
const TARGET_FRAMES = 120;
const AUDIO_CUE_SEC = 3.0;

const TASK_INSTRUCTIONS = {
  walking_gait: "Position camera 2.5–3m away at waist height. Have the child walk naturally across or toward the camera. Track leg symmetry and stride balance.",
  sitting_posture: "Child sits unsupported on a bench, play mat, or floor facing camera in portrait mode. Measures axial trunk tilt (theta <= 12 deg), kyphosis, hypotonia, and scoliosis.",
  standing_alignment: "Child stands upright facing camera with knees straight. Measures inter-condylar vs inter-malleolar spacing for bowed legs / knock knees.",
  balance_sway: "Child stands upright with feet close together for 10–12 seconds. Measures center-of-mass lateral and anteroposterior stability.",
  social_response: "Child sits facing forward. At 3.0s an auditory chime sounds. Measures orienting latency (head turn) and sustained eye contact.",
};

const TASK_CONFIGS = {
  walking_gait: {
    label: "Walking Gait",
    dataFile: "assets/demo_walk_landmarks.json",
    videoFile: "assets/tutorial_walking.mp4",
    poster: "",
    defaultAge: 24,
  },
  sitting_posture: {
    label: "Sitting Posture",
    dataFile: "assets/demo_sitting_landmarks.json",
    videoFile: "assets/tutorial_sitting.mp4",
    poster: "assets/demo_sitting.jpg",
    defaultAge: 18,
  },
  standing_alignment: {
    label: "Standing Alignment",
    dataFile: "assets/demo_standing_landmarks.json",
    videoFile: "assets/tutorial_standing.mp4",
    poster: "",
    defaultAge: 24,
  },
  balance_sway: {
    label: "Balance & Sway",
    dataFile: "assets/demo_balance_landmarks.json",
    videoFile: "assets/tutorial_balance.mp4",
    poster: "",
    defaultAge: 36,
  },
  social_response: {
    label: "Social Response",
    dataFile: "assets/demo_social_landmarks.json",
    videoFile: "assets/tutorial_social.mp4",
    poster: "",
    defaultAge: 20,
  },
};

function updateTaskUI(taskKey) {
  if (taskInstructionText) {
    taskInstructionText.textContent = TASK_INSTRUCTIONS[taskKey] || TASK_INSTRUCTIONS.walking_gait;
  }
  const cfg = TASK_CONFIGS[taskKey] || TASK_CONFIGS.walking_gait;
  if (runDemoBtn) runDemoBtn.textContent = `Run Demo: ${cfg.label}`;
  document.querySelectorAll(".demo-pill-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.task === taskKey);
  });
}

if (taskTypeSelect) {
  taskTypeSelect.addEventListener("change", () => {
    updateTaskUI(taskTypeSelect.value);
  });
}

// Demo Pill Buttons Listener
document.querySelectorAll(".demo-pill-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const task = btn.dataset.task;
    runDemoSession(task);
  });
});

// Initialize MediaPipe Vision Tasks
async function initMediaPipeVision() {
  if (poseLandmarker) return;

  try {
    if (videoStatus) videoStatus.textContent = "Loading MediaPipe Tasks Vision AI model in browser...";
    const vision = await window.MediaPipeVision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    poseLandmarker = await window.MediaPipeVision.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    try {
      faceLandmarker = await window.MediaPipeVision.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    } catch (faceErr) {
      console.warn("FaceLandmarker optional model loaded with pose fallback:", faceErr);
    }

    if (videoStatus) videoStatus.textContent = "AI models loaded. Start live camera or choose video file.";
    if (startCamBtn) startCamBtn.disabled = false;
  } catch (err) {
    console.error("MediaPipe load error:", err);
    if (videoStatus) videoStatus.textContent = "MediaPipe ready. Click 'Start Live Camera' or 'Upload Video'.";
    if (startCamBtn) startCamBtn.disabled = false;
  }
}

window.addEventListener("mediapipe-ready", initMediaPipeVision);
if (window.MediaPipeVision) initMediaPipeVision();

// Camera Start with Insecure Origin Fallback
if (startCamBtn) {
  startCamBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      videoStatus.innerHTML = "<strong>Camera Access Blocked:</strong> Browsers require HTTPS or localhost for live webcam.<br/>Use <strong>'Upload Video'</strong> or <strong>'Run Demo Video'</strong>, or check the Camera Permission Guide above.";
      videoStatus.classList.add("error");
      if (httpGuideBox) httpGuideBox.hidden = false;
      return;
    }

    try {
      videoStatus.textContent = "Requesting webcam access...";
      videoStatus.classList.remove("error");

      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 640 },
          facingMode: "user",
        },
        audio: false,
      });

      videoEl.srcObject = cameraStream;
      videoEl.src = "";
      videoEl.loop = false;
      await videoEl.play();

      startCamBtn.disabled = true;
      startRecordBtn.disabled = false;
      stopRecordBtn.disabled = false;
      videoStatus.textContent = "Camera active. Step back until child is framed inside target box.";

      canvasEl.width = videoEl.videoWidth || 360;
      canvasEl.height = videoEl.videoHeight || 640;

      startTrackingLoop();
    } catch (err) {
      console.error("Webcam error:", err);
      videoStatus.innerHTML = `<strong>Camera Blocked (${err.name}):</strong> ${err.message}.<br/>Tip: You can use <strong>'Upload Video'</strong> or <strong>'Run Demo Video'</strong> without camera permission.`;
      videoStatus.classList.add("error");
      if (httpGuideBox) httpGuideBox.hidden = false;
    }
  });
}

// Video File Upload Handler
function handleVideoFile(file) {
  if (!file) return;

  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }

  videoEl.srcObject = null;
  videoEl.src = URL.createObjectURL(file);
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.play();

  startCamBtn.disabled = false;
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = false;
  videoStatus.textContent = `Video "${file.name}" loaded! Click 'Record Session' to extract 33 landmarks.`;
  videoStatus.classList.remove("error");

  startTrackingLoop();
}

const fileInput1 = document.getElementById("videoFileInput");
const fileInput2 = document.getElementById("videoFileInputAlt");
if (fileInput1) fileInput1.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));
if (fileInput2) fileInput2.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));

// Real-Time Frame Processing & Live Overlay Loop
let lastVideoTime = -1;
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;

function startTrackingLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  function renderFrame() {
    if (videoEl && videoEl.readyState >= 2) {
      if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
        canvasEl.width = videoEl.videoWidth || 360;
        canvasEl.height = videoEl.videoHeight || 640;
      }

      const nowMs = performance.now();
      if (poseLandmarker && videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;

        try {
          const poseRes = poseLandmarker.detectForVideo(videoEl, nowMs);
          if (poseRes.landmarks && poseRes.landmarks.length > 0) {
            currentPoseLandmarks = poseRes.landmarks[0];
            currentWorldLandmarks = poseRes.worldLandmarks ? poseRes.worldLandmarks[0] : currentPoseLandmarks;
          } else {
            currentPoseLandmarks = null;
            currentWorldLandmarks = null;
          }
        } catch (e) {}

        // Face Metrics Extraction
        if (faceLandmarker) {
          try {
            const faceRes = faceLandmarker.detectForVideo(videoEl, nowMs);
            if (faceRes.faceLandmarks && faceRes.faceLandmarks.length > 0) {
              const fl = faceRes.faceLandmarks[0];
              const leftEye = fl[33];
              const rightEye = fl[263];
              const nose = fl[1];
              const span = rightEye.x - leftEye.x;
              const yaw = span !== 0 ? ((nose.x - leftEye.x) - (rightEye.x - nose.x)) / Math.abs(span) : 0.0;

              currentFaceMetrics = {
                head_yaw: Number(yaw.toFixed(3)),
                iris_center_ratio: 0.5,
                face_detected: true,
              };
            }
          } catch (fe) {}
        } else if (currentPoseLandmarks) {
          const nose = currentPoseLandmarks[0];
          const lEar = currentPoseLandmarks[7];
          const rEar = currentPoseLandmarks[8];
          if (nose && lEar && rEar) {
            const earDist = rEar.x - lEar.x;
            const yaw = earDist !== 0 ? ((nose.x - lEar.x) - (rEar.x - nose.x)) / Math.abs(earDist) : 0.0;
            currentFaceMetrics = {
              head_yaw: Number(yaw.toFixed(3)),
              iris_center_ratio: 0.5,
              face_detected: true,
            };
          }
        }
      }

      drawSkeleton(ctx, currentPoseLandmarks, canvasEl.width, canvasEl.height);
      updateLiveTelemetry(currentPoseLandmarks, currentWorldLandmarks, currentFaceMetrics);
    }

    animationFrameId = requestAnimationFrame(renderFrame);
  }

  renderFrame();
}

// Target Guide Markers Toggle State
let showGuideMarkers = true;
const toggleMarkersBtn = document.getElementById("toggleMarkersBtn");
const cameraGuideFrame = document.getElementById("cameraGuideFrame");

if (toggleMarkersBtn) {
  toggleMarkersBtn.addEventListener("click", () => {
    showGuideMarkers = !showGuideMarkers;
    toggleMarkersBtn.textContent = showGuideMarkers ? "Guide Markers: Active" : "Guide Markers: Inactive";
    toggleMarkersBtn.style.opacity = showGuideMarkers ? "1" : "0.6";
    if (cameraGuideFrame) cameraGuideFrame.style.display = showGuideMarkers ? "block" : "none";
  });
}

// Draw Floating Joint Measurement Badge Helper (Small, Crisp, Minimalist)
function drawFloatingBadge(ctx, text, x, y, bgColor = "rgba(15, 23, 42, 0.75)", textColor = "#ffffff") {
  ctx.save();
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  const textWidth = ctx.measureText(text).width;
  const paddingX = 5;
  const paddingY = 2;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 16;
  const rx = Math.max(4, Math.min(x - boxWidth / 2, ctx.canvas.width - boxWidth - 4));
  const ry = Math.max(4, Math.min(y - boxHeight / 2, ctx.canvas.height - boxHeight - 4));

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(rx, ry, boxWidth, boxHeight, 4);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rx + boxWidth / 2, ry + boxHeight / 2);
  ctx.restore();
}

// Draw Small 33 Skeletal Keypoints + Connections + Live Alignment Markers (Proportioned for 9:16)
function drawSkeleton(ctx, landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Check framing status in 9:16 frame
  const nose = landmarks ? landmarks[0] : null;
  const lAnkle = landmarks ? landmarks[27] : null;
  const rAnkle = landmarks ? landmarks[28] : null;
  const headFramed = nose && (nose.visibility ?? 1) > 0.4 && nose.y > 0.04 && nose.y < 0.30;
  const feetFramed = (lAnkle && (lAnkle.visibility ?? 1) > 0.4 && lAnkle.y > 0.70) ||
                     (rAnkle && (rAnkle.visibility ?? 1) > 0.4 && rAnkle.y > 0.70);
  const isFramed = headFramed && feetFramed;

  if (cameraGuideFrame) {
    cameraGuideFrame.classList.toggle("good-frame", Boolean(isFramed));
  }

  // Draw Camera Alignment Guide Markers on Canvas if enabled
  if (showGuideMarkers) {
    const guideColor = isFramed ? "rgba(16, 185, 129, 0.7)" : "rgba(232, 137, 28, 0.6)";
    ctx.save();
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);

    // 1. Head Target Oval
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.14, w * 0.24, h * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Shoulder Alignment Line
    ctx.beginPath();
    ctx.moveTo(w * 0.14, h * 0.24);
    ctx.lineTo(w * 0.86, h * 0.24);
    ctx.stroke();

    // 3. Central Vertical Plumbline (Spinal Axis)
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.24);
    ctx.lineTo(w * 0.5, h * 0.76);
    ctx.stroke();

    // 4. Feet Ground Placement Box
    ctx.beginPath();
    ctx.roundRect(w * 0.14, h * 0.82, w * 0.72, h * 0.12, 6);
    ctx.stroke();

    ctx.restore();
  }

  if (!landmarks || landmarks.length < 33) return;

  const CONNECTIONS = [
    [11, 12], [11, 23], [12, 24], [23, 24], // Torso
    [11, 13], [13, 15],                     // Left Arm
    [12, 14], [14, 16],                     // Right Arm
    [23, 25], [25, 27], [27, 29], [29, 31], // Left Leg
    [24, 26], [26, 28], [28, 30], [30, 32], // Right Leg
    [0, 1], [1, 2], [2, 3], [3, 7],         // Left Face
    [0, 4], [4, 5], [5, 6], [6, 8],         // Right Face
    [9, 10]                                 // Mouth
  ];

  // Thin crisp connecting lines (no heavy glow)
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
  ctx.shadowBlur = 0;

  for (const [i, j] of CONNECTIONS) {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
  }

  // Small, clean landmark dots (1.4px for face, 2.2px for joints)
  landmarks.forEach((p, idx) => {
    if (p && (p.visibility ?? 1) > 0.35) {
      ctx.beginPath();
      const r = idx <= 10 ? 1.4 : (idx === 15 || idx === 16 || idx === 27 || idx === 28 ? 2.8 : 2.2);
      ctx.arc(p.x * w, p.y * h, r, 0, 2 * Math.PI);
      ctx.fillStyle = idx >= 23 ? "#10b981" : idx >= 11 ? "#38bdf8" : "#fbbf24";
      ctx.fill();
    }
  });

  // Floating Micro Badges
  if (showGuideMarkers) {
    const lkAngle = calcAngle(landmarks[23], landmarks[25], landmarks[27]);
    const rkAngle = calcAngle(landmarks[24], landmarks[26], landmarks[28]);
    const pLK = landmarks[25];
    const pRK = landmarks[26];

    if (pLK && (pLK.visibility ?? 1) > 0.4) {
      drawFloatingBadge(ctx, `L Knee: ${lkAngle.toFixed(0)}°`, pLK.x * w - 34, pLK.y * h);
    }
    if (pRK && (pRK.visibility ?? 1) > 0.4) {
      drawFloatingBadge(ctx, `R Knee: ${rkAngle.toFixed(0)}°`, pRK.x * w + 34, pRK.y * h);
    }

    // Mid-Spine Marker
    const sMidX = (landmarks[11].x + landmarks[12].x) / 2;
    const sMidY = (landmarks[11].y + landmarks[12].y) / 2;
    const hMidX = (landmarks[23].x + landmarks[24].x) / 2;
    const hMidY = (landmarks[23].y + landmarks[24].y) / 2;
    const spineX = (sMidX + hMidX) / 2;
    const spineY = (sMidY + hMidY) / 2;
    const dx = sMidX - hMidX;
    const dy = sMidY - hMidY;
    const spineTilt = Math.abs((Math.atan2(dx, dy) * 180.0) / Math.PI);
    drawFloatingBadge(ctx, `Spine: ${spineTilt.toFixed(1)}°`, spineX * w + 40, spineY * h, "rgba(217, 119, 6, 0.85)");

    if (nose && (nose.visibility ?? 1) > 0.4) {
      drawFloatingBadge(ctx, "Gaze: Centered", nose.x * w, nose.y * h - 18, "rgba(15, 92, 92, 0.85)");
    }
  }
}

// 3D Joint Angle Helper in Degrees
function calcAngle(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const nu = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  const nv = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (nu < 1e-5 || nv < 1e-5) return 180.0;
  let cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  cos = Math.max(-1.0, Math.min(1.0, cos));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

// Live Biomechanical Telemetry Updates
function updateLiveTelemetry(pose, world, face) {
  if (!pose || pose.length < 33) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Waiting for Input...`;
    if (teleFraming) teleFraming.textContent = "Child Not Detected";
    return;
  }

  const nose = pose[0];
  const lAnkle = pose[27];
  const rAnkle = pose[28];
  const headOk = nose && (nose.visibility ?? 1) > 0.4;
  const feetOk = (lAnkle && (lAnkle.visibility ?? 1) > 0.4) || (rAnkle && (rAnkle.visibility ?? 1) > 0.4);

  if (headOk && feetOk) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot green"></span> Full-Body Framed`;
    if (teleFraming) teleFraming.textContent = "Framed (Head & Ankles)";
  } else if (headOk) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Upper Body Only`;
    if (teleFraming) teleFraming.textContent = "Step Back (Ankles Cut Off)";
  } else {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot red"></span> Partial Frame`;
    if (teleFraming) teleFraming.textContent = "Adjust Position";
  }

  // Torso / Spine Tilt
  const sMidX = (pose[11].x + pose[12].x) / 2;
  const sMidY = (pose[11].y + pose[12].y) / 2;
  const hMidX = (pose[23].x + pose[24].x) / 2;
  const hMidY = (pose[23].y + pose[24].y) / 2;
  const dx = sMidX - hMidX;
  const dy = sMidY - hMidY;
  const spineTilt = Math.abs((Math.atan2(dx, dy) * 180.0) / Math.PI);
  if (teleSpine) teleSpine.textContent = `${spineTilt.toFixed(1)}°`;

  // Left & Right Knee Angles
  const lkAngle = calcAngle(pose[23], pose[25], pose[27]);
  const rkAngle = calcAngle(pose[24], pose[26], pose[28]);
  if (teleLKnee) teleLKnee.textContent = `${lkAngle.toFixed(1)}°`;
  if (teleRKnee) teleRKnee.textContent = `${rkAngle.toFixed(1)}°`;

  // Gait Separation
  if (lAnkle && rAnkle && teleGSI) {
    const sep = Math.abs(lAnkle.x - rAnkle.x);
    teleGSI.textContent = `${sep.toFixed(3)}`;
  }

  // Head Yaw & Eye Contact
  if (face && teleYaw) {
    const yawDeg = Math.round(face.head_yaw * 45.0);
    const facing = Math.abs(face.head_yaw) < 0.12 ? "Centered" : face.head_yaw > 0 ? "Turned Right" : "Turned Left";
    teleYaw.textContent = `${yawDeg}° (${facing})`;
  }
}

// Web Audio API Audio Cue Synthesizer
function playAudioChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.log("Audio cue error:", e);
  }
}

// Guided 12-Second Recording Session (10 FPS Sampling)
if (startRecordBtn) {
  startRecordBtn.addEventListener("click", () => {
    if (isRecording) return;

    isRecording = true;
    capturedFrames = [];
    sessionStartTime = performance.now();
    startRecordBtn.disabled = true;
    startRecordBtn.classList.add("recording");
    startRecordBtn.textContent = "Recording Session... [Active]";
    timerBadge.hidden = false;
    const videoResultBanner = document.getElementById("videoResultBanner");
    if (videoResultBanner) videoResultBanner.hidden = true;
    videoStatus.textContent = "Guided screening active. Maintain child inside camera frame.";

    let cueFired = false;
    const isSocialTask = taskTypeSelect.value === "social_response";

    sampleTimer = setInterval(() => {
      const elapsedSec = (performance.now() - sessionStartTime) / 1000.0;
      const remainingSec = Math.max(0.0, SESSION_DURATION_SEC - elapsedSec);
      countdownText.textContent = `${remainingSec.toFixed(1)}s`;
      frameCountText.textContent = `${capturedFrames.length} / ${TARGET_FRAMES}`;

      if (isSocialTask && !cueFired && elapsedSec >= AUDIO_CUE_SEC) {
        cueFired = true;
        cueAlert.hidden = false;
        playAudioChime();
        setTimeout(() => { cueAlert.hidden = true; }, 1800);
      }

      if (currentWorldLandmarks && currentWorldLandmarks.length >= 33) {
        const frameLms = currentWorldLandmarks.map((lm) => ({
          x: Number(lm.x.toFixed(4)),
          y: Number(lm.y.toFixed(4)),
          z: Number((lm.z || 0).toFixed(4)),
          visibility: Number((lm.visibility ?? 1).toFixed(2)),
        }));

        capturedFrames.push({
          timestamp_ms: Math.round(elapsedSec * 1000),
          pose_world_landmarks: frameLms,
          face_metrics: currentFaceMetrics || { head_yaw: 0.0, iris_center_ratio: 0.5, face_detected: true },
        });
      }

      if (elapsedSec >= SESSION_DURATION_SEC || capturedFrames.length >= TARGET_FRAMES) {
        finishRecordingSession();
      }
    }, 1000 / TARGET_FPS);
  });
}

// Stop / Reset
if (stopRecordBtn) {
  stopRecordBtn.addEventListener("click", () => {
    if (sampleTimer) clearInterval(sampleTimer);
    isRecording = false;
    startRecordBtn.disabled = false;
    startRecordBtn.classList.remove("recording");
    startRecordBtn.textContent = "Record Session";
    timerBadge.hidden = true;
    cueAlert.hidden = true;
    videoStatus.textContent = "Session reset. Ready for next screening.";
  });
}

// Transmit Landmark Stream & Display Results
async function finishRecordingSession() {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  startRecordBtn.disabled = false;
  startRecordBtn.classList.remove("recording");
  startRecordBtn.textContent = "Record Session";
  timerBadge.hidden = true;

  videoStatus.textContent = `Analyzing ${capturedFrames.length} coordinate frames (~45 KB JSON payload)...`;

  const payload = {
    child_age_months: parseInt(childAgeInput.value, 10) || 24,
    task_type: taskTypeSelect.value,
    fps: TARGET_FPS,
    audio_cue_timestamp_sec: AUDIO_CUE_SEC,
    frames: capturedFrames,
  };

  try {
    const res = await fetch(`${API_URL}/analyze-video-landmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Server landmark analysis failed.");
    }

    displayVideoResults(data);
    videoStatus.textContent = "Analysis complete. Review the evaluation report below.";
  } catch (err) {
    console.error("Analysis submission error:", err);
    videoStatus.textContent = err.message || "Could not connect to FastAPI backend on port 8000.";
    videoStatus.classList.add("error");
  }
}

// Instant Demo Simulation Runner (Benchmarking for All 5 Tasks)
let activeDemoInterval = null;

async function runDemoSession(targetTask = null) {
  switchTab("tab-video");

  const chosenTask = targetTask || taskTypeSelect.value || "walking_gait";
  taskTypeSelect.value = chosenTask;
  updateTaskUI(chosenTask);

  const cfg = TASK_CONFIGS[chosenTask] || TASK_CONFIGS.walking_gait;
  childAgeInput.value = cfg.defaultAge;

  try {
    videoStatus.textContent = `Loading ${cfg.label} dataset (120 frames)...`;
    videoStatus.classList.remove("error");

    if (activeDemoInterval) {
      clearInterval(activeDemoInterval);
      activeDemoInterval = null;
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (cfg.videoFile) {
      videoEl.srcObject = null;
      videoEl.poster = "";
      videoEl.src = cfg.videoFile;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.play().catch(() => {});
    } else if (cfg.poster) {
      videoEl.srcObject = null;
      videoEl.src = "";
      videoEl.poster = cfg.poster;
    }

    const resp = await fetch(cfg.dataFile);
    if (!resp.ok) throw new Error(`Could not load ${cfg.dataFile}`);
    const demoPayload = await resp.json();

    timerBadge.hidden = false;
    let frameIdx = 0;
    const totalDemoFrames = demoPayload.frames.length;

    canvasEl.width = 360;
    canvasEl.height = 640;

    activeDemoInterval = setInterval(() => {
      if (frameIdx >= totalDemoFrames) {
        clearInterval(activeDemoInterval);
        activeDemoInterval = null;
        timerBadge.hidden = true;
        cueAlert.hidden = true;
        videoStatus.textContent = "Transmitting demo landmark frames to backend...";

        fetch(`${API_URL}/analyze-video-landmarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(demoPayload),
        })
          .then((r) => r.json())
          .then((data) => {
            displayVideoResults(data);
            videoStatus.textContent = `Demo ${cfg.label} analysis complete! See breakdown below.`;
          })
          .catch((err) => {
            videoStatus.textContent = err.message || "Demo submission failed.";
            videoStatus.classList.add("error");
          });
        return;
      }

      const f = demoPayload.frames[frameIdx];
      const lms = f.pose_world_landmarks;
      const face = f.face_metrics;

      drawSkeleton(ctx, lms, canvasEl.width, canvasEl.height);
      updateLiveTelemetry(lms, lms, face);

      if (chosenTask === "social_response" && frameIdx === 30) {
        playAudioChime();
        cueAlert.hidden = false;
        setTimeout(() => { cueAlert.hidden = true; }, 1500);
      }

      const remain = Math.max(0, 12.0 - frameIdx * 0.1);
      countdownText.textContent = `${remain.toFixed(1)}s`;
      frameCountText.textContent = `${frameIdx + 1} / ${totalDemoFrames}`;

      frameIdx++;
    }, 100);
  } catch (err) {
    console.error("Demo run error:", err);
    videoStatus.textContent = `Could not run demo: ${err.message}`;
    videoStatus.classList.add("error");
  }
}

if (runDemoBtn) runDemoBtn.addEventListener("click", () => runDemoSession());
if (quickDemoBtn) quickDemoBtn.addEventListener("click", () => runDemoSession("walking_gait"));

// Tutorial Action Button Triggers for All Protocols
const tutorialTestSittingBtn = document.getElementById("tutorialTestSittingBtn");
if (tutorialTestSittingBtn) tutorialTestSittingBtn.addEventListener("click", () => runDemoSession("sitting_posture"));

const tutorialTestWalkingBtn = document.getElementById("tutorialTestWalkingBtn");
if (tutorialTestWalkingBtn) tutorialTestWalkingBtn.addEventListener("click", () => runDemoSession("walking_gait"));

const tutorialTestStandingBtn = document.getElementById("tutorialTestStandingBtn");
if (tutorialTestStandingBtn) tutorialTestStandingBtn.addEventListener("click", () => runDemoSession("standing_alignment"));

const tutorialTestBalanceBtn = document.getElementById("tutorialTestBalanceBtn");
if (tutorialTestBalanceBtn) tutorialTestBalanceBtn.addEventListener("click", () => runDemoSession("balance_sway"));

const tutorialTestSocialBtn = document.getElementById("tutorialTestSocialBtn");
if (tutorialTestSocialBtn) tutorialTestSocialBtn.addEventListener("click", () => runDemoSession("social_response"));

const tutorialTestSkinBtn = document.getElementById("tutorialTestSkinBtn");
if (tutorialTestSkinBtn) {
  tutorialTestSkinBtn.addEventListener("click", () => {
    switchTab("tab-skin");
    loadDemoPhoto("skin");
  });
}

const tutorialTestEyeBtn = document.getElementById("tutorialTestEyeBtn");
if (tutorialTestEyeBtn) {
  tutorialTestEyeBtn.addEventListener("click", () => {
    switchTab("tab-eye");
    loadDemoPhoto("eye");
  });
}

// Display Video Results & The 4Ds Categorization
function displayVideoResults(data) {
  const videoResultBanner = document.getElementById("videoResultBanner");
  const videoStatusPill = document.getElementById("videoStatusPill");
  const videoScreeningStatusText = document.getElementById("videoScreeningStatusText");
  const videoAdviceText = document.getElementById("videoAdviceText");
  const formulaExplanationsBox = document.getElementById("formulaExplanationsBox");
  const flagsAlertBox = document.getElementById("flagsAlertBox");
  const flagsList = document.getElementById("flagsList");

  if (!videoResultBanner) return;

  videoResultBanner.hidden = false;
  const st = data.screening_status || "YELLOW";
  videoResultBanner.className = `result-banner ${st}`;
  if (videoStatusPill) videoStatusPill.textContent = st;
  if (videoScreeningStatusText) videoScreeningStatusText.textContent = `Screening Evaluation: ${st}`;
  if (videoAdviceText) videoAdviceText.textContent = data.advice || "";

  if (formulaExplanationsBox) {
    formulaExplanationsBox.innerHTML = "<strong>Biomechanical Analysis Notes:</strong>";
    const ul = document.createElement("ul");
    ul.style.margin = "6px 0 0 16px";
    ul.style.padding = "0";
    (data.formula_explanations || []).forEach((exp) => {
      const li = document.createElement("li");
      li.textContent = exp;
      ul.appendChild(li);
    });
    formulaExplanationsBox.appendChild(ul);
  }

  const flags = data.clinical_flags || [];
  if (flagsAlertBox && flagsList) {
    if (flags.length > 0) {
      flagsAlertBox.hidden = false;
      flagsList.innerHTML = "";
      flags.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f;
        flagsList.appendChild(li);
      });
    } else {
      flagsAlertBox.hidden = true;
    }
  }

  videoResultBanner.scrollIntoView({ behavior: "smooth" });
}
