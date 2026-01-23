#!/usr/bin/env python3
"""
MPEG-TS over HTTP streaming for ultra-low latency
Uses FFmpeg to transcode RTSP to MPEG-TS and stream over HTTP
Target latency: 200-500ms (much better than HLS)
"""

import subprocess
import urllib.parse
import logging
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# RTSP paths with fallback order
RTSP_PATHS = [
    '/live1s2.sdp',  # Sub-stream
    '/live1s1.sdp',  # Main stream
]

# Track active FFmpeg processes: {cam_id: process}
active_mpegts_processes = {}


def get_ffmpeg_path():
    """Get FFmpeg binary path"""
    import platform
    
    bin_dir = Path(__file__).parent / 'bin'
    os_name = platform.system().lower()
    arch = platform.machine().lower()
    
    if arch in ['x86_64', 'amd64']:
        arch = 'amd64'
    elif arch in ['arm64', 'aarch64']:
        arch = 'arm64'
    
    if os_name == 'darwin':
        os_name = 'darwin'
    elif os_name == 'linux':
        os_name = 'linux'
    
    local_binary = bin_dir / f'ffmpeg-{os_name}-{arch}'
    if local_binary.exists() and local_binary.is_file():
        return str(local_binary)
    
    return 'ffmpeg'


def get_camera_ip(cam_id):
    """Get IP address for a camera"""
    return f"10.10.0.{cam_id}"


def stream_mpegts(cam_id, username, password, output_pipe):
    """
    Stream MPEG-TS from RTSP camera to output pipe
    This runs in a background thread and writes to the HTTP response
    
    Args:
        cam_id: Camera ID
        username: RTSP username
        password: RTSP password
        output_pipe: File-like object to write MPEG-TS data to (HTTP response wfile)
    """
    try:
        ip = get_camera_ip(cam_id)
        encoded_username = urllib.parse.quote(username, safe='')
        encoded_password = urllib.parse.quote(password, safe='')
        
        # Try each RTSP path
        for rtsp_path in RTSP_PATHS:
            rtsp_url = f"rtsp://{encoded_username}:{encoded_password}@{ip}:554{rtsp_path}"
            
            ffmpeg_path = get_ffmpeg_path()
            
            # ULTRA LOW LATENCY MPEG-TS COMMAND
            ffmpeg_cmd = [
                ffmpeg_path,
                '-hide_banner',
                '-loglevel', 'warning',         # Show warnings for debugging
                '-rtsp_transport', 'tcp',       # TCP for reliability
                '-i', rtsp_url,                 # Input RTSP
                
                # Video: Copy (no re-encoding for minimal latency)
                '-c:v', 'copy',                 # Copy video stream
                '-bsf:v', 'h264_mp4toannexb',   # Convert to Annex B
                
                # Audio: Disable (saves bandwidth)
                '-an',
                
                # MPEG-TS output settings (ABSOLUTE MINIMUM LATENCY)
                '-f', 'mpegts',                 # MPEG-TS format
                '-mpegts_copyts', '1',          # Copy timestamps
                '-mpegts_flags', 'initial_discontinuity', # Handle stream restarts
                '-muxdelay', '0',               # Zero mux delay
                '-muxpreload', '0',             # Zero preload
                '-flush_packets', '1',          # Flush immediately
                '-fflags', 'nobuffer',          # No buffering
                '-flags', 'low_delay',          # Low delay mode
                '-max_delay', '0',              # No delay
                
                # Output to pipe (stdout)
                'pipe:1'
            ]
            
            logger.info(f"Camera {cam_id}: Starting MPEG-TS stream from {ip}")
            safe_cmd = ' '.join(ffmpeg_cmd).replace(encoded_password, '***')
            logger.info(f"Camera {cam_id}: {safe_cmd}")
            
            try:
                process = subprocess.Popen(
                    ffmpeg_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0  # Unbuffered for minimal latency
                )
                
                active_mpegts_processes[cam_id] = process
                logger.info(f"Camera {cam_id}: FFmpeg started (PID {process.pid})")
                
                # Wait a moment for FFmpeg to connect and start producing data
                time.sleep(0.5)
                
                # Check if process died immediately
                if process.poll() is not None:
                    stderr = process.stderr.read().decode('utf-8', errors='replace')
                    logger.error(f"Camera {cam_id}: FFmpeg died immediately (exit {process.returncode})")
                    logger.error(f"Camera {cam_id}: FFmpeg stderr: {stderr}")
                    
                    # Try next RTSP path
                    if rtsp_path != RTSP_PATHS[-1]:
                        logger.warning(f"Camera {cam_id}: Trying next RTSP path...")
                        continue
                    return
                
                logger.info(f"Camera {cam_id}: FFmpeg connected, starting stream...")
                
                # Stream data from FFmpeg to HTTP response
                chunk_size = 1880  # MPEG-TS packet size (188 * 10 packets)
                bytes_sent = 0
                
                while True:
                    chunk = process.stdout.read(chunk_size)
                    if not chunk:
                        # Check if process died
                        if process.poll() is not None:
                            stderr = process.stderr.read().decode('utf-8', errors='replace')
                            logger.error(f"Camera {cam_id}: FFmpeg died (exit {process.returncode}, sent {bytes_sent} bytes)")
                            if stderr:
                                logger.error(f"Camera {cam_id}: FFmpeg stderr: {stderr}")
                            
                            # Try next RTSP path if available
                            if rtsp_path != RTSP_PATHS[-1]:
                                logger.warning(f"Camera {cam_id}: Trying next RTSP path...")
                                break
                            return
                        continue
                    
                    bytes_sent += len(chunk)
                    
                    try:
                        output_pipe.write(chunk)
                        output_pipe.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        # Client disconnected
                        logger.info(f"Camera {cam_id}: Client disconnected")
                        process.terminate()
                        return
                
                # If we get here, try next RTSP path
                process.terminate()
                process.wait(timeout=2)
                
            except Exception as e:
                logger.error(f"Camera {cam_id}: Stream error: {e}")
                if rtsp_path == RTSP_PATHS[-1]:
                    return
                
    except Exception as e:
        logger.exception(f"Camera {cam_id}: Unexpected error")
    finally:
        if cam_id in active_mpegts_processes:
            process = active_mpegts_processes[cam_id]
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=2)
            except:
                try:
                    process.kill()
                except:
                    pass
            del active_mpegts_processes[cam_id]


def cleanup_mpegts_stream(cam_id):
    """Stop MPEG-TS stream for a camera"""
    if cam_id in active_mpegts_processes:
        process = active_mpegts_processes[cam_id]
        try:
            if process.poll() is None:
                logger.info(f"Camera {cam_id}: Stopping MPEG-TS stream (PID {process.pid})")
                process.terminate()
                process.wait(timeout=2)
        except:
            try:
                process.kill()
            except:
                pass
        del active_mpegts_processes[cam_id]


def cleanup_all_mpegts():
    """Stop all MPEG-TS streams"""
    logger.info("Cleaning up all MPEG-TS streams")
    for cam_id in list(active_mpegts_processes.keys()):
        cleanup_mpegts_stream(cam_id)
