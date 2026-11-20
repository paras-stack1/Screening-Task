// ============================================================
// Nanhe Kadam - RBSK 2.0 Pediatric Biomechanical Screening
// Real-Time Pose Tracking & Biomechanical Monitoring Dashboard
// Incorporating: Pose-Track, Google MediaPipe Vision, and berad217
// ============================================================

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

// ============================================================
// Complete 33 MediaPipe Landmark Registry
// ============================================================
const LANDMARK_REGISTRY = [
  { id: 0,  name: "nose",             side: "center", category: "face" },
  { id: 1,  name: "left_eye_inner",    side: "left",   category: "face" },
  { id: 2,  name: "left_eye",          side: "left",   category: "face" },
  { id: 3,  name: "left_eye_outer",    side: "left",   category: "face" },
  { id: 4,  name: "right_eye_inner",   side: "right",  category: "face" },
  { id: 5,  name: "right_eye",         side: "right",  category: "face" },
  { id: 6,  name: "right_eye_outer",   side: "right",  category: "face" },
  { id: 7,  name: "left_ear",          side: "left",   category: "face" },
  { id: 8,  name: "right_ear",         side: "right",  category: "face" },
  { id: 9,  name: "mouth_left",        side: "left",   category: "face" },
  { id: 10, name: "mouth_right",       side: "right",  category: "face" },
  { id: 11, name: "left_shoulder",     side: "left",   category: "upper" },
  { id: 12, name: "right_shoulder",    side: "right",  category: "upper" },
  { id: 13, name: "left_elbow",        side: "left",   category: "arms" },
  { id: 14, name: "right_elbow",       side: "right",  category: "arms" },
  { id: 15, name: "left_wrist",        side: "left",   category: "arms" },
  { id: 16, name: "right_wrist",       side: "right",  category: "arms" },
  { id: 17, name: "left_pinky",        side: "left",   category: "arms" },
  { id: 18, name: "right_pinky",       side: "right",  category: "arms" },
  { id: 19, name: "left_index",        side: "left",   category: "arms" },
  { id: 20, name: "right_index",       side: "right",  category: "arms" },
  { id: 21, name: "left_thumb",        side: "left",   category: "arms" },
  { id: 22, name: "right_thumb",       side: "right",  category: "arms" },
  { id: 23, name: "left_hip",          side: "left",   category: "upper" },
  { id: 24, name: "right_hip",         side: "right",  category: "upper" },
  { id: 25, name: "left_knee",         side: "left",   category: "lower" },
  { id: 26, name: "right_knee",        side: "right",  category: "lower" },
  { id: 27, name: "left_ankle",        side: "left",   category: "lower" },
  { id: 28, name: "right_ankle",       side: "right",  category: "lower" },
  { id: 29, name: "left_heel",         side: "left",   category: "lower" },
  { id: 30, name: "right_heel",        side: "right",  category: "lower" },
  { id: 31, name: "left_foot_index",   side: "left",   category: "lower" },
  { id: 32, name: "right_foot_index",  side: "right",  category: "lower" },
];

// Pose-Track 35 Anatomical Connections (including Foot Triangles)
const SKELETON_CONNECTIONS = [
  // Torso box
  { a: 11, b: 12, side: "center" },
  { a: 11, b: 23, side: "left" },
  { a: 12, b: 24, side: "right" },
  { a: 23, b: 24, side: "center" },
  // Left arm
  { a: 11, b: 13, side: "left" },
  { a: 13, b: 15, side: "left" },
  { a: 15, b: 17, side: "left" },
  { a: 15, b: 19, side: "left" },
  { a: 15, b: 21, side: "left" },
  { a: 17, b: 19, side: "left" },
  // Right arm
  { a: 12, b: 14, side: "right" },
  { a: 14, b: 16, side: "right" },
  { a: 16, b: 18, side: "right" },
  { a: 16, b: 20, side: "right" },
  { a: 16, b: 22, side: "right" },
  { a: 18, b: 20, side: "right" },
  // Left leg
  { a: 23, b: 25, side: "left" },
  { a: 25, b: 27, side: "left" },
  // Right leg
  { a: 24, b: 26, side: "right" },
  { a: 26, b: 28, side: "right" },
  // Left foot triangle (Pose-Track)
  { a: 27, b: 29, side: "left" },
  { a: 29, b: 31, side: "left" },
  { a: 31, b: 27, side: "left" },
  // Right foot triangle (Pose-Track)
  { a: 28, b: 30, side: "right" },
  { a: 30, b: 32, side: "right" },
  { a: 32, b: 28, side: "right" },
  // Face
  { a: 0, b: 1, side: "left" },
  { a: 1, b: 2, side: "left" },
  { a: 2, b: 3, side: "left" },
  { a: 3, b: 7, side: "left" },
  { a: 0, b: 4, side: "right" },
  { a: 4, b: 5, side: "right" },
  { a: 5, b: 6, side: "right" },
  { a: 6, b: 8, side: "right" },
  { a: 9, b: 10, side: "center" },
];

function getSideColor(side) {
  if (side === "left") return "#F59E0B";   // Warm Amber (Left)
  if (side === "right") return "#38BDF8";  // Sky Blue (Right)
  return "#10B981";                        // Mint Green (Center / Midline)
}

