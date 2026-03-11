# Mod Release And Submission Guide

This guide is the operational playbook for shipping Nimi desktop mods and handling third-party listing requests.

Chinese mirror: [`mod-release_cn.md`](./mod-release_cn.md)

For the maintainer-facing step-by-step workflow for official mods that live in `nimi-mods/`, see `nimi-mods/RELEASE.md` in the repo root.

Normative behavior still lives in:

- [`spec/desktop/marketplace.md`](../../spec/desktop/marketplace.md)
- [`spec/desktop/kernel/mod-governance-contract.md`](../../spec/desktop/kernel/mod-governance-contract.md)
- [`apps/desktop/docs/mod-runtime-layout-contract.md`](../../apps/desktop/docs/mod-runtime-layout-contract.md)
- [`RELEASE.md`](../../RELEASE.md)

Relevant Desktop kernel anchors for this guide:

- `D-MOD-016` — catalog release visibility and source-of-truth boundary
- `D-MOD-017` — third-party package ownership boundary
- `D-MOD-018` — trust tier semantics
- `D-MOD-019` — re-review triggers and risk handling

## What ships where

- `nimi-mods/` is the source workspace for official Nimi-maintained mods.
- Third-party mods do not get merged into `nimi-mods/` by default.
- Desktop distribution truth comes from the standalone catalog repo, not from scanning source trees.
- GitHub Release assets hold immutable package artifacts.
- Catalog JSON decides whether a package is listed, installable, blocked, yanked, or quarantined.

## Trust tiers

- `official`: Nimi-owned package, built from `nimi-mods/`, signed by Nimi, listed by default.
- `verified`: third-party package, still owned by the third party, but publisher identity and signer chain have been reviewed by Nimi.
- `community`: third-party package that passes structural and safety review for listing, but is not identity-verified by Nimi.

Only official mods belong in `nimi-mods/`. `verified` does not mean source transfer or ownership transfer.

## Required release artifacts

Every cataloged mod release must publish:

1. one prebuilt `.zip` package
2. one sidecar `release.manifest.json`
3. a stable public release URL for both files

The sidecar release manifest must include:

- `packageType=desktop-mod` for Nimi v1 installable mods
- `packageId`
- `version`
- `channel`
- `artifactUrl`
- `sha256`
- `signature`
- `signerId`
- `minDesktopVersion`
- `minHookApiVersion`
- `capabilities`
- `publisher`
- `source`
- `state`

`nimi-app` entries may exist in the catalog schema, but desktop v1 does not install them.

## Official mod release boundary

Official first-party mods are released from the `nimi-mods/` source workspace, but they are still listed through the platform catalog flow.

Boundary split:

- maintainer runbook: `nimi-mods/RELEASE.md`
- platform governance and Desktop visibility rules: this document

Platform-level rules to keep in mind:

1. GitHub Release assets are immutable package artifacts, not listing truth by themselves.
2. Desktop users only see a release after the catalog PR merges and the catalog host serves updated `index/v1/**`.
3. official release automation still runs from the main repo because it needs both `nimi-mods/` sources and catalog update scripts.

## Third-party listing model

Third-party mods follow a listing model, not a source merge model.

Default rule:

- third-party source stays in the author's own repository
- the author publishes their own release assets
- catalog inclusion happens through the catalog repo and Nimi review

Possible outcomes:

- listed as `community`
- listed as `verified`
- rejected
- deferred until missing requirements are fixed

## Third-party author checklist

Before requesting listing, the author must provide:

1. a public source repository
2. a public GitHub Release or equivalent static host for the `.zip`
3. a public `release.manifest.json`
4. a stable `packageId`
5. explicit capabilities with justification
6. tested desktop compatibility information
7. maintainer contact and update owner
8. license and attribution clarity

Strongly recommended:

- use the scaffold in [`examples/mod-template`](../../examples/mod-template/README.md)
- run `pnpm build`, `pnpm doctor`, and `pnpm pack` in the mod repo before submission
- keep release assets immutable after publication

## Third-party submission flow

### Step 1. Submit intake

Open the `Mod submission` issue in this repository and provide:

- package id
- version
- source repository
- zip artifact URL
- `release.manifest.json` URL
- capability justification
- tested desktop compatibility
- requested trust tier
- maintainer contact

The issue is intake for review. It is not listing by itself.

