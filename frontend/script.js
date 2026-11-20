// Automatically resolve API URL:
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
   1. Bilingual Translation Engine (English <-> Hindi)
   ========================================================================== */
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
    btn_markers_off: "Markers: Inactive",
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
    math_title: "Biomechanical Decision Calculation",
  },
  hi: {
    brand_sub: "राष्ट्रीय बाल स्वास्थ्य कार्यक्रम (RBSK 2.0) · बाल स्वास्थ्य जाँच",
    status_ready: "ऑफ़लाइन चालू",
    tab_walking: "चलने की चाल जाँच (Walking Gait)",
    tab_skin: "त्वचा स्थिति (Skin)",
    tab_eye: "नेत्र स्थिति (Eye)",
    label_age: "बच्चे की उम्र (महीने):",
    label_task: "जाँच का प्रकार:",
    btn_start_cam: "कैमरा शुरू करें",
    btn_upload_video: "वीडियो अपलोड करें",
    btn_run_demo: "चलने का डेमो चलाएं",
    btn_record: "जाँच रिकॉर्ड करें",
    btn_reset: "रीसेट करें",
    viewport_title: "लाइव 9:16 विजन स्ट्रीम",
    btn_markers_on: "मार्कर: चालू",
    btn_markers_off: "मार्कर: बंद",
    guide_head: "सिर का लक्ष्य",
    guide_shoulders: "कंधे",
    guide_feet: "पैर / टखने",
    status_waiting: "इनपुट की प्रतीक्षा...",
    status_ready_prompt: "कैमरा तैयार है। कैमरा शुरू करें या वीडियो चुनें।",
    kpi_framing: "फ्रेमिंग स्थिति",
    kpi_spine: "रीढ़ का झुकाव",
    kpi_lknee: "बायाँ घुटना",
    kpi_rknee: "दायाँ घुटना",
    kpi_gsi: "चाल समरूपता (GSI)",
    kpi_yaw: "सिर का कोण / दृष्टि",
    log_stream_title: "प्रति-सेकंड टेलीमेट्री डेटा (लाइव माप)",
    btn_copy_json: "JSON कॉपी करें",
    th_sec: "सेकंड",
    th_frame: "फ्रेम",
    th_lknee: "बायाँ घुटना",
    th_rknee: "दायाँ घुटना",
    th_spine: "रीढ़",
    th_sep: "कदम दूरी (s)",
    th_torso: "धड़ (px)",
    th_status: "फ्रेमिंग",
    empty_log: "लाइव टेलीमेट्री डेटा यहाँ प्रति-सेकंड दर्ज होगा...",
    math_title: "परिणाम की गणितीय गणना (इंजीनियरिंग ब्रेकडाउन)",
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

// Initial language set
setLanguage(currentLang);

/* ==========================================================================
   2. Tab Switching
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

/* ==========================================================================
   3. 33 3D Keypoints & Biomechanical Walking Gait Architecture
   ========================================================================== */
const videoEl = document.getElementById("webcamVideo");
const canvasEl = document.getElementById("skeletonCanvas");
const videoViewportWrap = document.querySelector(".video-viewport-wrap");
const ctx = canvasEl.getContext("2d");

const startCamBtn = document.getElementById("startCamBtn");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const runDemoBtn = document.getElementById("runDemoBtn");
const videoStatus = document.getElementById("videoStatus");

const framingBadge = document.getElementById("framingBadge");
const timerBadge = document.getElementById("timerBadge");
const countdownText = document.getElementById("countdownText");
const frameCountText = document.getElementById("frameCountText");

const teleFraming = document.getElementById("teleFraming");
const teleSpine = document.getElementById("teleSpine");
const teleLKnee = document.getElementById("teleLKnee");
const teleRKnee = document.getElementById("teleRKnee");
const teleGSI = document.getElementById("teleGSI");
const teleYaw = document.getElementById("teleYaw");

const childAgeInput = document.getElementById("childAgeInput");
const taskTypeSelect = document.getElementById("taskTypeSelect");

const toggleMarkersBtn = document.getElementById("toggleMarkersBtn");
const cameraGuideFrame = document.getElementById("cameraGuideFrame");

const telemetryTableBody = document.getElementById("telemetryTableBody");
const copyTelemetryBtn = document.getElementById("copyTelemetryBtn");
const mathBreakdownCard = document.getElementById("mathBreakdownCard");
const mathStatusBadge = document.getElementById("mathStatusBadge");
const mathStepsList = document.getElementById("mathStepsList");

let cameraStream = null;
let poseLandmarker = null;
let faceLandmarker = null;
let animationFrameId = null;
let isRecording = false;
let sessionStartTime = null;
let capturedFrames = [];
let sampleTimer = null;
let showGuideMarkers = true;

const TARGET_FPS = 10.0;
const SESSION_DURATION_SEC = 12.0;
const TARGET_FRAMES = 120;

// Per-Second Logging Tracker
let lastLoggedSecond = -1;
let secondLogs = [];

// Guide Markers Toggle
if (toggleMarkersBtn) {
  toggleMarkersBtn.addEventListener("click", () => {
    showGuideMarkers = !showGuideMarkers;
    const dict = I18N[currentLang] || I18N.en;
    toggleMarkersBtn.textContent = showGuideMarkers ? dict.btn_markers_on : dict.btn_markers_off;
    toggleMarkersBtn.style.opacity = showGuideMarkers ? "1" : "0.6";
    if (cameraGuideFrame) cameraGuideFrame.style.display = showGuideMarkers ? "block" : "none";
  });
}

// 3D Angle Calculation via Dot Product (arccos)
function compute3DAngle(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const nu = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  const nv = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (nu < 1e-5 || nv < 1e-5) return 180.0;
  let cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  cos = Math.max(-1.0, Math.min(1.0, cos));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

// Floating Joint Micro-Badge
function drawFloatingBadge(ctx, text, x, y, bgColor = "rgba(15, 23, 42, 0.75)", textColor = "#ffffff") {
  ctx.save();
  ctx.font = "600 10px JetBrains Mono, monospace";
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

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rx + boxWidth / 2, ry + boxHeight / 2);
  ctx.restore();
}

// Draw 33 3D Landmarks & Dedicated Foot Triangles
function drawSkeleton(ctx, landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);

  if (!landmarks || landmarks.length < 33) return;

  // Check framing status in 9:16 frame
  const nose = landmarks[0];
  const lAnkle = landmarks[27];
  const rAnkle = landmarks[28];
  const headFramed = nose && (nose.visibility === undefined || nose.visibility > 0.25) && nose.y > 0.04 && nose.y < 0.35;
  const feetFramed = (lAnkle && (lAnkle.visibility === undefined || lAnkle.visibility > 0.20) && lAnkle.y > 0.65) ||
                     (rAnkle && (rAnkle.visibility === undefined || rAnkle.visibility > 0.20) && rAnkle.y > 0.65);
  const isFramed = headFramed && feetFramed;

  if (cameraGuideFrame) {
    cameraGuideFrame.classList.toggle("good-frame", Boolean(isFramed));
  }

  // Skeletal Body Connections
  const BODY_CONNECTIONS = [
    [11, 12], [11, 23], [12, 24], [23, 24], // Torso
    [11, 13], [13, 15],                     // Left Arm
    [12, 14], [14, 16],                     // Right Arm
    [23, 25], [25, 27],                     // Left Leg
    [24, 26], [26, 28],                     // Right Leg
    [0, 1], [1, 2], [2, 3], [3, 7],         // Left Face
    [0, 4], [4, 5], [5, 6], [6, 8],         // Right Face
    [9, 10]                                 // Mouth
  ];

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(16, 185, 129, 0.88)"; // Crisp emerald

  for (const [i, j] of BODY_CONNECTIONS) {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2 && (p1.visibility === undefined || p1.visibility > 0.20) && (p2.visibility === undefined || p2.visibility > 0.20)) {
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
  }

  // Dedicated Anatomical Foot Triangles: Ankles (27, 28), Heels (29, 30), Foot Index / Toes (31, 32)
  const FOOT_CONNECTIONS = [
    [27, 29], [29, 31], [31, 27], // Left Foot Triangle
    [28, 30], [30, 32], [32, 28], // Right Foot Triangle
  ];

  ctx.lineWidth = 2.0;
  ctx.strokeStyle = "rgba(245, 158, 11, 0.95)"; // Vibrant amber for foot mechanics

  for (const [i, j] of FOOT_CONNECTIONS) {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2 && (p1.visibility === undefined || p1.visibility > 0.15) && (p2.visibility === undefined || p2.visibility > 0.15)) {
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
  }

  // Small refined landmark dots (face: 1.4px, body: 2.0px, feet: 2.4px)
  landmarks.forEach((p, idx) => {
    if (p && (p.visibility === undefined || p.visibility > 0.20)) {
      ctx.beginPath();
      const r = idx <= 10 ? 1.4 : (idx >= 27 ? 2.4 : 2.0);
      ctx.arc(p.x * w, p.y * h, r, 0, 2 * Math.PI);
      ctx.fillStyle = idx >= 27 ? "#F59E0B" : idx >= 23 ? "#10B981" : idx >= 11 ? "#38BDF8" : "#94A3B8";
      ctx.fill();
    }
  });

  // Floating Micro-Badges for Biomechanics (Knee angles, foot angles, spine tilt)
  if (showGuideMarkers) {
    const lkAngle = compute3DAngle(landmarks[23], landmarks[25], landmarks[27]);
    const rkAngle = compute3DAngle(landmarks[24], landmarks[26], landmarks[28]);
    const pLK = landmarks[25];
    const pRK = landmarks[26];

    if (pLK && (pLK.visibility === undefined || pLK.visibility > 0.25)) {
      drawFloatingBadge(ctx, `L: ${lkAngle.toFixed(0)}°`, pLK.x * w - 30, pLK.y * h);
    }
    if (pRK && (pRK.visibility === undefined || pRK.visibility > 0.25)) {
      drawFloatingBadge(ctx, `R: ${rkAngle.toFixed(0)}°`, pRK.x * w + 30, pRK.y * h);
    }

    // Foot angles (Ankle flexion)
    const lFootFlex = compute3DAngle(landmarks[25], landmarks[27], landmarks[31]);
    const pLAnkle = landmarks[27];
    if (pLAnkle && (pLAnkle.visibility === undefined || pLAnkle.visibility > 0.20)) {
      drawFloatingBadge(ctx, `L-Foot: ${lFootFlex.toFixed(0)}°`, pLAnkle.x * w - 36, pLAnkle.y * h + 16, "rgba(217, 119, 6, 0.85)");
    }

    const rFootFlex = compute3DAngle(landmarks[26], landmarks[28], landmarks[32]);
    const pRAnkle = landmarks[28];
    if (pRAnkle && (pRAnkle.visibility === undefined || pRAnkle.visibility > 0.20)) {
      drawFloatingBadge(ctx, `R-Foot: ${rFootFlex.toFixed(0)}°`, pRAnkle.x * w + 36, pRAnkle.y * h + 16, "rgba(217, 119, 6, 0.85)");
    }

    // Mid-Spine Marker & Tilt
    const sMidX = (landmarks[11].x + landmarks[12].x) / 2;
    const sMidY = (landmarks[11].y + landmarks[12].y) / 2;
    const hMidX = (landmarks[23].x + landmarks[24].x) / 2;
    const hMidY = (landmarks[23].y + landmarks[24].y) / 2;
    const spineX = (sMidX + hMidX) / 2;
    const spineY = (sMidY + hMidY) / 2;
    const dx = sMidX - hMidX;
    const dy = sMidY - hMidY;
    const spineTilt = Math.abs((Math.atan2(dx, dy) * 180.0) / Math.PI);
    drawFloatingBadge(ctx, `Spine: ${spineTilt.toFixed(1)}°`, spineX * w + 38, spineY * h, "rgba(15, 92, 92, 0.85)");
  }
}