// ============================================================
// 1. Language Toggle (EN / Hindi)
// ============================================================
const I18N = {
  en: {
    brand_sub: "RBSK 2.0 Aligned · Pediatric Biomechanical Screening",
    status_ready: "Offline Ready",
    tab_walking: "Walking Gait Analysis (चाल जाँच)",
    tab_skin: "Skin Condition (त्वचा)",
    tab_eye: "Eye Condition (नेत्र)",
    label_age: "Child Age (Months):",
    label_task: "Screening Task:",
    btn_start_cam: "Start Live Camera",
    btn_upload_video: "Upload Video File",
    btn_run_demo: "Run Walking Demo",
    btn_record: "Record Session",
    btn_reset: "Reset",
    viewport_title: "Live 9:16 Vision Stream",
    btn_markers_on: "Markers: Active",
    btn_markers_off: "Markers: Off",
    guide_head: "HEAD TARGET",
    guide_shoulders: "SHOULDERS",
    guide_feet: "FEET / ANKLES",
    status_waiting: "Waiting for Input...",
    status_ready_prompt: "Camera ready. Start camera or select a video to begin tracking.",
    kpi_framing: "Framing",
    kpi_spine: "Spine Tilt",
    kpi_lknee: "L-Knee Angle",
    kpi_rknee: "R-Knee Angle",
    kpi_gsi: "Gait Symmetry (GSI)",
    kpi_yaw: "Head Yaw / Gaze",
    subtab_stream: "Telemetry Stream",
    subtab_inspector: "33-Landmarks Inspector",
    subtab_charts: "Real-Time Kinematics",
    log_stream_title: "Per-Second Telemetry Stream (Live Measurements)",
    btn_copy_json: "Copy JSON",
    th_sec: "Sec",
    th_frame: "Frame",
    th_lknee: "L-Knee",
    th_rknee: "R-Knee",
    th_spine: "Spine",
    th_sep: "Ankle Sep (s)",
    th_torso: "Torso (px)",
    th_status: "Framing",
    empty_log: "Live telemetry data will stream here second-by-second...",
    math_title: "Biomechanical Decision Calculation & Risk Flags",
  },
  hi: {
    brand_sub: "RBSK 2.0 - बाल गतिशीलता व स्वास्थ्य जाँच",
    status_ready: "ऑफ़लाइन चालू",
    tab_walking: "चलने की चाल जाँच",
    tab_skin: "त्वचा स्थिति",
    tab_eye: "नेत्र स्थिति",
    label_age: "बच्चे की उम्र (महीने):",
    label_task: "जाँच का प्रकार:",
    btn_start_cam: "कैमरा शुरू करें",
    btn_upload_video: "वीडियो अपलोड करें",
    btn_run_demo: "डेमो वीडियो चलाएं",
    btn_record: "रिकॉर्ड करें",
    btn_reset: "रीसेट करें",
    viewport_title: "लाइव 9:16 विज़न स्ट्रीम",
    btn_markers_on: "मार्कर: चालू",
    btn_markers_off: "मार्कर: बंद",
    guide_head: "सिर",
    guide_shoulders: "कंधे",
    guide_feet: "पैर / टखने",
    status_waiting: "प्रतीक्षा...",
    status_ready_prompt: "तैयार। कैमरा शुरू करें या वीडियो चुनें।",
    kpi_framing: "फ्रेमिंग",
    kpi_spine: "रीढ़ का झुकाव",
    kpi_lknee: "बायाँ घुटना",
    kpi_rknee: "दायाँ घुटना",
    kpi_gsi: "कदम सममिति (GSI)",
    kpi_yaw: "सिर का कोण",
    subtab_stream: "टेलीमेट्री स्ट्रीम",
    subtab_inspector: "33 लैंडमार्क निरीक्षक",
    subtab_charts: "रीयल-टाइम काइनेमेटिक्स",
    log_stream_title: "प्रति-सेकंड लाइव टेलीमेट्री स्ट्रीम",
    btn_copy_json: "JSON कॉपी करें",
    th_sec: "समय",
    th_frame: "फ्रेम",
    th_lknee: "बायाँ घुटना",
    th_rknee: "दायाँ घुटना",
    th_spine: "रीढ़",
    th_sep: "कदम दूरी",
    th_torso: "धड़ (px)",
    th_status: "स्थिति",
    empty_log: "टेलीमेट्री डेटा यहाँ दर्ज होगा...",
    math_title: "गणितीय निर्णय गणना एवं जोखिम संकेत",
  }
};

let currentLang = localStorage.getItem("nanhe_lang") || "en";

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem("nanhe_lang", lang);
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
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
  langToggleBtn.addEventListener("click", () => {
    setLanguage(currentLang === "en" ? "hi" : "en");
  });
}
setLanguage(currentLang);

// ============================================================
// 2. Tab Switching (Walking Gait / Skin / Eye)
// ============================================================
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

// ============================================================
// 3. DOM References
// ============================================================
const videoEl = document.getElementById("webcamVideo");
const canvasEl = document.getElementById("skeletonCanvas");
const viewportWrap = document.querySelector(".video-viewport-wrap");
const ctx = canvasEl.getContext("2d");

