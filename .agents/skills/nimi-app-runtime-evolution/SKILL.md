---
name: nimi-app-runtime-evolution
description: Audit whether a third-party App should adopt Nimi, assess capability fit and extension cost, or implement and verify its Nimi adaptation. Use for App-driven work across Runtime, SDK, Kit and App Tools; ordinary App business edits stay with their lifecycle guide.
---

# App-driven Nimi evolution

Help decide whether to adapt an App or complete its authorized integration through the shared platform owner. Follow the user's current scope and phase; improving Nimi does not imply completing or releasing the entire App.

## Select the current mode

- **Audit:** requests about feasibility, whether an App is worth adapting, capability gaps, difficulty, cost or an implementation plan use the shared [adaptation audit guide](../../../app-tools/skills/nimi-app-lifecycle/references/audit.md). Investigate and deliver decision evidence; do not begin product/spec changes, adoption or release merely because the future goal is adaptation. Use the owner distinctions below as needed; the implementation sections are not audit prerequisites.
- **Implementation:** requests to adapt, extend or repair use the implementation sections below. When following an earlier audit, apply [the audit handoff](../../../app-tools/skills/nimi-app-lifecycle/references/audit.md#handoff-to-implementation) before relying on consequential assumptions. Reuse the user's accepted decisions and authorization.
- **Audit and implement:** when both are explicitly requested, resolve the decisions needed for a sound approach and continue the authorized implementation. Do not introduce a new approval checkpoint just to change modes.

For an unspecified Nimi ecosystem adaptation, assess preservation of the App's core product and integration through the formal SDK/Kit carrier. State that working scope and proceed. Follow an explicit model-only or other scope; ask only when an unresolved choice materially changes the assessment. Do not require the user to choose a speculative rewrite tier before inspecting the product.

## Establish the actual gap

Start from the App's affected workflow, public SDK/Kit call and selected package combination. Identify the required user result and the conditions that activate the need before choosing a platform extension. Distinguish a core or explicitly selected feature from an optional backend and the old foundation's configuration controls; neither default-off nor code reachability alone decides scope. Preserve the requested task and its required settings. Text alone may not supply alignment, a Job ID may not preserve a project result, and a preview format may differ from an inference input.

Separate missing configuration, unclear instructions, an existing-contract defect, a missing public carrier, unsupported exact implementation behavior, a new task contract, and model-content quality. A catalog row or method name is not proof of a supported request/result combination. Code-level absence can establish a gap without a running Desktop; a failed launch alone cannot establish absence of an AI capability.

For implementation, reuse existing authorization to extend or repair Nimi. Resolve routine implementation choices from the affected contracts. Ask only about an unresolved choice that materially changes product meaning, ownership or the requested outcome; continue independent work. If platform changes are excluded, report the specific blocking requirement without shrinking the App or introducing private inference. The external coding host coordinates repositories and task state; App Tools and Runtime do not acquire that responsibility.

## Choose the semantic owner

Use the relevant row, not a mandatory sweep of every layer:

| Need | Change boundary |
| --- | --- |
| Existing request/result is implemented incorrectly | Repair the owner that changes or loses the value, including SDK/Kit when the defect is in transport or projection. |
| Runtime supports a behavior that the protected App cannot consume | Extend the existing typed public carrier and preserve its authorization and lifetime. |
| Exact model/protocol needs supported tools, reasoning or structured output | Extend the Runtime Driver's versioned behavior adapter and explicit combination support. |
| Existing task needs a contract-local input feature or result detail | Extend that contract and its affected projections; an optional field does not itself justify a new capability. |
| Independent request, result or execution/lifecycle semantics are needed | Define the CapabilityContract with its Runtime owner, then its catalog and implementation. New modality is neither necessary nor sufficient. |
| Research steps, tool callbacks, subtitle rules, media assembly or project recovery | Keep App workflow and business state in the App; share a framework adapter only where the reusable mapping is established. |

For unresolved meaning, start with the exact affected units in [core protocol](../../../.nimi/spec/platform/core-protocol.authority.yaml) (CapabilityContract, standardized-feature and P-CAPCAT rules), [AI provider](../../../.nimi/spec/runtime/ai-provider.authority.yaml) (R051, R119–R124 and the exact capability/Driver rule), or the implicated SDK/Kit/lifecycle owner. These are lookup entry points, not instructions to load whole files or the authority corpus. Use [authority work](../nimi-authority-work/SKILL.md) for semantic authoring or review; a repair to settled behavior does not require invented authority or another approval ceremony.

In particular, canonical tools are text.generate behavior. The consuming App's AI Host may execute business tools and own later turns; Runtime executes the model step. Exact provider/model registration inside the Runtime owner is different from an App hardcoding a provider or bypassing its configured route.

## Implementation: complete the affected chain

Trace the actual public request through admission and allowed execution mode, configuration capture, dispatch, terminal result and the App's downstream action. A type or result-projection branch alone does not prove a callable path. Keep phase dependencies tied to the selected workflow; a conditional extension need not block independent work. Select only affected touchpoints:

- New contract: authority and catalog, proto, Runtime admission/Driver/ExecutionHost, required model and dependency preparation, SDK/Kit/native carrier, and configuration or consumer UI.
- New field or behavior: input validation, immutable effective inputs, parsing, Job/result persistence where applicable, Get/stream projection, and existing consumers of that result.
- Lifecycle repair: cancellation, resource release, session invalidation and subsequent explicit work. Restoring technical-session maintenance must not replay old business work.

Use the module's generation and checks for changed inputs. The canonical catalog generator also produces App Tools' reference vocabulary; scaffold admission remains an explicit subset. Do not make every capability scaffoldable or add a parallel support table to avoid following its owner.

## Implementation: verify and return to the App

Use an existing focused regression for the actual failure mechanism, or add one at the shared owner when it is missing. Relevant examples include terminal evidence before tool execution, ordered continuity, Unicode/whitespace preservation, actual timing and complete artifact pairs, large binary/JSON boundaries, and cancellation without late business writes. These are conditional examples, not a matrix required on every task. Recheck an older consumer only when the changed shared behavior can affect it.

Read the direct package manifest before choosing commands. Proto/generator changes need the affected drift checks and applicable cross-language conformance; a provider adapter change does not automatically require every language or platform suite.

Deliver complete packages through the existing [local tarball workflow](../../../app-tools/README.md#local-development-packages). Record the necessary source/build identity, selected versions, lock integrity, target and native trust profile in existing delivery notes. Matching version numbers alone do not establish matching Runtime/native behavior. Build changed package owners rather than patching installed files or linking App production dependencies to source.

Return to the original App input and downstream result using [real App acceptance](../nimi-app-acceptance/SKILL.md). Reuse the same-package reference baseline for first integration or affected foundation wiring. A passing reference narrows the investigation but does not certify a new capability or rule out a platform defect. Environment prerequisites block only their dependent checks.

Preserve actual model output while checking contract validity and the requested business result. Model-content quality, platform defects and App regressions need separate attribution; neither a model imperfection nor a single successful output justifies automatic model switching or speculative platform redesign.

## Leave reusable results

Report what ran now, what prior evidence remains applicable, and what remains NOT-VERIFIED for the exact version, target and journey. Not rerunning prior evidence does not erase it. Development use, local imported installation, Catalog installation and public release remain distinct; use the existing lifecycle guides for those stages.

Keep one current summary in existing delivery notes with links to historical evidence. State the consumer outcome, shared improvement, protecting regression or reused check, next consumer's entry point, and remaining scope. Update a package guide or this workflow only for a reusable new lesson. Do not create another proof ledger or copy product semantics out of canonical authority. Successful reuse without a platform code change is also a valid result.
