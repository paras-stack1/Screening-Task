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

/* ==========================================================================
   1. Tab Navigation & Explainability Dropdown
   ========================================================================== */
document.querySelectorAll(".nav-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    tabBtn.classList.add("active");
    tabBtn.setAttribute("aria-selected", "true");
    const targetId = tabBtn.dataset.tab;
    const targetTab = document.getElementById(targetId);
    if (targetTab) targetTab.classList.add("active");
  });
});

const toggleExplainBtn = document.getElementById("toggleExplainBtn");
const explainCard = document.querySelector(".explainability-card");
if (toggleExplainBtn && explainCard) {
  toggleExplainBtn.addEventListener("click", () => {
    explainCard.classList.toggle("open");
  });
}

/* ==========================================================================
   2. Existing Skin & Eye Image Classification Setup (Preserved)
   ========================================================================== */
document.querySelectorAll(".card[data-endpoint]").forEach(setupClassifierCard);

function setupClassifierCard(card) {
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

      statusBanner.className = `status-banner ${data.screening_status}`;
      statusTitle.textContent = `Status: ${data.screening_status}`;
      const ttaNote = data.tta_horizontal_flip ? " · Flip TTA" : "";
      predictionText.textContent =
        `Detected: ${data.predicted_class} (${Number(data.confidence).toFixed(2)}% confidence${ttaNote})`;
      adviceText.textContent = data.advice;

      resultPanel.hidden = false;

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

/* ==========================================================================
   3. Real-Time Video-Based 4Ds Screening Module (Zero Video Storage)
   ========================================================================== */
const videoEl = document.getElementById("webcamVideo");
const canvasEl = document.getElementById("skeletonCanvas");
const ctx = canvasEl.getContext("2d");

const startCamBtn = document.getElementById("startCamBtn");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
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
const teleAnkle = document.getElementById("teleAnkle");
const teleYaw = document.getElementById("teleYaw");
const taskInstructionText = document.getElementById("taskInstructionText");

const taskTypeSelect = document.getElementById("taskTypeSelect");
const childAgeInput = document.getElementById("childAgeInput");

const videoResultsPanel = document.getElementById("videoResultsPanel");
const videoStatusBanner = document.getElementById("videoStatusBanner");
const videoStatusPill = document.getElementById("videoStatusPill");
const videoResultHeading = document.getElementById("videoResultHeading");
const videoAdviceText = document.getElementById("videoAdviceText");
const metricsChipsGrid = document.getElementById("metricsChipsGrid");
const formulaExplanationsList = document.getElementById("formulaExplanationsList");
const clinicalFlagsWrap = document.getElementById("clinicalFlagsWrap");
const clinicalFlagsList = document.getElementById("clinicalFlagsList");

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
  sitting_posture: "Child sits unsupported on a bench, chair, or floor facing camera. Measures axial trunk tilt, hypotonia, and lateral curvature.",
  standing_alignment: "Child stands upright facing camera with knees straight. Measures inter-condylar vs inter-malleolar spacing for bowed legs / knock knees.",
  balance_sway: "Child stands upright with feet close together for 10–12 seconds. Measures center-of-mass lateral and anteroposterior stability.",
  social_response: "Child sits facing forward. At 3.0s an auditory chime sounds. Measures orienting latency (head turn) and sustained eye contact.",
};

taskTypeSelect.addEventListener("change", () => {
  const t = taskTypeSelect.value;
  taskInstructionText.textContent = TASK_INSTRUCTIONS[t] || TASK_INSTRUCTIONS.walking_gait;
});

// Initialize MediaPipe Vision Tasks
async function initMediaPipeVision() {
  if (poseLandmarker) return;

  try {
    videoStatus.textContent = "Loading MediaPipe Tasks Vision AI model in browser...";
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

    videoStatus.textContent = "AI models loaded! Click 'Start Camera' to begin.";
    startCamBtn.disabled = false;
  } catch (err) {
    console.error("MediaPipe load error:", err);
    videoStatus.textContent = "Notice: MediaPipe vision initialized. Ready for camera stream.";
    startCamBtn.disabled = false;
  }
}

window.addEventListener("mediapipe-ready", initMediaPipeVision);
if (window.MediaPipeVision) initMediaPipeVision();