const startCamBtn = document.getElementById("startCamBtn");
const videoFileInputAlt = document.getElementById("videoFileInputAlt");
const runDemoBtn = document.getElementById("runDemoBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const restartVideoBtn = document.getElementById("restartVideoBtn");
const toggleLabelsBtn = document.getElementById("toggleLabelsBtn");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const videoStatus = document.getElementById("videoStatus");

const framingBadge = document.getElementById("framingBadge");
const timerBadge = document.getElementById("timerBadge");
const countdownText = document.getElementById("countdownText");
const frameCountText = document.getElementById("frameCountText");
const fpsText = document.getElementById("fpsText");
const latencyText = document.getElementById("latencyText");

const teleFraming = document.getElementById("teleFraming");
const teleSpine = document.getElementById("teleSpine");
const teleLKnee = document.getElementById("teleLKnee");
const teleRKnee = document.getElementById("teleRKnee");
const teleGSI = document.getElementById("teleGSI");
const teleYaw = document.getElementById("teleYaw");

const childAgeInput = document.getElementById("childAgeInput");
const toggleMarkersBtn = document.getElementById("toggleMarkersBtn");
const cameraGuideFrame = document.getElementById("cameraGuideFrame");

// Subtabs elements
const subtabBtns = document.querySelectorAll(".subtab-btn");
const subtabPanels = document.querySelectorAll(".subtab-panel");

// Landmark Inspector elements
const landmarkSearch = document.getElementById("landmarkSearch");
const filterChips = document.querySelectorAll(".filter-chips .chip:not(.clear-chip)");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const inspectorTableBody = document.getElementById("inspectorTableBody");

// Kinematics Chart elements
const kinematicsCanvas = document.getElementById("kinematicsCanvas");
const chartStatLKnee = document.getElementById("chartStatLKnee");
const chartStatRKnee = document.getElementById("chartStatRKnee");
const chartStatSpine = document.getElementById("chartStatSpine");
const chartStatDelta = document.getElementById("chartStatDelta");

const biLKnee = document.getElementById("biLKnee");
const biRKnee = document.getElementById("biRKnee");
const biLHip = document.getElementById("biLHip");
const biRHip = document.getElementById("biRHip");
const biLAnkle = document.getElementById("biLAnkle");
const biRAnkle = document.getElementById("biRAnkle");
const biKneeDiff = document.getElementById("biKneeDiff");
const biStatusText = document.getElementById("biStatusText");

// Telemetry stream & results
const telemetryTableBody = document.getElementById("telemetryTableBody");
const copyTelemetryBtn = document.getElementById("copyTelemetryBtn");
const mathBreakdownCard = document.getElementById("mathBreakdownCard");
const mathStatusBadge = document.getElementById("mathStatusBadge");
const mathStepsList = document.getElementById("mathStepsList");

// ============================================================
// 4. State Variables
// ============================================================
let cameraStream = null;
let poseLandmarker = null;
let faceLandmarker = null;
let isInitializingMP = false;
let animationFrameId = null;
let isRecording = false;
let sessionStartTime = null;
let capturedFrames = [];
let sampleTimer = null;
let showMarkers = true;
let showLandmarkLabels = false;

// Selected landmark for inspector highlight reticle
let selectedLandmarkIndex = null;
let categoryFilter = "all";

// Monotonically increasing timestamp for MediaPipe
let mpTimestamp = 1;
let lastVideoTime = -1;

// Performance metrics
let lastTickTime = performance.now();
let frameTimeWindow = [];
let lastInferenceDuration = 0;

// Kinematics history for rolling chart
const MAX_CHART_SAMPLES = 50;
const kinematicsHistory = {
  times: [],
  lKnee: [],
  rKnee: [],
  spine: []
};

// Tracking state
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;
let frameCounter = 0;
let allLogs = [];

const TARGET_FPS = 10.0;
const SESSION_DURATION_SEC = 12.0;
const TARGET_FRAMES = 120;

// ============================================================
// 5. Initialize Landmark Inspector Rows
// ============================================================
function initLandmarkInspector() {
  if (!inspectorTableBody) return;
  inspectorTableBody.innerHTML = "";

  LANDMARK_REGISTRY.forEach((lm) => {
    const tr = document.createElement("tr");
    tr.dataset.id = lm.id;
    tr.dataset.name = lm.name;
    tr.dataset.side = lm.side;
    tr.dataset.category = lm.category;

    const sideBadgeClass = lm.side === "left" ? "dot-left" : lm.side === "right" ? "dot-right" : "dot-center";
    const sideName = lm.side.toUpperCase();

    tr.innerHTML = `
      <td><strong>#${lm.id}</strong></td>
      <td>${lm.name}</td>
      <td><span class="side-badge"><span class="side-dot ${sideBadgeClass}"></span>${sideName}</span></td>
      <td class="cell-x">--</td>
      <td class="cell-y">--</td>
      <td class="cell-z">--</td>
      <td class="cell-vis">--%</td>
    `;

    tr.addEventListener("click", () => {
      if (selectedLandmarkIndex === lm.id) {
        selectedLandmarkIndex = null;
      } else {
        selectedLandmarkIndex = lm.id;
      }
      updateInspectorSelectionUI();
    });

    inspectorTableBody.appendChild(tr);
  });
}

function updateInspectorSelectionUI() {
  const rows = inspectorTableBody?.querySelectorAll("tr") || [];
  rows.forEach((tr) => {
    const id = parseInt(tr.dataset.id, 10);
    tr.classList.toggle("selected", id === selectedLandmarkIndex);
  });
  if (clearSelectionBtn) {
    clearSelectionBtn.style.display = selectedLandmarkIndex !== null ? "inline-block" : "none";
  }
}

if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", () => {
    selectedLandmarkIndex = null;
    updateInspectorSelectionUI();
  });
}

function applyInspectorFilter() {
  const query = (landmarkSearch?.value || "").toLowerCase().trim();
  const rows = inspectorTableBody?.querySelectorAll("tr") || [];
  rows.forEach((tr) => {
    const id = tr.dataset.id;
    const name = tr.dataset.name;
    const cat = tr.dataset.category;
    const matchesSearch = !query || name.includes(query) || id.includes(query);
    const matchesCat = categoryFilter === "all" || cat === categoryFilter;
    tr.style.display = (matchesSearch && matchesCat) ? "" : "none";
  });
}

if (landmarkSearch) {
  landmarkSearch.addEventListener("input", applyInspectorFilter);
}

filterChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    filterChips.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    categoryFilter = chip.dataset.filter;
    applyInspectorFilter();
  });
});

// Update Inspector Row Values
function updateInspectorValues(landmarks) {
  if (!landmarks || landmarks.length < 33 || !inspectorTableBody) return;
  const rows = inspectorTableBody.querySelectorAll("tr");
  rows.forEach((tr) => {
    const id = parseInt(tr.dataset.id, 10);
    const p = landmarks[id];
    if (!p) return;

    const cellX = tr.querySelector(".cell-x");
    const cellY = tr.querySelector(".cell-y");
    const cellZ = tr.querySelector(".cell-z");
    const cellVis = tr.querySelector(".cell-vis");

    if (cellX) cellX.textContent = p.x.toFixed(3);
    if (cellY) cellY.textContent = p.y.toFixed(3);
    if (cellZ) cellZ.textContent = (p.z || 0).toFixed(3);
    if (cellVis) {
      const v = Math.round((p.visibility !== undefined ? p.visibility : 1.0) * 100);
      cellVis.textContent = `${v}%`;
    }
  });
}

// ============================================================
// 6. Subtab Switching inside Telemetry Card
// ============================================================
subtabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.subtab;
    subtabBtns.forEach(b => b.classList.toggle("active", b === btn));
    subtabPanels.forEach(p => p.classList.toggle("active", p.id === target));
  });
});

// ============================================================
// 7. Video Transport & Overlay Toggles
// ============================================================
if (toggleMarkersBtn) {
  toggleMarkersBtn.addEventListener("click", () => {
    showMarkers = !showMarkers;
    const dict = I18N[currentLang] || I18N.en;
    toggleMarkersBtn.textContent = showMarkers ? dict.btn_markers_on : dict.btn_markers_off;
    if (cameraGuideFrame) cameraGuideFrame.style.display = showMarkers ? "block" : "none";
  });
}

if (toggleLabelsBtn) {
  toggleLabelsBtn.addEventListener("click", () => {
    showLandmarkLabels = !showLandmarkLabels;
    toggleLabelsBtn.textContent = showLandmarkLabels ? "Labels: ON" : "Labels: Off";
  });
}

