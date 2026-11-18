from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.utils import load_img, img_to_array
from PIL import UnidentifiedImageError
import numpy as np
import io
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SKIN_MODEL_PATH = BASE_DIR / "skin_model.keras"
EYE_MODEL_PATH = BASE_DIR / "best_eye_mobilenetv3_small.keras"

# MUST match the class_names order printed during training in Colab.
SKIN_CLASS_NAMES = [
    "Acne_Mild",
    "Acne_Moderate",
    "Acne_Severe",
    "Eczema_Mild",
    "Eczema_Moderate",
    "Eczema_Severe",
    "Normal",
    "Xyz",
]

# PASTE YOUR EXACT 5 EYE DISEASE NAMES FROM COLAB HERE (same order as class_names!)
EYE_CLASS_NAMES = [
    "Cataract",        # 0
    "Conjunctivitis",  # 1
    "Eyelid",          # 2
    "Normal",          # 3
    "Uveitis",         # 4
]


if not SKIN_MODEL_PATH.exists():
    raise FileNotFoundError(f"Skin model not found at {SKIN_MODEL_PATH}")
if not EYE_MODEL_PATH.exists():
    raise FileNotFoundError(f"Eye model not found at {EYE_MODEL_PATH}")

skin_model = load_model(SKIN_MODEL_PATH)
eye_model = load_model(EYE_MODEL_PATH)

app = FastAPI(title="Skin & Eye Image Classifier API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


async def read_and_preprocess(file: UploadFile) -> np.ndarray:
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=415,
            detail="Please upload a JPG, PNG, or WEBP image.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        image = load_img(io.BytesIO(contents), target_size=(224, 224), color_mode="rgb")
    except (UnidentifiedImageError, ValueError):
        raise HTTPException(status_code=400, detail="Could not read this image.")

    image_array = img_to_array(image)
    return np.expand_dims(image_array, axis=0)


def get_screening_info(predicted_class: str, confidence: float) -> tuple[str, str]:
    label = predicted_class.lower()
    is_normal = any(word in label for word in ("normal", "healthy"))

    if is_normal:
        if confidence >= 60:
            return (
                "GREEN",
                "Model output leans toward a normal/healthy class. Learning prototype only — consult a doctor if you have symptoms.",
            )
        return (
            "YELLOW",
            "Low confidence result. Try a clearer, well-lit photo and consult a healthcare professional if concerned.",
        )

    if confidence < 50 or "mild" in label:
        return (
            "YELLOW",
            f"Model leans toward {predicted_class} ({confidence:.1f}%). Try a clear photo and consider checking with a doctor.",
        )

    return (
        "RED",
        f"Model detected {predicted_class} ({confidence:.1f}%). This is not a medical diagnosis — please consult a qualified specialist.",
    )


def format_prediction(
    model_name: str,
    scores: np.ndarray,
    class_names: list[str],
    tta_horizontal_flip: bool = False,
) -> dict:
    if len(scores) != len(class_names):
        raise HTTPException(
            status_code=500,
            detail=(
                f"{model_name} model outputs {len(scores)} classes, "
                f"but class list has {len(class_names)} names in backend/main.py."
            ),
        )

    top_index = int(np.argmax(scores))
    predicted_class = class_names[top_index]
    confidence = round(float(scores[top_index]) * 100, 2)
    screening_status, advice = get_screening_info(predicted_class, confidence)

    return {
        "model": model_name,
        "tta_horizontal_flip": tta_horizontal_flip,
        "predicted_class": predicted_class,
        "confidence": confidence,
        "screening_status": screening_status,
        "advice": advice,
        "all_predictions": {
            name: round(float(score) * 100, 2)
            for name, score in zip(class_names, scores)
        },
    }


@app.get("/health")
@app.get("/api")
def health():
    return {
        "status": "healthy",
        "message": "Skin & Eye Prediction API is running",
        "endpoints": ["/predict/skin", "/predict/eye"],
    }


@app.post("/predict")
@app.post("/predict/skin")
async def predict_skin(file: UploadFile = File(...)):
    image_array = await read_and_preprocess(file)
    scores = skin_model.predict(image_array, verbose=0)[0]
    return format_prediction("skin", scores, SKIN_CLASS_NAMES, tta_horizontal_flip=False)


@app.post("/predict/eye")
async def predict_eye(file: UploadFile = File(...)):
    image_array = await read_and_preprocess(file)
    probs_orig = eye_model.predict(image_array, verbose=0)
    probs_flip = eye_model.predict(tf.image.flip_left_right(image_array), verbose=0)
    scores = ((probs_orig + probs_flip) / 2.0)[0]
    return format_prediction("eye", scores, EYE_CLASS_NAMES, tta_horizontal_flip=True)


# Mount frontend so visiting http://<HOST>:8000/ serves the full web app directly
FRONTEND_DIR = BASE_DIR.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
