BUF := $(shell go env GOPATH)/bin/buf

.PHONY: proto proto-baseline test run compliance compliance-gate

proto:
	cd ../proto && $(BUF) generate

proto-baseline:
	cd ../proto && $(BUF) build -o ../runtime/proto/runtime-v1.baseline.binpb

test:
	go test ./...

run:
	go run ./cmd/nimi serve

compliance:
	go run ./cmd/runtime-compliance --output ./compliance-report.json

compliance-gate:
	go run ./cmd/runtime-compliance --gate --output ./compliance-report.json