if (playPauseBtn) {
  playPauseBtn.addEventListener("click", () => {
    if (videoEl.paused) {
      videoEl.play();
    } else {
      videoEl.pause();
    }
  });
}

videoEl.addEventListener("play", () => {
  if (playPauseBtn) playPauseBtn.textContent = "⏸ Pause";
});
videoEl.addEventListener("pause", () => {
  if (playPauseBtn) playPauseBtn.textContent = "▶ Play";
});

if (restartVideoBtn) {
  restartVideoBtn.addEventListener("click", () => {
    videoEl.currentTime = 0;
    videoEl.play();
  });
}

// ============================================================
// 8. Math Utilities (3D Vector Angle from berad217)
// ============================================================
function angle3D(a, b, c) {
  if (!a || !b || !c) return 180.0;
  const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z || 0) - (b.z || 0);
  const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z || 0) - (b.z || 0);
  const nu = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const nv = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (nu < 1e-5 || nv < 1e-5) return 180.0;
  let cos = (ux * vx + vy * vy + uz * vz) / (nu * nv);
  cos = Math.max(-1.0, Math.min(1.0, cos));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

function vis(p) {
  if (!p) return false;
  if (p.visibility === undefined) return true;
  return p.visibility > 0.15;
}

// ============================================================
// 9. SKELETON RENDERING - 33 Landmarks, Bilateral Colors & Reticle
// ============================================================
function drawSkeleton(landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || landmarks.length < 33 || !showMarkers) return;

  // --- 1. Draw 35 Anatomical Connections (Pose-Track) ---
  ctx.lineCap = "round";
  for (const conn of SKELETON_CONNECTIONS) {
    const a = landmarks[conn.a], b = landmarks[conn.b];
    if (vis(a) && vis(b)) {
      ctx.beginPath();
      ctx.lineWidth = (conn.a >= 27 && conn.b >= 27) ? 2.8 : 2.2;
      ctx.strokeStyle = conn.side === "left"
        ? "rgba(245, 158, 11, 0.92)"
        : conn.side === "right"
          ? "rgba(56, 189, 248, 0.92)"
          : "rgba(16, 185, 129, 0.92)";
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }

  // --- 2. Draw All 33 Landmark Dots ---
  landmarks.forEach((p, idx) => {
    if (!vis(p)) return;
    const px = p.x * w;
    const py = p.y * h;
    const def = LANDMARK_REGISTRY[idx] || { side: "center" };
    const color = getSideColor(def.side);

    let r = 4.0;
    if (idx <= 10) r = 3.2;         // Face
    else if (idx <= 24) r = 4.5;    // Upper body / arms
    else r = 5.5;                   // Legs / feet

    // Outer glow
    ctx.beginPath();
    ctx.arc(px, py, r + 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();

    // Colored body
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Crisp white core
    ctx.beginPath();
    ctx.arc(px, py, r * 0.45, 0, 2 * Math.PI);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // Landmark ID/Name labels toggle
    if (showLandmarkLabels) {
      drawLabel(ctx, `#${idx}`, px + 6, py - 4, "rgba(15,23,42,0.85)");
    }
  });

  // --- 3. Highlight Selected Landmark with Targeting Reticle ---
  if (selectedLandmarkIndex !== null && vis(landmarks[selectedLandmarkIndex])) {
    const selP = landmarks[selectedLandmarkIndex];
    const sx = selP.x * w;
    const sy = selP.y * h;
    const selDef = LANDMARK_REGISTRY[selectedLandmarkIndex];
    const pulse = Math.sin(performance.now() * 0.008) * 4;

    // Glowing animated outer target ring
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + pulse, 0, 2 * Math.PI);
    ctx.strokeStyle = "#F59E0B";
    ctx.lineWidth = 2.2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Crosshair ticks
    const tickLen = 6;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Top
    ctx.moveTo(sx, sy - 18 - pulse);
    ctx.lineTo(sx, sy - 18 - pulse - tickLen);
    // Bottom
    ctx.moveTo(sx, sy + 18 + pulse);
    ctx.lineTo(sx, sy + 18 + pulse + tickLen);
    // Left
    ctx.moveTo(sx - 18 - pulse, sy);
    ctx.lineTo(sx - 18 - pulse - tickLen, sy);
    // Right
    ctx.moveTo(sx + 18 + pulse, sy);
    ctx.lineTo(sx + 18 + pulse + tickLen, sy);
    ctx.stroke();

    // Callout banner above target
    const bannerText = `#${selectedLandmarkIndex} ${selDef.name.toUpperCase()} (X:${selP.x.toFixed(2)} Y:${selP.y.toFixed(2)})`;
    drawLabel(ctx, bannerText, sx - 40, sy - 30, "#D97706");
  }

  // --- 4. Joint Angle Callouts on Knees & Spine ---
  const lk = angle3D(landmarks[23], landmarks[25], landmarks[27]);
  const rk = angle3D(landmarks[24], landmarks[26], landmarks[28]);

  if (vis(landmarks[25])) {
    drawLabel(ctx, `L:${lk.toFixed(0)}°`, landmarks[25].x * w - 38, landmarks[25].y * h - 10, "rgba(217, 119, 6, 0.9)");
  }
  if (vis(landmarks[26])) {
    drawLabel(ctx, `R:${rk.toFixed(0)}°`, landmarks[26].x * w + 12, landmarks[26].y * h - 10, "rgba(2, 132, 199, 0.9)");
  }

  // Spine tilt indicator
  if (vis(landmarks[11]) && vis(landmarks[12]) && vis(landmarks[23]) && vis(landmarks[24])) {
    const smx = (landmarks[11].x + landmarks[12].x) / 2;
    const smy = (landmarks[11].y + landmarks[12].y) / 2;
    const hmx = (landmarks[23].x + landmarks[24].x) / 2;
    const hmy = (landmarks[23].y + landmarks[24].y) / 2;
    const dx = smx - hmx, dy = smy - hmy;
    const tilt = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
    const sx = (smx + hmx) / 2, sy = (smy + hmy) / 2;
    drawLabel(ctx, `Tilt:${tilt.toFixed(1)}°`, sx * w + 16, sy * h, "#0F5C5C");
  }
}

