#!/usr/bin/env bash
# Nimi Runtime CLI Quick Start
#
# Prerequisites: installed `nimi` binary on PATH, a running runtime daemon, and
# a build with an admitted background/service controller.
# Run: bash examples/runtime/cli-quickstart.sh

set -euo pipefail

echo "=== 1. Runtime Doctor ==="
nimi doctor

echo ""
echo "=== 2. Version ==="
nimi version

echo ""
echo "=== 3. Runtime Health ==="
nimi health --json

echo ""
echo "=== 4. Runtime Process Status ==="
nimi status

echo ""
echo "Done. Connector and model custody are managed through the protected Desktop Runtime surface."
