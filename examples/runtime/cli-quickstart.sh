#!/usr/bin/env bash
# Nimi Runtime CLI Quick Start
#
# Prerequisites: installed `nimi` binary on PATH and a running runtime daemon.
# Note: this is a scripted, non-interactive path, so local calls use `--yes`.
# Public first-run docs intentionally use bare `nimi run "<prompt>"`.
# Run: bash examples/runtime/cli-quickstart.sh

set -euo pipefail

echo "=== 1. Runtime Doctor ==="
nimi doctor

echo ""
echo "=== 2. Version ==="
nimi version

echo ""
echo "=== 3. Local Generation ==="
nimi run "What is the Nimi platform?" --yes --json

echo ""
echo "=== 4. Streaming Generation ==="
nimi run "Write a haiku about open source" --yes

echo ""
echo "=== 5. List Models ==="
nimi model list --json

echo ""
echo "=== 6. Provider Setup (Optional Cloud Path) ==="
echo "Fastest cloud path:"
echo "  nimi run \"Hello from the cloud\" --provider gemini --json"
echo ""
echo "Reusable default path:"
echo "  nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default"

echo ""
echo "=== 7. Cloud Generation (Optional) ==="
echo "After saving a reusable default:"
echo "  nimi run \"Hello from the cloud\" --cloud --json"

echo ""
echo "Done. See docs/reference/runtime.md for the full command reference."