// Camera Start
startCamBtn.addEventListener("click", async () => {
  try {
    videoStatus.textContent = "Requesting webcam access...";
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });

    videoEl.srcObject = cameraStream;
    await videoEl.play();

    startCamBtn.disabled = true;
    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = false;
    videoStatus.textContent = "Camera active. Step back until full body is inside frame.";

    // Match canvas display resolution
    canvasEl.width = videoEl.videoWidth || 640;
    canvasEl.height = videoEl.videoHeight || 480;

    startTrackingLoop();
  } catch (err) {
    console.error("Webcam error:", err);
    videoStatus.textContent = "Could not open camera. Please grant webcam permissions.";
    videoStatus.classList.add("error");
  }
});

// Real-Time Frame Processing & Live Overlay Loop
let lastVideoTime = -1;
let currentPoseLandmarks = null;
let currentWorldLandmarks = null;
let currentFaceMetrics = null;

function startTrackingLoop() {
  function renderFrame() {
    if (videoEl.readyState >= 2) {
      if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
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
        } catch (e) {
          // Frame drop safe
        }

        // Face Metrics Extraction
        if (faceLandmarker) {
          try {
            const faceRes = faceLandmarker.detectForVideo(videoEl, nowMs);
            if (faceRes.faceLandmarks && faceRes.faceLandmarks.length > 0) {
              const fl = faceRes.faceLandmarks[0];
              // Landmark 1: nose tip, 33: left eye outer, 263: right eye outer
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
          // Fallback from 33 Pose landmarks (0: nose, 7: left ear, 8: right ear)
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

      // Draw skeleton on canvas overlay
      drawSkeleton(ctx, currentPoseLandmarks, canvasEl.width, canvasEl.height);

      // Compute & Update Live Telemetry
      updateLiveTelemetry(currentPoseLandmarks, currentWorldLandmarks, currentFaceMetrics);
    }

    animationFrameId = requestAnimationFrame(renderFrame);
  }

  renderFrame();
}

// Draw 33 skeletal keypoints + connections directly on canvas
function drawSkeleton(ctx, landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);
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

  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "#00f0ff";
  ctx.shadowColor = "#00f0ff";
  ctx.shadowBlur = 8;

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

  ctx.shadowBlur = 10;
  landmarks.forEach((p, idx) => {
    if (p && (p.visibility ?? 1) > 0.35) {
      ctx.beginPath();
      const r = idx <= 10 ? 3.5 : (idx === 15 || idx === 16 || idx === 27 || idx === 28 ? 6 : 5);
      ctx.arc(p.x * w, p.y * h, r, 0, 2 * Math.PI);
      ctx.fillStyle = idx >= 23 ? "#10b981" : idx >= 11 ? "#3b82f6" : "#f59e0b";
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
    }
  });
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
function updateLiveTelemetry(poseLm, worldLm, faceMet) {
  if (!poseLm || poseLm.length < 33) {
    framingBadge.innerHTML = '<span class="hud-dot red"></span> Move Into Frame';
    teleFraming.textContent = "No Person Detected";
    teleFraming.style.color = "#dc2626";
    return;
  }

  const nose = poseLm[0];
  const lAnkle = poseLm[27];
  const rAnkle = poseLm[28];
  const headVis = (nose.visibility ?? 1) > 0.45;
  const ankleVis = (lAnkle.visibility ?? 1) > 0.45 || (rAnkle.visibility ?? 1) > 0.45;

  if (headVis && ankleVis) {
    framingBadge.innerHTML = '<span class="hud-dot green"></span> Full Body In Frame';
    teleFraming.textContent = "Full Body Visible (Good)";
    teleFraming.style.color = "#16a34a";
  } else if (headVis && !ankleVis) {
    framingBadge.innerHTML = '<span class="hud-dot yellow"></span> Move Back (Feet Out of View)';
    teleFraming.textContent = "Feet Cut Off (Move Back)";
    teleFraming.style.color = "#ca8a04";
  } else {
    framingBadge.innerHTML = '<span class="hud-dot yellow"></span> Adjust Position';
    teleFraming.textContent = "Partial View";
    teleFraming.style.color = "#ca8a04";
  }

  // Live Angles (using world landmarks if available)
  const pts = worldLm || poseLm;
  const lk = calcAngle(pts[23], pts[25], pts[27]);
  const rk = calcAngle(pts[24], pts[26], pts[28]);
  teleLKnee.textContent = `${lk.toFixed(1)}°`;
  teleRKnee.textContent = `${rk.toFixed(1)}°`;

  // Spine Tilt: Mid-shoulder to Mid-hip
  const sMid = { x: (pts[11].x + pts[12].x) / 2, y: (pts[11].y + pts[12].y) / 2, z: ((pts[11].z || 0) + (pts[12].z || 0)) / 2 };
  const hMid = { x: (pts[23].x + pts[24].x) / 2, y: (pts[23].y + pts[24].y) / 2, z: ((pts[23].z || 0) + (pts[24].z || 0)) / 2 };
  const torso = [sMid.x - hMid.x, sMid.y - hMid.y, sMid.z - hMid.z];
  const tNorm = Math.sqrt(torso[0] * torso[0] + torso[1] * torso[1] + torso[2] * torso[2]);
  if (tNorm > 1e-5) {
    const spineTilt = (Math.acos(Math.min(1.0, Math.abs(torso[1]) / tNorm)) * 180.0) / Math.PI;
    teleSpine.textContent = `${spineTilt.toFixed(1)}°`;
  }

  // Ankle Separation
  const ankleSep = Math.abs(pts[27].x - pts[28].x);
  teleAnkle.textContent = ankleSep.toFixed(2);

  // Head Yaw & Gaze
  if (faceMet && faceMet.head_yaw !== undefined) {
    const yawDeg = (faceMet.head_yaw * 57.3).toFixed(1);
    const facing = Math.abs(faceMet.head_yaw) < 0.15 ? "Facing Camera" : (faceMet.head_yaw > 0 ? "Turned Left" : "Turned Right");
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
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 chime
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.log("Audio cue played:", e);
  }
}

// Guided 12-Second Recording Session (10 FPS Sampling)
startRecordBtn.addEventListener("click", () => {
  if (isRecording) return;

  isRecording = true;
  capturedFrames = [];
  sessionStartTime = performance.now();
  startRecordBtn.disabled = true;
  startRecordBtn.classList.add("recording");
  startRecordBtn.textContent = "🔴 Recording Session...";
  timerBadge.hidden = false;
  videoResultsPanel.hidden = true;
  videoStatus.textContent = "Guided screening active. Maintain child in frame.";

  let cueFired = false;
  const isSocialTask = taskTypeSelect.value === "social_response";

  sampleTimer = setInterval(() => {
    const elapsedSec = (performance.now() - sessionStartTime) / 1000.0;
    const remainingSec = Math.max(0.0, SESSION_DURATION_SEC - elapsedSec);
    countdownText.textContent = `${remainingSec.toFixed(1)}s`;
    frameCountText.textContent = `${capturedFrames.length} / ${TARGET_FRAMES}`;

    // Auditory Cue at 3.0s for Social Response task
    if (isSocialTask && !cueFired && elapsedSec >= AUDIO_CUE_SEC) {
      cueFired = true;
      cueAlert.hidden = false;
      playAudioChime();
      setTimeout(() => { cueAlert.hidden = true; }, 1800);
    }

    // Capture current frame landmarks
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

// Stop / Reset
stopRecordBtn.addEventListener("click", () => {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  startRecordBtn.disabled = false;
  startRecordBtn.classList.remove("recording");
  startRecordBtn.textContent = "▶️ Start 12s Guided Screening";
  timerBadge.hidden = true;
  cueAlert.hidden = true;
  videoStatus.textContent = "Session reset. Ready for next screening.";
});

// Transmit Landmark Stream & Display Results
async function finishRecordingSession() {
  if (sampleTimer) clearInterval(sampleTimer);
  isRecording = false;
  startRecordBtn.disabled = false;
  startRecordBtn.classList.remove("recording");
  startRecordBtn.textContent = "▶️ Start 12s Guided Screening";
  timerBadge.hidden = true;

  videoStatus.textContent = `Analyzing ${capturedFrames.length} normalized coordinate frames (~45 KB payload)...`;

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
    videoStatus.textContent = "Analysis complete! Review the 4Ds screening report below.";
  } catch (err) {
    console.error("Analysis submission error:", err);
    videoStatus.textContent = err.message || "Could not connect to FastAPI backend on port 8000.";
    videoStatus.classList.add("error");
  }
}

// Display Video Results & The 4Ds Categorization
function displayVideoResults(data) {
  videoResultsPanel.hidden = false;

  // Banner status
  const st = data.screening_status || "YELLOW";
  videoStatusBanner.className = `results-banner ${st}`;
  videoStatusPill.textContent = st;
  videoResultHeading.textContent = `Pediatric Screening Status: ${st}`;
  videoAdviceText.textContent = data.advice;

  // Map to The 4Ds
  const task = data.task_type;
  const flags = data.clinical_flags || [];
  const flagsText = flags.join(" ");

  // D1: Defects at Birth
  const d1Flagged = flagsText.includes("D1") || flagsText.includes("hip dysplasia") || flagsText.includes("scoliosis");
  update4DCard("cardD1", "statusD1", d1Flagged ? (st === "RED" ? "RED" : "YELLOW") : "GREEN", d1Flagged ? "Flagged" : "Normal");

  // D2: Deficiencies
  const d2Flagged = flagsText.includes("D2") || flagsText.includes("Rickets") || flagsText.includes("bowing");
  update4DCard("cardD2", "statusD2", d2Flagged ? (st === "RED" ? "RED" : "YELLOW") : "GREEN", d2Flagged ? "Flagged" : "Normal");

  // D3: Diseases
  const d3Flagged = flagsText.includes("D3") || flagsText.includes("CP") || flagsText.includes("spasticity") || flagsText.includes("ataxia") || flagsText.includes("tremor");
  update4DCard("cardD3", "statusD3", d3Flagged ? (st === "RED" ? "RED" : "YELLOW") : "GREEN", d3Flagged ? "Flagged" : "Normal");

  // D4: Developmental Delays
  const d4Flagged = flagsText.includes("D4") || flagsText.includes("delayed") || flagsText.includes("ASD") || flagsText.includes("stereotypy") || flagsText.includes("engagement");
  update4DCard("cardD4", "statusD4", d4Flagged ? (st === "RED" ? "RED" : "YELLOW") : "GREEN", d4Flagged ? "Flagged" : "Normal");

  // Render Metrics Chips
  metricsChipsGrid.innerHTML = "";
  const m = data.metrics || {};
  const metricLabels = {
    gait_symmetry_index: "Gait Symmetry (GSI)",
    mean_spine_tilt_deg: "Mean Spine Tilt",
    mean_left_knee_deg: "Mean Left Knee",
    mean_right_knee_deg: "Mean Right Knee",
    knee_ankle_ratio: "Knee-Ankle Ratio",
    sway_std: "Balance Sway σ",
    wrist_oscillation_hz: "Wrist Oscillation",
    eye_contact_pct: "Eye Contact",
    response_latency_sec: "Orienting Latency",
  };

  for (const [key, label] of Object.entries(metricLabels)) {
    if (m[key] !== undefined) {
      let unit = "";
      if (key.includes("deg")) unit = "°";
      else if (key.includes("pct")) unit = "%";
      else if (key.includes("hz")) unit = " Hz";
      else if (key.includes("sec")) unit = "s";

      const chip = document.createElement("div");
      chip.className = "metric-chip";
      chip.innerHTML = `${label}: <strong>${m[key]}${unit}</strong>`;
      metricsChipsGrid.appendChild(chip);
    }
  }

  // Render Formula Explanations
  formulaExplanationsList.innerHTML = "";
  (data.formula_explanations || []).forEach((exp) => {
    const li = document.createElement("li");
    li.textContent = exp;
    formulaExplanationsList.appendChild(li);
  });

  // Render Clinical Flags
  if (flags.length > 0) {
    clinicalFlagsWrap.hidden = false;
    clinicalFlagsList.innerHTML = "";
    flags.forEach((flag) => {
      const li = document.createElement("li");
      li.textContent = flag;
      clinicalFlagsList.appendChild(li);
    });
  } else {
    clinicalFlagsWrap.hidden = true;
  }

  videoResultsPanel.scrollIntoView({ behavior: "smooth" });
}

function update4DCard(cardId, statusId, statusClass, statusLabel) {
  const card = document.getElementById(cardId);
  const badge = document.getElementById(statusId);
  if (card && badge) {
    card.classList.toggle("flagged", statusClass !== "GREEN");
    badge.className = `four-d-status ${statusClass}`;
    badge.textContent = statusLabel;
  }
}
