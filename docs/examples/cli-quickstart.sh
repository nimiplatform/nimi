#!/usr/bin/env bash
# Nimi Runtime CLI Quick Start
#
# Prerequisites: Go 1.24+
# Run from the @nimiplatform/nimi repository root.

set -euo pipefail

RUNTIME_DIR="./runtime"
APP_ID="example.cli"
APP_INSTANCE_ID="cli-demo"
EXTERNAL_ID="agent-1"

cd "${RUNTIME_DIR}"

echo "=== 1. Runtime Health ==="
go run ./cmd/nimi health --source grpc

echo ""
echo "=== 2. AI Providers ==="
go run ./cmd/nimi providers --source grpc

echo ""
echo "=== 3. Text Generation (Unary) ==="
go run ./cmd/nimi run local/qwen2.5 \
  --prompt "What is the Nimi platform?" \
  --json

echo ""
echo "=== 4. Text Generation (Streaming) ==="
go run ./cmd/nimi chat local/qwen2.5 \
  --prompt "Write a haiku about open source" \
  --json

echo ""
echo "=== 5. List Models ==="
go run ./cmd/nimi model list --json

echo ""
echo "=== 6. Register App ==="
go run ./cmd/nimi auth register-app \
  --app-id "${APP_ID}" \
  --app-instance-id "${APP_INSTANCE_ID}" \
  --app-mode full \
  --runtime-required \
  --world-relation none \
  --capability runtime.ai.generate \
  --capability runtime.model.list \
  --json

echo ""
echo "=== 7. Register External Principal ==="
go run ./cmd/nimi auth register-external \
  --app-id "${APP_ID}" \
  --external-principal-id "${EXTERNAL_ID}" \
  --external-type agent \
  --proof-type ed25519 \
  --json

echo ""
echo "=== 8. App Authorization ==="
go run ./cmd/nimi app-auth authorize \
  --domain app-auth \
  --app-id "${APP_ID}" \
  --external-principal-id "${EXTERNAL_ID}" \
  --external-type agent \
  --subject-user-id local-user \
  --consent-id consent-001 \
  --consent-version v1 \
  --policy-version v1 \
  --policy-mode preset \
  --preset delegate \
  --scope runtime.ai.generate \
  --ttl-seconds 3600 \
  --scope-catalog-version sdk-v1 \
  --json

echo ""
echo "=== 9. Audit Events ==="
go run ./cmd/nimi audit events --page-size 5 --json

echo ""
echo "=== 10. Usage Stats ==="
go run ./cmd/nimi audit usage --json

echo ""
echo "=== 11. Knowledge (Vector Index) ==="
go run ./cmd/nimi knowledge build \
  --app-id "${APP_ID}" \
  --subject-user-id local-user \
  --index-id demo-index \
  --source-kind messages \
  --source-uri "memory://chat/1" \
  --json

echo ""
echo "=== 12. App Messaging ==="
go run ./cmd/nimi app send \
  --from-app-id app.sender \
  --to-app-id app.receiver \
  --subject-user-id local-user \
  --message-type test.ping \
  --json

echo ""
echo "Done. See docs/runtime/README.md for the full command reference."