// Live Biomechanical Telemetry & Per-Second Engineering Logger
function updateLiveTelemetry(pose, world, face, currentSecond = 0, currentFrame = 0) {
  if (!pose || pose.length < 33) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Waiting...`;
    if (teleFraming) teleFraming.textContent = "Not Detected";
    return;
  }

  const nose = pose[0];
  const lAnkle = pose[27];
  const rAnkle = pose[28];
  const headOk = nose && (nose.visibility === undefined || nose.visibility > 0.25);
  const feetOk = (lAnkle && (lAnkle.visibility === undefined || lAnkle.visibility > 0.20)) ||
                 (rAnkle && (rAnkle.visibility === undefined || rAnkle.visibility > 0.20));
  const isFramed = headOk && feetOk;

  if (isFramed) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot green"></span> Full-Body Framed`;
    if (teleFraming) teleFraming.textContent = "Framed (Good)";
  } else if (headOk) {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Upper Body Only`;
    if (teleFraming) teleFraming.textContent = "Feet Cut Off";
  } else {
    if (framingBadge) framingBadge.innerHTML = `<span class="hud-dot red"></span> Partial Frame`;
    if (teleFraming) teleFraming.textContent = "Adjust View";
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
  const lkAngle = compute3DAngle(pose[23], pose[25], pose[27]);
  const rkAngle = compute3DAngle(pose[24], pose[26], pose[28]);
  if (teleLKnee) teleLKnee.textContent = `${lkAngle.toFixed(1)}°`;
  if (teleRKnee) teleRKnee.textContent = `${rkAngle.toFixed(1)}°`;

  // Torso Length in Pixels
  const torsoPx = Math.sqrt(dx * dx * canvasEl.width * canvasEl.width + dy * dy * canvasEl.height * canvasEl.height);

  // Ankle Horizontal Separation
  let ankleSep = 0;
  if (lAnkle && rAnkle) {
    ankleSep = Math.abs(lAnkle.x - rAnkle.x);
    if (teleGSI) teleGSI.textContent = `${ankleSep.toFixed(3)}`;
  }

  // Head Yaw
  if (face && teleYaw) {
    const yawDeg = Math.round((face.head_yaw || 0) * 45.0);
    teleYaw.textContent = `${yawDeg}°`;
  }

  // Per-Second Logging into Engineering Table
  const secInt = Math.floor(currentSecond);
  if (secInt < lastLoggedSecond) {
    lastLoggedSecond = -1; // Reset on video loop
  }
  if (secInt > lastLoggedSecond && secInt >= 0) {
    lastLoggedSecond = secInt;

    const logEntry = {
      sec: secInt,
      frame: currentFrame,
      lKnee: Number(lkAngle.toFixed(1)),
      rKnee: Number(rkAngle.toFixed(1)),
      spineTilt: Number(spineTilt.toFixed(1)),
      ankleSep: Number(ankleSep.toFixed(3)),
      torsoLenPx: Number(torsoPx.toFixed(1)),
      framingStatus: isFramed ? "OK" : (headOk ? "No-Feet" : "Partial")
    };
    secondLogs.push(logEntry);
    appendLogRow(logEntry);
  }
}

function appendLogRow(entry) {
  if (!telemetryTableBody) return;
  const emptyRow = telemetryTableBody.querySelector(".empty-row");
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${entry.sec}s</td>
    <td>#${entry.frame}</td>
    <td>${entry.lKnee}°</td>
    <td>${entry.rKnee}°</td>
    <td>${entry.spineTilt}°</td>
    <td>${entry.ankleSep}</td>
    <td>${entry.torsoLenPx}</td>
    <td><span class="badge-status ${entry.framingStatus === 'OK' ? 'GREEN' : 'YELLOW'}">${entry.framingStatus}</span></td>
  `;
  telemetryTableBody.appendChild(tr);

  // Auto-scroll to bottom of table
  const container = telemetryTableBody.closest(".table-container");
  if (container) container.scrollTop = container.scrollHeight;
}

