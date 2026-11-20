// ==========================================================================
// Nanhe Kadam – Real-Time Pose & Biomechanical Observability Dashboard
// Complete 33-Landmark MediaPipe Tracking, Live Kinematics, Charts & Replay
// ==========================================================================

const API_URL = (window.location.port === "5500")
  ? "http://127.0.0.1:8000"
  : window.location.origin.startsWith("http")
    ? window.location.origin
    : "http://127.0.0.1:8000";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CHART_COLORS = [
  "#06B6D4", "#F59E0B", "#10B981", "#EF4444",
  "#8B5CF6", "#EC4899", "#3B82F6", "#64748B",
];

// 33 MediaPipe Pose Landmark Definitions & Regional Classifications
const LANDMARKS_META = [
  { id: 0, name: "nose", side: "center", region: "face" },
  { id: 1, name: "left_eye_inner", side: "left", region: "face" },
  { id: 2, name: "left_eye", side: "left", region: "face" },
  { id: 3, name: "left_eye_outer", side: "left", region: "face" },
  { id: 4, name: "right_eye_inner", side: "right", region: "face" },
  { id: 5, name: "right_eye", side: "right", region: "face" },
  { id: 6, name: "right_eye_outer", side: "right", region: "face" },
  { id: 7, name: "left_ear", side: "left", region: "face" },
  { id: 8, name: "right_ear", side: "right", region: "face" },
  { id: 9, name: "mouth_left", side: "left", region: "face" },
  { id: 10, name: "mouth_right", side: "right", region: "face" },
  { id: 11, name: "left_shoulder", side: "left", region: "upper" },
  { id: 12, name: "right_shoulder", side: "right", region: "upper" },
  { id: 13, name: "left_elbow", side: "left", region: "arms" },
  { id: 14, name: "right_elbow", side: "right", region: "arms" },
  { id: 15, name: "left_wrist", side: "left", region: "arms" },
  { id: 16, name: "right_wrist", side: "right", region: "arms" },
  { id: 17, name: "left_pinky", side: "left", region: "arms" },
  { id: 18, name: "right_pinky", side: "right", region: "arms" },
  { id: 19, name: "left_index", side: "left", region: "arms" },
  { id: 20, name: "right_index", side: "right", region: "arms" },
  { id: 21, name: "left_thumb", side: "left", region: "arms" },
  { id: 22, name: "right_thumb", side: "right", region: "arms" },
  { id: 23, name: "left_hip", side: "left", region: "upper" },
  { id: 24, name: "right_hip", side: "right", region: "upper" },
  { id: 25, name: "left_knee", side: "left", region: "lower" },
  { id: 26, name: "right_knee", side: "right", region: "lower" },
  { id: 27, name: "left_ankle", side: "left", region: "lower" },
  { id: 28, name: "right_ankle", side: "right", region: "lower" },
  { id: 29, name: "left_heel", side: "left", region: "lower" },
  { id: 30, name: "right_heel", side: "right", region: "lower" },
  { id: 31, name: "left_foot_index", side: "left", region: "lower" },
  { id: 32, name: "right_foot_index", side: "right", region: "lower" },
];

// Complete Official MediaPipe Topology (35 connections)
const POSE_CONNECTIONS = [
  // Face & Head
  { a: 0, b: 1, side: "left" }, { a: 1, b: 2, side: "left" }, { a: 2, b: 3, side: "left" }, { a: 3, b: 7, side: "left" },
  { a: 0, b: 4, side: "right" }, { a: 4, b: 5, side: "right" }, { a: 5, b: 6, side: "right" }, { a: 6, b: 8, side: "right" },
  { a: 9, b: 10, side: "center" },
  // Torso
  { a: 11, b: 12, side: "center" },
  { a: 11, b: 23, side: "left" }, { a: 12, b: 24, side: "right" },
  { a: 23, b: 24, side: "center" },
  // Left Arm & Hand
  { a: 11, b: 13, side: "left" }, { a: 13, b: 15, side: "left" },
  { a: 15, b: 17, side: "left" }, { a: 15, b: 19, side: "left" }, { a: 15, b: 21, side: "left" },
  { a: 17, b: 19, side: "left" },
  // Right Arm & Hand
  { a: 12, b: 14, side: "right" }, { a: 14, b: 16, side: "right" },
  { a: 16, b: 18, side: "right" }, { a: 16, b: 20, side: "right" }, { a: 16, b: 22, side: "right" },
  { a: 18, b: 20, side: "right" },
  // Left Leg & Anatomical Foot Triangle
  { a: 23, b: 25, side: "left" }, { a: 25, b: 27, side: "left" },
  { a: 27, b: 29, side: "left", isFoot: true }, { a: 29, b: 31, side: "left", isFoot: true }, { a: 31, b: 27, side: "left", isFoot: true },
  // Right Leg & Anatomical Foot Triangle
  { a: 24, b: 26, side: "right" }, { a: 26, b: 28, side: "right" },
  { a: 28, b: 30, side: "right", isFoot: true }, { a: 30, b: 32, side: "right", isFoot: true }, { a: 32, b: 28, side: "right", isFoot: true },
];

// Bilingual Translations (EN / Hindi)
const I18N = {
  en: {
    brand_sub: "RBSK 2.0 Aligned · Real-Time 33-Landmark Pose & Kinematics",
    tab_walking: "Pose & Biomechanical Monitoring (चाल जाँच)",
    tab_skin: "Skin Condition (त्वचा)",
    tab_eye: "Eye Condition (नेत्र)",
    label_age: "Age(Mo):",
    btn_start_cam: "Live Camera",
    btn_upload_video: "Upload MP4",
    btn_run_demo: "Run Demo Video",
    btn_record: "Record 120F",
    btn_reset: "Reset",
    viewport_title: "Live Vision Stream & 33-Landmark Overlay",
    guide_head: "HEAD TARGET",
    guide_shoulders: "SHOULDERS",
    guide_feet: "FEET / ANKLES",
    status_waiting: "Waiting for Input...",
    status_ready_prompt: "Camera ready. Start camera or select a video to begin tracking.",
    math_title: "Biomechanical Decision Calculation & Clinical Flags",
  },
  hi: {
    brand_sub: "RBSK 2.0 - रीयल-टाइम 33-लैंडमार्क पोज़ व गतिशीलता जाँच",
    tab_walking: "पोज़ व बायोमैकेनिकल निगरानी",
    tab_skin: "त्वचा स्थिति",
    tab_eye: "नेत्र स्थिति",
    label_age: "उम्र (माह):",
    btn_start_cam: "कैमरा शुरू करें",
    btn_upload_video: "वीडियो अपलोड करें",
    btn_run_demo: "डेमो वीडियो चलाएं",
    btn_record: "120 फ्रेम रिकॉर्ड करें",
    btn_reset: "रीसेट करें",
    viewport_title: "लाइव विज़न स्ट्रीम व 33 लैंडमार्क ओवरले",
    guide_head: "सिर",
    guide_shoulders: "कंधे",
    guide_feet: "पैर / टखने",
    status_waiting: "प्रतीक्षा...",
    status_ready_prompt: "तैयार। कैमरा शुरू करें या वीडियो चुनें।",
    math_title: "गणितीय निर्णय गणना एवं नैदानिक जोखिम संकेत",
  }
};

let currentLang = localStorage.getItem("nanhe_lang") || "en";
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem("nanhe_lang", lang);
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) el.textContent = dict[key];
  });
  const langBtn = document.getElementById("langToggleBtn");
  if (langBtn) {
    langBtn.querySelector(".lang-code.en")?.classList.toggle("active", lang === "en");
    langBtn.querySelector(".lang-code.hi")?.classList.toggle("active", lang === "hi");
  }
}
const langToggleBtn = document.getElementById("langToggleBtn");
if (langToggleBtn) {
  langToggleBtn.addEventListener("click", () => setLanguage(currentLang === "en" ? "hi" : "en"));
}
setLanguage(currentLang);

