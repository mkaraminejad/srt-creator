"""
In-process asynchronous job queue and lifecycle manager.
Suitable for single-instance trial deployments. Designed with clear separation
to allow migrating to Celery / Redis / RQ / BullMQ in production.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from enum import Enum
import logging
from pathlib import Path
import secrets
import threading
import time
from typing import Dict, Any, Optional

from backend import config
from backend.services.storage import get_storage
from backend.services.audio import extract_audio_for_whisper, AudioProcessingError
from backend.services.transcriber import transcribe_audio_file

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    QUEUED = "queued"                  # در انتظار در صف
    EXTRACTING_AUDIO = "extracting"    # در حال استخراج صدا با FFmpeg
    TRANSCRIBING = "transcribing"      # در حال رونویسی با faster-whisper
    COMPLETED = "completed"            # پایان یافته و آماده دانلود
    FAILED = "failed"                  # با خطا مواجه شده


class JobManager:
    """
    In-memory Job Coordinator for trial deployment.
    
    TRIAL LIMITATIONS NOTE:
    - Jobs are tracked in RAM: restarting the container/process clears memory of active jobs.
    - Worker pool is bound to the single host CPU.
    - For distributed multi-server scale: Replace this with Celery/Redis or RabbitMQ.
    """

    def __init__(self, max_workers: int = 1):
        # We default to 1 concurrent transcription worker for CPU safety,
        # preventing CPU saturation when multiple videos are uploaded.
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="whisper-worker")
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.Lock()
        self._start_janitor_thread()

    def create_job(self, original_filename: str, file_size: int, language: str = "auto", model: str = "base") -> str:
        """
        Creates a new job with a cryptographically hard-to-guess ID (URL-safe token).
        """
        job_id = secrets.token_urlsafe(24)  # 32 characters, ~192 bits of entropy
        now = time.time()
        job_record = {
            "id": job_id,
            "status": JobStatus.QUEUED.value,
            "progress": 0.0,
            "message": "فایل دریافت شد و در صف پردازش قرار گرفت.",
            "original_filename": original_filename,
            "file_size": file_size,
            "duration": 0.0,
            "language_requested": language,
            "language_detected": None,
            "language_probability": 0.0,
            "model": model,
            "error": None,
            "created_at": now,
            "updated_at": now,
            "segments_count": 0
        }
        with self.lock:
            self.jobs[job_id] = job_record

        logger.info(f"Created job {job_id} for file '{original_filename}' ({file_size} bytes)")
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            job = self.jobs.get(job_id)
            if job:
                return dict(job)
            return None

    def update_job(self, job_id: str, **kwargs):
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].update(kwargs)
                self.jobs[job_id]["updated_at"] = time.time()

    def enqueue_job(self, job_id: str, video_path: str):
        """Submit the background job execution to the thread pool executor."""
        self.executor.submit(self._run_job_pipeline, job_id, video_path)

    def _run_job_pipeline(self, job_id: str, video_path_str: str):
        storage = get_storage()
        job = self.get_job(job_id)
        if not job:
            logger.error(f"Cannot run pipeline: Job {job_id} not found in memory.")
            return

        video_path = Path(video_path_str)
        wav_path = video_path.parent / "audio.wav"

        try:
            # Step 1: Extract Audio via FFmpeg
            self.update_job(
                job_id,
                status=JobStatus.EXTRACTING_AUDIO.value,
                progress=5.0,
                message="در حال استخراج فایل صوتی از ویدیو با FFmpeg..."
            )

            audio_duration = extract_audio_for_whisper(video_path, wav_path)
            self.update_job(job_id, duration=round(audio_duration, 2), progress=15.0)

            # Step 2: Transcribe via faster-whisper
            self.update_job(
                job_id,
                status=JobStatus.TRANSCRIBING.value,
                message="در حال رونویسی گفتار با هوش مصنوعی faster-whisper..."
            )

            def on_progress(percent: float, text: str):
                self.update_job(job_id, progress=percent, message=text)

            srt_content, segments, detected_lang, lang_prob = transcribe_audio_file(
                audio_path=wav_path,
                language_code=job["language_requested"],
                model_name=job.get("model") or config.WHISPER_MODEL,
                total_duration=audio_duration,
                progress_callback=on_progress
            )

            # Step 3: Save SRT file into storage with UTF-8 encoding
            storage.save_text(job_id, "subtitles.srt", srt_content, encoding="utf-8")

            # Clean up intermediate wav audio file to save disk space
            if wav_path.exists():
                try:
                    wav_path.unlink()
                except Exception as e:
                    logger.warning(f"Could not remove temp audio file {wav_path}: {e}")

            # Mark job complete
            self.update_job(
                job_id,
                status=JobStatus.COMPLETED.value,
                progress=100.0,
                message="رونویسی با موفقیت انجام شد. فایل زیرنویس آماده دانلود است.",
                language_detected=detected_lang,
                language_probability=round(lang_prob, 3),
                segments_count=len(segments)
            )
            logger.info(f"Job {job_id} completed successfully with {len(segments)} subtitle segments.")

        except AudioProcessingError as ape:
            logger.error(f"Job {job_id} audio error: {ape}")
            self.update_job(
                job_id,
                status=JobStatus.FAILED.value,
                error=str(ape),
                message=f"خطا در پردازش ویدیو: {str(ape)}"
            )
        except Exception as ex:
            logger.exception(f"Job {job_id} unhandled failure")
            self.update_job(
                job_id,
                status=JobStatus.FAILED.value,
                error=str(ex),
                message=f"خطای غیرمنتظره در پردازش: {str(ex)}"
            )

    def _start_janitor_thread(self):
        """Background daemon thread to purge expired temp files according to retention policy."""
        def janitor_loop():
            while True:
                try:
                    time.sleep(config.CLEANUP_INTERVAL_MINUTES * 60)
                    retention_sec = config.TEMP_FILE_RETENTION_HOURS * 3600
                    logger.info("Running automatic storage cleanup janitor...")
                    storage = get_storage()
                    purged_count = storage.cleanup_expired_jobs(retention_sec)
                    if purged_count > 0:
                        logger.info(f"Janitor purged {purged_count} expired job directories.")

                    # Also prune old jobs from memory
                    now = time.time()
                    with self.lock:
                        stale_ids = [
                            jid for jid, info in self.jobs.items()
                            if now - info.get("created_at", now) > retention_sec
                        ]
                        for jid in stale_ids:
                            del self.jobs[jid]
                except Exception as err:
                    logger.warning(f"Error in janitor cleanup loop: {err}")

        thread = threading.Thread(target=janitor_loop, daemon=True, name="storage-janitor")
        thread.start()


# Global singleton instance
_job_manager: Optional[JobManager] = None


def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager(max_workers=1)
    return _job_manager
