BUF := $(shell go env GOPATH)/bin/buf

.PHONY: proto proto-baseline test fast full targeted owner-batch run compliance compliance-gate

proto:
	cd ../proto && $(BUF) generate

proto-baseline:
	cd ../proto && $(BUF) build -o ../runtime/proto/runtime-v1.baseline.binpb

test: fast

fast:
	go run ./cmd/runtime-compliance --profile=fast

full: compliance-gate

targeted:
	go run ./cmd/runtime-compliance --profile=developer $(ARGS)

owner-batch:
	go run ./cmd/runtime-compliance --profile=owner-batch $(ARGS)

run:
	go run ./cmd/nimi serve

compliance: compliance-gate

compliance-gate:
	go run ./cmd/runtime-compliance --gate --output ./compliance-report.json