// Tab Navigation
function switchTab(tabId) {
  document.querySelectorAll(".nav-tab").forEach(b => {
    const isTarget = b.dataset.tab === tabId;
    b.classList.toggle("active", isTarget);
    b.setAttribute("aria-selected", isTarget ? "true" : "false");
  });
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === tabId);
  });
}
document.querySelectorAll(".nav-tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ==========================================================================
// DOM Elements
// ==========================================================================
const videoEl = document.getElementById("webcamVideo");
const canvasEl = document.getElementById("skeletonCanvas");
const viewportWrap = document.querySelector(".video-viewport-wrap");
const ctx = canvasEl.getContext("2d");

// Transport Buttons
const startCamBtn = document.getElementById("startCamBtn");
const videoFileInputAlt = document.getElementById("videoFileInputAlt");
const runDemoBtn = document.getElementById("runDemoBtn");
const btnPlayPause = document.getElementById("btnPlayPause");
const btnRestartVideo = document.getElementById("btnRestartVideo");
const btnStepBack = document.getElementById("btnStepBack");
const btnStepFwd = document.getElementById("btnStepFwd");
const startRecordBtn = document.getElementById("startRecordBtn");
const btnReplaySession = document.getElementById("btnReplaySession");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const childAgeInput = document.getElementById("childAgeInput");

// HUD Status
const hudFps = document.getElementById("hudFps");
const hudLatency = document.getElementById("hudLatency");
const hudFrame = document.getElementById("hudFrame");
const hudTrackingStatus = document.getElementById("hudTrackingStatus");
const streamSourceTag = document.getElementById("streamSourceTag");
const framingBadge = document.getElementById("framingBadge");
const timerBadge = document.getElementById("timerBadge");
const countdownText = document.getElementById("countdownText");
const frameCountText = document.getElementById("frameCountText");
const trackingAlertBanner = document.getElementById("trackingAlertBanner");
const trackingAlertText = document.getElementById("trackingAlertText");
const videoStatus = document.getElementById("videoStatus");
const cameraGuideFrame = document.getElementById("cameraGuideFrame");

// Canvas Toggles
const toggleLandmarksBtn = document.getElementById("toggleLandmarksBtn");
const toggleSkeletonBtn = document.getElementById("toggleSkeletonBtn");
const toggleTrianglesBtn = document.getElementById("toggleTrianglesBtn");
const toggleLabelsBtn = document.getElementById("toggleLabelsBtn");
const toggleGuideBtn = document.getElementById("toggleGuideBtn");

// Landmark Inspector Elements
const visibleLandmarksCount = document.getElementById("visibleLandmarksCount");
const landmarkSearchInput = document.getElementById("landmarkSearchInput");
const landmarkTableBody = document.getElementById("landmarkTableBody");
const selectedJointName = document.getElementById("selectedJointName");

// Replay Timeline Elements
const sessionTimelineSlider = document.getElementById("sessionTimelineSlider");
const replayTimeDisplay = document.getElementById("replayTimeDisplay");
const replayFrameDisplay = document.getElementById("replayFrameDisplay");
const btnTimelinePlay = document.getElementById("btnTimelinePlay");
const btnTimelineStepPrev = document.getElementById("btnTimelineStepPrev");
const btnTimelineStepNext = document.getElementById("btnTimelineStepNext");

// Terminal Log Elements
const terminalConsole = document.getElementById("terminalConsole");
const terminalAutoScroll = document.getElementById("terminalAutoScroll");
const btnPauseTerminal = document.getElementById("btnPauseTerminal");
const btnClearTerminal = document.getElementById("btnClearTerminal");
const btnExportLogs = document.getElementById("btnExportLogs");

// Results Card Elements
const mathBreakdownCard = document.getElementById("mathBreakdownCard");
const mathStatusBadge = document.getElementById("mathStatusBadge");
const mathStepsList = document.getElementById("mathStepsList");

// ==========================================================================
// Application State
// ==========================================================================
let cameraStream = null;
let poseLandmarker = null;
let faceLandmarker = null;
let animationFrameId = null;
let isVideoPaused = false;
let mpTimestamp = 1;
let lastVideoTime = -1;

// Performance Tracking
let frameIndex = 0;
let fpsFramesCount = 0;
let fpsLastTime = performance.now();
let currentFps = 0;
let currentInferenceLatency = 0;

// Visualization Options
let optShowLandmarks = true;
let optShowSkeleton = true;
let optShowFootTriangles = true;
let optShowLabels = false;
let optShowGuide = true;
let selectedLandmarkId = null; // Clicking an ID highlights it on canvas
let inspectorCoordMode = "normalized"; // "normalized" or "world"
let inspectorFilterCategory = "all"; // "all", "face", "upper", "arms", "lower"
let inspectorSearchQuery = "";

// Real-Time Pose Data
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;

// Parameter Histories for Sparklines & Charts (FIFO buffers)
const MAX_HISTORY = 120;
let paramHistory = {
  timestamps: [],
  lKnee: [],
  rKnee: [],
  spine: [],
  ankleSep: [],
  gsi: [],
  wristVel: [],
};
let prevParams = {};

// Terminal Logs Buffer
let logEvents = [];
let terminalPaused = false;
let terminalFilterCategory = "ALL";

// Session Recording & Replay State
let isRecording = false;
let sessionStartTime = null;
let sampleTimer = null;
let recordedSession = []; // Array of recorded frames: { time, frame, landmarks, worldLandmarks, params }
let isReplaying = false;
let replayTimer = null;
let replayIndex = 0;

const TARGET_FPS = 10.0;
const SESSION_DURATION_SEC = 12.0;
const TARGET_FRAMES = 120;

// Sparkline Canvas Contexts
const sparklines = {};
["lknee", "rknee", "spine", "anklesep", "gsi", "limb", "lfoot", "rfoot", "shoulder", "sway", "wrist", "fft"].forEach(id => {
  const el = document.getElementById(`spark-${id}`);
  if (el) sparklines[id] = el.getContext("2d");
});

// ==========================================================================
// 1. Terminal Logger (Structured Events & Throttling)
// ==========================================================================
function logEvent(severity, category, message, frame = frameIndex) {
  const now = new Date();
  const timeStr = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
  const event = {
    timestamp: timeStr,
    frame: frame,
    severity: severity.toUpperCase(), // INFO, SUCCESS, WARN, ERROR
    category: category.toUpperCase(), // SYSTEM, VIDEO, MEDIAPIPE, LANDMARKS, BIOMECH, BACKEND
    message: message
  };

  logEvents.push(event);
  if (logEvents.length > 500) logEvents.shift();

  if (terminalPaused) return;

  // Filter check
  if (terminalFilterCategory !== "ALL" && event.category !== terminalFilterCategory && !(terminalFilterCategory === "WARN" && (event.severity === "WARN" || event.severity === "ERROR"))) {
    return;
  }

  renderTerminalRow(event);
}

function renderTerminalRow(event) {
  if (!terminalConsole) return;
  const row = document.createElement("div");
  row.className = `terminal-row ${event.severity.toLowerCase()}`;
  row.innerHTML = `
    <span class="term-time">[${event.timestamp}]</span>
    <span class="term-frame">[F#${event.frame}]</span>
    <span class="term-tag tag-${event.severity.toLowerCase()}">[${event.severity}]</span>
    <span class="term-cat">[${event.category}]</span>
    <span class="term-msg">${event.message}</span>
  `;
  terminalConsole.appendChild(row);

  if (terminalAutoScroll?.checked) {
    terminalConsole.scrollTop = terminalConsole.scrollHeight;
  }
}

function refreshTerminalView() {
  if (!terminalConsole) return;
  terminalConsole.innerHTML = "";
  logEvents.forEach(e => {
    if (terminalFilterCategory === "ALL" || e.category === terminalFilterCategory || (terminalFilterCategory === "WARN" && (e.severity === "WARN" || e.severity === "ERROR"))) {
      renderTerminalRow(e);
    }
  });
}

// Terminal Filter Buttons
document.querySelectorAll(".term-filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".term-filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    terminalFilterCategory = chip.dataset.cat;
    refreshTerminalView();
  });
});

if (btnPauseTerminal) {
  btnPauseTerminal.addEventListener("click", () => {
    terminalPaused = !terminalPaused;
    btnPauseTerminal.textContent = terminalPaused ? "Resume" : "Pause";
  });
}

if (btnClearTerminal) {
  btnClearTerminal.addEventListener("click", () => {
    logEvents = [];
    if (terminalConsole) terminalConsole.innerHTML = "";
  });
}

if (btnExportLogs) {
  btnExportLogs.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logEvents, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `telemetry_logs_${Date.now()}.json`);
    dlAnchor.click();
  });
}

// ==========================================================================
// 2. Real-Time Chart.js Initialization
// ==========================================================================
let chartKnee = null;
let chartSpine = null;
let chartAnkle = null;
let chartWrist = null;

function initCharts() {
  if (typeof Chart === "undefined") return;

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true, mode: "index", intersect: false }
    },
    scales: {
      x: {
        display: false,
        grid: { color: "rgba(255,255,255,0.04)" }
      },
      y: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: { color: "#64748B", font: { family: "JetBrains Mono", size: 9 } }
      }
    }
  };

  // Chart 1: Knee Angles
  const ctxKnee = document.getElementById("chartKneeBilateral")?.getContext("2d");
  if (ctxKnee) {
    chartKnee = new Chart(ctxKnee, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Left Knee (°)", data: [], borderColor: "#06B6D4", borderWidth: 2, pointRadius: 0 },
          { label: "Right Knee (°)", data: [], borderColor: "#F59E0B", borderWidth: 2, pointRadius: 0 },
        ]
      },
      options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 60, max: 190 } } }
    });
  }

  // Chart 2: Spine Tilt & Sway
  const ctxSpine = document.getElementById("chartSpineSway")?.getContext("2d");
  if (ctxSpine) {
    chartSpine = new Chart(ctxSpine, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Spine Tilt (°)", data: [], borderColor: "#10B981", borderWidth: 2, pointRadius: 0 },
          { label: "CoM Sway", data: [], borderColor: "#8B5CF6", borderWidth: 1.5, pointRadius: 0, yAxisID: "y1" },
        ]
      },
      options: {
        ...chartDefaults,
        scales: {
          x: { display: false },
          y: { ...chartDefaults.scales.y, min: 0, max: 40 },
          y1: { position: "right", display: true, min: -0.2, max: 0.2, grid: { drawOnChartArea: false }, ticks: { color: "#8B5CF6", font: { size: 9 } } }
        }
      }
    });
  }

  // Chart 3: Ankle Separation
  const ctxAnkle = document.getElementById("chartAnkleSep")?.getContext("2d");
  if (ctxAnkle) {
    chartAnkle = new Chart(ctxAnkle, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Ankle Sep (norm)", data: [], borderColor: "#8B5CF6", borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: "rgba(139,92,246,0.1)" },
        ]
      },
      options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 0.5 } } }
    });
  }

  // Chart 4: Wrist Velocity
  const ctxWrist = document.getElementById("chartWristVelocity")?.getContext("2d");
  if (ctxWrist) {
    chartWrist = new Chart(ctxWrist, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Wrist dy/dt (norm/s)", data: [], borderColor: "#EC4899", borderWidth: 2, pointRadius: 0 },
        ]
      },
      options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 2.0 } } }
    });
  }
}

