"""Consent-gated storage for assessment media and its evaluation record."""

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import StringConstraints, TypeAdapter, ValidationError


router = APIRouter(prefix="/api/captures", tags=["assessment captures"])
DATA_DIR = Path(os.environ.get("SCREENING_CAPTURE_DIR", Path(__file__).resolve().parents[1] / "data" / "captures"))
DB_PATH = Path(os.environ.get("SCREENING_CAPTURE_DB", Path(__file__).resolve().parents[1] / "data" / "captures.sqlite3"))
MAX_MEDIA_BYTES = 128 * 1024 * 1024
ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}
ChildCode = Annotated[str, StringConstraints(pattern=r"^[A-Z0-9-]{2,32}$")]
child_code_adapter = TypeAdapter(ChildCode)
SUPPORTED_ASSESSMENTS = {
    "eye", "alignment", "cleft", "dental", "skin", "foot", "bitot", "pupil", "pallor", "body",
    "gait", "sitting", "crawl", "standing", "episodes", "audio",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        with db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS captures (
                    id TEXT PRIMARY KEY,
                    created TEXT NOT NULL,
                    child_code TEXT NOT NULL,
                    assessment TEXT NOT NULL,
                    media_kind TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    stored_name TEXT NOT NULL UNIQUE,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    duration_seconds REAL,
                    evaluation TEXT NOT NULL,
                    review TEXT NOT NULL
                )
            """)
            yield db
    finally:
        db.close()


def serialize(row: sqlite3.Row) -> dict:
    item = dict(row)
    item["evaluation"] = json.loads(item["evaluation"])
    item["review"] = json.loads(item["review"])
    item["media_url"] = f"/api/captures/{item['id']}/media"
    item.pop("stored_name", None)
    return item


def parse_json(value: str, field: str) -> dict:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, f"{field} must be valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(422, f"{field} must be a JSON object.")
    return parsed


@router.post("", status_code=201)
async def create_capture(
    media: UploadFile = File(...),
    assessment: str = Form(...),
    child_code: str = Form(...),
    consent: bool = Form(...),
    evaluation: str = Form("{}"),
    review: str = Form("{}"),
    duration_seconds: float | None = Form(default=None),
):
    if not consent:
        raise HTTPException(422, "Recorded media requires verified guardian consent.")
    try:
        if assessment not in SUPPORTED_ASSESSMENTS:
            raise ValueError
        child_code = child_code_adapter.validate_python(child_code.strip().upper())
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, "Use a supported assessment and a 2-32 character child code.") from exc
    content_type = (media.content_type or "").split(";", 1)[0].lower()
    suffix = ALLOWED_TYPES.get(content_type)
    if suffix is None:
        raise HTTPException(415, "Upload a supported WebM, MP4, MOV, OGG, MP3, M4A, or WAV recording.")
    media_kind = content_type.split("/", 1)[0]
    expected_kind = "audio" if assessment == "audio" else "video" if assessment in {"gait", "sitting", "crawl", "standing", "episodes"} else "image"
    if media_kind != expected_kind:
        raise HTTPException(422, "The recording type does not match the selected assessment.")
    evaluation_data = parse_json(evaluation, "evaluation")
    review_data = parse_json(review, "review")
    if duration_seconds is not None and not 0 <= duration_seconds <= 300:
        raise HTTPException(422, "Recording duration must be between 0 and 300 seconds.")

    capture_id = str(uuid4())
    stored_name = f"{capture_id}{suffix}"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    destination = DATA_DIR / stored_name
    digest = hashlib.sha256()
    size = 0
    try:
        with destination.open("xb") as output:
            while chunk := await media.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_MEDIA_BYTES:
                    raise HTTPException(413, "Recording exceeds the 128 MB limit.")
                digest.update(chunk)
                output.write(chunk)
        if size == 0:
            raise HTTPException(400, "The recording is empty.")
        with database() as db:
            db.execute(
                "INSERT INTO captures VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (capture_id, now(), child_code, assessment, media_kind, content_type,
                 (media.filename or "recording")[:255], stored_name, size, digest.hexdigest(),
                 duration_seconds, json.dumps(evaluation_data), json.dumps(review_data)),
            )
            row = db.execute("SELECT * FROM captures WHERE id = ?", (capture_id,)).fetchone()
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await media.close()
    return serialize(row)


@router.get("")
def list_captures(child_code: str | None = None):
    with database() as db:
        if child_code:
            rows = db.execute("SELECT * FROM captures WHERE child_code = ? ORDER BY created DESC",
                              (child_code.strip().upper(),)).fetchall()
        else:
            rows = db.execute("SELECT * FROM captures ORDER BY created DESC LIMIT 100").fetchall()
    return {"captures": [serialize(row) for row in rows]}


@router.get("/{capture_id}")
def get_capture(capture_id: str):
    with database() as db:
        row = db.execute("SELECT * FROM captures WHERE id = ?", (capture_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Capture not found.")
    return serialize(row)


@router.get("/{capture_id}/media")
def get_capture_media(capture_id: str):
    with database() as db:
        row = db.execute("SELECT * FROM captures WHERE id = ?", (capture_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Capture not found.")
    path = DATA_DIR / row["stored_name"]
    if not path.is_file():
        raise HTTPException(410, "Stored recording is unavailable.")
    return FileResponse(path, media_type=row["content_type"], filename=row["original_name"])
