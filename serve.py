#!/usr/bin/env python3
"""
Simple HTTP server that serves the HTML file and proxies SSE endpoint with CORS headers.
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import sys
import os
import time
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
SOVEREIGN_URL = 'http://127.0.0.1:8080'

class CORSProxyHandler(http.server.SimpleHTTPRequestHandler):
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
        # Handle SSE proxy for /api/v1/subscribe
        if self.path == '/api/v1/subscribe' or self.path.startswith('/api/v1/subscribe'):
            self.proxy_sse()
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
            # Connect to the sovereign server
            url = f'{SOVEREIGN_URL}{self.path}'
            req = urllib.request.Request(url)
            req.add_header('Accept', 'text/event-stream')
            req.add_header('Cache-Control', 'no-cache')
            
            # Open connection
            response = urllib.request.urlopen(req, timeout=None)
            
            # Send response headers with CORS
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache, no-transform')
            self.send_header('Connection', 'keep-alive')
            self.send_header('X-Accel-Buffering', 'no')  # Disable nginx buffering
            self.end_headers()
            
            # Flush headers immediately
            self.wfile.flush()
            
            # Use the underlying file object for better streaming control
            # Read from the response's underlying file-like object
            fp = response.fp
            
            # Stream data in small chunks for real-time forwarding
            try:
                while True:
                    # Read line by line for proper SSE format handling
                    line = fp.readline()
                    if line:
                        # Write line immediately and flush
                        self.wfile.write(line)
                        self.wfile.flush()  # Critical: flush after each line for SSE
                    else:
                        # No data available, small sleep
                        time.sleep(0.01)
                        # Check if connection is still alive
                        if response.status != 200:
                            break
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
            self.send_error(502, f"Bad Gateway: {e}")
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {e}")

if __name__ == '__main__':
    # Change to the directory containing this script
    os.chdir(Path(__file__).parent)
    
    # Create server with address reuse enabled to handle stale connections
    class ReuseTCPServer(socketserver.TCPServer):
        allow_reuse_address = True
    
    try:
        with ReuseTCPServer(("", PORT), CORSProxyHandler) as httpd:
            print(f"Starting HTTP server on port {PORT}...")
            print(f"Open http://localhost:{PORT} in your browser")
            print(f"SSE endpoint proxied at http://localhost:{PORT}/api/v1/subscribe")
            print("Press Ctrl+C to stop the server")
            print("")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nShutting down server...")
                httpd.shutdown()
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

