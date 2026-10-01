"""
FastAPI Main Application for WhisperVideoSRT.
Provides RESTful endpoints for video uploading, job tracking, SRT subtitle downloading,
and server status inspection.
"""

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import tempfile
from typing import Optional

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    Header,
    Query,
    Depends,
    status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import config
from backend.services.storage import get_storage
from backend.services.queue import get_job_manager, JobStatus
from backend.services.srt_formatter import parse_srt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("whisper-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing WhisperVideoSRT application...")
    logger.info(f"Storage dir: {config.STORAGE_DIR}")
    logger.info(f"Model cache dir: {config.MODEL_CACHE_DIR}")
    logger.info(f"Default model: {config.WHISPER_MODEL}, Device: {config.DEVICE}")
    if config.API_ACCESS_TOKEN:
        logger.info("API Token authentication is ENABLED.")
    else:
        logger.info("API Token authentication is DISABLED (open access).")
    yield
    logger.info("Shutting down WhisperVideoSRT application...")


app = FastAPI(
    title="WhisperVideoSRT API",
    description="سرویس تبدیل خودکار ویدیو به زیرنویس با هوش مصنوعی faster-whisper و FFmpeg",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for cross-origin frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_token(
    x_api_token: Optional[str] = Header(None, alias="X-API-Token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    token_query: Optional[str] = Query(None, alias="token")
):
    """
    Validates the security access token if API_ACCESS_TOKEN is configured in environment.
    Supports Header 'X-API-Token', 'Authorization: Bearer <token>', or '?token=' query parameter.
    """
    if not config.API_ACCESS_TOKEN:
        return True  # No token required

    provided_token = None
    if x_api_token:
        provided_token = x_api_token.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        provided_token = authorization[7:].strip()
    elif token_query:
        provided_token = token_query.strip()

    if not provided_token or provided_token != config.API_ACCESS_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="توکن امنیتی نامعتبر است. لطفاً توکن دسترسی مجاز را وارد کنید."
        )
    return True


@app.get("/api/health")
def health_check():
    """Health status endpoint for Docker healthcheck and monitoring."""
    return {
        "status": "healthy",
        "service": "WhisperVideoSRT",
        "model": config.WHISPER_MODEL,
        "device": config.DEVICE,
        "compute_type": config.COMPUTE_TYPE,
        "max_upload_mb": config.UPLOAD_MAX_MB
    }


@app.get("/api/config")
def get_public_config():
    """Returns server constraints and capabilities for the web UI."""
    return {
        "upload_max_mb": config.UPLOAD_MAX_MB,
        "upload_max_bytes": config.UPLOAD_MAX_BYTES,
        "allowed_extensions": list(config.ALLOWED_EXTENSIONS),
        "default_model": config.WHISPER_MODEL,
        "supported_models": ["tiny", "base", "small", "medium", "large-v3"],
        "auth_required": bool(config.API_ACCESS_TOKEN),
        "supported_languages": [
            {"code": "auto", "label": "تشخیص خودکار زبان (Auto-detect)"},
            {"code": "fa", "label": "فارسی (Persian / Farsi)"},
            {"code": "en", "label": "انگلیسی (English)"}
        ]
    }


@app.post("/api/jobs/upload")
async def upload_video(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    model: Optional[str] = Form(None),
    _: bool = Depends(verify_token)
):
    """
    Upload an MP4, MKV, or MOV video file to begin asynchronous transcription.
    Returns immediately with a unique job ID without blocking the connection.
    """
    original_filename = file.filename or "uploaded_video.mp4"
    file_ext = Path(original_filename).suffix.lstrip(".").lower()

    # 1. Validate file extension
    if file_ext not in config.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"فرمت فایل مجاز نیست ({file_ext}). تنها فرمت‌های mp4، mkv و mov پشتیبانی می‌شوند."
        )

    # 2. Validate language parameter
    clean_lang = language.strip().lower()
    if clean_lang not in ("auto", "fa", "en"):
        clean_lang = "auto"

    chosen_model = model.strip() if model else config.WHISPER_MODEL

    storage = get_storage()
    job_manager = get_job_manager()

    # 3. Create job and save file stream while validating size
    # Create preliminary job ID
    dummy_job_id = job_manager.create_job(
        original_filename=original_filename,
        file_size=0,
        language=clean_lang,
        model=chosen_model
    )

    try:
        # Stream file to storage with size limit verification
        bytes_read = 0
        saved_path = None

        # Use temporary spool or direct write via storage
        job_dir = Path(config.STORAGE_DIR) / dummy_job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        target_video_path = job_dir / f"input.{file_ext}"

        with open(target_video_path, "wb") as f_out:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                bytes_read += len(chunk)
                if bytes_read > config.UPLOAD_MAX_BYTES:
                    # Exceeded limit
                    f_out.close()
                    storage.delete_job_files(dummy_job_id)
                    job_manager.update_job(
                        dummy_job_id,
                        status=JobStatus.FAILED.value,
                        error=f"حجم فایل بیش از سقف مجاز ({config.UPLOAD_MAX_MB} مگابایت) است."
                    )
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"حجم فایل بیش از سقف تعیین شده ({config.UPLOAD_MAX_MB}MB) است."
                    )
                f_out.write(chunk)

        # Update actual size and enqueue background processing
        job_manager.update_job(dummy_job_id, file_size=bytes_read)
        job_manager.enqueue_job(dummy_job_id, str(target_video_path))

        return {
            "success": True,
            "job_id": dummy_job_id,
            "status": JobStatus.QUEUED.value,
            "original_filename": original_filename,
            "file_size": bytes_read,
            "language": clean_lang,
            "model": chosen_model,
            "message": "فایل با موفقیت دریافت و در صف استخراج و رونویسی قرار گرفت."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error handling upload for job {dummy_job_id}")
        storage.delete_job_files(dummy_job_id)
        job_manager.update_job(dummy_job_id, status=JobStatus.FAILED.value, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"خطا در ذخیره‌سازی و شروع پردازش: {str(e)}"
        )


@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str, _: bool = Depends(verify_token)):
    """
    Check the current status and progress of a transcription job.
    """
    job_manager = get_job_manager()
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="شناسه درخواست (Job ID) یافت نشد یا منقضی شده است."
        )

    return {
        "job_id": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "original_filename": job["original_filename"],
        "file_size": job["file_size"],
        "duration": job.get("duration", 0.0),
        "language_requested": job["language_requested"],
        "language_detected": job.get("language_detected"),
        "language_probability": job.get("language_probability"),
        "model": job.get("model"),
        "error": job.get("error"),
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "segments_count": job.get("segments_count", 0),
        "can_download": job["status"] == JobStatus.COMPLETED.value
    }