function updateLiveCharts(t, p) {
  if (!chartKnee) return;

  const timeLabel = `${t.toFixed(2)}s`;
  paramHistory.timestamps.push(timeLabel);
  paramHistory.lKnee.push(p.lKnee);
  paramHistory.rKnee.push(p.rKnee);
  paramHistory.spine.push(p.spine);
  paramHistory.ankleSep.push(p.ankleSep);
  paramHistory.wristVel.push(p.wristVel);

  if (paramHistory.timestamps.length > MAX_HISTORY) {
    paramHistory.timestamps.shift();
    paramHistory.lKnee.shift();
    paramHistory.rKnee.shift();
    paramHistory.spine.shift();
    paramHistory.ankleSep.shift();
    paramHistory.wristVel.shift();
  }

  // Update chart data arrays
  chartKnee.data.labels = paramHistory.timestamps;
  chartKnee.data.datasets[0].data = paramHistory.lKnee;
  chartKnee.data.datasets[1].data = paramHistory.rKnee;
  chartKnee.update();

  if (chartSpine) {
    chartSpine.data.labels = paramHistory.timestamps;
    chartSpine.data.datasets[0].data = paramHistory.spine;
    chartSpine.update();
  }

  if (chartAnkle) {
    chartAnkle.data.labels = paramHistory.timestamps;
    chartAnkle.data.datasets[0].data = paramHistory.ankleSep;
    chartAnkle.update();
  }

  if (chartWrist) {
    chartWrist.data.labels = paramHistory.timestamps;
    chartWrist.data.datasets[0].data = paramHistory.wristVel;
    chartWrist.update();
  }
}

// Sparkline Mini-Graph Renderer
function drawSparkline(ctxSpark, dataArray, strokeColor = "#06B6D4") {
  if (!ctxSpark || !dataArray || dataArray.length < 2) return;
  const w = ctxSpark.canvas.width;
  const h = ctxSpark.canvas.height;
  ctxSpark.clearRect(0, 0, w, h);

  const min = Math.min(...dataArray);
  const max = Math.max(...dataArray);
  const range = max - min || 1;

  ctxSpark.beginPath();
  ctxSpark.strokeStyle = strokeColor;
  ctxSpark.lineWidth = 1.5;

  dataArray.forEach((val, idx) => {
    const x = (idx / (dataArray.length - 1)) * w;
    const y = h - ((val - min) / range) * (h - 4) - 2;
    if (idx === 0) ctxSpark.moveTo(x, y);
    else ctxSpark.lineTo(x, y);
  });
  ctxSpark.stroke();
}

// ==========================================================================
// 3. MediaPipe Tasks Vision Initialization
// ==========================================================================
async function initMediaPipe() {
  if (poseLandmarker) return;
  try {
    logEvent("INFO", "MEDIAPIPE", "Resolving WASM fileset for Tasks Vision...");
    if (videoStatus) videoStatus.textContent = "Loading MediaPipe AI Vision models...";

    const vision = await window.MediaPipeVision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    logEvent("INFO", "MEDIAPIPE", "Initializing PoseLandmarker (float16, GPU delegate)...");
    poseLandmarker = await window.MediaPipeVision.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    });

    logEvent("SUCCESS", "MEDIAPIPE", "PoseLandmarker loaded successfully.");

    try {
      faceLandmarker = await window.MediaPipeVision.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      logEvent("SUCCESS", "MEDIAPIPE", "FaceLandmarker loaded for head orientation.");
    } catch (e) {
      logEvent("WARN", "MEDIAPIPE", `FaceLandmarker optional load skipped: ${e.message}`);
    }

    if (hudTrackingStatus) {
      hudTrackingStatus.textContent = "STANDBY";
      hudTrackingStatus.className = "hud-badge-status ready";
    }
    if (videoStatus) videoStatus.textContent = "AI Models ready. Start camera or upload video.";
  } catch (err) {
    console.error("MediaPipe initialization error:", err);
    logEvent("ERROR", "MEDIAPIPE", `Model loading error: ${err.message}`);
    if (videoStatus) videoStatus.textContent = `Model initialization error: ${err.message}`;
    if (hudTrackingStatus) {
      hudTrackingStatus.textContent = "INIT_FAILED";
      hudTrackingStatus.className = "hud-badge-status lost";
    }
  }
}

window.addEventListener("mediapipe-ready", initMediaPipe);
if (window.MediaPipeVision) initMediaPipe();

// ==========================================================================
// 4. Mathematical & Kinematic Utilities (3D arccos & Invariant Vectors)
// ==========================================================================
function angle3D(a, b, c) {
  if (!a || !b || !c) return 180.0;
  const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z || 0) - (b.z || 0);
  const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z || 0) - (b.z || 0);
  const nu = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const nv = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (nu < 1e-6 || nv < 1e-6) return 180.0;
  let cos = (ux * vx + vy * vy + uz * vz) / (nu * nv);
  cos = Math.max(-1.0, Math.min(1.0, cos));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

function vis(p) {
  if (!p) return false;
  if (p.visibility === undefined) return true;
  return p.visibility > 0.25;
}

// Compute All Live Biomechanical Kinematics
function computeAllBiomechanicalParameters(pose, timeSec, prevPose, prevTimeSec) {
  if (!pose || pose.length < 33) return null;

  // 1. Joint Angles
  const lKnee = angle3D(pose[23], pose[25], pose[27]);
  const rKnee = angle3D(pose[24], pose[26], pose[28]);
  const lFoot = (vis(pose[25]) && vis(pose[27]) && vis(pose[31])) ? angle3D(pose[25], pose[27], pose[31]) : 90.0;
  const rFoot = (vis(pose[26]) && vis(pose[28]) && vis(pose[32])) ? angle3D(pose[26], pose[28], pose[32]) : 90.0;

  // 2. Spine / Trunk Tilt
  const smx = (pose[11].x + pose[12].x) / 2;
  const smy = (pose[11].y + pose[12].y) / 2;
  const hmx = (pose[23].x + pose[24].x) / 2;
  const hmy = (pose[23].y + pose[24].y) / 2;
  const dx = smx - hmx, dy = smy - hmy;
  const spine = Math.abs((Math.atan2(dx, dy) * 180.0) / Math.PI);

  // 3. Shoulder Level Tilt
  const sdx = pose[12].x - pose[11].x;
  const sdy = pose[12].y - pose[11].y;
  const shoulderTilt = Math.abs((Math.atan2(sdy, sdx) * 180.0) / Math.PI);

  // 4. Ankle Separation (norm)
  const ankleSep = Math.abs(pose[27].x - pose[28].x);

  // 5. Lower Limb Alignment Ratio (Knee vs Ankle spacing)
  let limbRatio = 0.0;
  if (lKnee > 140 && rKnee > 140) {
    const kDist = Math.abs(pose[25].x - pose[26].x);
    const aDist = Math.abs(pose[27].x - pose[28].x);
    limbRatio = kDist - aDist;
  }

  // 6. Center-of-Mass Sway (Mid-Hip X position)
  const midHipX = hmx;

  // 7. Wrist Velocity (norm/s)
  let wristVel = 0.0;
  if (prevPose && prevTimeSec !== undefined && timeSec > prevTimeSec) {
    const dt = timeSec - prevTimeSec;
    if (dt > 1e-4) {
      const dwy = Math.abs(pose[15].y - prevPose[15].y);
      wristVel = dwy / dt;
    }
  }

  // 8. Dynamic Gait Symmetry Index (GSI running estimate)
  let dynamicGSI = 1.0;
  if (paramHistory.ankleSep.length >= 8) {
    const arr = paramHistory.ankleSep.slice(-30);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const diffs = arr.map(v => v - mean);
    const pos = diffs.filter(d => d > 0.015);
    const neg = diffs.filter(d => d < -0.015).map(Math.abs);
    if (pos.length > 0 && neg.length > 0) {
      const avgP = pos.reduce((a, b) => a + b, 0) / pos.length;
      const avgN = neg.reduce((a, b) => a + b, 0) / neg.length;
      dynamicGSI = Math.min(avgP, avgN) / (Math.max(avgP, avgN) + 1e-6);
      dynamicGSI = Math.max(0.0, Math.min(1.0, dynamicGSI));
    }
  }

  // 9. Framing Quality
  const headOk = vis(pose[0]);
  const feetOk = vis(pose[27]) && vis(pose[28]);
  const framing = (headOk && feetOk) ? "OK" : headOk ? "No-Feet" : "Partial";

  return {
    lKnee: Number(lKnee.toFixed(1)),
    rKnee: Number(rKnee.toFixed(1)),
    lFoot: Number(lFoot.toFixed(1)),
    rFoot: Number(rFoot.toFixed(1)),
    spine: Number(spine.toFixed(1)),
    shoulderTilt: Number(shoulderTilt.toFixed(1)),
    ankleSep: Number(ankleSep.toFixed(3)),
    limbRatio: Number(limbRatio.toFixed(3)),
    midHipX: Number(midHipX.toFixed(3)),
    wristVel: Number(wristVel.toFixed(2)),
    gsi: Number(dynamicGSI.toFixed(2)),
    framing: framing,
    headOk, feetOk
  };
}

