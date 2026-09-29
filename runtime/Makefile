BUF := $(shell go env GOPATH)/bin/buf

.PHONY: proto test run

proto:
	cd ../proto && $(BUF) generate

test:
	go test ./...

run:
	go run ./cmd/nimi serve