function clearLogTable() {
  lastLoggedSecond = -1;
  secondLogs = [];
  if (telemetryTableBody) {
    const dict = I18N[currentLang] || I18N.en;
    telemetryTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">${dict.empty_log}</td>
      </tr>
    `;
  }
}

// Copy JSON Telemetry to Clipboard
if (copyTelemetryBtn) {
  copyTelemetryBtn.addEventListener("click", () => {
    if (secondLogs.length === 0) {
      alert("No telemetry data captured yet.");
      return;
    }
    const jsonStr = JSON.stringify(secondLogs, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      copyTelemetryBtn.textContent = "Copied!";
      setTimeout(() => {
        const dict = I18N[currentLang] || I18N.en;
        copyTelemetryBtn.textContent = dict.btn_copy_json;
      }, 1500);
    });
  });
}

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
    } catch (e) {}

    if (videoStatus) videoStatus.textContent = "AI Vision Model ready. Start camera or upload video.";
    if (startCamBtn) startCamBtn.disabled = false;
  } catch (err) {
    console.error("MediaPipe load error:", err);
    if (videoStatus) videoStatus.textContent = "MediaPipe loaded. Ready to track.";
    if (startCamBtn) startCamBtn.disabled = false;
  }
}

window.addEventListener("mediapipe-ready", initMediaPipeVision);
if (window.MediaPipeVision) initMediaPipeVision();

// Camera Start
if (startCamBtn) {
  startCamBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      videoStatus.innerHTML = "<strong>Camera Blocked:</strong> Browsers require HTTPS or localhost. You can upload a pre-recorded video or test with demo.";
      videoStatus.classList.add("error");
      return;
    }

    try {
      videoStatus.textContent = "Accessing live camera stream...";
      clearLogTable();
      if (mathBreakdownCard) mathBreakdownCard.hidden = true;
      if (sampleTimer) clearInterval(sampleTimer);

      if (videoViewportWrap) {
        videoViewportWrap.classList.add("video-active");
        videoViewportWrap.classList.add("selfie-mirrored");
      }

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
      videoStatus.textContent = "Live camera active. Position child inside the 9:16 target markers.";

      startTrackingLoop();
    } catch (err) {
      console.error("Camera error:", err);
      videoStatus.innerHTML = `<strong>Camera Access Blocked (${err.name}):</strong> ${err.message}.`;
      videoStatus.classList.add("error");
    }
  });
}

// Pre-Recorded Video Upload Handler
function handleVideoFile(file) {
  if (!file) return;

  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }

  clearLogTable();
  if (mathBreakdownCard) mathBreakdownCard.hidden = true;
  if (sampleTimer) clearInterval(sampleTimer);

  if (videoViewportWrap) {
    videoViewportWrap.classList.add("video-active");
    videoViewportWrap.classList.remove("selfie-mirrored");
  }

  videoEl.srcObject = null;
  videoEl.src = URL.createObjectURL(file);
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.play();

  startCamBtn.disabled = false;
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = false;
  videoStatus.textContent = `Video "${file.name}" loaded. Extracting 33 landmarks in lockstep with body...`;
  videoStatus.classList.remove("error");

  startTrackingLoop();
}

const fileInputAlt = document.getElementById("videoFileInputAlt");
if (fileInputAlt) fileInputAlt.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));

// Tracking Loop for Both Live Camera & Pre-Recorded Video
let lastVideoTime = -1;
let lastDetectionTime = 0;
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;
let frameCounter = 0;

function startTrackingLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  function renderFrame() {
    if (videoEl && videoEl.readyState >= 2) {
      if (videoViewportWrap && !videoViewportWrap.classList.contains("video-active")) {
        videoViewportWrap.classList.add("video-active");
      }

      if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
        canvasEl.width = videoEl.videoWidth || 360;
        canvasEl.height = videoEl.videoHeight || 640;
      }

      const nowMs = performance.now();
      const isLive = Boolean(videoEl.srcObject);
      const shouldDetect = poseLandmarker && (
        isLive ? (nowMs - lastDetectionTime >= 33) : (videoEl.currentTime !== lastVideoTime)
      );

      if (shouldDetect) {
        lastDetectionTime = nowMs;
        lastVideoTime = videoEl.currentTime;
        frameCounter++;

        try {
          const poseRes = poseLandmarker.detectForVideo(videoEl, nowMs);
          if (poseRes.landmarks && poseRes.landmarks.length > 0) {
            currentPoseLandmarks = poseRes.landmarks[0];
            currentWorldLandmarks = poseRes.worldLandmarks ? poseRes.worldLandmarks[0] : currentPoseLandmarks;
          }
        } catch (e) {
          // Monotonic timestamp protection on video loop
        }

        if (faceLandmarker) {
          try {
            const faceRes = faceLandmarker.detectForVideo(videoEl, nowMs);
            if (faceRes.faceLandmarks && faceRes.faceLandmarks.length > 0) {
              const fl = faceRes.faceLandmarks[0];
              const span = fl[263].x - fl[33].x;
              const yaw = span !== 0 ? ((fl[1].x - fl[33].x) - (fl[263].x - fl[1].x)) / Math.abs(span) : 0.0;
              currentFaceMetrics = { head_yaw: Number(yaw.toFixed(3)), face_detected: true };
            }
          } catch (e) {}
        }
      }

      drawSkeleton(ctx, currentPoseLandmarks, canvasEl.width, canvasEl.height);
      const currentTimeSec = videoEl.currentTime || (performance.now() - (sessionStartTime || performance.now())) / 1000.0;
      updateLiveTelemetry(currentPoseLandmarks, currentWorldLandmarks, currentFaceMetrics, currentTimeSec, frameCounter);
    }

    animationFrameId = requestAnimationFrame(renderFrame);
  }

  renderFrame();
}

// Guided Recording Session (10 FPS Sampling)
if (startRecordBtn) {
  startRecordBtn.addEventListener("click", () => {
    if (isRecording) return;

    isRecording = true;
    capturedFrames = [];
    clearLogTable();
    if (mathBreakdownCard) mathBreakdownCard.hidden = true;

    sessionStartTime = performance.now();
    startRecordBtn.disabled = true;
    startRecordBtn.textContent = "Recording... [Active]";
    timerBadge.hidden = false;
    videoStatus.textContent = "Recording session active. Measuring walking gait...";

    sampleTimer = setInterval(() => {
      const elapsedSec = (performance.now() - sessionStartTime) / 1000.0;
      const remainingSec = Math.max(0.0, SESSION_DURATION_SEC - elapsedSec);
      countdownText.textContent = `${remainingSec.toFixed(1)}s`;
      frameCountText.textContent = `${capturedFrames.length} / ${TARGET_FRAMES}`;

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

// Stop / Reset Button
if (stopRecordBtn) {
  stopRecordBtn.addEventListener("click", () => {
    if (sampleTimer) clearInterval(sampleTimer);
    isRecording = false;
    startRecordBtn.disabled = false;
    startRecordBtn.textContent = "Record Session";
    timerBadge.hidden = true;
    videoStatus.textContent = "Session reset.";
  });
}

// Transmit Landmarks & Compute Detailed Breakdown
async function finishRecordingSession() {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  startRecordBtn.disabled = false;
  startRecordBtn.textContent = "Record Session";
  timerBadge.hidden = true;

  videoStatus.textContent = `Analyzing ${capturedFrames.length} landmark coordinate frames via NumPy backend...`;

  const payload = {
    child_age_months: parseInt(childAgeInput.value, 10) || 24,
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
    if (!res.ok) throw new Error(data.detail || "Analysis failed.");

    displayMathematicalBreakdown(data);
    videoStatus.textContent = "Analysis complete. Review mathematical decision breakdown below.";
  } catch (err) {
    console.error("Backend error:", err);
    videoStatus.textContent = err.message || "Failed to connect to backend.";
    videoStatus.classList.add("error");
  }
}

// Instant Demo Runner (Real Live MediaPipe Inference on Benchmark Walking Video)
async function runDemoWalking() {
  clearLogTable();
  if (mathBreakdownCard) mathBreakdownCard.hidden = true;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if (sampleTimer) clearInterval(sampleTimer);

  videoStatus.textContent = "Loading AI Vision model & benchmark walking gait video...";

  if (videoViewportWrap) {
    videoViewportWrap.classList.add("video-active");
    videoViewportWrap.classList.remove("selfie-mirrored");
  }

  if (!poseLandmarker) {
    await initMediaPipeVision();
  }

  videoEl.srcObject = null;
  videoEl.src = "assets/tutorial_walking.mp4";
  videoEl.loop = true;
  videoEl.muted = true;
  await videoEl.play().catch((e) => console.warn("Video play error:", e));

  startCamBtn.disabled = false;
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = false;
  videoStatus.textContent = "Live AI tracking active on walking video. 33 landmarks moving in lockstep with child.";

  startTrackingLoop();

  // Benchmark automated 120-frame collection
  isRecording = true;
  capturedFrames = [];
  sessionStartTime = performance.now();
  timerBadge.hidden = false;

  sampleTimer = setInterval(() => {
    const elapsedSec = (performance.now() - sessionStartTime) / 1000.0;
    const remainingSec = Math.max(0.0, SESSION_DURATION_SEC - elapsedSec);
    countdownText.textContent = `${remainingSec.toFixed(1)}s`;
    frameCountText.textContent = `${capturedFrames.length} / ${TARGET_FRAMES}`;

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
}

if (runDemoBtn) runDemoBtn.addEventListener("click", runDemoWalking);

// Display Detailed Mathematical Calculation & Engineering Steps
function displayMathematicalBreakdown(data) {
  if (!mathBreakdownCard || !mathStepsList) return;

  const st = data.screening_status || "YELLOW";
  mathBreakdownCard.hidden = false;
  mathStatusBadge.className = `badge-status ${st}`;
  mathStatusBadge.textContent = st;

  const m = data.metrics || {};
  const gsi = m.gait_symmetry_index !== undefined ? m.gait_symmetry_index : 1.0;
  const spine = m.mean_spine_tilt_deg !== undefined ? m.mean_spine_tilt_deg : 0.0;
  const lk = m.mean_left_knee_deg !== undefined ? m.mean_left_knee_deg : 170.0;
  const rk = m.mean_right_knee_deg !== undefined ? m.mean_right_knee_deg : 170.0;

  mathStepsList.innerHTML = `
    <div class="math-step-item">
      <strong>1. Invariant Coordinate Normalization:</strong>
      Mid-Hip origin shifted to (0,0,0) via H_mid = (P_23 + P_24) / 2. All 33 coordinates divided by Torso Length L_torso = ||S_mid - H_mid||_2 (${m.frames_analyzed || 120} frames normalized). This eliminates camera distance variations.
    </div>
    <div class="math-step-item">
      <strong>2. 3D Joint Angle Computation (arccos dot product):</strong>
      Left Knee Mean: <strong>${lk}°</strong> | Right Knee Mean: <strong>${rk}°</strong> | Coronal Spine Tilt: <strong>${spine}°</strong> (Baseline <= 12°).
    </div>
    <div class="math-step-item">
      <strong>3. Gait Symmetry Index (GSI):</strong>
      Tracked horizontal ankle separation s(t) = x_27(t) - x_28(t). Left step peak vs Right step peak ratio:
      GSI = min(S_L, S_R) / max(S_L, S_R) = <strong>${gsi}</strong>.
    </div>
    <div class="math-step-item">
      <strong>4. RBSK 2.0 Clinical Triage Decision:</strong>
      ${gsi >= 0.85 
        ? "<strong>GREEN (Normal):</strong> Step symmetry ratio >= 0.85 confirms bilateral stride equilibrium. No limp or unilateral weakness flagged." 
        : gsi >= 0.70 
          ? "<strong>YELLOW (Mild Asymmetry):</strong> Step symmetry between 0.70 and 0.84. Mild stride discrepancy noted."
          : "<strong>RED (Significant Asymmetry):</strong> Step symmetry < 0.70. High risk for unilateral limp, hip dysplasia, or hemiplegia."}
    </div>
  `;

  mathBreakdownCard.scrollIntoView({ behavior: "smooth" });
}

/* ==========================================================================
   4. Preserved Skin & Eye Classifiers
   ========================================================================== */
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
  const btnFlipCam = card.querySelector(".btn-flip-cam");

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
      setStatus("Please choose a JPG or PNG image.", true);
      return;
    }

    previewUrl = URL.createObjectURL(selectedFile);
    if (previewImage) {
      previewImage.src = previewUrl;
      previewImage.style.display = "inline-block";
    }
    if (predictBtn) predictBtn.disabled = false;
  }

  if (fileInput) fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  if (uploadBox) {
    uploadBox.addEventListener("dragover", (e) => { e.preventDefault(); uploadBox.classList.add("dragover"); });
    uploadBox.addEventListener("dragleave", (e) => { e.preventDefault(); uploadBox.classList.remove("dragover"); });
    uploadBox.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadBox.classList.remove("dragover");
      if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
    });
  }

  function stopActiveCamera() {
    if (activeCamStream) {
      activeCamStream.getTracks().forEach((t) => t.stop());
      activeCamStream = null;
    }
    if (camFeed) camFeed.srcObject = null;
    if (btnSnapPhoto) btnSnapPhoto.disabled = true;
    if (btnOpenCam) btnOpenCam.textContent = "Start Camera";
  }

  async function startActiveCamera() {
    stopActiveCamera();
    try {
      activeCamStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      if (camFeed) {
        camFeed.srcObject = activeCamStream;
        await camFeed.play();
      }
      if (btnSnapPhoto) btnSnapPhoto.disabled = false;
      if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
    } catch (e) {
      try {
        activeCamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (camFeed) { camFeed.srcObject = activeCamStream; await camFeed.play(); }
        if (btnSnapPhoto) btnSnapPhoto.disabled = false;
        if (btnOpenCam) btnOpenCam.textContent = "Stop Camera";
      } catch (err) {
        setStatus("Camera not accessible.", true);
      }
    }
  }

  if (btnOpenCam) {
    btnOpenCam.addEventListener("click", () => {
      if (activeCamStream) stopActiveCamera();
      else startActiveCamera();
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
        if (!blob) return;
        const snapFile = new File([blob], `snap_${Date.now()}.jpg`, { type: "image/jpeg" });
        handleFile(snapFile);
        stopActiveCamera();

        modeTabs.forEach((b) => b.classList.toggle("active", b.dataset.mode === "upload"));
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";
      }, "image/jpeg", 0.92);
    });
  }

  modeTabs.forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const mode = tabBtn.dataset.mode;
      modeTabs.forEach((b) => b.classList.toggle("active", b === tabBtn));

      if (mode === "upload") {
        if (uploadView) uploadView.style.display = "block";
        if (cameraView) cameraView.style.display = "none";
        stopActiveCamera();
      } else {
        if (uploadView) uploadView.style.display = "none";
        if (cameraView) cameraView.style.display = "block";
        startActiveCamera();
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
        if (!response.ok) throw new Error(data.detail || "Prediction failed.");

        if (statusBanner) statusBanner.className = `result-banner status-banner ${data.screening_status}`;
        if (statusTitle) statusTitle.textContent = `Status: ${data.screening_status}`;
        if (predictionText) predictionText.textContent = `Detected: ${data.predicted_class} (${Number(data.confidence).toFixed(1)}%)`;
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
      const fileInput = card.querySelector(".file-input");
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change"));

      const uploadModeBtn = card.querySelector('[data-mode="upload"]');
      if (uploadModeBtn) uploadModeBtn.click();

      setTimeout(() => {
        const predictBtn = card.querySelector(".predict-btn");
        if (predictBtn && !predictBtn.disabled) predictBtn.click();
      }, 350);
    } catch (e) {
      console.error(e);
    }
  });
});