// Update 12 Biomechanical Parameter Cards UI
function updateParamCards(p) {
  if (!p) return;

  function setCard(id, val, unit, formatFn) {
    const elVal = document.getElementById(`val-${id}`);
    const elPrev = document.getElementById(`prev-${id}`);
    const elDelta = document.getElementById(`delta-${id}`);
    const elBadge = document.getElementById(`badge-${id}`);

    const cur = val;
    const prev = prevParams[id];
    let delta = "--";
    if (prev !== undefined && !isNaN(cur) && !isNaN(prev)) {
      const diff = cur - prev;
      delta = (diff >= 0 ? "+" : "") + diff.toFixed(1);
    }

    if (elVal) elVal.textContent = isNaN(cur) ? "--" : (formatFn ? formatFn(cur) : cur);
    if (elPrev) elPrev.textContent = prev !== undefined ? (formatFn ? formatFn(prev) : prev) : "--";
    if (elDelta) elDelta.textContent = delta;
    if (elBadge) {
      if (isNaN(cur)) {
        elBadge.textContent = "UNAVAILABLE";
        elBadge.className = "param-badge unavailable";
      } else {
        elBadge.textContent = "VALID";
        elBadge.className = "param-badge";
      }
    }

    prevParams[id] = cur;
  }

  setCard("lknee", p.lKnee, "°");
  setCard("rknee", p.rKnee, "°");
  setCard("spine", p.spine, "°");
  setCard("anklesep", p.ankleSep, "norm");
  setCard("gsi", p.gsi, "ratio");
  setCard("limb", p.limbRatio, "ratio");
  setCard("lfoot", p.lFoot, "°");
  setCard("rfoot", p.rFoot, "°");
  setCard("shoulder", p.shoulderTilt, "°");
  setCard("sway", Math.abs(p.midHipX - 0.5), "norm");
  setCard("wrist", p.wristVel, "norm/s");
  setCard("fft", 0.0, "Hz");

  // Render Mini Sparklines
  if (paramHistory.lKnee.length > 2) {
    drawSparkline(sparklines.lknee, paramHistory.lKnee.slice(-30), "#06B6D4");
    drawSparkline(sparklines.rknee, paramHistory.rKnee.slice(-30), "#F59E0B");
    drawSparkline(sparklines.spine, paramHistory.spine.slice(-30), "#10B981");
    drawSparkline(sparklines.anklesep, paramHistory.ankleSep.slice(-30), "#8B5CF6");
    drawSparkline(sparklines.wrist, paramHistory.wristVel.slice(-30), "#EC4899");
  }
}

// ==========================================================================
// 5. 33-Landmark Inspector Table Management
// ==========================================================================
function updateLandmarkInspector(landmarks, worldLandmarks) {
  if (!landmarkTableBody) return;

  const dataList = (inspectorCoordMode === "world" && worldLandmarks && worldLandmarks.length >= 33)
    ? worldLandmarks
    : landmarks;

  if (!dataList || dataList.length < 33) {
    landmarkTableBody.innerHTML = `<tr class="empty-state-row"><td colspan="7">No pose tracked in this frame</td></tr>`;
    if (visibleLandmarksCount) visibleLandmarksCount.textContent = "0/33";
    return;
  }

  let visibleCount = 0;
  let rowsHtml = "";

  LANDMARKS_META.forEach((meta, idx) => {
    const lm = dataList[idx];
    if (!lm) return;

    const isVisible = vis(lm);
    if (isVisible) visibleCount++;

    // Category filter check
    if (inspectorFilterCategory !== "all" && meta.region !== inspectorFilterCategory) {
      return;
    }

    // Search query check
    if (inspectorSearchQuery) {
      const q = inspectorSearchQuery.toLowerCase();
      if (!meta.name.toLowerCase().includes(q) && String(meta.id) !== q) {
        return;
      }
    }

    const isSelected = selectedLandmarkId === idx;
    const sideClass = meta.side === "left" ? "side-left" : meta.side === "right" ? "side-right" : "side-center";
    const statusText = isVisible ? "TRACKED" : (lm.visibility && lm.visibility > 0.1) ? "LOW_VIS" : "OCCLUDED";
    const statusClass = isVisible ? "valid" : (lm.visibility && lm.visibility > 0.1) ? "low" : "occ";

    const xVal = lm.x !== undefined ? lm.x.toFixed(3) : "--";
    const yVal = lm.y !== undefined ? lm.y.toFixed(3) : "--";
    const zVal = lm.z !== undefined ? lm.z.toFixed(3) : "--";
    const visVal = lm.visibility !== undefined ? lm.visibility.toFixed(2) : "1.00";

    rowsHtml += `
      <tr class="${isSelected ? 'selected-row' : ''}" data-id="${idx}">
        <td class="mono ${sideClass}">#${idx}</td>
        <td class="${sideClass}"><strong>${meta.name}</strong></td>
        <td class="mono">${xVal}</td>
        <td class="mono">${yVal}</td>
        <td class="mono">${zVal}</td>
        <td class="mono">${visVal}</td>
        <td><span class="status-chip ${statusClass}">${statusText}</span></td>
      </tr>
    `;
  });

  landmarkTableBody.innerHTML = rowsHtml;
  if (visibleLandmarksCount) visibleLandmarksCount.textContent = `${visibleCount}/33`;

  // Attach click listeners to rows for joint selection
  landmarkTableBody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => {
      const id = parseInt(tr.dataset.id, 10);
      selectedLandmarkId = (selectedLandmarkId === id) ? null : id;
      if (selectedJointName) {
        if (selectedLandmarkId !== null) {
          const m = LANDMARKS_META[selectedLandmarkId];
          selectedJointName.textContent = `#${m.id} ${m.name} (${m.side.toUpperCase()} ${m.region.toUpperCase()})`;
          logEvent("INFO", "LANDMARKS", `Selected landmark #${m.id} [${m.name}] for visual reticle tracking`);
        } else {
          selectedJointName.textContent = "Click a landmark in table to isolate & trace on video";
        }
      }
      // Re-render table selection highlight
      landmarkTableBody.querySelectorAll("tr").forEach(r => r.classList.remove("selected-row"));
      if (selectedLandmarkId !== null) tr.classList.add("selected-row");
    });
  });
}

// Inspector Filter Chips
document.querySelectorAll(".filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    inspectorFilterCategory = chip.dataset.filter;
    updateLandmarkInspector(currentPoseLandmarks, currentWorldLandmarks);
  });
});

// Coordinate Mode Buttons (Normalized vs 3D World)
document.querySelectorAll(".coord-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".coord-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    inspectorCoordMode = btn.dataset.coord;
    logEvent("INFO", "LANDMARKS", `Switched inspector coordinate space to: ${inspectorCoordMode}`);
    updateLandmarkInspector(currentPoseLandmarks, currentWorldLandmarks);
  });
});

// Search Filter Input
if (landmarkSearchInput) {
  landmarkSearchInput.addEventListener("input", (e) => {
    inspectorSearchQuery = e.target.value.trim();
    updateLandmarkInspector(currentPoseLandmarks, currentWorldLandmarks);
  });
}

