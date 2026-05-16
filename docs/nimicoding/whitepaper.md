# Nimi Coding Whitepaper

Nimi Coding treats AI-assisted implementation as authority-bearing work.
The claim is simple: complex AI coding succeeds when authority, scope,
execution packets, audit gates, and closeout criteria are all spelled
out *before* the output is accepted as done.

This page argues for that claim and lays out the failure modes it's
designed to handle.

## Why Ordinary AI Coding Breaks Down

For small changes, a single assistant can read a few files, patch the
code, run a test, and call it done. For complex projects, that model
breaks down. The assistant might:

- follow stale docs because they look authoritative;
- infer missing product truth that was never admitted;
- preserve old compatibility paths because they happen to still
  compile;
- close the task because the build passed even though the user-facing
  result is wrong;
- produce work that looks complete by one closure dimension but fails
  another.

Each of those is hard to detect from inside the assistant's loop. Each
of them looks like success in the moment.

## The Nimi Coding Model

Nimi Coding separates five concerns:

| Concern | Question it answers |
| --- | --- |
| **Authority** | Where does truth live? |
| **Packet** | What is this worker allowed to read, write, and claim? |
| **Wave** | Which owner domain is being closed now? |
| **Audit** | What evidence proves the work did not drift? |
| **Closeout** | Why is this complete for authority, semantics, consumer use, and future drift? |

This model does not remove iteration. It makes iteration auditable.

## The Four Closure Dimensions

Each wave is closed only when all four dimensions are satisfied:

- **Authority closure** — the work fits inside admitted authority and
  did not silently expand it.
- **Semantic closure** — the work matches the meaning of the contract
  it was supposed to express.
- **Consumer closure** — the work actually serves the human or system
  that consumes it.
- **Drift-resistance closure** — the work does not leave footguns that
  will let drift creep back later.

Most "looks done but isn't" failures map cleanly to one of these
dimensions failing while another passes. A docs rewrite can be
authority-closed (no spec drift) and semantic-closed (claims match
the spec) and still be consumer-failed because the rendered docs do
not read as public documentation.

## Reader Scenario: The Current Pending Topic

The current pending docs remediation topic is a useful illustration:

1. A previous topic redesigned the public docs around source-anchored
   prose. Authority closure was clean: no spec drift, every public
   claim had source basis.
2. Semantic closure was clean: the prose described the spec contracts
   accurately.
3. Consumer closure failed: the user said the docs read like audit
   artifacts.
4. Drift-resistance closure was contingent on human acceptance, which
   never came.
5. The topic was held in pending instead of being marked complete.

That is what the four-dimension model catches that simpler "build
passed" closure rules miss.

## Why This Is Not Bureaucracy

Topic overhead can look heavy. The reason it pays off is that AI
implementation is unusually good at producing plausible-but-wrong
output. In a normal codebase, code review and tests are the main
gates. With AI, the assistant can produce work that passes both gates
while still being wrong about authority, scope, or consumer fit.

Nimi Coding does not replace code review. It adds gates that catch
the failure modes code review alone cannot.

## Consumer Closure Matters

The human-readable docs remediation topic exists because the previous
docs rewrite passed machine gates but failed human acceptance. That is
exactly the kind of failure Nimi Coding is meant to surface: a task
can be source-anchored, lint-clean, build-clean, and still not satisfy
the consumer.

When that happens, the right move is to keep the topic in pending and
admit a follow-on wave, not to declare the work done.

## Source Basis

- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
