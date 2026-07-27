# Knowledge Service

Cognition Knowledge Service is the typed knowledge surface for
agent reasoning — pages with first-class relations, lexical and
hybrid retrieval, ingest lifecycle. Distinct from runtime
knowledge banks; this is the standalone authority's knowledge
surface.

## What Knowledge Service Owns

| Concern | Surface |
| --- | --- |
| Typed page lifecycle | Save / list / load / delete |
| Lexical retrieval | Keyword / phrase search |
| Hybrid retrieval | Lexical + vector |
| First-class relations | Typed relation graph between pages |
| Ingest lifecycle | `queued → running → completed/failed` |
| Page metadata | Service-derived |

Pages are typed. The relation graph is **first-class** — you can
query "what is connected to this page" and get a typed graph
result, not a flat list.

## First-Class Relations

| Property | Value |
| --- | --- |
| Storage | Typed relation graph |
| Cardinality | Per-relation typed |
| Cross-scope | Forbidden (cognition scope-bound) |
| Mutation | Through admitted relation contracts |
| Query | "What is connected to X" returns typed graph |

This is what distinguishes Cognition Knowledge from a flat
search-index. A reader (or agent) can navigate the relation
graph; reasoning can traverse "what derives from what."

## Ingest Lifecycle

| State | Meaning |
| --- | --- |
| `queued` | Awaiting ingest |
| `running` | Ingest in progress |
| `completed` | Ingest finished successfully |
| `failed` | Ingest failed; reason recorded |

Interrupted local tasks become **explicit failed-state evidence
on reopen**. The platform does not silently lose ingest progress;
on reopen, the failure is visible.

## Reader Scenario: An Agent Queries Knowledge By Lexical Search

An agent needs to recall information about a topic during a turn.

1. **Lexical search.** Agent issues a query under
   `KnowledgeService.Search`.
2. **Service returns matches.** Pages matching the query, with
   service-derived relevance metadata.
3. **Agent uses results.** Brain layer composes the response
   with the recalled knowledge.

The agent did not have to scan all pages itself; the service
provides the typed search surface.

## Reader Scenario: An Agent Navigates The Relation Graph

An agent has a page about "interview tomorrow." Related pages
might include "user's preferred talking points," "user's career
goals," "user's anxiety triggers."

1. **Navigate from anchor page.** Agent invokes
   `KnowledgeService.RelatedPages(pageId)`.
2. **Service returns typed graph.** Connected pages with typed
   relation kinds.
3. **Agent traverses.** Reasoning includes the related context.
4. **Composed response.** Reflects the agent's broader
   understanding.

First-class relations enable structural reasoning. A flat
search-index cannot answer "what's connected to this."

## Reader Scenario: An Ingest Pipeline Fails Mid-Run

A user ingests a large document set; halfway through, the
process is interrupted.

1. **Ingest started.** State `queued → running`.
2. **Process killed.** External interruption.
3. **On reopen.** Ingest state is detected as `failed` (or
   `running` with stale heartbeat that times out to `failed`).
4. **Failure visible.** User sees typed failure with reason —
   not silent partial completion.
5. **Resume / restart.** User can resume under admitted resume
   contract or restart the ingest.

The platform makes interruption visible. Silent partial completion
would let stale state masquerade as completion.

## Cleanup Of Knowledge

Knowledge pages, like memory records, are eligible for digest
cleanup.

| Cleanup driver | What it cleans |
| --- | --- |
| Digest | Pages with broken refs / stale support |
| Explicit delete | User-driven destructive delete |
| Archive | Reversible archive (digest first pass) |

Cleanup is traceable to refgraph reasoning. A page archived
because of broken refs has the broken refs as the explanation.

## Cognition Scope For Knowledge

Knowledge pages live within a Cognition scope. Cross-scope
references are forbidden. This means knowledge from one agent's
scope does not leak into another's.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Page storage | Cognition Knowledge Service |
| Relation graph | Cognition (first-class) |
| Search | Lexical / hybrid retrieval |
| Ingest | Typed lifecycle |
| Cleanup | Digest + explicit delete |

## What Knowledge Service Does Not Do

| Concern | Why not |
| --- | --- |
| Mutate kernels | Kernels are core truth; advisory cannot demote |
| Cross-scope references | Hard reject |
| Free-form unstructured ingest | Pages are typed |
| Implicit relevance | Service-derived metadata is explicit |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
