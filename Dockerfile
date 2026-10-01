# ==========================================
# WhisperVideoSRT - Dockerfile
# CPU-optimized with faster-whisper and FFmpeg
# ==========================================

FROM python:3.10-slim

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install system dependencies including FFmpeg and curl (for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (leverages Docker layer caching)
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend application source code
COPY backend/ /app/backend/

# Create persistent storage directories
RUN mkdir -p /data/storage /root/.cache/huggingface

# Set default environment variables
ENV HOST=0.0.0.0 \
    PORT=8000 \
    STORAGE_DIR=/data/storage \
    MODEL_CACHE_DIR=/root/.cache/huggingface \
    WHISPER_MODEL=base \
    DEVICE=cpu \
    COMPUTE_TYPE=int8 \
    UPLOAD_MAX_MB=500 \
    TEMP_FILE_RETENTION_HOURS=24

# Expose default HTTP port
EXPOSE 8000

# Docker healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start FastAPI application with Uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
