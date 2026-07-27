# Delegation Client

## Status: Admitted Contract; Release-Gated Surface

The runtime delegation client contract is admitted at the SDK kernel
level. The contract pins how an SDK consumer integrates with the
runtime delegation gateway + output firewall; the client surface is
usable only when present in SDK package exports.

## What This Client Does

The Delegation Client is the SDK surface for an app or external AI host that
integrates with delegated capability — proposing observations,
queries, intents, tool requests, presentation updates, artifact
creates, or controlled tests through the runtime delegation gateway.

All proposals go through the runtime output firewall (see
[Runtime → Delegated Capability](/runtime/delegated-capability)).
The SDK does not let proposals reach a consumer surface
pre-firewall.

## Method Surface

| Method | Purpose |
| --- | --- |
| `OBSERVE` | Submit a typed observation |
| `QUERY` | Submit a typed query |
| `SUGGEST_INTENT` | Propose an intent |
| `SUGGEST_TOOL_REQUEST` | Propose a tool call |
| `SUGGEST_PRESENTATION` | Propose a presentation update |
| `CREATE_ARTIFACT` | Propose creating an artifact |
| `CONTROLLED_TEST` | Run a controlled, sandboxed test |

All of these are **suggestions / observations**, not actions.

## No Fallback Knobs

The SDK surface deliberately does not expose route / provider
rescue fallback knobs for delegation. Internal runtime fallback may
exist as a low-level strategy; it must not weaken typed public
contracts. A delegation that fails firewall is reported as the typed
failure — not silently retried with a different provider.

## Reader Scenario: App Proposes A Tool Call

An app backed by an external AI proposes a tool call.

1. **App calls SDK.** `delegationClient.suggestToolRequest(...)`.
2. **Runtime delegation gateway opens.** Per the trust tier of the
   provider profile.
3. **Output firewall validates.** Schema, provenance, descriptor
   hash, sensitivity classification, prompt poisoning detection.
4. **Verdict.** Typed verdict (`ACCEPTED_SUGGESTION`,
   `APPROVAL_REQUIRED`, `QUARANTINED`, etc.).
5. **If approved:** Runtime acts under its own audit lineage; SDK
   surfaces the typed result to the app.

## What This Client Does Not Do

- It does not let proposals bypass the output firewall.
- It does not expose route or provider rescue knobs.
- It does not let consumer code execute proposed actions directly.
- It does not silently retry across providers when contract failure.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
