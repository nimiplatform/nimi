BUF := $(shell go env GOPATH)/bin/buf
ifeq ($(OS),Windows_NT)
GO_TEST_EXEC := -exec $(abspath ../scripts/windows-go-test-exec-signer.cmd)
endif

.PHONY: proto proto-baseline test run compliance compliance-gate

proto:
	cd ../proto && $(BUF) generate

proto-baseline:
	cd ../proto && $(BUF) build -o ../runtime/proto/runtime-v1.baseline.binpb

test:
	go test $(GO_TEST_EXEC) ./...

run:
	go run ./cmd/nimi serve

compliance:
	go run ./cmd/runtime-compliance --output ./compliance-report.json

compliance-gate:
	go run ./cmd/runtime-compliance --gate --output ./compliance-report.json