// ==========================================================================
// 6. Canvas Skeleton & Bilateral Pose Rendering
// ==========================================================================
function drawSkeletonOverlay(landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || landmarks.length < 33) return;

  // 1. Draw Official MediaPipe Topology Connections
  if (optShowSkeleton) {
    ctx.lineWidth = 2.2;
    POSE_CONNECTIONS.forEach(conn => {
      if (conn.isFoot && !optShowFootTriangles) return;

      const pA = landmarks[conn.a];
      const pB = landmarks[conn.b];
      if (vis(pA) && vis(pB)) {
        ctx.beginPath();
        ctx.moveTo(pA.x * w, pA.y * h);
        ctx.lineTo(pB.x * w, pB.y * h);

        // Bilateral Color Palette
        if (conn.isFoot) {
          ctx.strokeStyle = (conn.side === "left") ? "#00E5FF" : "#FF9100";
          ctx.lineWidth = 2.8;
        } else if (conn.side === "left") {
          ctx.strokeStyle = "rgba(6, 182, 212, 0.95)"; // Cyan for Left
        } else if (conn.side === "right") {
          ctx.strokeStyle = "rgba(245, 158, 11, 0.95)"; // Amber for Right
        } else {
          ctx.strokeStyle = "rgba(16, 185, 129, 0.95)"; // Green for Center
        }
        ctx.stroke();
      }
    });
  }

  // 2. Draw 33 Landmark Dots
  if (optShowLandmarks) {
    landmarks.forEach((p, idx) => {
      if (!vis(p)) return;
      const meta = LANDMARKS_META[idx] || { side: "center", region: "face" };
      const px = p.x * w;
      const py = p.y * h;

      // Base radius by anatomical hierarchy
      let r = 4;
      if (meta.region === "face") r = 2.5;
      else if (idx === 25 || idx === 26 || idx === 27 || idx === 28) r = 5.0; // Major joints (knees/ankles)

      let fillColor = "#10B981"; // Center Green
      if (meta.side === "left") fillColor = "#06B6D4"; // Left Cyan
      else if (meta.side === "right") fillColor = "#F59E0B"; // Right Amber

      // Outer glow circle
      ctx.beginPath();
      ctx.arc(px, py, r + 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();

      // Inner point
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Crisp white rim
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Optional Landmark IDs & Names
      if (optShowLabels) {
        ctx.save();
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(11, 15, 25, 0.85)";
        const labelText = `${idx}:${meta.name.replace("left_", "L_").replace("right_", "R_")}`;
        const tw = ctx.measureText(labelText).width;
        ctx.fillRect(px + 6, py - 6, tw + 4, 12);
        ctx.fillStyle = fillColor;
        ctx.fillText(labelText, px + 8, py + 3);
        ctx.restore();
      }
    });
  }

  // 3. Highlight Selected Landmark Reticle
  if (selectedLandmarkId !== null && landmarks[selectedLandmarkId]) {
    const sel = landmarks[selectedLandmarkId];
    if (vis(sel)) {
      const sx = sel.x * w;
      const sy = sel.y * h;
      const meta = LANDMARKS_META[selectedLandmarkId];
      const ringColor = meta.side === "left" ? "#06B6D4" : meta.side === "right" ? "#F59E0B" : "#10B981";

      // Pulsing Reticle Ring
      const pulseR = 12 + Math.sin(performance.now() / 150) * 3;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, pulseR, 0, 2 * Math.PI);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(sx - pulseR - 4, sy); ctx.lineTo(sx - pulseR + 2, sy);
      ctx.moveTo(sx + pulseR - 2, sy); ctx.lineTo(sx + pulseR + 4, sy);
      ctx.moveTo(sx, sy - pulseR - 4); ctx.lineTo(sx, sy - pulseR + 2);
      ctx.moveTo(sx, sy + pulseR - 2); ctx.lineTo(sx, sy + pulseR + 4);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();

      // Joint Inspection Tag
      ctx.font = "bold 10px 'JetBrains Mono', monospace";
      const tagText = `[SELECTED #${selectedLandmarkId}: ${meta.name}]`;
      const tw = ctx.measureText(tagText).width;
      ctx.fillStyle = "rgba(11, 15, 25, 0.9)";
      ctx.fillRect(sx - tw / 2 - 4, sy - pulseR - 18, tw + 8, 16);
      ctx.fillStyle = ringColor;
      ctx.textAlign = "center";
      ctx.fillText(tagText, sx, sy - pulseR - 6);
      ctx.restore();
    }
  }
}

// Canvas Toggle Button Listeners
if (toggleLandmarksBtn) {
  toggleLandmarksBtn.addEventListener("click", () => {
    optShowLandmarks = !optShowLandmarks;
    toggleLandmarksBtn.classList.toggle("active", optShowLandmarks);
  });
}
if (toggleSkeletonBtn) {
  toggleSkeletonBtn.addEventListener("click", () => {
    optShowSkeleton = !optShowSkeleton;
    toggleSkeletonBtn.classList.toggle("active", optShowSkeleton);
  });
}
if (toggleTrianglesBtn) {
  toggleTrianglesBtn.addEventListener("click", () => {
    optShowFootTriangles = !optShowFootTriangles;
    toggleTrianglesBtn.classList.toggle("active", optShowFootTriangles);
  });
}
if (toggleLabelsBtn) {
  toggleLabelsBtn.addEventListener("click", () => {
    optShowLabels = !optShowLabels;
    toggleLabelsBtn.classList.toggle("active", optShowLabels);
  });
}
if (toggleGuideBtn) {
  toggleGuideBtn.addEventListener("click", () => {
    optShowGuide = !optShowGuide;
    toggleGuideBtn.classList.toggle("active", optShowGuide);
    if (cameraGuideFrame) cameraGuideFrame.style.display = optShowGuide ? "block" : "none";
  });
}

// ==========================================================================
// 7. Main Computer Vision Loop (requestAnimationFrame)
// ==========================================================================
let prevPoseForVel = null;
let prevTimeForVel = 0;

function startTrackingLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  lastVideoTime = -1;
  mpTimestamp = performance.now();
  fpsFramesCount = 0;
  fpsLastTime = performance.now();

  function tick() {
    if (videoEl && videoEl.readyState >= 2 && !isVideoPaused) {
      const vw = videoEl.videoWidth || 480;
      const vh = videoEl.videoHeight || 854;

      // Ensure 1:1 pixel overlay match
      if (canvasEl.width !== vw || canvasEl.height !== vh) {
        canvasEl.width = vw;
        canvasEl.height = vh;
        logEvent("INFO", "VIDEO", `Canvas pixel overlay matched to video resolution: ${vw}x${vh}`);
      }

      const curTime = videoEl.currentTime;

      // Run MediaPipe Pose Detection whenever a new video frame is ready
      if (poseLandmarker && curTime !== lastVideoTime) {
        lastVideoTime = curTime;
        mpTimestamp += 35; // Monotonically increasing timestamp

        const tDetectStart = performance.now();
        let detectionSuccess = false;

        try {
          const result = poseLandmarker.detectForVideo(videoEl, mpTimestamp);
          const tDetectEnd = performance.now();
          currentInferenceLatency = Math.round(tDetectEnd - tDetectStart);

          if (result.landmarks && result.landmarks.length > 0) {
            currentPoseLandmarks = result.landmarks[0];
            currentWorldLandmarks = result.worldLandmarks ? result.worldLandmarks[0] : null;
            detectionSuccess = true;
          } else {
            currentPoseLandmarks = null;
            currentWorldLandmarks = null;
          }
        } catch (e) {
          // Silently handle loop reset timestamp jumps
        }

        // Optional Face Orientation
        if (faceLandmarker) {
          try {
            const fResult = faceLandmarker.detectForVideo(videoEl, mpTimestamp);
            if (fResult.faceLandmarks && fResult.faceLandmarks.length > 0) {
              const fl = fResult.faceLandmarks[0];
              const span = fl[263].x - fl[33].x;
              const yaw = span !== 0 ? ((fl[1].x - fl[33].x) - (fl[263].x - fl[1].x)) / Math.abs(span) : 0;
              currentFaceMetrics = { head_yaw: Number(yaw.toFixed(3)), face_detected: true };
            }
          } catch (e) {}
        }

        frameIndex++;

        // Calculate System FPS
        fpsFramesCount++;
        const now = performance.now();
        if (now - fpsLastTime >= 1000) {
          currentFps = (fpsFramesCount * 1000) / (now - fpsLastTime);
          fpsFramesCount = 0;
          fpsLastTime = now;
          if (hudFps) hudFps.textContent = currentFps.toFixed(1);
        }

        // Update Header HUD
        if (hudLatency) hudLatency.textContent = `${currentInferenceLatency} ms`;
        if (hudFrame) hudFrame.textContent = `#${frameIndex}`;

        if (detectionSuccess) {
          if (hudTrackingStatus) {
            hudTrackingStatus.textContent = "TRACKING";
            hudTrackingStatus.className = "hud-badge-status active";
          }
          if (trackingAlertBanner) trackingAlertBanner.hidden = true;

          // Draw Pose Overlay
          drawSkeletonOverlay(currentPoseLandmarks, canvasEl.width, canvasEl.height);

          // Compute Biomechanics
          const params = computeAllBiomechanicalParameters(currentPoseLandmarks, curTime, prevPoseForVel, prevTimeForVel);
          if (params) {
            updateParamCards(params);
            updateLiveCharts(curTime, params);

            // Update Framing Badge
            if (framingBadge) {
              if (params.framing === "OK") {
                framingBadge.innerHTML = `<span class="hud-dot green"></span> Full Body (OK)`;
              } else if (params.framing === "No-Feet") {
                framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Upper Body Only`;
              } else {
                framingBadge.innerHTML = `<span class="hud-dot red"></span> Partial Occlusion`;
              }
            }

            // Periodic Aggregated Log (every 30 frames ~1s)
            if (frameIndex % 30 === 0) {
              logEvent(
                "SUCCESS",
                "BIOMECH",
                `L-Knee: ${params.lKnee}° | R-Knee: ${params.rKnee}° | Spine: ${params.spine}° | GSI: ${params.gsi}`
              );
            }

            prevPoseForVel = currentPoseLandmarks;
            prevTimeForVel = curTime;
          }

          // Update 33-Landmark Inspector Table (throttled to every 3rd frame ~10Hz)
          if (frameIndex % 3 === 0) {
            updateLandmarkInspector(currentPoseLandmarks, currentWorldLandmarks);
          }
        } else {
          // Pose Lost
          if (hudTrackingStatus) {
            hudTrackingStatus.textContent = "NO_POSE";
            hudTrackingStatus.className = "hud-badge-status lost";
          }
          if (trackingAlertBanner) {
            trackingAlertBanner.hidden = false;
            if (trackingAlertText) trackingAlertText.textContent = "POSE LOST: Ensure full child body is visible";
          }
          ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
          if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot red"></span> Occluded`;
        }
      } else {
        // Redraw overlay when paused
        drawSkeletonOverlay(currentPoseLandmarks, canvasEl.width, canvasEl.height);
      }
    }

    animationFrameId = requestAnimationFrame(tick);
  }

  tick();
}

// ==========================================================================
// 8. Video Transport Controls (Play, Pause, Step, Restart)
// ==========================================================================
function setTransportEnabled(enabled) {
  if (btnPlayPause) btnPlayPause.disabled = !enabled;
  if (btnRestartVideo) btnRestartVideo.disabled = !enabled;
  if (btnStepBack) btnStepBack.disabled = !enabled;
  if (btnStepFwd) btnStepFwd.disabled = !enabled;
}

if (btnPlayPause) {
  btnPlayPause.addEventListener("click", () => {
    if (!videoEl.src && !videoEl.srcObject) return;
    if (videoEl.paused) {
      videoEl.play();
      isVideoPaused = false;
      btnPlayPause.textContent = "Pause";
      logEvent("INFO", "VIDEO", "Video playback resumed.");
    } else {
      videoEl.pause();
      isVideoPaused = true;
      btnPlayPause.textContent = "Play";
      logEvent("INFO", "VIDEO", "Video playback paused.");
    }
  });
}

if (btnRestartVideo) {
  btnRestartVideo.addEventListener("click", () => {
    if (!videoEl) return;
    videoEl.currentTime = 0;
    lastVideoTime = -1;
    mpTimestamp += 100;
    logEvent("INFO", "VIDEO", "Video rewound to start (0.00s).");
  });
}

if (btnStepBack) {
  btnStepBack.addEventListener("click", () => {
    if (!videoEl || !videoEl.paused) videoEl.pause();
    isVideoPaused = true;
    if (btnPlayPause) btnPlayPause.textContent = "Play";
    videoEl.currentTime = Math.max(0, videoEl.currentTime - (1 / 30));
    logEvent("INFO", "VIDEO", `Stepped back 1 frame to ${videoEl.currentTime.toFixed(3)}s`);
  });
}

if (btnStepFwd) {
  btnStepFwd.addEventListener("click", () => {
    if (!videoEl || !videoEl.paused) videoEl.pause();
    isVideoPaused = true;
    if (btnPlayPause) btnPlayPause.textContent = "Play";
    videoEl.currentTime = Math.min(videoEl.duration || 100, videoEl.currentTime + (1 / 30));
    logEvent("INFO", "VIDEO", `Stepped forward 1 frame to ${videoEl.currentTime.toFixed(3)}s`);
  });
}

// ==========================================================================
// 9. Input Sources (Live Camera, Upload File, Demo Video)
// ==========================================================================
function stopEverything() {
  if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  isRecording = false;
  isReplaying = false;
  currentPoseLandmarks = null;
  currentWorldLandmarks = null;
  setTransportEnabled(false);
}

// Live Camera
if (startCamBtn) {
  startCamBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (videoStatus) videoStatus.textContent = "Camera requires HTTPS or localhost.";
      logEvent("ERROR", "VIDEO", "getUserMedia not supported on non-secure context.");
      return;
    }

    try {
      stopEverything();
      if (videoStatus) videoStatus.textContent = "Accessing camera...";
      logEvent("INFO", "VIDEO", "Requesting user media (video stream)...");

      if (viewportWrap) viewportWrap.classList.add("selfie-mirrored");

      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 854 }, facingMode: "user" },
        audio: false,
      });

      videoEl.srcObject = cameraStream;
      videoEl.loop = false;
      await videoEl.play();

      if (streamSourceTag) streamSourceTag.textContent = "WEBCAM";
      if (startRecordBtn) startRecordBtn.disabled = false;
      if (stopRecordBtn) stopRecordBtn.disabled = false;
      if (videoStatus) videoStatus.textContent = "Live camera active. 33-landmark pose tracking running.";
      logEvent("SUCCESS", "VIDEO", "Webcam feed started (mirrored for selfie perspective).");

      startTrackingLoop();
    } catch (err) {
      if (videoStatus) videoStatus.textContent = `Camera error: ${err.message}`;
      logEvent("ERROR", "VIDEO", `Camera access failed: ${err.message}`);
    }
  });
}