function drawLabel(targetCtx, text, x, y, bg = "rgba(15,23,42,0.85)") {
  targetCtx.save();
  targetCtx.font = "bold 10px monospace";
  const tw = targetCtx.measureText(text).width;
  const bx = Math.max(2, Math.min(x, targetCtx.canvas.width - tw - 8));
  const by = Math.max(2, Math.min(y, targetCtx.canvas.height - 16));

  targetCtx.fillStyle = bg;
  targetCtx.beginPath();
  targetCtx.roundRect(bx, by, tw + 6, 14, 3);
  targetCtx.fill();

  targetCtx.fillStyle = "#FFFFFF";
  targetCtx.textAlign = "left";
  targetCtx.textBaseline = "top";
  targetCtx.fillText(text, bx + 3, by + 2);
  targetCtx.restore();
}

// ============================================================
// 10. REAL-TIME KINEMATICS CHART (HTML5 Canvas 60 FPS)
// ============================================================
function updateKinematicsChart(t, lk, rk, spine) {
  kinematicsHistory.times.push(t);
  kinematicsHistory.lKnee.push(lk);
  kinematicsHistory.rKnee.push(rk);
  kinematicsHistory.spine.push(spine);

  if (kinematicsHistory.times.length > MAX_CHART_SAMPLES) {
    kinematicsHistory.times.shift();
    kinematicsHistory.lKnee.shift();
    kinematicsHistory.rKnee.shift();
    kinematicsHistory.spine.shift();
  }

  if (!kinematicsCanvas) return;
  const kCtx = kinematicsCanvas.getContext("2d");
  const cw = kinematicsCanvas.width;
  const ch = kinematicsCanvas.height;
  kCtx.clearRect(0, 0, cw, ch);

  // Background grid
  kCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  kCtx.lineWidth = 1;
  const gridAngles = [60, 90, 120, 150, 180];
  gridAngles.forEach((deg) => {
    const y = ch - (deg / 180.0) * (ch - 24) - 12;
    kCtx.beginPath();
    kCtx.moveTo(35, y);
    kCtx.lineTo(cw - 10, y);
    kCtx.stroke();

    kCtx.fillStyle = "rgba(255, 255, 255, 0.35)";
    kCtx.font = "9px monospace";
    kCtx.textAlign = "right";
    kCtx.fillText(`${deg}°`, 30, y + 3);
  });

  const len = kinematicsHistory.times.length;
  if (len < 2) return;

  function plotSeries(data, color, width = 2) {
    kCtx.strokeStyle = color;
    kCtx.lineWidth = width;
    kCtx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = 40 + (i / (MAX_CHART_SAMPLES - 1)) * (cw - 55);
      const val = Math.max(0, Math.min(180, data[i]));
      const y = ch - (val / 180.0) * (ch - 24) - 12;
      if (i === 0) kCtx.moveTo(x, y);
      else kCtx.lineTo(x, y);
    }
    kCtx.stroke();

    // Latest point head
    const lastX = 40 + ((len - 1) / (MAX_CHART_SAMPLES - 1)) * (cw - 55);
    const lastY = ch - (Math.max(0, Math.min(180, data[len - 1])) / 180.0) * (ch - 24) - 12;
    kCtx.fillStyle = color;
    kCtx.beginPath();
    kCtx.arc(lastX, lastY, 3.5, 0, 2 * Math.PI);
    kCtx.fill();
  }

  // Left Knee (Amber)
  plotSeries(kinematicsHistory.lKnee, "#F59E0B", 2.2);
  // Right Knee (Sky Blue)
  plotSeries(kinematicsHistory.rKnee, "#38BDF8", 2.2);
  // Spine Tilt (Mint)
  plotSeries(kinematicsHistory.spine, "#10B981", 1.8);

  // Update stats bar
  if (chartStatLKnee) chartStatLKnee.textContent = `LK: ${lk.toFixed(0)}°`;
  if (chartStatRKnee) chartStatRKnee.textContent = `RK: ${rk.toFixed(0)}°`;
  if (chartStatSpine) chartStatSpine.textContent = `Spine: ${spine.toFixed(1)}°`;
  const delta = Math.abs(lk - rk);
  if (chartStatDelta) chartStatDelta.textContent = `|L-R|: ${delta.toFixed(0)}°`;

  // Update Bilateral Card
  if (biLKnee) biLKnee.textContent = `${lk.toFixed(0)}°`;
  if (biRKnee) biRKnee.textContent = `${rk.toFixed(0)}°`;
  if (biKneeDiff) biKneeDiff.textContent = `Δ ${delta.toFixed(0)}°`;
  if (biStatusText) {
    if (delta <= 12) {
      biStatusText.textContent = "Symmetrical";
      biStatusText.style.background = "#DCFCE7";
      biStatusText.style.color = "#166534";
    } else if (delta <= 25) {
      biStatusText.textContent = "Mild Asymmetry";
      biStatusText.style.background = "#FEF3C7";
      biStatusText.style.color = "#92400E";
    } else {
      biStatusText.textContent = "Significant Asymmetry";
      biStatusText.style.background = "#FEE2E2";
      biStatusText.style.color = "#991B1B";
    }
  }
}

