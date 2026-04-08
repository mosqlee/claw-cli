#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building Docker image..."
docker build -t claw-cli-test . 2>&1

echo ""
echo "✅ Docker blackbox tests passed!"
