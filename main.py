#!/usr/bin/env python3

import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse
import sys
import os
import time
import re
import secrets
import ssl
import getpass
import logging
import threading
import subprocess
import platform
import queue
from pathlib import Path

from md5 import hash
import mpegts_stream

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,  # Enable debug logs for H.264 troubleshooting
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout,
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

SOVEREIGN_URL = os.environ.get('SOVEREIGN_URL', 'http://127.0.0.1:8080')
# Store parent directory path for serving Images
PARENT_DIR = Path(__file__).parent.parent

CAMERA_USERNAME = os.environ.get('CAMERA_USERNAME', 'root')
CAMERA_PASSWORD = None

class CORSProxyHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress all HTTP request logs
        pass
    
    def end_headers(self):
        # Add CORS headers to all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.end_headers()
    
    def do_GET(self):
        # Handle MPEG-TS live stream (ultra-low latency)
        if self.path.startswith('/mpegts/'):
            cam_id_str = self.path.split('/')[-1]
            try:
                cam_id = int(cam_id_str)
            except ValueError:
                self.send_error(400, "Invalid camera ID")
                return
            
            username = CAMERA_USERNAME
            password = CAMERA_PASSWORD
            
            if not password:
                self.send_error(500, "Camera password not configured")
                return
            
            # Start streaming MPEG-TS
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp2t')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            
            # Stream MPEG-TS data (blocks until client disconnects)
            mpegts_stream.stream_mpegts(cam_id, username, password, self.wfile)
            return
        
        # Handle cleanup endpoint
        if self.path == '/cleanup_mpegts':
            mpegts_stream.cleanup_all_mpegts()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'MPEG-TS streams cleaned up')
            return
        
        # Handle camera video proxy for /video*
        if self.path.startswith('/video'):
            self.proxy_camera_stream()
        # Handle SSE proxy for /api/v1/subscribe
        elif self.path == '/api/v1/subscribe' or self.path.startswith('/api/v1/subscribe'):
            self.proxy_sse()
        elif self.path.startswith('/Images/'):
            # Serve Images from parent directory
            image_path = PARENT_DIR / self.path.lstrip('/')
            if image_path.exists() and image_path.is_file():
                try:
                    with open(image_path, 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    # Determine content type based on file extension
                    if image_path.suffix.lower() == '.png':
                        self.send_header('Content-Type', 'image/png')
                    elif image_path.suffix.lower() == '.jpg' or image_path.suffix.lower() == '.jpeg':
                        self.send_header('Content-Type', 'image/jpeg')
                    else:
                        self.send_header('Content-Type', 'application/octet-stream')
                    self.send_header('Content-Length', str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                except Exception as e:
                    self.send_error(500, f"Error serving image: {e}")
            else:
                self.send_error(404, "Image not found")
        else:
            # Serve static files normally
            try:
                super().do_GET()
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected, ignore the error
                pass
    
    def proxy_sse(self):
        """Proxy Server-Sent Events with CORS headers"""
        
        try:
            # Send response headers FIRST (before connecting to SOVEREIGN)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache, no-transform')
            self.send_header('Connection', 'keep-alive')
            self.send_header('X-Accel-Buffering', 'no')  # Disable nginx buffering
            self.end_headers()
            
            # Flush headers immediately so browser knows connection is established
            self.wfile.flush()
            
            # Send initial keep-alive comment
            self.wfile.write(b': connected\n\n')
            self.wfile.flush()
            
            # Now connect to the sovereign server
            url = f'{SOVEREIGN_URL}{self.path}'
            req = urllib.request.Request(url)
            req.add_header('Accept', 'text/event-stream')
            req.add_header('Cache-Control', 'no-cache')
            
            # Open connection with no timeout (we already have keep-alive to client)
            try:
                response = urllib.request.urlopen(req, timeout=None)
            except Exception as e:
                self.wfile.write(f': error connecting to event server: {e}\n\n'.encode())
                self.wfile.flush()
                return  # Don't raise, just return to close connection gracefully
            
            # Use the underlying file object for better streaming control
            # Read from the response's underlying file-like object
            fp = response.fp
            
            # Stream data in small chunks for real-time forwarding
            last_data_time = time.time()
            try:
                while True:
                    # Read line by line for proper SSE format handling
                    line = fp.readline()
                    if line:
                        # Write line immediately and flush
                        self.wfile.write(line)
                        self.wfile.flush()  # Critical: flush after each line for SSE
                        last_data_time = time.time()
                    else:
                        # Send keep-alive comment every 15 seconds to prevent timeout
                        if time.time() - last_data_time > 15:
                            try:
                                self.wfile.write(b': keep-alive\n\n')
                                self.wfile.flush()
                                last_data_time = time.time()
                            except:
                                break
                        # No data available, small sleep
                        time.sleep(0.1)
                        continue
                        
            except (ConnectionResetError, BrokenPipeError, OSError) as e:
                # Client disconnected, that's fine for SSE
                pass
            except Exception as e:
                # Log unexpected errors
                import sys
                print(f"Proxy error: {e}", file=sys.stderr)
            finally:
                try:
                    response.close()
                except:
                    pass
                
        except urllib.error.URLError as e:
            logger.debug(f"SSE proxy error: {e}")
            try:
                self.wfile.write(f': error: {e}\n\n'.encode())
                self.wfile.flush()
            except:
                pass
        except Exception as e:
            logger.debug(f"SSE proxy error: {e}")
            try:
                self.wfile.write(f': error: {e}\n\n'.encode())
                self.wfile.flush()
            except:
                pass
    
    def proxy_camera_stream(self):
        """Proxy camera video streams with Digest authentication
        Supports both MJPEG and H.264 streams based on requested format
        """
        cam_id = None
        ip = None
        url = None
        try:
            # Parse camera ID and format from path
            # /video1 or /video1?format=h264 or /video1?format=mjpeg
            path_parts = self.path.split('?')
            cam_id = path_parts[0].strip("/video")
            
            # Parse query parameters
            format_type = 'mjpeg'  # default
            if len(path_parts) > 1:
                params = urllib.parse.parse_qs(path_parts[1])
                format_type = params.get('format', ['mjpeg'])[0].lower()
            
            username = CAMERA_USERNAME
            password = CAMERA_PASSWORD
            
            if not password:
                self.send_error(500, "Camera password not configured")
                return
            
            camera_ip_prefix = os.environ.get('CAMERA_IP_PREFIX', '10.10.0')
            ip = f"{camera_ip_prefix}.{cam_id}"
            
            # Use HTTP MJPEG stream for all cameras
            uri = "/video1s3.mjpg"  # MJPEG
            url = f"https://{ip}{uri}"
            
            logger.debug(f"camera{cam_id}: Proxying {format_type} stream from {ip}")

            context = ssl._create_unverified_context()

            # Step 1: Get Digest challenge
            req1 = urllib.request.Request(url)
            try:
                response = urllib.request.urlopen(req1, context=context, timeout=5)
            except urllib.error.HTTPError as e:
                auth_header = e.headers.get("WWW-Authenticate", "")
                if not auth_header.lower().startswith("digest"):
                    raise Exception(f"No Digest challenge from camera")

            # Parse Digest challenge
            def extract(key):
                match = re.search(f'{key}="([^"]+)"', auth_header)
                return match.group(1) if match else None

            realm = extract("realm")
            nonce = extract("nonce")
            qop = extract("qop") or "auth"
            opaque = extract("opaque")
            algorithm = extract("algorithm") or "md5"

            nc = "00000001"
            cnonce = secrets.token_hex(16)
            method = "GET"

            def H(x): return hash(x)

            HA1 = H(f"{username}:{realm}:{password}")
            HA2 = H(f"{method}:{uri}")
            response = H(f"{HA1}:{nonce}:{nc}:{cnonce}:{qop}:{HA2}")

            # Construct Authorization header
            auth = (
                f'Digest username="{username}", realm="{realm}", nonce="{nonce}", '
                f'uri="{uri}", algorithm={algorithm}, response="{response}", '
                f'qop={qop}, nc={nc}, cnonce="{cnonce}"'
            )
            if opaque:
                auth += f', opaque="{opaque}"'

            req2 = urllib.request.Request(url, headers={"Authorization": auth})
            try:
                stream = urllib.request.urlopen(req2, context=context, timeout=10)
                pass  # Successfully connected, no need to log
                self.send_response(200)
                self.send_header("Content-Type", stream.headers.get("Content-Type", "multipart/x-mixed-replace"))
                self.end_headers()

                while True:
                    try:
                        chunk = stream.read(1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                    except (ConnectionResetError, BrokenPipeError, OSError):
                        # Client disconnected or stream ended, that's normal
                        break
            except urllib.error.HTTPError as e:
                logger.debug(f"Camera {cam_id}: HTTP error {e.code}")
                raise
            except urllib.error.URLError as e:
                logger.debug(f"Camera {cam_id}: Connection error: {e}")
                raise

        except (ConnectionResetError, BrokenPipeError):
            # Client disconnected, that's normal - don't log or send error response
            pass
        except urllib.error.URLError as err:
            logger.debug(f'Camera {cam_id} at {ip}: {err}')
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Camera {cam_id} unavailable: {err}'.encode())
            except (ConnectionResetError, BrokenPipeError):
                # Client already disconnected
                pass
        except Exception as err:
            logger.debug(f'Camera {cam_id} error: {err}')
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Camera {cam_id} error: {err}'.encode())
            except (ConnectionResetError, BrokenPipeError):
                # Client already disconnected
                pass

def run_server(port):
    """Run a single server instance on the specified port"""
    class ReuseTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True
        daemon_threads = True
    
    with ReuseTCPServer(("", port), CORSProxyHandler) as httpd:
        httpd.serve_forever()

if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    
    CAMERA_PASSWORD = os.environ.get('CAMERA_PASSWORD') or getpass.getpass('Honeywell IP camera password: ')
    
    # Ports for camera servers
    PORTS = [8000, 8001, 8002, 8003, 8004, 8005]
    
    print("Starting camera proxy servers...")
    print("")
    print("Camera distribution:")
    print("  Port 8000: cameras 13, 11, 12, 9")
    print("  Port 8001: cameras 10, 8, 7, 4")
    print("  Port 8002: cameras 2, 3, 1, 5")
    print("  Port 8003: cameras 6, 14, 15, 16")
    print("  Port 8004: cameras 17, 18, 19, 20")
    print("  Port 8005: cameras 21, 22, 23, 24, 25, 26")
    print("")
    print(f"Open http://localhost:8000/index.html in your browser")
    print(f"SSE endpoint at http://localhost:8000/api/v1/subscribe")
    print("Press Ctrl+C to stop all servers")
    print("")
    
    # Start servers in separate threads
    threads = []
    for port in PORTS:
        thread = threading.Thread(target=run_server, args=(port,), daemon=True)
        thread.start()
        threads.append(thread)
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down all servers...")
        sys.exit(0)
    except OSError as e:
        if e.errno == 48:  # Address already in use
            print(f"Error: Port {PORT} is already in use.")
            print("")
            # Try to find and kill the process
            import subprocess
            try:
                result = subprocess.run(['lsof', '-ti', f':{PORT}'], 
                                      capture_output=True, text=True)
                if result.stdout.strip():
                    pids = result.stdout.strip().split('\n')
                    print(f"Found process(es) on port {PORT}: {', '.join(pids)}")
                    response = input("Kill them and start server? (y/n): ")
                    if response.lower() == 'y':
                        for pid in pids:
                            try:
                                subprocess.run(['kill', '-9', pid], check=True)
                                print(f"Killed process {pid}")
                            except:
                                pass
                        # Try again
                        print("Retrying to start server...")
                        with ReuseTCPServer(("", PORT), CORSProxyHandler) as httpd:
                            print(f"✓ Server started on port {PORT}")
                            print(f"Open http://localhost:{PORT} in your browser")
                            print("Press Ctrl+C to stop the server")
                            print("")
                            httpd.serve_forever()
                        sys.exit(0)
            except FileNotFoundError:
                pass  # lsof not available
            
            print("Please either:")
            print(f"  1. Kill the process using port {PORT} manually")
            print(f"  2. Use a different port: python3 serve.py <port>")
            print("")
            print("To find and kill the process:")
            print(f"  lsof -ti:{PORT} | xargs kill -9")
            sys.exit(1)
        else:
            raise