### Step 2. Triage

Maintainers perform a fast intake check:

1. artifact URLs are reachable
2. `release.manifest.json` parses
3. `packageType` is acceptable
4. `packageId` does not conflict with an existing owner
5. capability claims are understandable
6. the package is not asking for unsupported install semantics

Typical triage outcomes:

- `needs-info`: missing metadata or broken links
- `under-review`: review started
- `rejected`: hard policy or safety failure
- `ready-for-catalog-pr`: metadata is sufficient for listing work

### Step 3. Technical review

Maintainers then verify:

1. digest matches the downloadable artifact
2. signature format and signer identity are coherent
3. `minDesktopVersion` and `minHookApiVersion` are realistic
4. manifest capabilities match the stated behavior
5. the mod does not bypass `nimi-hook`
6. the package is installable as a prebuilt archive
7. there is no obvious path traversal, broken archive layout, or malformed metadata

For `verified`, maintainers additionally verify:

1. publisher identity
2. signer ownership and public key continuity
3. package ownership continuity across releases

### Step 4. Trust-tier decision

Decision rules:

- `official`: only Nimi-owned mods from `nimi-mods/`
- `verified`: third-party package passed identity and signer review
- `community`: third-party package passed listing review but not full identity verification
- `reject`: insufficient safety, ownership, or package quality

### Step 5. Catalog update

Once approved:

1. the release is added to the catalog repo
2. `packages/<packageId>.json` is created or updated
3. `releases/<packageId>/<version>.json` is added
4. `packages.json` summary is updated
5. signers, revocations, and advisories are reviewed as needed
6. the catalog PR is opened and must pass validation

The source repository remains the package owner of record.

### Step 6. Merge and visibility

After the catalog PR merges:

1. the package becomes visible through the hosted catalog
2. desktop can discover it
3. install policy follows the assigned trust tier

### Step 7. Future updates

For later versions, the author does not re-submit source code into `nimi-mods/`.

Instead they:

1. publish a new immutable release in their own repo
2. keep `packageId` ownership unchanged
3. update `release.manifest.json`
4. request catalog update for the new version

Re-review is required when:

- signer changes
- publisher ownership changes
- capability set expands materially
- trust tier upgrade is requested

## Maintainer handling checklist

Use this checklist when processing a third-party request.

### Intake checklist

- links resolve
- `release.manifest.json` is public
- zip artifact is public
- `packageId` is not squatting on an official package namespace
- package description is understandable

### Technical checklist

- artifact digest matches
- signature/signer fields are present
- package layout is valid
- capabilities are justified
- `minDesktopVersion` is not below the supported floor
- no runtime/SDK boundary bypass

### Governance checklist

- trust tier selected explicitly
- publisher display name is acceptable
- signer registry entry exists or is proposed
- no open revocation or blocking advisory conflict
- support owner is known

### Merge checklist

- catalog diff only touches intended package files
- release record stays immutable
- channel pointer is correct
- Pages/raw hosting path will expose the new files after merge

## Rejection and escalation rules

Reject or hold a request when:

- artifact and manifest do not match
- package ownership is ambiguous
- signature or signer history is missing for a `verified` request
- capabilities look excessive or unjustified
- package tries to depend on unsupported install-time compilation
- artifact layout is malformed or unsafe

Escalate to security or governance review when:

- a previously listed package changes signer unexpectedly
- package ownership is disputed
- a listed package appears malicious or compromised
- the requested trust tier does not match available evidence

## Yank, quarantine, revoke, and block

Use the catalog overlays instead of rewriting release history.

- `yank`: keep release history visible, but stop recommending or auto-updating to that release
- `quarantine`: treat the package as high-risk and prevent normal install flow
- `revocation`: invalidate a package, release, or signer identity
- advisory `block`: hard-stop install and update in desktop

When a listed third-party package becomes unsafe:

1. open an urgent catalog PR
2. update `revocations.json` and/or `advisories.json`
3. move package state if needed
4. notify the author through the submission issue or repository contact

## Recommended repository split

Keep these responsibilities separate:

- source repo: code, build, pack, GitHub Release assets
- catalog repo: listing, trust tier, revocation, advisory, search index
- desktop app: install, verify, update, rollback

That split is the core v1 policy and should not be collapsed back into `nimi-mods` as a source-scanning marketplace.