@app.get("/api/jobs/{job_id}/download")
def download_srt(job_id: str, _: bool = Depends(verify_token)):
    """
    Download the generated subtitle in SRT format with UTF-8 encoding.
    """
    job_manager = get_job_manager()
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="شناسه درخواست یافت نشد.")

    if job["status"] != JobStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"زیرنویس هنوز آماده نیست. وضعیت فعلی: {job['status']}"
        )

    storage = get_storage()
    srt_path = storage.get_file_path(job_id, "subtitles.srt")
    if not srt_path or not srt_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="فایل زیرنویس بر روی دیسک سرور یافت نشد."
        )

    # Clean filename for download: replace original extension with .srt
    original_stem = Path(job.get("original_filename", "subtitles")).stem
    safe_download_name = f"{original_stem}.srt"

    return FileResponse(
        path=str(srt_path),
        media_type="text/plain; charset=utf-8",
        filename=safe_download_name,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_download_name}"; filename*=UTF-8\'\'{safe_download_name}'
        }
    )


@app.get("/api/jobs/{job_id}/subtitles")
def get_job_subtitles(job_id: str, _: bool = Depends(verify_token)):
    """
    Returns the parsed subtitles and raw SRT text for live preview and video sync in UI.
    """
    storage = get_storage()
    srt_text = storage.read_text(job_id, "subtitles.srt")
    if not srt_text:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="فایل زیرنویس برای این درخواست موجود نیست.")

    parsed_segments = parse_srt(srt_text)
    return {
        "job_id": job_id,
        "srt_raw": srt_text,
        "segments": parsed_segments,
        "count": len(parsed_segments)
    }


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str, _: bool = Depends(verify_token)):
    """
    Cancel and remove all files associated with a job.
    """
    storage = get_storage()
    storage.delete_job_files(job_id)
    job_manager = get_job_manager()
    with job_manager.lock:
        if job_id in job_manager.jobs:
            del job_manager.jobs[job_id]
    return {"success": True, "message": "اطلاعات و فایل‌های این درخواست پاکسازی شدند."}


# Mount static directory if it exists (e.g. production build)
dist_dir = Path(__file__).resolve().parent.parent / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="frontend")
