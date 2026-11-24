from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.combined_image import router as combined_image_router
from app.media import router as media_router
from video_analyzer import VideoLandmarkPayload, analyze_video_landmarks

app = FastAPI(title="Assessment Lab API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "assessment-lab",
        "endpoints": ["/predict/combined/{check}", "/analyze-video-landmarks", "/api/captures"],
    }


@app.post("/analyze-video-landmarks")
def analyze_video(payload: VideoLandmarkPayload):
    try:
        return analyze_video_landmarks(payload)
    except Exception as exc:
        raise HTTPException(500, f"Landmark analysis error: {exc}") from exc


app.include_router(combined_image_router)
app.include_router(media_router)
