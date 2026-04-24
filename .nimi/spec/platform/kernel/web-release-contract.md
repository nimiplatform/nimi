# Web Release Contract

> Owner Domain: `P-WEB-*`

## P-WEB-001 — Web Surface Ownership

`apps/web/**` is the first-party web surface for the Nimi site, static legal pages, Cloudflare function adapters, and web-shell mode adapters. It is platform-owned release/web evidence, not an app-local subordinate spec slice unless a later `.nimi/spec` admission explicitly changes that ownership.

## P-WEB-002 — Desktop Public Boundary

Web shell mode may consume desktop public-for-web surfaces and web-specific adapter replacements, but it must not import Tauri APIs, desktop-private renderer aliases, runtime internals, or local filesystem/mod behaviors. Unsupported desktop-only release/self-update surfaces must fail closed rather than returning pseudo-success values.

## P-WEB-003 — Install Gateway Ownership

`apps/install-gateway/**` is the platform release distribution gateway for install scripts, platform manifests, updater metadata, and release-feed projection. Release data must come from the admitted GitHub release source, checksum validation must remain explicit for platform archives, and generated distribution copies must not become source truth.

## P-WEB-004 — Cloudflare Boundary

Cloudflare Workers/Pages functions under the web and install gateway surfaces are deployment adapters. They may proxy or project admitted runtime/release data, but they must not invent runtime, SDK, realm, desktop, or release truth outside their admitted source contracts.

## P-WEB-005 — Evidence Root Admission

Audit evidence roots for `apps/web/**`, `apps/install-gateway/**`, and other platform web/release support surfaces must be admitted through `.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml`. Audit tooling must not infer these roots from broad `apps/**` ownership or from package names alone.
