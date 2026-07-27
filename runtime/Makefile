BUF := $(shell go env GOPATH)/bin/buf

.PHONY: proto proto-baseline test run

proto:
	cd ../proto && $(BUF) generate

proto-baseline:
	cd ../proto && $(BUF) build -o ../runtime/proto/runtime-v1.baseline.binpb

test:
	go test ./...

run:
	go run ./cmd/nimi serve