// ============================================================
// 11. TELEMETRY - Compute & Stream Live Measurements
// ============================================================
function computeTelemetry(pose, timeSec, frame) {
  if (!pose || pose.length < 33) return null;

  const lk = angle3D(pose[23], pose[25], pose[27]);
  const rk = angle3D(pose[24], pose[26], pose[28]);
  const lHip = angle3D(pose[11], pose[23], pose[25]);
  const rHip = angle3D(pose[12], pose[24], pose[26]);

  const smx = (pose[11].x + pose[12].x) / 2;
  const smy = (pose[11].y + pose[12].y) / 2;
  const hmx = (pose[23].x + pose[24].x) / 2;
  const hmy = (pose[23].y + pose[24].y) / 2;
  const dx = smx - hmx, dy = smy - hmy;
  const spine = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
  const torsoPx = Math.sqrt(dx * dx * canvasEl.width * canvasEl.width + dy * dy * canvasEl.height * canvasEl.height);

  let ankleSep = 0;
  if (pose[27] && pose[28]) {
    ankleSep = Math.abs(pose[27].x - pose[28].x);
  }

  const headOk = vis(pose[0]);
  const feetOk = vis(pose[27]) && vis(pose[28]);
  const framing = (headOk && feetOk) ? "OK" : headOk ? "No-Feet" : "Partial";

  // Dynamic GSI estimate
  let gsi = 1.0;
  if (allLogs.length >= 8) {
    const seps = allLogs.slice(-20).map(l => l.ankleSep);
    const mean = seps.reduce((a, b) => a + b, 0) / seps.length;
    const diffs = seps.map(s => s - mean);
    const pos = diffs.filter(d => d > 0.015);
    const neg = diffs.filter(d => d < -0.015).map(Math.abs);
    if (pos.length > 0 && neg.length > 0) {
      const avgP = pos.reduce((a, b) => a + b, 0) / pos.length;
      const avgN = neg.reduce((a, b) => a + b, 0) / neg.length;
      gsi = Math.min(avgP, avgN) / (Math.max(avgP, avgN) + 1e-6);
      gsi = Math.max(0.0, Math.min(1.0, gsi));
    }
  }

  // Update Bilateral Card Hips & Ankles
  if (biLHip) biLHip.textContent = `${lHip.toFixed(0)}°`;
  if (biRHip) biRHip.textContent = `${rHip.toFixed(0)}°`;
  if (biLAnkle && pose[27]) biLAnkle.textContent = pose[27].y.toFixed(2);
  if (biRAnkle && pose[28]) biRAnkle.textContent = pose[28].y.toFixed(2);

  return {
    time: Number(timeSec.toFixed(3)),
    frame: frame,
    lKnee: Number(lk.toFixed(1)),
    rKnee: Number(rk.toFixed(1)),
    spine: Number(spine.toFixed(1)),
    ankleSep: Number(ankleSep.toFixed(4)),
    torsoPx: Number(torsoPx.toFixed(1)),
    gsi: Number(gsi.toFixed(2)),
    framing: framing,
  };
}

function updateKPIs(t) {
  if (!t) return;
  if (teleSpine) teleSpine.textContent = `${t.spine}°`;
  if (teleLKnee) teleLKnee.textContent = `${t.lKnee}°`;
  if (teleRKnee) teleRKnee.textContent = `${t.rKnee}°`;
  if (teleGSI) teleGSI.textContent = `${t.gsi}`;
  if (teleFraming) teleFraming.textContent = t.framing;

  if (framingBadge) {
    if (t.framing === "OK") {
      framingBadge.innerHTML = `<span class="hud-dot green"></span> Full Body (OK)`;
    } else if (t.framing === "No-Feet") {
      framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Upper Body Only`;
    } else {
      framingBadge.innerHTML = `<span class="hud-dot red"></span> Partial`;
    }
  }
}

function appendLogRow(t) {
  if (!telemetryTableBody || !t) return;
  const empty = telemetryTableBody.querySelector(".empty-row");
  if (empty) empty.remove();

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${t.time}s</td>
    <td>#${t.frame}</td>
    <td>${t.lKnee}°</td>
    <td>${t.rKnee}°</td>
    <td>${t.spine}°</td>
    <td>${t.ankleSep}</td>
    <td>${t.torsoPx}</td>
    <td><span class="badge-status ${t.framing === 'OK' ? 'GREEN' : 'YELLOW'}">${t.framing}</span></td>
  `;
  telemetryTableBody.appendChild(tr);

  const container = telemetryTableBody.closest(".table-container");
  if (container) container.scrollTop = container.scrollHeight;
}

function clearLogs() {
  allLogs = [];
  frameCounter = 0;
  kinematicsHistory.times = [];
  kinematicsHistory.lKnee = [];
  kinematicsHistory.rKnee = [];
  kinematicsHistory.spine = [];
  if (telemetryTableBody) {
    const dict = I18N[currentLang] || I18N.en;
    telemetryTableBody.innerHTML = `<tr class="empty-row"><td colspan="8">${dict.empty_log}</td></tr>`;
  }
}

if (copyTelemetryBtn) {
  copyTelemetryBtn.addEventListener("click", () => {
    if (allLogs.length === 0) { alert("No telemetry data yet."); return; }
    navigator.clipboard.writeText(JSON.stringify(allLogs, null, 2)).then(() => {
      copyTelemetryBtn.textContent = "Copied!";
      setTimeout(() => { copyTelemetryBtn.textContent = I18N[currentLang]?.btn_copy_json || "Copy JSON"; }, 1500);
    });
  });
}

// ============================================================
// 12. MediaPipe Initialization (With GPU & CPU Fallback)
// ============================================================
async function ensureMediaPipe() {
  if (poseLandmarker) return poseLandmarker;
  if (isInitializingMP) {
    while (isInitializingMP) {
      await new Promise(r => setTimeout(r, 100));
    }
    return poseLandmarker;
  }

  isInitializingMP = true;
  try {
    if (videoStatus) videoStatus.textContent = "Loading AI Vision model from Google CDN...";

    let attempts = 0;
    while (!window.MediaPipeVision && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (!window.MediaPipeVision) {
      throw new Error("MediaPipe library failed to load from CDN.");
    }

    const vision = await window.MediaPipeVision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // Try GPU delegate first, fallback to CPU
    try {
      poseLandmarker = await window.MediaPipeVision.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
      console.log("MediaPipe Pose Landmarker ready with GPU delegate.");
    } catch (gpuErr) {
      console.warn("GPU delegate failed, attempting CPU delegate:", gpuErr);
      poseLandmarker = await window.MediaPipeVision.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
      console.log("MediaPipe Pose Landmarker ready with CPU delegate.");
    }

    try {
      faceLandmarker = await window.MediaPipeVision.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    } catch (e) {
      console.warn("FaceLandmarker optional load skipped:", e);
    }

    if (videoStatus) videoStatus.textContent = "AI Model ready. Start camera or upload video.";
  } catch (err) {
    console.error("MediaPipe initialization error:", err);
    if (videoStatus) videoStatus.textContent = "Model load error: " + err.message;
  } finally {
    isInitializingMP = false;
  }
  return poseLandmarker;
}

window.addEventListener("mediapipe-ready", ensureMediaPipe);
if (window.MediaPipeVision) ensureMediaPipe();

// ============================================================
// 13. Main Real-Time Tracking Loop
// ============================================================
function startTracking() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  lastVideoTime = -1;
  mpTimestamp = performance.now();
  lastTickTime = performance.now();
  frameTimeWindow = [];

  function tick() {
    const now = performance.now();
    const frameDelta = now - lastTickTime;
    lastTickTime = now;

    if (frameDelta > 0) {
      frameTimeWindow.push(frameDelta);
      if (frameTimeWindow.length > 15) frameTimeWindow.shift();
      const avgDelta = frameTimeWindow.reduce((a, b) => a + b, 0) / frameTimeWindow.length;
      const fps = Math.round(1000 / avgDelta);
      if (fpsText) fpsText.textContent = `${fps} FPS`;
    }

    if (videoEl && videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth || 360;
      const vh = videoEl.videoHeight || 640;

      // Keep canvas pixels matched 1:1 to video resolution
      if (canvasEl.width !== vw || canvasEl.height !== vh) {
        canvasEl.width = vw;
        canvasEl.height = vh;
      }

      const curTime = videoEl.currentTime;

      if (poseLandmarker && curTime !== lastVideoTime) {
        lastVideoTime = curTime;
        mpTimestamp = Math.max(mpTimestamp + 33, performance.now());

        const tStart = performance.now();
        try {
          const result = poseLandmarker.detectForVideo(videoEl, mpTimestamp);
          lastInferenceDuration = performance.now() - tStart;
          if (latencyText) latencyText.textContent = `${Math.round(lastInferenceDuration)} ms`;

          if (result && result.landmarks && result.landmarks.length > 0) {
            currentPoseLandmarks = result.landmarks[0];
            currentWorldLandmarks = (result.worldLandmarks && result.worldLandmarks.length > 0)
              ? result.worldLandmarks[0]
              : result.landmarks[0];
          } else {
            currentPoseLandmarks = null;
            currentWorldLandmarks = null;
          }
        } catch (e) {
          console.error("Pose detection error:", e);
          mpTimestamp = performance.now() + 1000;
        }

        // Optional face detection
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

        frameCounter++;
        const timeSec = videoEl.currentTime || 0;

        // Draw skeleton & landmarks with bilateral colors & reticle
        drawSkeleton(currentPoseLandmarks, canvasEl.width, canvasEl.height);

        // Update 33-Landmark Inspector values
        updateInspectorValues(currentPoseLandmarks);

        // Compute telemetry for this frame
        const telemetry = computeTelemetry(currentPoseLandmarks, timeSec, frameCounter);
        if (telemetry) {
          updateKPIs(telemetry);
          allLogs.push(telemetry);

          if (allLogs.length % 3 === 0 || allLogs.length <= 5) {
            appendLogRow(telemetry);
          }

          if (currentFaceMetrics && teleYaw) {
            teleYaw.textContent = `${Math.round((currentFaceMetrics.head_yaw || 0) * 45)}°`;
          }

          // Update Real-Time Kinematics Canvas Chart
          updateKinematicsChart(telemetry.time, telemetry.lKnee, telemetry.rKnee, telemetry.spine);
        }
      } else {
        // Redraw overlay to maintain visual alignment even when paused
        drawSkeleton(currentPoseLandmarks, canvasEl.width, canvasEl.height);
      }
    }

    animationFrameId = requestAnimationFrame(tick);
  }

  tick();
}

// ============================================================
// 14. Camera Start
// ============================================================
if (startCamBtn) {
  startCamBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      videoStatus.textContent = "Camera requires HTTPS or localhost.";
      return;
    }

    try {
      videoStatus.textContent = "Accessing camera...";
      clearLogs();
      stopEverything();

      await ensureMediaPipe();

      if (viewportWrap) {
        viewportWrap.classList.add("selfie-mirrored");
      }

      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 854 }, facingMode: "user" },
        audio: false,
      });

      videoEl.srcObject = cameraStream;
      videoEl.loop = false;
      await videoEl.play();

      startCamBtn.disabled = true;
      startRecordBtn.disabled = false;
      stopRecordBtn.disabled = false;
      videoStatus.textContent = "Live camera active. Tracking 33 landmarks.";

      startTracking();
    } catch (err) {
      videoStatus.textContent = `Camera error: ${err.message}`;
    }
  });
}

