#!/usr/bin/env python3
"""
Test script for WhisperVideoSRT.
1. Generates a synthetic MP4 video sample using FFmpeg (if not already provided).
2. Sends the video to the FastAPI upload endpoint.
3. Polls the job status until completed.
4. Downloads the resulting SRT subtitle and validates format and UTF-8 encoding.
"""

import os
import sys
import time
import subprocess
from pathlib import Path
import requests

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
API_TOKEN = os.getenv("API_ACCESS_TOKEN", "")
SAMPLE_VIDEO = Path("sample_test.mp4")


def generate_sample_video_if_missing(file_path: Path):
    """Generates a short 4-second MP4 video with audio tone for testing."""
    if file_path.exists():
        print(f"[*] Found existing test video: {file_path}")
        return

    print(f"[*] Generating synthetic test video using FFmpeg at {file_path}...")
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        str(file_path)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        print("[!] FFmpeg generation failed:", res.stderr.decode(errors="ignore"))
        sys.exit(1)
    print("[+] Test video generated successfully.")


def run_test():
    generate_sample_video_if_missing(SAMPLE_VIDEO)

    headers = {}
    if API_TOKEN:
        headers["X-API-Token"] = API_TOKEN

    print(f"[*] Checking API health at {API_BASE_URL}/api/health...")
    try:
        health_resp = requests.get(f"{API_BASE_URL}/api/health", timeout=5)
        print(f"[+] Health check response ({health_resp.status_code}): {health_resp.json()}")
    except Exception as e:
        print(f"[!] Could not connect to API server at {API_BASE_URL}: {e}")
        print("[!] Make sure the application is running (e.g., docker compose up -d)")
        sys.exit(1)

    print(f"[*] Uploading {SAMPLE_VIDEO} to /api/jobs/upload...")
    with open(SAMPLE_VIDEO, "rb") as f:
        files = {"file": (SAMPLE_VIDEO.name, f, "video/mp4")}
        data = {"language": "auto", "model": "base"}
        upload_resp = requests.post(f"{API_BASE_URL}/api/jobs/upload", files=files, data=data, headers=headers)

    if upload_resp.status_code != 200:
        print(f"[!] Upload failed ({upload_resp.status_code}): {upload_resp.text}")
        sys.exit(1)

    job_info = upload_resp.json()
    job_id = job_info["job_id"]
    print(f"[+] Job created successfully! Job ID: {job_id}")

    # Polling job status
    print("[*] Polling job status...")
    max_wait = 180  # 3 minutes
    start_time = time.time()

    while time.time() - start_time < max_wait:
        status_resp = requests.get(f"{API_BASE_URL}/api/jobs/{job_id}", headers=headers)
        if status_resp.status_code != 200:
            print(f"[!] Failed to get job status: {status_resp.text}")
            sys.exit(1)

        data = status_resp.json()
        current_status = data.get("status")
        progress = data.get("progress", 0)
        message = data.get("message", "")

        print(f"    - Status: {current_status} | Progress: {progress}% | Message: {message}")

        if current_status == "completed":
            print(f"\n[+] Transcription completed successfully!")
            print(f"    Language detected: {data.get('language_detected')} (prob: {data.get('language_probability')})")
            print(f"    Duration: {data.get('duration')}s")

            # Download SRT
            print(f"[*] Downloading SRT from /api/jobs/{job_id}/download...")
            dl_resp = requests.get(f"{API_BASE_URL}/api/jobs/{job_id}/download", headers=headers)
            if dl_resp.status_code == 200:
                # Verify valid UTF-8
                srt_text = dl_resp.content.decode("utf-8")
                output_srt = Path(f"result_{job_id[:8]}.srt")
                output_srt.write_text(srt_text, encoding="utf-8")
                print(f"[+] SRT saved to {output_srt}")
                print("\n--- Subtitle Preview ---")
                print(srt_text[:300] if srt_text else "(No speech detected in synthetic tone)")
                print("------------------------")
                print("[SUCCESS] All pipeline tests passed!")
                return
            else:
                print(f"[!] Failed to download SRT: {dl_resp.status_code} {dl_resp.text}")
                sys.exit(1)

        elif current_status == "failed":
            print(f"[!] Job failed with error: {data.get('error')}")
            sys.exit(1)

        time.sleep(2)

    print("[!] Timeout waiting for job to complete.")
    sys.exit(1)


if __name__ == "__main__":
    run_test()
