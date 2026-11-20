// ============================================================
// Nanhe Kadam - Working Prototype: 33 Landmark Tracker
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
// 1. Language Toggle (EN / Hindi)
// ============================================================
const I18N = {
  en: {
    brand_sub: "RBSK 2.0 Aligned - Pediatric Biomechanical Screening",
    status_ready: "Offline Ready",
    tab_walking: "Walking Gait Analysis",
    tab_skin: "Skin Condition",
    tab_eye: "Eye Condition",
    label_age: "Child Age (Months):",
    label_task: "Screening Task:",
    btn_start_cam: "Start Live Camera",
    btn_upload_video: "Upload Video File",
    btn_run_demo: "Run Walking Demo",
    btn_record: "Record Session",
    btn_reset: "Reset",
    viewport_title: "Live 9:16 Vision Stream",
    btn_markers_on: "Markers: ON",
    btn_markers_off: "Markers: OFF",
    guide_head: "HEAD TARGET",
    guide_shoulders: "SHOULDERS",
    guide_feet: "FEET / ANKLES",
    status_waiting: "Waiting for Input...",
    status_ready_prompt: "Ready. Start camera or upload video.",
    kpi_framing: "Framing",
    kpi_spine: "Spine Tilt",
    kpi_lknee: "L-Knee",
    kpi_rknee: "R-Knee",
    kpi_gsi: "Ankle Sep",
    kpi_yaw: "Head Yaw",
    log_stream_title: "Per-Frame Telemetry Log (Every Detection)",
    btn_copy_json: "Copy JSON",
    th_sec: "Time",
    th_frame: "Frame",
    th_lknee: "L-Knee",
    th_rknee: "R-Knee",
    th_spine: "Spine",
    th_sep: "Ankle Sep",
    th_torso: "Torso(px)",
    th_status: "Status",
    empty_log: "Telemetry data will stream here every frame...",
    math_title: "Biomechanical Decision Calculation",
  },
  hi: {
    brand_sub: "RBSK 2.0 - बाल स्वास्थ्य जाँच",
    status_ready: "ऑफ़लाइन चालू",
    tab_walking: "चलने की चाल जाँच",
    tab_skin: "त्वचा स्थिति",
    tab_eye: "नेत्र स्थिति",
    label_age: "बच्चे की उम्र (महीने):",
    label_task: "जाँच का प्रकार:",
    btn_start_cam: "कैमरा शुरू करें",
    btn_upload_video: "वीडियो अपलोड करें",
    btn_run_demo: "डेमो चलाएं",
    btn_record: "रिकॉर्ड करें",
    btn_reset: "रीसेट करें",
    viewport_title: "लाइव 9:16 विजन स्ट्रीम",
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
    kpi_gsi: "कदम दूरी",
    kpi_yaw: "सिर का कोण",
    log_stream_title: "प्रति-फ्रेम टेलीमेट्री लॉग",
    btn_copy_json: "JSON कॉपी करें",
    th_sec: "समय",
    th_frame: "फ्रेम",
    th_lknee: "बायाँ घुटना",
    th_rknee: "दायाँ घुटना",
    th_spine: "रीढ़",
    th_sep: "कदम दूरी",
    th_torso: "धड़(px)",
    th_status: "स्थिति",
    empty_log: "टेलीमेट्री डेटा यहाँ हर फ्रेम पर दर्ज होगा...",
    math_title: "गणितीय गणना",
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
// 2. Tab Switching
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
const toggleMarkersBtn = document.getElementById("toggleMarkersBtn");
const cameraGuideFrame = document.getElementById("cameraGuideFrame");

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
let animationFrameId = null;
let isRecording = false;
let sessionStartTime = null;
let capturedFrames = [];
let sampleTimer = null;
let showMarkers = true;

// Monotonically increasing timestamp for MediaPipe
let mpTimestamp = 1;

// Tracking state
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;
let frameCounter = 0;
let allLogs = []; // Stores EVERY frame log

const TARGET_FPS = 10.0;
const SESSION_DURATION_SEC = 12.0;
const TARGET_FRAMES = 120;

// MediaPipe 33 Landmark Names
const LANDMARK_NAMES = [
  "nose","left_eye_inner","left_eye","left_eye_outer","right_eye_inner",
  "right_eye","right_eye_outer","left_ear","right_ear","mouth_left",
  "mouth_right","left_shoulder","right_shoulder","left_elbow","right_elbow",
  "left_wrist","right_wrist","left_pinky","right_pinky","left_index",
  "right_index","left_thumb","right_thumb","left_hip","right_hip",
  "left_knee","right_knee","left_ankle","right_ankle","left_heel",
  "right_heel","left_foot_index","right_foot_index"
];

// ============================================================
// 5. Markers Toggle
// ============================================================
if (toggleMarkersBtn) {
  toggleMarkersBtn.addEventListener("click", () => {
    showMarkers = !showMarkers;
    const dict = I18N[currentLang] || I18N.en;
    toggleMarkersBtn.textContent = showMarkers ? dict.btn_markers_on : dict.btn_markers_off;
    if (cameraGuideFrame) cameraGuideFrame.style.display = showMarkers ? "block" : "none";
  });
}

// ============================================================
// 6. Math Utilities
// ============================================================
function angle3D(a, b, c) {
  // Angle at joint B formed by A-B-C using arccos dot product
  const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z||0) - (b.z||0);
  const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z||0) - (b.z||0);
  const nu = Math.sqrt(ux*ux + uy*uy + uz*uz);
  const nv = Math.sqrt(vx*vx + vy*vy + vz*vz);
  if (nu < 1e-5 || nv < 1e-5) return 180.0;
  let cos = (ux*vx + uy*vy + uz*vz) / (nu * nv);
  cos = Math.max(-1.0, Math.min(1.0, cos));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

function vis(p) {
  // Returns true if landmark is visible enough
  if (!p) return false;
  if (p.visibility === undefined) return true;
  return p.visibility > 0.15;
}

// ============================================================
// 7. DRAW SKELETON - Big Visible Dots + Connections
// ============================================================
function drawSkeleton(landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || landmarks.length < 33) return;

  // --- Body Connections (green lines) ---
  const BODY = [
    [11,12],[11,23],[12,24],[23,24], // torso box
    [11,13],[13,15],[15,17],[15,19],[15,21], // left arm
    [12,14],[14,16],[16,18],[16,20],[16,22], // right arm
    [23,25],[25,27], // left leg
    [24,26],[26,28], // right leg
    [0,1],[1,2],[2,3],[3,7], // left face
    [0,4],[4,5],[5,6],[6,8], // right face
    [9,10], // mouth
  ];

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(16, 185, 129, 0.9)";

  for (const [i, j] of BODY) {
    const a = landmarks[i], b = landmarks[j];
    if (vis(a) && vis(b)) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }

  // --- Foot Triangles (amber/orange lines, thicker) ---
  const FEET = [
    [27,29],[29,31],[31,27], // left foot
    [28,30],[30,32],[32,28], // right foot
  ];

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(245, 158, 11, 1.0)";

  for (const [i, j] of FEET) {
    const a = landmarks[i], b = landmarks[j];
    if (vis(a) && vis(b)) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }

  // --- Draw ALL 33 dots - BIG and VISIBLE ---
  landmarks.forEach((p, idx) => {
    if (!vis(p)) return;
    const px = p.x * w;
    const py = p.y * h;

    // Dot size: face=3px, body=4px, feet=5px
    let r, color;
    if (idx <= 10) {
      r = 3; color = "#94A3B8"; // face: gray
    } else if (idx <= 22) {
      r = 4; color = "#38BDF8"; // arms: sky blue
    } else if (idx <= 24) {
      r = 4; color = "#10B981"; // hips: green
    } else if (idx <= 26) {
      r = 5; color = "#10B981"; // knees: green
    } else {
      r = 5; color = "#F59E0B"; // feet/ankles: amber
    }

    // Outer glow
    ctx.beginPath();
    ctx.arc(px, py, r + 2, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // White border
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // --- Angle labels near joints ---
  if (showMarkers) {
    const lk = angle3D(landmarks[23], landmarks[25], landmarks[27]);
    const rk = angle3D(landmarks[24], landmarks[26], landmarks[28]);

    // Left knee label
    if (vis(landmarks[25])) {
      drawLabel(ctx, `L:${lk.toFixed(0)}`, landmarks[25].x*w - 28, landmarks[25].y*h - 8);
    }
    // Right knee label
    if (vis(landmarks[26])) {
      drawLabel(ctx, `R:${rk.toFixed(0)}`, landmarks[26].x*w + 10, landmarks[26].y*h - 8);
    }

    // Left ankle flexion
    if (vis(landmarks[27]) && vis(landmarks[31])) {
      const lf = angle3D(landmarks[25], landmarks[27], landmarks[31]);
      drawLabel(ctx, `LF:${lf.toFixed(0)}`, landmarks[27].x*w - 32, landmarks[27].y*h + 10, "#D97706");
    }
    // Right ankle flexion
    if (vis(landmarks[28]) && vis(landmarks[32])) {
      const rf = angle3D(landmarks[26], landmarks[28], landmarks[32]);
      drawLabel(ctx, `RF:${rf.toFixed(0)}`, landmarks[28].x*w + 8, landmarks[28].y*h + 10, "#D97706");
    }

    // Spine tilt
    const smx = (landmarks[11].x + landmarks[12].x) / 2;
    const smy = (landmarks[11].y + landmarks[12].y) / 2;
    const hmx = (landmarks[23].x + landmarks[24].x) / 2;
    const hmy = (landmarks[23].y + landmarks[24].y) / 2;
    const dx = smx - hmx, dy = smy - hmy;
    const tilt = Math.abs(Math.atan2(dx, dy) * 180 / Math.PI);
    const sx = (smx + hmx) / 2, sy = (smy + hmy) / 2;
    drawLabel(ctx, `S:${tilt.toFixed(1)}`, sx*w + 20, sy*h, "#0F5C5C");
  }
}

function drawLabel(ctx, text, x, y, bg = "rgba(15,23,42,0.8)") {
  ctx.save();
  ctx.font = "bold 10px monospace";
  const tw = ctx.measureText(text).width;
  const bx = Math.max(2, Math.min(x, ctx.canvas.width - tw - 8));
  const by = Math.max(2, Math.min(y, ctx.canvas.height - 14));

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + 6, 14, 3);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, bx + 3, by + 2);
  ctx.restore();
}

// ============================================================
// 8. TELEMETRY - Log EVERY frame detection
// ============================================================
function computeTelemetry(pose, timeSec, frame) {
  if (!pose || pose.length < 33) return null;

  const lk = angle3D(pose[23], pose[25], pose[27]);
  const rk = angle3D(pose[24], pose[26], pose[28]);

  const smx = (pose[11].x + pose[12].x) / 2;
  const smy = (pose[11].y + pose[12].y) / 2;
  const hmx = (pose[23].x + pose[24].x) / 2;
  const hmy = (pose[23].y + pose[24].y) / 2;
  const dx = smx - hmx, dy = smy - hmy;
  const spine = Math.abs(Math.atan2(dx, dy) * 180 / Math.PI);
  const torsoPx = Math.sqrt(dx*dx*canvasEl.width*canvasEl.width + dy*dy*canvasEl.height*canvasEl.height);

  let ankleSep = 0;
  if (pose[27] && pose[28]) {
    ankleSep = Math.abs(pose[27].x - pose[28].x);
  }

  const headOk = vis(pose[0]);
  const feetOk = vis(pose[27]) || vis(pose[28]);
  const framing = headOk && feetOk ? "OK" : headOk ? "No-Feet" : "Partial";

  // Left/Right foot angles
  let lFoot = 0, rFoot = 0;
  if (vis(pose[25]) && vis(pose[27]) && vis(pose[31])) {
    lFoot = angle3D(pose[25], pose[27], pose[31]);
  }
  if (vis(pose[26]) && vis(pose[28]) && vis(pose[32])) {
    rFoot = angle3D(pose[26], pose[28], pose[32]);
  }

  // Hip angle
  let lHip = 0, rHip = 0;
  if (vis(pose[11]) && vis(pose[23]) && vis(pose[25])) {
    lHip = angle3D(pose[11], pose[23], pose[25]);
  }
  if (vis(pose[12]) && vis(pose[24]) && vis(pose[26])) {
    rHip = angle3D(pose[12], pose[24], pose[26]);
  }

  return {
    time: Number(timeSec.toFixed(3)),
    frame: frame,
    lKnee: Number(lk.toFixed(1)),
    rKnee: Number(rk.toFixed(1)),
    spine: Number(spine.toFixed(1)),
    ankleSep: Number(ankleSep.toFixed(4)),
    torsoPx: Number(torsoPx.toFixed(1)),
    lFoot: Number(lFoot.toFixed(1)),
    rFoot: Number(rFoot.toFixed(1)),
    lHip: Number(lHip.toFixed(1)),
    rHip: Number(rHip.toFixed(1)),
    framing: framing,
  };
}

function updateKPIs(t) {
  if (!t) return;
  if (teleSpine) teleSpine.textContent = `${t.spine}°`;
  if (teleLKnee) teleLKnee.textContent = `${t.lKnee}°`;
  if (teleRKnee) teleRKnee.textContent = `${t.rKnee}°`;
  if (teleGSI) teleGSI.textContent = `${t.ankleSep}`;
  if (teleFraming) teleFraming.textContent = t.framing;

  // Framing badge
  if (framingBadge) {
    if (t.framing === "OK") {
      framingBadge.innerHTML = `<span class="hud-dot green"></span> Full Body`;
    } else if (t.framing === "No-Feet") {
      framingBadge.innerHTML = `<span class="hud-dot yellow"></span> Upper Only`;
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
    <td><span class="badge-status ${t.framing==='OK'?'GREEN':'YELLOW'}">${t.framing}</span></td>
  `;
  telemetryTableBody.appendChild(tr);

  // Keep table scrolled to bottom
  const container = telemetryTableBody.closest(".table-container");
  if (container) container.scrollTop = container.scrollHeight;
}

function clearLogs() {
  allLogs = [];
  frameCounter = 0;
  if (telemetryTableBody) {
    const dict = I18N[currentLang] || I18N.en;
    telemetryTableBody.innerHTML = `<tr class="empty-row"><td colspan="8">${dict.empty_log}</td></tr>`;
  }
}

// Copy JSON
if (copyTelemetryBtn) {
  copyTelemetryBtn.addEventListener("click", () => {
    if (allLogs.length === 0) { alert("No data yet."); return; }
    navigator.clipboard.writeText(JSON.stringify(allLogs, null, 2)).then(() => {
      copyTelemetryBtn.textContent = "Copied!";
      setTimeout(() => { copyTelemetryBtn.textContent = I18N[currentLang]?.btn_copy_json || "Copy JSON"; }, 1500);
    });
  });
}

// ============================================================
// 9. MediaPipe Initialization
// ============================================================
async function initMediaPipe() {
  if (poseLandmarker) return;
  try {
    if (videoStatus) videoStatus.textContent = "Loading AI Vision model...";
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
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
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
    } catch (e) { console.warn("Face model skipped:", e); }

    if (videoStatus) videoStatus.textContent = "AI Model ready. Start camera or upload video.";
  } catch (err) {
    console.error("MediaPipe load error:", err);
    if (videoStatus) videoStatus.textContent = "Model load error: " + err.message;
  }
}

window.addEventListener("mediapipe-ready", initMediaPipe);
if (window.MediaPipeVision) initMediaPipe();

// ============================================================
// 10. Main Tracking Loop - runs on EVERY animation frame
// ============================================================
let lastVideoTime = -1;

function startTracking() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  lastVideoTime = -1;
  mpTimestamp = performance.now();

  function tick() {
    if (videoEl && videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth || 360;
      const vh = videoEl.videoHeight || 640;

      // Keep canvas pixels matched to video pixels
      if (canvasEl.width !== vw || canvasEl.height !== vh) {
        canvasEl.width = vw;
        canvasEl.height = vh;
      }

      // Only detect when we have a new video frame
      const curTime = videoEl.currentTime;
      if (poseLandmarker && curTime !== lastVideoTime) {
        lastVideoTime = curTime;
        mpTimestamp += 40; // Strictly increasing timestamp

        try {
          const result = poseLandmarker.detectForVideo(videoEl, mpTimestamp);
          if (result.landmarks && result.landmarks.length > 0) {
            currentPoseLandmarks = result.landmarks[0];
            currentWorldLandmarks = result.worldLandmarks ? result.worldLandmarks[0] : result.landmarks[0];
          } else {
            currentPoseLandmarks = null;
            currentWorldLandmarks = null;
          }
        } catch (e) {
          // Silently handle detection errors (e.g., on loop restart)
        }

        // Face detection
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

        // Update frame counter and telemetry for EVERY detection
        frameCounter++;
        const timeSec = videoEl.currentTime || 0;

        // Draw skeleton
        drawSkeleton(currentPoseLandmarks, canvasEl.width, canvasEl.height);

        // Compute and log telemetry for THIS frame
        const telemetry = computeTelemetry(currentPoseLandmarks, timeSec, frameCounter);
        if (telemetry) {
          updateKPIs(telemetry);

          // Log every frame but only add table row every ~200ms to prevent UI flood
          allLogs.push(telemetry);
          if (allLogs.length % 3 === 0 || allLogs.length <= 5) {
            appendLogRow(telemetry);
          }

          // Update head yaw
          if (currentFaceMetrics && teleYaw) {
            teleYaw.textContent = `${Math.round((currentFaceMetrics.head_yaw || 0) * 45)}°`;
          }
        }
      } else {
        // Still draw even if no new detection (keeps overlay in sync)
        drawSkeleton(currentPoseLandmarks, canvasEl.width, canvasEl.height);
      }
    }

    animationFrameId = requestAnimationFrame(tick);
  }

  tick();
}

// ============================================================
// 11. Camera Start
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
// 12. Video Upload
// ============================================================
function handleVideoFile(file) {
  if (!file) return;
  stopEverything();
  clearLogs();

  if (viewportWrap) {
    viewportWrap.classList.remove("selfie-mirrored");
  }

  videoEl.srcObject = null;
  videoEl.src = URL.createObjectURL(file);
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.play().then(() => {
    startCamBtn.disabled = false;
    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = false;
    videoStatus.textContent = `"${file.name}" loaded. AI tracking active on every frame.`;
    startTracking();
  }).catch(e => {
    videoStatus.textContent = `Video play error: ${e.message}`;
  });
}

const fileInputAlt = document.getElementById("videoFileInputAlt");
if (fileInputAlt) fileInputAlt.addEventListener("change", (e) => handleVideoFile(e.target.files[0]));

// ============================================================
// 13. Demo Button - Runs REAL MediaPipe on tutorial_walking.mp4
// ============================================================
async function runDemo() {
  stopEverything();
  clearLogs();

  if (viewportWrap) {
    viewportWrap.classList.remove("selfie-mirrored");
  }

  videoStatus.textContent = "Loading AI model and demo video...";

  if (!poseLandmarker) {
    await initMediaPipe();
  }

  videoEl.srcObject = null;
  videoEl.src = "assets/tutorial_walking.mp4";
  videoEl.loop = true;
  videoEl.muted = true;

  try {
    await videoEl.play();
  } catch (e) {
    videoStatus.textContent = "Could not play demo video: " + e.message;
    return;
  }

  startCamBtn.disabled = false;
  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = false;
  videoStatus.textContent = "Live AI tracking on demo video. 33 landmarks moving with the child.";

  startTracking();

  // Auto-collect 120 frames for backend analysis
  startAutoRecording();
}

if (runDemoBtn) runDemoBtn.addEventListener("click", runDemo);

// ============================================================
// 14. Recording Session (10 FPS sampling for backend)
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

    if (currentWorldLandmarks && currentWorldLandmarks.length >= 33) {
      capturedFrames.push({
        timestamp_ms: Math.round(elapsed * 1000),
        pose_world_landmarks: currentWorldLandmarks.map(lm => ({
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
// 15. Results Display
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

  let verdict;
  if (gsi >= 0.85) {
    verdict = `<strong>GREEN - Normal:</strong> GSI ${gsi} >= 0.85. Symmetric gait. No limp detected.`;
  } else if (gsi >= 0.70) {
    verdict = `<strong>YELLOW - Mild Asymmetry:</strong> GSI ${gsi}. Slight stride difference. Re-screen recommended.`;
  } else {
    verdict = `<strong>RED - Significant Asymmetry:</strong> GSI ${gsi} < 0.70. High risk for limp, hip dysplasia, or hemiplegia.`;
  }

  mathStepsList.innerHTML = `
    <div class="math-step-item">
      <strong>1. Normalization</strong>
      Mid-Hip origin H_mid = (P23 + P24)/2. Torso length L = ||S_mid - H_mid||. ${m.frames_analyzed || capturedFrames.length} frames normalized.
    </div>
    <div class="math-step-item">
      <strong>2. Joint Angles (3D arccos)</strong>
      Left Knee: <strong>${lk}°</strong> | Right Knee: <strong>${rk}°</strong> | Spine Tilt: <strong>${spine}°</strong> (normal <= 12°)
    </div>
    <div class="math-step-item">
      <strong>3. Gait Symmetry Index (GSI)</strong>
      Ankle separation s(t) tracked. GSI = min(S_L, S_R) / max(S_L, S_R) = <strong>${gsi}</strong>
    </div>
    <div class="math-step-item">
      <strong>4. Clinical Decision</strong>
      ${verdict}
    </div>
    <div class="math-step-item">
      <strong>5. Risk Flags</strong>
      ${(data.clinical_flags || []).map(f => `- ${f}`).join("<br>") || "No flags raised."}
    </div>
  `;

  mathBreakdownCard.scrollIntoView({ behavior: "smooth" });
}

// ============================================================
// 16. Cleanup Helper
// ============================================================
function stopEverything() {
  if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  isRecording = false;
  currentPoseLandmarks = null;
  currentWorldLandmarks = null;
}

// ============================================================
// 17. Skin & Eye Classifiers (preserved from original)
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
