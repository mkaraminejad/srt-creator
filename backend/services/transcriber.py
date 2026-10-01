"""
Faster-Whisper transcription engine.
Loads models locally from cached storage (Docker volume) and runs speech-to-text
on CPU with int8 quantization. Supports automatic language detection, Persian (fa), and English (en).
"""

import logging
import os
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Any

from backend import config
from backend.services.srt_formatter import segments_to_srt

logger = logging.getLogger(__name__)

# Cached model instance
_loaded_model = None
_loaded_model_name: Optional[str] = None


def get_whisper_model(model_name: Optional[str] = None):
    """
    Get or initialize faster-whisper WhisperModel.
    Cached in memory so multiple jobs don't re-initialize the model from disk every time.
    Models are saved in config.MODEL_CACHE_DIR (mounted Docker volume).
    """
    global _loaded_model, _loaded_model_name
    target_name = model_name or config.WHISPER_MODEL

    if _loaded_model is not None and _loaded_model_name == target_name:
        return _loaded_model

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        logger.error("faster-whisper is not installed. Install it via pip install faster-whisper")
        raise e

    logger.info(
        f"Loading faster-whisper model '{target_name}' on {config.DEVICE} "
        f"with compute_type={config.COMPUTE_TYPE}, cache={config.MODEL_CACHE_DIR}"
    )

    os.makedirs(config.MODEL_CACHE_DIR, exist_ok=True)

    _loaded_model = WhisperModel(
        model_size_or_path=target_name,
        device=config.DEVICE,
        compute_type=config.COMPUTE_TYPE,
        download_root=config.MODEL_CACHE_DIR,
        cpu_threads=config.CPU_THREADS
    )
    _loaded_model_name = target_name
    logger.info(f"Model '{target_name}' loaded successfully.")
    return _loaded_model


def transcribe_audio_file(
    audio_path: Path,
    language_code: Optional[str] = None,
    model_name: Optional[str] = None,
    total_duration: float = 0.0,
    progress_callback: Optional[Callable[[float, str], None]] = None
) -> Tuple[str, List[Dict[str, Any]], str, float]:
    """
    Transcribes the specified audio file.

    Parameters:
    - audio_path: Path to 16kHz mono WAV file
    - language_code: 'auto' / None for auto-detect, 'fa' for Persian, 'en' for English
    - model_name: Whisper model size
    - total_duration: Audio length in seconds to calculate progress percentage
    - progress_callback: Optional function(percentage, status_text)

    Returns:
    - Tuple: (srt_content, segments_list, detected_language, language_probability)
    """
    model = get_whisper_model(model_name)

    # Resolve language selection
    lang_param = None
    if language_code and language_code.lower() not in ("auto", "none", ""):
        lang_param = language_code.lower()

    logger.info(f"Starting faster-whisper transcription for {audio_path} with language={lang_param}")

    if progress_callback:
        progress_callback(10.0, "در حال تحلیل صوت و تشخیص گفتار...")

    # Options:
    # vad_filter: enables Silero VAD to skip non-speech segments, boosting CPU speed and accuracy
    segments_generator, info = model.transcribe(
        str(audio_path),
        language=lang_param,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        word_timestamps=False
    )

    detected_lang = info.language
    lang_prob = info.language_probability
    logger.info(f"Speech detected: language='{detected_lang}' (probability: {lang_prob:.2f}), duration={info.duration:.2f}s")

    if total_duration <= 0 and info.duration > 0:
        total_duration = info.duration

    segments_data: List[Dict[str, Any]] = []

    for seg in segments_generator:
        seg_dict = {
            "id": seg.id,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "avg_logprob": round(seg.avg_logprob, 3),
            "no_speech_prob": round(seg.no_speech_prob, 3)
        }
        segments_data.append(seg_dict)

        # Calculate progress
        if total_duration > 0 and progress_callback:
            # Scale from 15% to 90% during transcription
            pct = min(90.0, 15.0 + (seg.end / total_duration) * 75.0)
            progress_callback(round(pct, 1), f"در حال پردازش زیرنویس (ثانیه {int(seg.end)} از {int(total_duration)})...")

    # Format into standard SRT with UTF-8
    srt_text = segments_to_srt(segments_data)

    if progress_callback:
        progress_callback(100.0, "رونویسی و تولید زیرنویس با موفقیت به پایان رسید.")

    return srt_text, segments_data, detected_lang, lang_prob