// ============================================================
// 15. Video File Upload (Handles Pre-Recorded Videos)
// ============================================================
async function handleVideoFile(file) {
  if (!file) return;
  stopEverything();
  clearLogs();

  if (viewportWrap) {
    viewportWrap.classList.remove("selfie-mirrored");
  }

  videoStatus.textContent = `Loading "${file.name}" and initializing AI...`;

  // Ensure MediaPipe is loaded FIRST
  await ensureMediaPipe();

  videoEl.srcObject = null;
  videoEl.src = URL.createObjectURL(file);
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.playsInline = true;

  videoEl.onloadeddata = async () => {
    try {
      await videoEl.play();
      startCamBtn.disabled = false;
      startRecordBtn.disabled = false;
      stopRecordBtn.disabled = false;
      videoStatus.textContent = `"${file.name}" loaded. AI tracking 33 landmarks on every frame.`;
      startTracking();
    } catch (err) {
      videoStatus.textContent = `Video play error: ${err.message}`;
    }
  };
}

if (videoFileInputAlt) {
  videoFileInputAlt.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));
}

// ============================================================
// 16. Demo Button - Runs MediaPipe on tutorial_walking.mp4
// ============================================================
async function runDemo() {
  stopEverything();
  clearLogs();

  if (viewportWrap) {
    viewportWrap.classList.remove("selfie-mirrored");
  }

  videoStatus.textContent = "Loading AI model and demo video...";

  await ensureMediaPipe();

  videoEl.srcObject = null;
  videoEl.src = "assets/tutorial_walking.mp4";
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.playsInline = true;

  videoEl.onloadeddata = async () => {
    try {
      await videoEl.play();
      startCamBtn.disabled = false;
      startRecordBtn.disabled = false;
      stopRecordBtn.disabled = false;
      videoStatus.textContent = "Live AI tracking on demo video. 33 landmarks moving with the child.";
      startTracking();
      startAutoRecording();
    } catch (e) {
      videoStatus.textContent = "Could not play demo video: " + e.message;
    }
  };
}

if (runDemoBtn) runDemoBtn.addEventListener("click", runDemo);

