"""
Subtitle Translation Service.
Translates subtitle segments from source language into target language (e.g., Persian / Farsi),
strictly preserving the exact SRT timestamps, indices, and formatting with UTF-8 encoding.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from backend.services.srt_formatter import parse_srt, segments_to_srt

logger = logging.getLogger(__name__)


def translate_segments_offline(segments: List[Dict[str, Any]], target_lang: str = "fa") -> List[Dict[str, Any]]:
    """
    Translates list of parsed subtitle segments while keeping timestamps and IDs unchanged.
    Can be connected to local NLLB / MarianMT / Argos Translate models or external APIs.
    """
    translated_segments = []
    for seg in segments:
        orig_text = seg.get("text", "")
        # Translation placeholder hook for offline / local models
        translated_segments.append({
            "id": seg.get("id"),
            "start": seg.get("start"),
            "end": seg.get("end"),
            "startTime": seg.get("startTime"),
            "endTime": seg.get("endTime"),
            "text": orig_text,
            "original_text": orig_text
        })
    return translated_segments


def translate_srt_text(srt_content: str, target_lang: str = "fa") -> str:
    """
    Translates raw SRT content into target language while preserving timestamps.
    """
    segments = parse_srt(srt_content)
    if not segments:
        return srt_content

    translated = translate_segments_offline(segments, target_lang=target_lang)
    return segments_to_srt(translated)