// Uploaded Video
function handleVideoFile(file) {
  if (!file) return;
  stopEverything();

  if (viewportWrap) viewportWrap.classList.remove("selfie-mirrored");

  videoEl.srcObject = null;
  videoEl.src = URL.createObjectURL(file);
  videoEl.loop = true;
  videoEl.muted = true;

  videoEl.play().then(() => {
    setTransportEnabled(true);
    if (btnPlayPause) btnPlayPause.textContent = "Pause";
    if (streamSourceTag) streamSourceTag.textContent = "FILE";
    if (startRecordBtn) startRecordBtn.disabled = false;
    if (stopRecordBtn) stopRecordBtn.disabled = false;
    if (videoStatus) videoStatus.textContent = `Loaded "${file.name}". Tracking active.`;
    logEvent("SUCCESS", "VIDEO", `Loaded video file: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    startTrackingLoop();
  }).catch(e => {
    if (videoStatus) videoStatus.textContent = `Video error: ${e.message}`;
    logEvent("ERROR", "VIDEO", `Failed to play uploaded video: ${e.message}`);
  });
}

if (videoFileInputAlt) {
  videoFileInputAlt.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));
}

// Demo Video
async function runDemo() {
  stopEverything();
  if (viewportWrap) viewportWrap.classList.remove("selfie-mirrored");

  if (videoStatus) videoStatus.textContent = "Loading demo video and AI model...";
  logEvent("INFO", "SYSTEM", "Loading benchmark tutorial_walking.mp4...");

  if (!poseLandmarker) await initMediaPipe();

  videoEl.srcObject = null;
  videoEl.src = "assets/tutorial_walking.mp4";
  videoEl.loop = true;
  videoEl.muted = true;

  try {
    await videoEl.play();
  } catch (e) {
    if (videoStatus) videoStatus.textContent = "Could not play demo video: " + e.message;
    logEvent("ERROR", "VIDEO", `Demo video playback failed: ${e.message}`);
    return;
  }

  setTransportEnabled(true);
  if (btnPlayPause) btnPlayPause.textContent = "Pause";
  if (streamSourceTag) streamSourceTag.textContent = "DEMO";
  if (startRecordBtn) startRecordBtn.disabled = false;
  if (stopRecordBtn) stopRecordBtn.disabled = false;
  if (videoStatus) videoStatus.textContent = "Live AI tracking active on walking gait demo.";
  logEvent("SUCCESS", "VIDEO", "Demo video active. Running 33-landmark inference in real time.");

  startTrackingLoop();
}

if (runDemoBtn) runDemoBtn.addEventListener("click", runDemo);

// ==========================================================================
// 10. Recording Session & Synchronized Replay
// ==========================================================================
function startRecordingSession() {
  if (isRecording) return;
  isRecording = true;
  recordedSession = [];
  sessionStartTime = performance.now();

  if (timerBadge) timerBadge.hidden = false;
  if (startRecordBtn) startRecordBtn.disabled = true;
  if (btnReplaySession) btnReplaySession.disabled = true;
  if (mathBreakdownCard) mathBreakdownCard.hidden = true;

  logEvent("INFO", "SYSTEM", `Starting 120-frame telemetry recording at ${TARGET_FPS} FPS...`);

  sampleTimer = setInterval(() => {
    const elapsed = (performance.now() - sessionStartTime) / 1000.0;
    const remain = Math.max(0, SESSION_DURATION_SEC - elapsed);

    if (countdownText) countdownText.textContent = `${remain.toFixed(1)}s`;
    if (frameCountText) frameCountText.textContent = `${recordedSession.length}/${TARGET_FRAMES}`;

    if (currentWorldLandmarks && currentWorldLandmarks.length >= 33) {
      recordedSession.push({
        timestamp_ms: Math.round(elapsed * 1000),
        videoTime: videoEl.currentTime || elapsed,
        pose_world_landmarks: currentWorldLandmarks.map(lm => ({
          x: Number(lm.x.toFixed(4)),
          y: Number(lm.y.toFixed(4)),
          z: Number((lm.z || 0).toFixed(4)),
          visibility: Number((lm.visibility ?? 1).toFixed(2)),
        })),
        pose_normalized_landmarks: currentPoseLandmarks.map(lm => ({
          x: Number(lm.x.toFixed(4)),
          y: Number(lm.y.toFixed(4)),
          z: Number((lm.z || 0).toFixed(4)),
          visibility: Number((lm.visibility ?? 1).toFixed(2)),
        })),
        face_metrics: currentFaceMetrics || { head_yaw: 0, face_detected: true },
      });
    }

    if (elapsed >= SESSION_DURATION_SEC || recordedSession.length >= TARGET_FRAMES) {
      finishRecordingSession();
    }
  }, 1000 / TARGET_FPS);
}

async function finishRecordingSession() {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  if (timerBadge) timerBadge.hidden = true;
  if (startRecordBtn) startRecordBtn.disabled = false;
  if (btnReplaySession) btnReplaySession.disabled = (recordedSession.length === 0);

  logEvent("SUCCESS", "SYSTEM", `Recording finished: ${recordedSession.length} frames captured.`);

  // Initialize Timeline Scrubber with recorded frames
  if (sessionTimelineSlider && recordedSession.length > 0) {
    sessionTimelineSlider.disabled = false;
    sessionTimelineSlider.min = 0;
    sessionTimelineSlider.max = recordedSession.length - 1;
    sessionTimelineSlider.value = 0;
    if (btnTimelinePlay) btnTimelinePlay.disabled = false;
    if (btnTimelineStepPrev) btnTimelineStepPrev.disabled = false;
    if (btnTimelineStepNext) btnTimelineStepNext.disabled = false;
  }

  // Submit to Backend for Biomechanical Stage 1 & 2 Analysis
  if (videoStatus) videoStatus.textContent = `Transmitting ${recordedSession.length} frames to backend analyzer...`;
  logEvent("INFO", "BACKEND", `POST /analyze-video-landmarks with ${recordedSession.length} coordinate frames...`);

  const payload = {
    child_age_months: parseInt(childAgeInput?.value, 10) || 24,
    task_type: "walking_gait",
    fps: TARGET_FPS,
    frames: recordedSession.map(f => ({
      timestamp_ms: f.timestamp_ms,
      pose_world_landmarks: f.pose_world_landmarks,
      face_metrics: f.face_metrics,
    })),
  };

  try {
    const res = await fetch(`${API_URL}/analyze-video-landmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Analysis failed");

    logEvent("SUCCESS", "BACKEND", `Analysis complete. Screening Status: ${data.screening_status}`);
    showResultsCard(data);
    if (videoStatus) videoStatus.textContent = "Biomechanical screening analysis complete. See results below.";
  } catch (err) {
    logEvent("ERROR", "BACKEND", `Backend error: ${err.message}`);
    if (videoStatus) videoStatus.textContent = "Backend error: " + err.message;
  }
}

if (startRecordBtn) startRecordBtn.addEventListener("click", startRecordingSession);

if (stopRecordBtn) {
  stopRecordBtn.addEventListener("click", () => {
    stopEverything();
    if (timerBadge) timerBadge.hidden = true;
    if (startRecordBtn) startRecordBtn.disabled = false;
    if (videoStatus) videoStatus.textContent = "Session reset.";
    logEvent("INFO", "SYSTEM", "Session reset.");
  });
}

// Synchronized Replay on Timeline Scrub
function renderReplayFrame(idx) {
  if (!recordedSession || idx < 0 || idx >= recordedSession.length) return;
  replayIndex = idx;
  const frameData = recordedSession[idx];

  // Update Scrubber Slider
  if (sessionTimelineSlider) sessionTimelineSlider.value = idx;
  if (replayTimeDisplay) {
    const totalSec = (recordedSession[recordedSession.length - 1].timestamp_ms / 1000).toFixed(2);
    const curSec = (frameData.timestamp_ms / 1000).toFixed(2);
    replayTimeDisplay.textContent = `${curSec}s / ${totalSec}s`;
  }
  if (replayFrameDisplay) replayFrameDisplay.textContent = `Frame ${idx + 1} / ${recordedSession.length}`;

  // Pause video and sync timestamp
  if (videoEl && !isNaN(frameData.videoTime)) {
    videoEl.currentTime = frameData.videoTime;
  }

  // Draw Recorded Skeleton Overlay
  const lms = frameData.pose_normalized_landmarks;
  const wlms = frameData.pose_world_landmarks;
  drawSkeletonOverlay(lms, canvasEl.width, canvasEl.height);

  // Update Inspector Table
  updateLandmarkInspector(lms, wlms);

  // Compute and show parameters for this specific frame
  const p = computeAllBiomechanicalParameters(lms, frameData.timestamp_ms / 1000);
  if (p) updateParamCards(p);
}

if (sessionTimelineSlider) {
  sessionTimelineSlider.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    renderReplayFrame(idx);
  });
}

if (btnTimelinePlay) {
  btnTimelinePlay.addEventListener("click", () => {
    if (isReplaying) {
      clearInterval(replayTimer);
      isReplaying = false;
      btnTimelinePlay.textContent = "Play Replay";
    } else {
      isReplaying = true;
      btnTimelinePlay.textContent = "Pause Replay";
      replayTimer = setInterval(() => {
        replayIndex++;
        if (replayIndex >= recordedSession.length) replayIndex = 0;
        renderReplayFrame(replayIndex);
      }, 1000 / TARGET_FPS);
    }
  });
}

if (btnTimelineStepPrev) {
  btnTimelineStepPrev.addEventListener("click", () => {
    renderReplayFrame(Math.max(0, replayIndex - 1));
  });
}

if (btnTimelineStepNext) {
  btnTimelineStepNext.addEventListener("click", () => {
    renderReplayFrame(Math.min(recordedSession.length - 1, replayIndex + 1));
  });
}

if (btnReplaySession) {
  btnReplaySession.addEventListener("click", () => {
    if (recordedSession.length === 0) return;
    renderReplayFrame(0);
    sessionTimelineSlider.scrollIntoView({ behavior: "smooth" });
  });
}

// ==========================================================================
// 11. Results Display (Stage 1 & Stage 2 Screening Report)
// ==========================================================================
function showResultsCard(data) {
  if (!mathBreakdownCard || !mathStepsList) return;

  const st = data.screening_status || "YELLOW";
  mathBreakdownCard.hidden = false;
  if (mathStatusBadge) {
    mathStatusBadge.className = `badge-status ${st}`;
    mathStatusBadge.textContent = st;
  }

  const m = data.metrics || {};
  const gsi = m.gait_symmetry_index ?? 1.0;
  const spine = m.mean_spine_tilt_deg ?? 0;
  const lk = m.mean_left_knee_deg ?? 170;
  const rk = m.mean_right_knee_deg ?? 170;
  const limb = m.knee_ankle_ratio ?? 0;

  let verdict;
  if (gsi >= 0.85) {
    verdict = `<span style="color:#34D399;">GREEN (Normal Baseline):</span> Gait Symmetry Index ${gsi} >= 0.85. Stride timing is bilateral and symmetric.`;
  } else if (gsi >= 0.70) {
    verdict = `<span style="color:#FBBF24;">YELLOW (Mild Asymmetry):</span> Gait Symmetry Index ${gsi} in 0.70-0.84 range. Slight stride favor observed.`;
  } else {
    verdict = `<span style="color:#F87171;">RED (Pronounced Asymmetry):</span> Gait Symmetry Index ${gsi} < 0.70. High risk for antalgic limp, mild hemiplegia, or hip dysplasia.`;
  }

  mathStepsList.innerHTML = `
    <div class="math-step-item">
      <strong>1. Stage 1 Invariant Normalization (NumPy)</strong><br>
      Coordinate origin shifted to Mid-Hip $H_{\\text{mid}} = \\frac{P_{23}+P_{24}}{2} = (0,0,0)$. Scale normalized by Torso Length $L_{\\text{torso}} = \\|S_{\\text{mid}} - H_{\\text{mid}}\\|$. ${data.frames_analyzed || recordedSession.length} frames normalized.
    </div>
    <div class="math-step-item">
      <strong>2. Joint Angles &amp; Posture (3D arccos dot-product)</strong><br>
      Left Knee Mean: <strong>${lk}°</strong> | Right Knee Mean: <strong>${rk}°</strong> | Coronal Spine Tilt: <strong>${spine}°</strong> (Normal baseline &le; 12.0°)
    </div>
    <div class="math-step-item">
      <strong>3. Gait Symmetry Index (GSI)</strong><br>
      Ankle separation time-series analyzed at 80th-percentile strides: $\\text{GSI} = \\frac{\\min(S_L, S_R)}{\\max(S_L, S_R)} = $ <strong>${gsi}</strong>
    </div>
    <div class="math-step-item">
      <strong>4. Lower-Limb Alignment Ratio</strong><br>
      Knee vs Ankle spacing: <strong>${limb > 0 ? "+" : ""}${limb}</strong> (${limb > 0 ? "Varum/Bowed" : "Valgum/Knock-knees"})
    </div>
    <div class="math-step-item">
      <strong>5. Screening Status &amp; Recommendations</strong><br>
      ${verdict}<br>
      <em>Advice:</em> ${data.advice || "Routine pediatrician checkups recommended."}
    </div>
    <div class="math-step-item">
      <strong>6. Actionable Clinical Risk Flags</strong><br>
      ${(data.clinical_flags && data.clinical_flags.length > 0)
        ? data.clinical_flags.map(f => `&bull; ${f}`).join("<br>")
        : "&bull; No clinical abnormalities flagged across lower-limb biomechanics."}
    </div>
  `;

  mathBreakdownCard.scrollIntoView({ behavior: "smooth" });
}