// ============================================================
// 17. Recording Session (Captures 120 Frames at 10 FPS)
// ============================================================
function startAutoRecording() {
  isRecording = true;
  capturedFrames = [];
  sessionStartTime = performance.now();
  if (timerBadge) timerBadge.hidden = false;

  sampleTimer = setInterval(() => {
    const elapsed = (performance.now() - sessionStartTime) / 1000.0;
    const remain = Math.max(0, SESSION_DURATION_SEC - elapsed);
    if (countdownText) countdownText.textContent = `${remain.toFixed(1)}s`;
    if (frameCountText) frameCountText.textContent = `${capturedFrames.length}/${TARGET_FRAMES}`;

    // Use currentWorldLandmarks or fallback to currentPoseLandmarks
    const lms = currentWorldLandmarks || currentPoseLandmarks;
    if (lms && lms.length >= 33) {
      capturedFrames.push({
        timestamp_ms: Math.round(elapsed * 1000),
        pose_world_landmarks: lms.map(lm => ({
          x: Number(lm.x.toFixed(4)),
          y: Number(lm.y.toFixed(4)),
          z: Number((lm.z || 0).toFixed(4)),
          visibility: Number((lm.visibility ?? 1).toFixed(2)),
        })),
        face_metrics: currentFaceMetrics || { head_yaw: 0, face_detected: true },
      });
    }

    if (elapsed >= SESSION_DURATION_SEC || capturedFrames.length >= TARGET_FRAMES) {
      finishRecording();
    }
  }, 1000 / TARGET_FPS);
}

if (startRecordBtn) {
  startRecordBtn.addEventListener("click", () => {
    if (isRecording) return;
    clearLogs();
    if (mathBreakdownCard) mathBreakdownCard.hidden = true;
    startAutoRecording();
    startRecordBtn.disabled = true;
    videoStatus.textContent = "Recording session active...";
  });
}

if (stopRecordBtn) {
  stopRecordBtn.addEventListener("click", () => {
    if (sampleTimer) clearInterval(sampleTimer);
    isRecording = false;
    startRecordBtn.disabled = false;
    if (timerBadge) timerBadge.hidden = true;
    videoStatus.textContent = "Session reset.";
  });
}

async function finishRecording() {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  startRecordBtn.disabled = false;
  if (timerBadge) timerBadge.hidden = true;

  if (capturedFrames.length === 0) {
    videoStatus.textContent = "No child pose detected during recording. Please ensure the child is clearly visible in the camera.";
    return;
  }

  videoStatus.textContent = `Analyzing ${capturedFrames.length} frames on backend...`;

  const payload = {
    child_age_months: parseInt(childAgeInput?.value, 10) || 24,
    task_type: "walking_gait",
    fps: TARGET_FPS,
    frames: capturedFrames,
  };

  try {
    const res = await fetch(`${API_URL}/analyze-video-landmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Analysis failed");

    showResults(data);
    videoStatus.textContent = "Analysis complete. See results below.";
  } catch (err) {
    videoStatus.textContent = "Backend error: " + err.message;
  }
}

// ============================================================
// 18. Results Display (Stage 1 & Stage 2 Screening Report)
// ============================================================
function showResults(data) {
  if (!mathBreakdownCard || !mathStepsList) return;

  const st = data.screening_status || "YELLOW";
  mathBreakdownCard.hidden = false;
  mathStatusBadge.className = `badge-status ${st}`;
  mathStatusBadge.textContent = st;

  const m = data.metrics || {};
  const gsi = m.gait_symmetry_index ?? 1.0;
  const spine = m.mean_spine_tilt_deg ?? 0;
  const lk = m.mean_left_knee_deg ?? 170;
  const rk = m.mean_right_knee_deg ?? 170;
  const limb = m.knee_ankle_ratio ?? 0;

  let verdict;
  if (gsi >= 0.85) {
    verdict = `<strong>GREEN - Normal:</strong> GSI ${gsi} >= 0.85. Symmetrical strides. No antalgic limp detected.`;
  } else if (gsi >= 0.70) {
    verdict = `<strong>YELLOW - Mild Asymmetry:</strong> GSI ${gsi} in 0.70–0.84 range. Slight stride favor observed.`;
  } else {
    verdict = `<strong>RED - Significant Asymmetry:</strong> GSI ${gsi} < 0.70. High risk for antalgic limp, mild hemiplegia, or hip dysplasia.`;
  }

  mathStepsList.innerHTML = `
    <div class="math-step-item">
      <strong>1. Stage 1 Invariant Normalization (NumPy)</strong><br>
      Mid-Hip origin H_mid = (P23 + P24)/2. Torso length L = ||S_mid - H_mid||. ${data.frames_analyzed || capturedFrames.length} frames normalized.
    </div>
    <div class="math-step-item">
      <strong>2. Joint Angles (3D arccos dot-product)</strong><br>
      Left Knee: <strong>${lk}°</strong> | Right Knee: <strong>${rk}°</strong> | Coronal Spine Tilt: <strong>${spine}°</strong> (normal &le; 12.0°)
    </div>
    <div class="math-step-item">
      <strong>3. Gait Symmetry Index (GSI)</strong><br>
      Ankle separation time-series analyzed: GSI = min(S_L, S_R) / max(S_L, S_R) = <strong>${gsi}</strong>
    </div>
    <div class="math-step-item">
      <strong>4. Lower-Limb Alignment Ratio</strong><br>
      Knee vs Ankle spacing: <strong>${limb > 0 ? "+" : ""}${limb}</strong> (${limb > 0 ? "Varum/Bowed" : "Valgum/Knock-knees"})
    </div>
    <div class="math-step-item">
      <strong>5. Clinical Assessment &amp; Advice</strong><br>
      ${verdict}<br>
      <em>${data.advice || "Continue routine well-child checkups."}</em>
    </div>
    <div class="math-step-item">
      <strong>6. Actionable Clinical Risk Flags</strong><br>
      ${(data.clinical_flags && data.clinical_flags.length > 0)
        ? data.clinical_flags.map(f => `• ${f}`).join("<br>")
        : "• No abnormalities flagged across lower-limb biomechanics."}
    </div>
  `;

  mathBreakdownCard.scrollIntoView({ behavior: "smooth" });
}

// ============================================================
// 19. Cleanup Helper
// ============================================================
function stopEverything() {
  if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  isRecording = false;
  currentPoseLandmarks = null;
  currentWorldLandmarks = null;
}

// Initialize inspector rows on page load
initLandmarkInspector();

// ============================================================
// 20. Skin & Eye Classifiers (Preserved Modules)
// ============================================================
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
            options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
          });

          doughnutChart = new Chart(doughnutCanvas, {
            type: "doughnut",
            data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } }
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
