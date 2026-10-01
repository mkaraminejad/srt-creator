"""
Audio processing service using FFmpeg.
Extracts 16kHz mono audio from uploaded MP4, MKV, or MOV video files,
which is the optimal format required by faster-whisper.
"""

import json
import logging
import os
from pathlib import Path
import subprocess
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class AudioProcessingError(Exception):
    """Raised when FFmpeg extraction fails or video has no valid audio stream."""
    pass


def probe_media_duration(video_path: Path) -> float:
    """
    Get duration in seconds using ffprobe.
    Falls back to 0.0 if duration cannot be determined.
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path)
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception as e:
        logger.warning(f"Could not probe duration for {video_path}: {e}")
    return 0.0


def extract_audio_for_whisper(video_path: Path, output_wav_path: Path) -> float:
    """
    Extracts audio from video_path and converts it to:
    - Format: WAV (pcm_s16le)
    - Sample rate: 16000 Hz (Whisper standard)
    - Channels: 1 (Mono)

    Returns the duration of the audio in seconds.
    """
    if not video_path.exists():
        raise AudioProcessingError(f"فایل ویدیو یافت نشد: {video_path}")

    # Make sure output directory exists
    output_wav_path.parent.mkdir(parents=True, exist_ok=True)

    # FFmpeg command:
    # -y: overwrite output
    # -i <input>: input video
    # -vn: disable video recording (extract audio only)
    # -acodec pcm_s16le: uncompressed 16-bit linear PCM
    # -ar 16000: 16kHz sample rate
    # -ac 1: mono channel
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(output_wav_path)
    ]

    logger.info(f"Extracting audio using FFmpeg: {' '.join(cmd)}")
    try:
        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=300  # 5 minutes timeout for audio extraction
        )
        if process.returncode != 0:
            error_msg = process.stderr.strip()
            logger.error(f"FFmpeg failed with error:\n{error_msg}")
            # Check for common issue: no audio stream
            if "does not contain any stream" in error_msg or "matches no streams" in error_msg:
                raise AudioProcessingError("ویدیو فاقد ترک صوتی است یا فایل صوتی قابل خواندن نیست.")
            raise AudioProcessingError(f"خطا در استخراج صدا با FFmpeg: {error_msg[-200:]}")

    except subprocess.TimeoutExpired:
        raise AudioProcessingError("زمان استخراج صدا به اتمام رسید (Timeout).")
    except Exception as e:
        if isinstance(e, AudioProcessingError):
            raise e
        logger.exception("Unexpected error during audio extraction")
        raise AudioProcessingError(f"خطای سیستمی در استخراج صدا: {str(e)}")

    duration = probe_media_duration(output_wav_path)
    if duration <= 0:
        duration = probe_media_duration(video_path)
    logger.info(f"Audio extracted successfully to {output_wav_path}, duration: {duration:.2f}s")
    return duration
