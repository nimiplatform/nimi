.PHONY: build vet test test-race lint clean

build:
	go build ./...

vet:
	go vet ./...

test:
	go test ./...

test-race:
	go test -race ./...

test-verbose:
	go test -v ./...

lint:
	golangci-lint run ./...

clean:
	go clean -testcache

all: build vet test
