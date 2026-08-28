# nimi-cognition

`nimi-cognition` is the local owner implementation for the admitted V1
Cognition capabilities.

It owns exactly two durable product families:

- canonical LocalAgent long-term Memory through `memoryv1.Core`
- snapshot-bound typed Agent Source ingest, inspect, search, and delete

It does not initialize or expose Knowledge, kernel, graph, digest, skill or
plugin registry, working state, prompt serving, a generic scheduler, or a
generic Cognition RPC/bridge.

## V1 composition

Runtime constructs the bounded in-process owner:

```go
owner, err := cognition.NewV1Owner("/path/to/runtime-cognition")
if err != nil {
	panic(err)
}
defer owner.Close()

memoryCore := owner.MemoryCore()
sourceBridge := owner.SourceBridge()
```

`V1Owner` is not App-callable. Runtime remains responsible for LocalAgent
identity, authorization, committed events, transactional outbox custody, AI
jobs, context composition, and final Conversation commit. Cognition alone
commits canonical long-term Memory effects.

The fresh durable layout is intentionally separate and bounded:

- `cognition-memory-v1.sqlite3` contains the canonical Memory store and its
  independent FTS/vector derived indexes.
- `cognition-agent-source-v1.sqlite3` contains only the three typed Agent
  Source tables.

There is no legacy `cognition.sqlite` schema or automatic migration path in
the V1 production composition.

## Build

```bash
go build ./...
go test ./...
go vet ./...
```

Product authority remains under `.nimi/spec/**`; this package README is only
an implementation guide.
