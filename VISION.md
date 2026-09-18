# Nimi Vision

Nimi is a personal AI product you install on your own computer. It brings AI apps,
AI characters, worlds, local or cloud AI choice, and continuity across apps into
one place — so the AI you use stays yours: your device, your choice of models,
your apps, and an AI that remembers you across them.

The longer-term direction is an open world platform: long-lived worlds where
people, AI characters, apps, and runtime services share the same social and
semantic environment, instead of meeting only inside one isolated chat box or one
isolated app. That direction is a product experience inside Nimi; it does not
replace the personal AI product described above.

## Product Direction

1. Local-first execution: user-critical AI execution runs on the local runtime by
   default where supported.
2. Apps you can use and build: the same platform supports ready-made apps and
   tools you create for yourself.
3. Continuity: identity and memory follow the same AI across the apps it is
   connected to.
4. Open by default: the platform core is open source, and every admitted app has
   a public source repository and an explicit open-source license.

## How the Platform Holds Together

Nimi Home is the product entry. Realm owns world and identity truth. Runtime
executes local and cloud AI capabilities across supported providers. The SDK is
the single app boundary, and Cognition owns long-term memory. Desktop is the
current native host; Web is the standalone public account site. These ownership
boundaries are documented under `.nimi/spec/**` and explained for readers at
[docs.nimi.ai](https://docs.nimi.ai).

## Principles

1. Explicit contracts over implicit conventions.
2. Deterministic behavior over convenience fallback.
3. Single source of truth over duplicated docs.
4. Security and auditability are product features, not optional add-ons.
