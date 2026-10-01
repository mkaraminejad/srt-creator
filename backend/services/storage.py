"""
Storage service interface and implementations.
Designed with the Repository / Strategy pattern so that LocalStorage can be easily replaced
with S3Storage (MinIO, AWS S3, Cloudflare R2) in the future without changing business logic.
"""

from abc import ABC, abstractmethod
import os
import shutil
import time
from pathlib import Path
from typing import BinaryIO, Optional, List
import logging

from backend import config

logger = logging.getLogger(__name__)


class BaseStorage(ABC):
    """Abstract storage interface for decoupling file persistence from business logic."""

    @abstractmethod
    def save_upload(self, job_id: str, filename: str, stream: BinaryIO) -> str:
        """Save an incoming file stream and return its reference path/key."""
        pass

    @abstractmethod
    def save_text(self, job_id: str, filename: str, text_content: str, encoding: str = "utf-8") -> str:
        """Save a text file (such as SRT or logs) with UTF-8 encoding."""
        pass

    @abstractmethod
    def get_file_path(self, job_id: str, filename: str) -> Optional[Path]:
        """Return the local filesystem Path to a file if locally available."""
        pass

    @abstractmethod
    def read_text(self, job_id: str, filename: str, encoding: str = "utf-8") -> Optional[str]:
        """Read a text file's contents."""
        pass

    @abstractmethod
    def file_exists(self, job_id: str, filename: str) -> bool:
        """Check whether a file exists for the given job."""
        pass

    @abstractmethod
    def delete_job_files(self, job_id: str) -> bool:
        """Delete all files associated with a specific job ID."""
        pass

    @abstractmethod
    def cleanup_expired_jobs(self, max_age_seconds: int) -> int:
        """Delete files older than max_age_seconds. Returns number of purged jobs."""
        pass


class LocalStorage(BaseStorage):
    """
    Local filesystem storage provider.
    Stores jobs in: {base_dir}/{job_id}/
    Examples:
      - {base_dir}/{job_id}/input.mp4
      - {base_dir}/{job_id}/audio.wav
      - {base_dir}/{job_id}/subtitles.srt
    """

    def __init__(self, base_dir: str = config.STORAGE_DIR):
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"LocalStorage initialized at: {self.base_dir}")

    def _job_dir(self, job_id: str) -> Path:
        # Sanitize job_id to prevent directory traversal
        clean_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_"))
        target = self.base_dir / clean_id
        target.mkdir(parents=True, exist_ok=True)
        return target

    def save_upload(self, job_id: str, filename: str, stream: BinaryIO) -> str:
        job_dir = self._job_dir(job_id)
        # Preserve extension safely
        ext = Path(filename).suffix.lower()
        destination = job_dir / f"input{ext}"
        with open(destination, "wb") as f_out:
            shutil.copyfileobj(stream, f_out)
        logger.info(f"Saved uploaded file for job {job_id} to {destination}")
        return str(destination)

    def save_text(self, job_id: str, filename: str, text_content: str, encoding: str = "utf-8") -> str:
        job_dir = self._job_dir(job_id)
        destination = job_dir / filename
        with open(destination, "w", encoding=encoding) as f_out:
            f_out.write(text_content)
        logger.info(f"Saved text file for job {job_id} to {destination}")
        return str(destination)

    def get_file_path(self, job_id: str, filename: str) -> Optional[Path]:
        clean_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_"))
        candidate = self.base_dir / clean_id / filename
        if candidate.exists() and candidate.is_file():
            return candidate
        return None

    def read_text(self, job_id: str, filename: str, encoding: str = "utf-8") -> Optional[str]:
        path = self.get_file_path(job_id, filename)
        if path:
            return path.read_text(encoding=encoding)
        return None

    def file_exists(self, job_id: str, filename: str) -> bool:
        clean_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_"))
        candidate = self.base_dir / clean_id / filename
        return candidate.exists() and candidate.is_file()

    def delete_job_files(self, job_id: str) -> bool:
        clean_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_"))
        job_dir = self.base_dir / clean_id
        if job_dir.exists() and job_dir.is_dir():
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info(f"Deleted directory for job {job_id}")
            return True
        return False

    def cleanup_expired_jobs(self, max_age_seconds: int) -> int:
        now = time.time()
        purged = 0
        if not self.base_dir.exists():
            return 0
        for entry in self.base_dir.iterdir():
            if entry.is_dir():
                try:
                    stat = entry.stat()
                    # Check modification time
                    if now - stat.st_mtime > max_age_seconds:
                        shutil.rmtree(entry, ignore_errors=True)
                        purged += 1
                        logger.info(f"Purged expired job folder: {entry.name}")
                except Exception as e:
                    logger.warning(f"Error checking/purging {entry}: {e}")
        return purged


class S3StorageAdapterStub(BaseStorage):
    """
    Example implementation blueprint for migrating to AWS S3 / MinIO in the future.
    When ready to move to multi-instance cloud deployment, install `boto3` and
    replace `get_storage()` with an instantiated S3StorageAdapter.
    """

    def __init__(self, bucket_name: str, endpoint_url: Optional[str] = None):
        self.bucket_name = bucket_name
        self.endpoint_url = endpoint_url
        logger.info(f"S3StorageAdapter initialized for bucket: {bucket_name}")

    def save_upload(self, job_id: str, filename: str, stream: BinaryIO) -> str:
        raise NotImplementedError("S3 storage adapter is ready for production cloud migration via boto3.")

    def save_text(self, job_id: str, filename: str, text_content: str, encoding: str = "utf-8") -> str:
        raise NotImplementedError("S3 storage adapter is ready for production cloud migration via boto3.")

    def get_file_path(self, job_id: str, filename: str) -> Optional[Path]:
        return None  # In S3, files are streamed or presigned URLs are used

    def read_text(self, job_id: str, filename: str, encoding: str = "utf-8") -> Optional[str]:
        raise NotImplementedError("S3 storage adapter is ready for production cloud migration via boto3.")

    def file_exists(self, job_id: str, filename: str) -> bool:
        raise NotImplementedError("S3 storage adapter is ready for production cloud migration via boto3.")

    def delete_job_files(self, job_id: str) -> bool:
        raise NotImplementedError("S3 storage adapter is ready for production cloud migration via boto3.")

    def cleanup_expired_jobs(self, max_age_seconds: int) -> int:
        # In S3, bucket lifecycle expiration rules handle this automatically.
        return 0


# Factory singleton for storage
_storage_instance: Optional[BaseStorage] = None


def get_storage() -> BaseStorage:
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = LocalStorage()
    return _storage_instance
