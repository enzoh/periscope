#!/bin/bash
# Update third-party JavaScript libraries
# Run this script to update to the latest versions

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Updating JavaScript libraries..."
echo ""

# mpegts.js
MPEGTS_VERSION="1.7.3"
echo "Downloading mpegts.js v${MPEGTS_VERSION}..."
curl -L -o mpegts.js "https://cdn.jsdelivr.net/npm/mpegts.js@${MPEGTS_VERSION}/dist/mpegts.js"
curl -L -o mpegts.min.js "https://cdn.jsdelivr.net/npm/mpegts.js@${MPEGTS_VERSION}/dist/mpegts.min.js"

echo "✓ mpegts.js updated ($(wc -c < mpegts.js | tr -d ' ') bytes)"
echo "✓ mpegts.min.js updated ($(wc -c < mpegts.min.js | tr -d ' ') bytes)"
echo ""

# Update VERSION.txt
cat > VERSION.txt << EOF
mpegts.js
Version: ${MPEGTS_VERSION}
Source: https://cdn.jsdelivr.net/npm/mpegts.js@${MPEGTS_VERSION}/dist/
Downloaded: $(date +%Y-%m-%d)
License: Apache-2.0
GitHub: https://github.com/xqq/mpegts.js

Files:
- mpegts.js ($(wc -c < mpegts.js | tr -d ' ') bytes) - Development version
- mpegts.min.js ($(wc -c < mpegts.min.js | tr -d ' ') bytes) - Production minified version

Note: Use mpegts.js for development (better debugging)
      Use mpegts.min.js for production (optimized)
EOF

echo "✓ VERSION.txt updated"
echo ""
echo "All libraries updated successfully!"
echo ""
echo "To use minified version in production, edit index.html:"
echo "  Change: <script src=\"lib/mpegts.js\"></script>"
echo "  To:     <script src=\"lib/mpegts.min.js\"></script>"
