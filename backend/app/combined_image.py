import io
import json
import logging
from functools import lru_cache

import numpy as np
import tensorflow as tf
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, ImageOps

from .config import MODELS_DIR

router = APIRouter()
logger = logging.getLogger(__name__)
CHECKS = ("eye", "cleft", "dental", "skin")
MAX_BYTES = 10 * 1024 * 1024


@lru_cache(maxsize=1)
def load_bundle():
    folders = sorted(
        folder for folder in MODELS_DIR.glob("nanhe_kadam_efficientnetv2b0*")
        if (folder / "combined_model.keras").is_file()
        and (folder / "labels.json").is_file()
    )
    if not folders:
        raise FileNotFoundError("No complete combined image model bundle")
    folder = folders[-1]
    metadata = json.loads((folder / "labels.json").read_text(encoding="utf-8"))
    model = tf.keras.models.load_model(folder / "combined_model.keras", compile=False)
    if (tuple(metadata["checks"]) != CHECKS
            or len(metadata["classes_in_output_order"]) != model.output_shape[-1]
            or metadata["image_size"] != 224):
        raise ValueError("Combined image model metadata does not match the model")
    return model, metadata


@router.post("/predict/combined/{check}")
def predict_combined(check: str, file: UploadFile = File(...)):
    if check not in CHECKS:
        raise HTTPException(422, detail=f"Choose one of: {', '.join(CHECKS)}.")
    contents = file.file.read(MAX_BYTES + 1)
    if len(contents) > MAX_BYTES:
        raise HTTPException(413, detail="Upload an image no larger than 10 MB.")
    try:
        with Image.open(io.BytesIO(contents)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(415, detail="Upload a JPG, PNG, or WEBP image.")
            if image.width * image.height > 25_000_000:
                raise HTTPException(413, detail="Upload an image under 25 megapixels.")
            pixels = np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, detail="Could not read the uploaded photo.") from exc

    try:
        model, metadata = load_bundle()
    except (OSError, ValueError, KeyError) as exc:
        logger.exception("Could not load the combined image model")
        raise HTTPException(503, detail="Combined image model is unavailable.") from exc
    size = metadata["image_size"]
    photo = tf.image.resize_with_pad(pixels, size, size)
    check_id = CHECKS.index(check)
    logits = model(
        {"photo": photo[None], "check": tf.constant([check_id], dtype=tf.int32)},
        training=False,
    )[0]
    labels = metadata["classes_in_output_order"]
    indices = [i for i, item in enumerate(labels) if item["check"] == check]
    scores = tf.nn.softmax(tf.gather(logits, indices)).numpy()
    best = int(np.argmax(scores))
    return {
        "model": metadata["model"],
        "check": check,
        "predicted_class": labels[indices[best]]["label"],
        "confidence": round(float(scores[best]) * 100, 2),
        "all_predictions": {
            labels[index]["label"]: round(float(score) * 100, 2)
            for index, score in zip(indices, scores)
        },
    }
