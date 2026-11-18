# Skin & Eye Health Screening Demo

A full-stack deep-learning screening web application that predicts both **Skin Conditions** and **Eye Conditions** using lightweight MobileNetV3 models. Built with FastAPI and a modern frontend featuring Chart.js visual probability charts and clinical screening status banners.

---

## 🎯 Features

- **Skin Condition Model (`skin_model.keras`)**:
  - Classifies 8 skin conditions: `Acne_Mild`, `Acne_Moderate`, `Acne_Severe`, `Eczema_Mild`, `Eczema_Moderate`, `Eczema_Severe`, `Normal`, and `Xyz`.
- **Eye Condition Model (`best_eye_mobilenetv3_small.keras`)**:
  - Classifies 5 eye conditions: `Cataract`, `Conjunctivitis`, `Eyelid`, `Normal`, and `Uveitis`.
  - Uses **Test-Time Augmentation (Flip TTA)**: Averages predictions on the original and horizontally flipped images (`(probs_orig + probs_flip) / 2.0`) for enhanced accuracy.
- **Visual Analytics**:
  - **Triage Status Banner**: Instant `GREEN` (Normal/Low Risk), `YELLOW` (Mild / Uncertain), or `RED` (Condition Detected / Action Advised).
  - **Interactive Graphs**: Real-time Horizontal Bar Chart and Doughnut Chart powered by Chart.js.
- **Dual-Mode Serving**:
  - The FastAPI backend directly serves the frontend static files on port `8000`, or can be run with frontend and backend separated for local development.

---

## 📁 Repository Structure

```
Screening-Task/
├── backend/
│   ├── main.py                             # FastAPI server (Skin & Eye routes)
│   ├── requirements.txt                    # Python dependencies
│   ├── skin_model.keras                    # Trained skin classification model
│   └── best_eye_mobilenetv3_small.keras    # Trained eye classification model
├── frontend/
│   ├── index.html                          # Single-page UI for Skin & Eye screening
│   ├── style.css                           # Modern responsive styling
│   └── script.js                           # Chart.js rendering & API client
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

### Step 1: Launch an EC2 Instance
- **AMI:** Ubuntu 22.04 LTS or Ubuntu 24.04 LTS.
- **Instance Type:** `t3.medium` or `t3.large` recommended (minimum 2 GB–4 GB RAM for TensorFlow). If using `t2.micro` or `t3.micro`, our deployment script automatically adds 4 GB swap space to prevent memory issues.
- **Security Group Inbound Rules:**
  - `SSH` (Port 22) from your IP
  - `Custom TCP` (Port 8000) from `0.0.0.0/0` (Anywhere)

---

### Step 2: Connect to your EC2 Instance
```bash
ssh -i /path/to/your-key.pem ubuntu@<YOUR_EC2_PUBLIC_IP>
```

---

### Step 3: Deploy (Choose Option A or Option B)

#### Option A: 1-Click Automated Script (Systemd Service)
```bash
git clone https://github.com/paras-stack1/Screening-Task.git
cd Screening-Task
chmod +x deploy_ec2.sh
./deploy_ec2.sh
```
The script will:
1. Install Python 3, venv, and build tools.
2. Configure 4 GB swap space (if RAM < 3 GB).
3. Install backend dependencies.
4. Create and start a persistent background `systemd` service (`screening.service`) that automatically restarts on boot or failures.

**Useful systemd commands on EC2:**
- Check service status: `sudo systemctl status screening`
- View live application logs: `journalctl -u screening -f`
- Restart service: `sudo systemctl restart screening`

---

#### Option B: Deploy with Docker
If you have Docker installed on your EC2 instance:
```bash
git clone https://github.com/paras-stack1/Screening-Task.git
cd Screening-Task
docker compose up -d --build
```

---

### Step 4: Access your Live Web App
Open your browser and navigate to:
```
http://<YOUR_EC2_PUBLIC_IP>:8000
```

---

## ⚠️ Disclaimer
This project is an **educational and learning prototype**. The machine learning models are not approved or validated for medical or clinical diagnostic use. Prediction probabilities and screening statuses are model outputs only and should never replace professional medical advice, consultation, or diagnosis.
