"""
SRT Subtitle Formatter and Utilities.
Formats speech transcription segments into standard SubRip (.srt) syntax
with correct UTF-8 Persian/English text handling and standard HH:MM:SS,mmm timestamps.
"""

from typing import List, Dict, Any


def format_timestamp(seconds: float) -> str:
    """
    Convert seconds into SRT timestamp format: HH:MM:SS,mmm
    Example: 73.456 -> 00:01:13,456
    """
    if seconds < 0:
        seconds = 0.0

    total_milliseconds = int(round(seconds * 1000))

    hours = total_milliseconds // 3_600_000
    remainder = total_milliseconds % 3_600_000

    minutes = remainder // 60_000
    remainder = remainder % 60_000

    secs = remainder // 1000
    millis = remainder % 1000

    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def segments_to_srt(segments: List[Dict[str, Any]]) -> str:
    """
    Converts a list of segment dicts (with 'start', 'end', 'text')
    into standard SRT formatted string.
    Ensures UTF-8 compatibility and clean subtitle numbering.
    """
    srt_lines: List[str] = []
    index = 1

    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue

        start_time = float(seg.get("start", 0.0))
        end_time = float(seg.get("end", start_time + 1.0))

        if end_time <= start_time:
            end_time = start_time + 0.5

        start_str = format_timestamp(start_time)
        end_str = format_timestamp(end_time)

        srt_lines.append(f"{index}")
        srt_lines.append(f"{start_str} --> {end_str}")
        srt_lines.append(text)
        srt_lines.append("")  # Empty line separator

        index += 1

    # Join with standard newline
    return "\n".join(srt_lines).strip() + "\n"


def parse_srt(srt_text: str) -> List[Dict[str, Any]]:
    """
    Parse an SRT formatted string into segment objects for frontend rendering and preview.
    """
    segments = []
    blocks = srt_text.strip().replace("\r\n", "\n").split("\n\n")

    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if len(lines) >= 3:
            # line 0 is index, line 1 is timestamp, line 2+ is text
            time_line = lines[1]
            if "-->" in time_line:
                parts = time_line.split("-->")
                start_str = parts[0].strip()
                end_str = parts[1].strip()

                def parse_ts(ts: str) -> float:
                    try:
                        ts = ts.replace(",", ".")
                        h, m, s = ts.split(":")
                        return float(h) * 3600 + float(m) * 60 + float(s)
                    except Exception:
                        return 0.0

                start_sec = parse_ts(start_str)
                end_sec = parse_ts(end_str)
                text = " ".join(lines[2:])
                segments.append({
                    "id": lines[0],
                    "start": start_sec,
                    "end": end_sec,
                    "startTime": start_str,
                    "endTime": end_str,
                    "text": text
                })
    return segments
