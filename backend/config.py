"""
Configuration module for WhisperVideoSRT.
Reads settings from environment variables with sensible defaults for local and Docker execution.
"""

import os
from pathlib import Path
from typing import Optional, Set

# Base Directories
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_STORAGE_DIR = str(BASE_DIR / "storage")

# Server Settings
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

# Security Settings
# If set, all API requests (except health check) must include this token in header:
# X-API-Token: <token> or Authorization: Bearer <token>
API_ACCESS_TOKEN: Optional[str] = os.getenv("API_ACCESS_TOKEN", None)

# Upload & File Constraints
UPLOAD_MAX_MB: int = int(os.getenv("UPLOAD_MAX_MB", "500"))
UPLOAD_MAX_BYTES: int = UPLOAD_MAX_MB * 1024 * 1024
ALLOWED_EXTENSIONS: Set[str] = {"mp4", "mkv", "mov"}

# Storage Paths
STORAGE_DIR: str = os.getenv("STORAGE_DIR", DEFAULT_STORAGE_DIR)
MODEL_CACHE_DIR: str = os.getenv("MODEL_CACHE_DIR", os.path.expanduser("~/.cache/huggingface"))

# Whisper AI Settings
# Model size: 'tiny', 'base', 'small', 'medium', 'large-v3'
# 'base' and 'small' provide great balance for CPU transcription.
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "base")
DEVICE: str = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE: str = os.getenv("COMPUTE_TYPE", "int8")  # 'int8' for CPU efficiency, 'float16' for CUDA GPU
CPU_THREADS: int = int(os.getenv("CPU_THREADS", "4"))

# Cleanup Policy
# Temporary files older than this threshold will be deleted by the background janitor
TEMP_FILE_RETENTION_HOURS: int = int(os.getenv("TEMP_FILE_RETENTION_HOURS", "24"))
CLEANUP_INTERVAL_MINUTES: int = int(os.getenv("CLEANUP_INTERVAL_MINUTES", "30"))
