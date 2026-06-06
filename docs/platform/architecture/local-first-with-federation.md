# Local-First With Federation

Nimi treats your machine as the AI hub. The cloud is where worlds and
identity live; your machine is where AI execution actually happens.
The platform is built to be useful when your computer is the only
thing online, and to compose into a larger compute network when other
machines join in.

## What "Local-First" Means For Nimi

A local-first platform is one where the user's primary device holds
real authority over its own data and execution. It isn't a rebranded
"client-server" — it is a posture that survives going offline.

In Nimi's case:

- **AI inference runs on your hardware.** Runtime owns text / image /
  video / audio / embedding / STT / TTS execution and arbitrates GPU
  use. You do not need a cloud subscription to use AI.
- **Memory and knowledge are local by default.** Memory is opt-in;
  the default substrate runs supervised locally. Knowledge banks live
  in runtime-local storage with explicit ingest.
- **Audit is local first.** Every AI call, every model operation,
  every authorization decision lands in a runtime-local audit ledger.
  Realm cloud audit is a separate plane.
- **Cloud is opt-in.** Connectors to cloud AI providers are typed,
  scoped credentials you choose to add. They don't get added by
  accident.

The cloud half (Realm) still matters — it owns canonical world truth
and cross-world identity. But Realm is not on the AI execution path.
You can have AI capability with Realm offline.

## The Federation Direction (Long-Term)

The Runtime vision goes one step further: a peer-to-peer compute
network where machines federate AI capability with each other.

Concretely, the long-term direction is:

- Your machine can host capability for a friend. Your idle GPU
  cycles run someone else's image generation under their consent
  and your access policy.
- Your machine can call into a friend's machine. If your laptop has
  no GPU but your desktop at home does, your laptop talks to your
  desktop's runtime through the same SDK shape.
- Capability is bounded by scoped tokens. Federation does not mean
  "anyone can use my GPU." It means an admitted token grants a
  declared scope, and the audit lineage is preserved end-to-end.

Federation is a long-term direction, not a current shipping promise.
The current Runtime is single-machine; the federation surface is
admitted at the architecture level so that future federation does not
require breaking the local-first contract.

## Reader Scenario: A First-Run Local-First Setup

You install Nimi on a fresh laptop with a discrete GPU.

1. You start the Runtime daemon. It registers the local GPU as a
   capability surface and reports its device profile.
2. You install a local model — say, a quantized text model that fits
   in your VRAM. The local engine catalog resolves the model and
   prepares its bundle.
3. You optionally add a cloud connector for a provider you have a
   subscription to. The connector is a managed identity with
   scoped credentials.
4. You open an app. The app uses `@nimiplatform/sdk/runtime` to call generation.
   Runtime decides whether to route to your local model or your
   cloud connector based on the request shape and your config.
5. Audit lands in your runtime-local ledger. If you later sign in
   to Realm, you can opt to aggregate the audit upward; you do not
   have to.

At no point did the platform require a cloud subscription. The cloud
is a capability your runtime can route through, not a precondition.

## Reader Scenario: Working Across Two Of Your Own Machines

You have a laptop and a desktop. Your desktop has the powerful GPU.

- Today: your laptop and your desktop each run their own Runtime.
  Each is independent. You can install models on either; identities
  are tied to your account through Realm; runtime state is local.
- Future: a federation surface lets your laptop request capability
  from your desktop's Runtime under a scoped token. The laptop's
  app sees a normal `@nimiplatform/sdk/runtime` call; the actual inference runs
  on the desktop. Audit is preserved across both ledgers.

This federation flow is admitted as a future direction in the
runtime kernel; the local-first posture today is what makes the
future federation safe.

## Why Local-First Matters For An AI Platform

| Risk | What local-first prevents |
| --- | --- |
| Vendor lock-in | Provider connectors are typed and replaceable; the platform itself does not depend on any one provider. |
| Subscription tax | Local models and local capability are first-class; cloud is opt-in. |
| Privacy leak | Memory, knowledge, and audit live on your machine by default; cloud sync is explicit. |
| Network outage | AI work continues without network. |
| Hardware vendor capture | The runtime arbitrates GPU access and is portable across hardware. |

The architectural commitment is that none of these failure modes
should silently degrade the platform.

## Source Basis

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/connector-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/connector-contract.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
