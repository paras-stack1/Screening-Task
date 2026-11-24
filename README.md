# Assessment Lab

Focused branch containing the working image, movement, gait, and audio Assessment Lab plus all trained model artifacts.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd lab-web
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

The lab provides combined eye, cleft, dental and skin image inference; MediaPipe-based gait and movement measurements; audio quality/event analysis; consent-gated evidence storage; and the complete `backend/models` bundle.

This is a screening research application, not an autonomous diagnostic system.