// ==========================================================================
// 12. Skin & Eye Classifiers (Preserved Modules)
// ==========================================================================
document.querySelectorAll(".card[data-endpoint]").forEach(setupClassifierCard);

function setupClassifierCard(card) {
  const endpoint = card.dataset.endpoint;
  const uploadBox = card.querySelector(".upload-box");
  const fileInput = card.querySelector(".file-input");
  const previewImage = card.querySelector(".preview-image");
  const predictBtn = card.querySelector(".predict-btn");
  const statusText = card.querySelector(".status");

  const resultPanel = card.querySelector(".result-panel");
  const statusBanner = card.querySelector(".status-banner");
  const statusTitle = card.querySelector(".status-title");
  const predictionText = card.querySelector(".prediction-text");
  const adviceText = card.querySelector(".advice-text");
  const barCanvas = card.querySelector(".bar-canvas");
  const doughnutCanvas = card.querySelector(".doughnut-canvas");

  const uploadView = card.querySelector(".mode-upload-view");
  const cameraView = card.querySelector(".mode-camera-view");
  const modeTabs = card.querySelectorAll(".mode-tab-btn");

  const camFeed = card.querySelector(".cam-feed");
  const camSnapCanvas = card.querySelector(".cam-snap-canvas");
  const btnOpenCam = card.querySelector(".btn-open-cam");
  const btnSnapPhoto = card.querySelector(".btn-snap-photo");

  let selectedFile = null;
  let previewUrl = null;
  let barChart = null;
  let doughnutChart = null;
  let activeCamStream = null;

  function setStatus(msg, isError = false) {
    if (!statusText) return;
    statusText.textContent = msg;
    statusText.classList.toggle("error", isError);
  }

  function handleFile(file) {
    selectedFile = file || null;
    if (resultPanel) resultPanel.hidden = true;
    setStatus("");
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (!selectedFile) {
      if (previewImage) previewImage.style.display = "none";
      if (predictBtn) predictBtn.disabled = true;
      return;
    }
    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      selectedFile = null;
      if (previewImage) previewImage.style.display = "none";
      if (predictBtn) predictBtn.disabled = true;
      setStatus("Please choose a JPG or PNG image.", true);
      return;
    }
    previewUrl = URL.createObjectURL(selectedFile);
    if (previewImage) { previewImage.src = previewUrl; previewImage.style.display = "inline-block"; }
    if (predictBtn) predictBtn.disabled = false;
  }

  if (fileInput) fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  if (uploadBox) {
    uploadBox.addEventListener("dragover", (e) => { e.preventDefault(); uploadBox.classList.add("dragover"); });
    uploadBox.addEventListener("dragleave", (e) => { e.preventDefault(); uploadBox.classList.remove("dragover"); });
    uploadBox.addEventListener("drop", (e) => {
      e.preventDefault(); uploadBox.classList.remove("dragover");
      if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
    });
  }

  function stopCam() {
    if (activeCamStream) { activeCamStream.getTracks().forEach(t => t.stop()); activeCamStream = null; }
    if (camFeed) camFeed.srcObject = null;
    if (btnSnapPhoto) btnSnapPhoto.disabled = true;
    if (btnOpenCam) btnOpenCam.textContent = "Start Camera";
  }

  async function startCam() {
    stopCam();
    try {
      activeCamStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      if (camFeed) { camFeed.srcObject = activeCamStream; await camFeed.play(); }
      if (btnSnapPhoto) btnSnapPhoto.disabled = false;
      if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
    } catch (e) {
      try {
        activeCamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (camFeed) { camFeed.srcObject = activeCamStream; await camFeed.play(); }
        if (btnSnapPhoto) btnSnapPhoto.disabled = false;
        if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
      } catch (err) { setStatus("Camera not accessible.", true); }
    }
  }

  if (btnOpenCam) btnOpenCam.addEventListener("click", () => { activeCamStream ? stopCam() : startCam(); });

  if (btnSnapPhoto) {
    btnSnapPhoto.addEventListener("click", () => {
      if (!camFeed || !activeCamStream) return;
      const snap = camSnapCanvas || document.createElement("canvas");
      snap.width = camFeed.videoWidth || 640;
      snap.height = camFeed.videoHeight || 480;
      snap.getContext("2d").drawImage(camFeed, 0, 0, snap.width, snap.height);
      snap.toBlob((blob) => {
        if (!blob) return;
        handleFile(new File([blob], `snap_${Date.now()}.jpg`, { type: "image/jpeg" }));
        stopCam();
        modeTabs.forEach(b => b.classList.toggle("active", b.dataset.mode === "upload"));
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";
      }, "image/jpeg", 0.92);
    });
  }

  modeTabs.forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      const mode = tabBtn.dataset.mode;
      modeTabs.forEach(b => b.classList.toggle("active", b === tabBtn));
      if (mode === "upload") {
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";
        stopCam();
      } else {
        if (uploadView) uploadView.style.display = "none";
        if (cameraView) cameraView.style.display = "block";
        startCam();
      }
    });
  });

  if (predictBtn) {
    predictBtn.addEventListener("click", async () => {
      if (!selectedFile) return;
      const formData = new FormData();
      formData.append("file", selectedFile);
      predictBtn.disabled = true;
      predictBtn.textContent = "Analyzing...";
      setStatus("");

      try {
        const response = await fetch(`${API_URL}${endpoint}`, { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Failed");

        if (statusBanner) statusBanner.className = `result-banner status-banner ${data.screening_status}`;
        if (statusTitle) statusTitle.textContent = `Status: ${data.screening_status}`;
        if (predictionText) predictionText.textContent = `Detected: ${data.predicted_class} (${Number(data.confidence).toFixed(1)}%)`;
        if (adviceText) adviceText.textContent = data.advice;
        if (resultPanel) resultPanel.hidden = false;

        if (typeof Chart !== "undefined" && barCanvas && doughnutCanvas) {
          const sorted = Object.entries(data.all_predictions).sort((a, b) => b[1] - a[1]);
          const labels = sorted.map(([n]) => n);
          const values = sorted.map(([, s]) => Number(s));
          const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

          if (barChart) barChart.destroy();
          if (doughnutChart) doughnutChart.destroy();

          barChart = new Chart(barCanvas, {
            type: "bar",
            data: { labels, datasets: [{ label: "Confidence (%)", data: values, backgroundColor: colors }] },
            options: {
              indexAxis: "y",
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: "#94A3B8" }, grid: { color: "rgba(255,255,255,0.05)" } },
                y: { ticks: { color: "#E2E8F0" }, grid: { color: "rgba(255,255,255,0.05)" } },
              }
            }
          });

          doughnutChart = new Chart(doughnutCanvas, {
            type: "doughnut",
            data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: "right", labels: { color: "#CBD5E1" } } }
            }
          });
        }
        setStatus("Analysis complete.");
      } catch (err) {
        setStatus(err.message, true);
      } finally {
        predictBtn.disabled = !selectedFile;
        predictBtn.textContent = "Analyze";
      }
    });
  }
}

// Demo photo loader for skin/eye
document.querySelectorAll(".demo-load-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = btn.dataset.target;
    const card = document.querySelector(`.card-${target}`);
    if (!card) return;
    try {
      const resp = await fetch(`assets/demo_${target}.jpg`);
      const blob = await resp.blob();
      const file = new File([blob], `demo_${target}.jpg`, { type: "image/jpeg" });
      const fi = card.querySelector(".file-input");
      const dt = new DataTransfer();
      dt.items.add(file);
      fi.files = dt.files;
      fi.dispatchEvent(new Event("change"));
      const uploadModeBtn = card.querySelector('[data-mode="upload"]');
      if (uploadModeBtn) uploadModeBtn.click();
      setTimeout(() => {
        const pb = card.querySelector(".predict-btn");
        if (pb && !pb.disabled) pb.click();
      }, 350);
    } catch (e) { console.error(e); }
  });
});

// Initialize Chart.js on page ready
window.addEventListener("DOMContentLoaded", () => {
  initCharts();
  logEvent("INFO", "SYSTEM", "Real-Time Biomechanical Dashboard loaded and ready.");
});
