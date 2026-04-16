# nimi-cognition

`nimi-cognition` is a standalone per-agent local cognition package.

It owns:

- local `agent_model_kernel` and `world_model_kernel`
- local `memory_substrate`
- local `knowledge_projections`
- service-grade advisory `skill_artifacts`
- transient local `working_state`
- prompt serving with strict `core` vs `advisory` separation

It does **not** own:

- runtime canonical truth
- runtime replication
- runtime canonical review
- runtime ranking / feedback / event semantics
- runtime control-plane state
- runtime event streams

The single admitted durable backend is SQLite. The service stores normalized tables
for kernels, rules, commits, memory, knowledge, skills, artifact refs,
memory/knowledge history, knowledge ingest tasks, and digest reports. Memory
and knowledge retrieval use FTS-backed lexical search, and knowledge also
admits same-scope relation traversal and deterministic hybrid retrieval.

## Service Surface

Import the top-level facade:

```go
import "github.com/nimiplatform/nimi/nimi-cognition/cognition"
```

Create a standalone service:

```go
c, err := cognition.New("/path/to/data")
if err != nil {
	panic(err)
}
defer c.Close()

if err := c.InitScope("agent_001"); err != nil {
	panic(err)
}
```

Available subservices:

- `c.KernelService()` for kernel access and `kernelops`
- `c.MemoryService()` for record persistence, lexical retrieval, derived views,
  explicit delete, and local history
- `c.KnowledgeService()` for projection lifecycle, lexical/hybrid retrieval,
  same-scope relations, traversal, ingest tasks, explicit delete, and local history
- `c.SkillService()` for validated advisory bundle persistence, lexical search,
  explicit delete, and local lifecycle history
- `c.WorkingService()` for transient in-process working state
- `c.PromptService()` for core/advisory prompt rendering

For external routines, `c.NewRoutineContext(scopeID)` builds a typed
non-kernel execution context without re-introducing digest or other routines
into the facade.

## Kernel Mutation

Kernel mutation still goes through the admitted surface:

```text
incoming_patch -> diff_report -> conflict_report -> resolved_patch -> commit_record
```

`kernelops` now performs field-aware diffing, transition validation, commit
snapshot recording, and fail-closed checks for supersession and artifact-ref
integrity.

## Artifact Refs

Internal reference ownership lives on the referencing artifact.

- memory records do not carry downstream ownership
- kernel rules, knowledge pages, and skill bundles own their own refs
- digest and retrieval query these refs through the repository-backed
  `internal/refgraph` service

## Digest

`digest` remains an external routine. It is not part of the `cognition`
facade and it never mutates kernels directly.

Each run has two phases:

1. internal analysis produces findings and cleanup candidates from refgraph and lifecycle state
2. internal apply performs archive/remove transitions only when blockers are absent

The admitted external entrypoint is `digest.NewWorker(cfg).Run(ctx)`.

Cleanup order is downstream-first:

1. `knowledge`
2. `skill`
3. `memory`

Cleanup is refgraph/lifecycle-driven. There is no wall-clock forgetting
baseline in this package.

Explicit delete remains separate from digest cleanup. `remove` persists a
terminal lifecycle outcome that remains loadable and visible in history;
`delete` is the explicit destructive operator that makes a later load fail.

## Knowledge Graph And Ingest

Knowledge projections now own explicit same-scope graph and ingest surfaces:

- `KnowledgeService().PutRelation(...)`
- `KnowledgeService().DeleteRelation(...)`
- `KnowledgeService().ListRelations(scopeID, pageID)`
- `KnowledgeService().ListBacklinks(scopeID, pageID)`
- `KnowledgeService().Traverse(scopeID, rootPageID, depth)`
- `KnowledgeService().IngestDocument(scopeID, envelope)`
- `KnowledgeService().GetIngestTask(scopeID, taskID)`

Ingest remains standalone-local: it persists an explicit queued/running/
completed/failed task lifecycle and performs page writes through the local
worker path. It does not claim runtime workflow or shared-truth ownership.

## Local History And Lifecycle

Memory, knowledge, and skill now expose explicit local lifecycle history:

- `MemoryService().History(scopeID, recordID)`
- `KnowledgeService().History(scopeID, pageID)`
- `SkillService().History(scopeID, bundleID)`

Advisory services distinguish three outcomes:

- `archive`: non-terminal lifecycle transition
- `remove`: terminal lifecycle transition that remains persisted and observable
- `delete`: explicit destructive removal after blocker checks

Delete remains explicit and fail-closed:

- `MemoryService().Delete(scopeID, recordID)`
- `KnowledgeService().Delete(scopeID, pageID)`
- `SkillService().Delete(scopeID, bundleID)`

## Prompt Separation

Prompt rendering keeps kernel truth separate from advisory context:

- `PromptService().FormatCore(scopeID)` only renders active kernel rules
- `PromptService().FormatAdvisory(scopeID)` renders memory, knowledge, and
  skill context from service-owned memory views and validated knowledge/skill artifacts
- `PromptService().FormatAll(scopeID)` joins both sections without collapsing
  them

Prompt serving fails closed on malformed advisory artifacts or illegal lane
inputs; it never reads working state or routine evidence.

## Build

```bash
go build ./...
go test ./...
go vet ./...
```

## Audit Status

Cognition authority and implementation are now aligned for cognition-local
standalone completion closeout.

`C-COG-004`, `C-COG-023`, `C-COG-032`, and `C-COG-045` are currently `covered`
in `/.nimi/spec/cognition/kernel/tables/rule-evidence.yaml`, with direct
behavior evidence for public lifecycle mutation, citation/provenance integrity,
typed digest persistence, and authoritative worker-path cleanup.

This is a cognition-local completion claim only. Repo-wide human-doc
projections and broader standalone project closeout remain separate governance
surfaces and must be kept in sync independently.
