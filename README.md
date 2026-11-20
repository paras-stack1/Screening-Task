# Child Health Screening Platform (Across the 4Ds + Skin & Eye)

A multi-modal pediatric health screening web application combining **Deep Learning Computer Vision** (Skin & Eye models) with a **Privacy-First Real-Time Video Biomechanical Screening Module** mapped across **The 4Ds**:
1. **Defects at birth** (e.g., Congenital hip dysplasia, club foot, spinal dysraphism)
2. **Deficiencies** (e.g., Nutritional Rickets / lower-limb bowing, severe stunting)
3. **Diseases** (e.g., Cerebral palsy spasticity, neuromuscular dystrophies, ataxias)
4. **Development delays & disabilities** (e.g., Gross motor delays, autism auditory orienting latency, stereotypies)

Built with **FastAPI**, **MediaPipe Tasks Vision**, and an interactive **Chart.js** frontend with live biomechanical telemetry.

---

## 🎯 Modules & Features

### 1. 🎥 Real-Time Video Child Screening (Across the 4Ds)
- **Zero Video Storage / Privacy-First Architecture**:
  - Raw video streams are processed exclusively inside the browser via client-side WebAssembly (**MediaPipe Tasks Vision `PoseLandmarker`**).
  - **No `.mp4` video files are ever recorded, saved, or uploaded.**
  - Extracts 33 3D skeletal landmarks and face metrics at `10 FPS` over a guided 10–15s protocol (~50 KB JSON payload) sent to `POST /analyze-video-landmarks`.
- **Live Canvas HUD Overlay**:
  - Draws glowing skeletal joints and connecting bones live on a canvas overlaid on the video feed.
  - Live full-body framing indicator badge (detects head and ankle visibility).
  - Auditory cue prompt (Web Audio API 880 Hz chime) at 3.0s for social orienting tasks.
- **Live Biomechanical Telemetry Panel**:
  - Real-time live readings of:
    - Full-body framing status (`Head & Ankles Visible`)
    - Left & Right knee angles (degrees)
    - Spine tilt angle from vertical (degrees)
    - Stride / ankle separation
    - Head yaw angle & camera gaze status
- **Two-Stage Invariant Biomechanical Analysis**:
  - **Stage 1 (Coordinate Normalization)**:
    - Origin Shift: Subtract Mid-Hip $H_{mid} = \frac{P_{23} + P_{24}}{2}$
    - Scale Normalization: Divide by Torso Length $L_{torso} = \|S_{mid} - H_{mid}\|_2$
  - **Stage 2 (Time-Series Algorithms)**:
    - **Spine Tilt ($\theta_{spine}$)**: Angle of torso vector relative to vertical (Baseline: Green $\le 12^\circ$, Yellow $12^\circ–22^\circ$, Red $> 22^\circ$).
    - **Gait Symmetry Index (GSI)**: Ratio of left vs right step amplitude (Baseline: Green $\ge 0.85$, Yellow $0.70–0.84$, Red $< 0.70$).
    - **Lower-Limb Alignment**: Inter-condylar vs inter-malleolar distance ratio for age $> 24$ mo (Bowed legs / Knock knees / Rickets).
    - **Balance Sway ($\sigma$)**: Lateral center-of-mass oscillation standard deviation.
    - **FFT Tremor / Stereotypy**: Fast Fourier Transform on wrist velocity detecting rhythmic oscillations in the 1.5–4.5 Hz band.
    - **Auditory Orienting Latency ($\Delta t$)**: Time to head turn ($>10^\circ$) after name call (Baseline: Green $\le 2.0$s, Yellow $2.0–4.0$s, Red $> 4.0$s).
    - **Eye Contact %**: Percentage of frames maintaining forward central gaze.

---

### 2. 📸 Skin Image Classifier (`skin_model.keras`)
- Classifies 8 skin condition classes: `Acne_Mild`, `Acne_Moderate`, `Acne_Severe`, `Eczema_Mild`, `Eczema_Moderate`, `Eczema_Severe`, `Normal`, `Xyz`.
- Returns top condition, confidence percentage, and full probability breakdown with interactive Chart.js bar and doughnut charts.

---

### 3. 👁️ Eye Health Classifier (`best_eye_mobilenetv3_small.keras`)
- Classifies 5 eye conditions: `Cataract`, `Conjunctivitis`, `Eyelid`, `Normal`, `Uveitis`.
- Uses **Test-Time Augmentation (Flip TTA)**: Averages predictions on the original and horizontally flipped images (`(probs_orig + probs_flip) / 2.0`) for enhanced clinical accuracy.

---

## 📁 Repository Structure

```
Screening-Task/
├── backend/
│   ├── main.py                             # FastAPI server (Skin, Eye & Video routes)
│   ├── video_analyzer.py                   # 4Ds Biomechanical Normalization & Time-Series Engine
│   ├── requirements.txt                    # Python dependencies
│   ├── skin_model.keras                    # Trained skin classification model
│   └── best_eye_mobilenetv3_small.keras    # Trained eye classification model
├── frontend/
│   ├── index.html                          # Single-page UI with 3 screening tabs
│   ├── style.css                           # Modern responsive styling & HUD telemetry
│   └── script.js                           # MediaPipe Pose tracking, Chart.js & API client
├── Dockerfile                              # Production Docker image
├── docker-compose.yml                      # 1-command Docker Compose setup
├── deploy_ec2.sh                           # 1-click automated setup script for AWS EC2
└── README.md
```

---

## 💻 Local Setup & Execution

### Prerequisites
- Python 3.10 or 3.11 (64-bit)

### Run with Python & Uvicorn

1. **Clone the repository:**
   ```bash
   git clone https://github.com/paras-stack1/Screening-Task.git
   cd Screening-Task
   ```

2. **Create and activate a virtual environment:**
   - **Windows:**
     ```powershell
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - **Linux / macOS:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Start the application:**
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

5. Open your browser at:
   - **Web UI:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
   - **Swagger API Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## ☁️ Deployment on AWS EC2

### Update Running EC2 Instance
If already deployed on your EC2 instance (`16.179.162.6`):

```bash
ssh -i /path/to/aws-eye-key.pem ubuntu@16.179.162.6
cd Screening-Task
git pull origin main
sudo systemctl restart screening
```

---

## ⚠️ Medical Disclaimer
This platform is a **developmental screening and triage prototype**. The machine learning models and biomechanical algorithms are non-diagnostic and not validated for clinical diagnosis. Always consult a qualified pediatrician or medical professional for health evaluations and treatment decisions.
