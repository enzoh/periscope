#!/usr/bin/env bash

# HTTP server that serves the HTML file and proxies SSE endpoint with CORS
# This is needed because EventSource requires HTTP protocol, not file://

PORT="${1:-3000}"

echo "Starting HTTP server with SSE proxy on port $PORT..."
echo "Open http://localhost:$PORT in your browser"
echo "Press Ctrl+C to stop the server"
echo ""

# Run the Python proxy server
python3 "$(dirname "$0")/serve.py" "$PORT"

