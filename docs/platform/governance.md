# Platform Governance

Nimi uses explicit authority admission because the platform crosses many
owner domains. Runtime, SDK, Realm, Desktop, Web, Avatar, Cognition, and
Nimi Coding are connected, but they are not allowed to overwrite each
other's truth informally.

This page explains the practical rule and what it means for readers and
contributors.

## The Practical Rule

If a claim changes product behavior, compatibility, ownership, or public
meaning, it needs an admitted authority home before it appears as fact in
docs or implementation.

That rule keeps public pages from becoming accidental specifications. It
also keeps app packages from inventing local truth that conflicts with
the platform model.

## Why Admission Matters On AI Platforms

AI platforms are unusually sensitive to silent authority drift. A small
local helper can grow into a parallel routing rule. A docs page can
describe a behavior that the implementation never agreed to. An app can
quietly call past a Desktop boundary because the Runtime call worked at
runtime.

Each of those failures looks small and reversible from one side; it
looks like a contract violation from the other. Admission turns those
moments into explicit cross-domain decisions.

## Reader Scenario: Adding A Capability

Suppose someone wants to add a new local capability route to Runtime
that an app would consume through the SDK. The governance rule says:

1. The route's authority has to belong somewhere. Runtime is the most
   plausible owner because Runtime owns local capability routing.
2. If the route also requires a new SDK surface, the SDK has to admit
   that surface explicitly. The SDK does not silently project new
   Runtime behaviors.
3. If the new route changes how Desktop or Web should display state,
   that change is admitted on the consumer side too. Desktop doesn't
   automatically inherit a new Runtime route's UX.
4. If the docs want to mention the new capability publicly, the page
   needs source basis. A page cannot pre-announce behavior that has
   not yet been admitted.

Each step corresponds to an admitted contract update, not a comment in
a pull request.

## Reader Scenario: A Failed Closure

Suppose Codex finishes a public docs rewrite. The build passes, the
source basis is correct, and the page reads fine to a reviewer. The user
then says, "this still does not look like public docs." The task has
authority and semantic evidence but fails consumer closure. Codex keeps
the task open, fixes the reader experience, and adds the missing
acceptance coverage.

The independent closure dimensions make that visible. A build result
alone cannot justify task completion.

## What This Means For Readers

When a public page says a capability is contract-level, it means the
shape is specified but public operational availability may still be
gated. When a public page says a surface is a projection, it means the
readable page explains an upstream source rather than becoming a
second authority.

If that distinction matters for a decision (say, whether to depend on
a behavior in a downstream project), follow the page's Source Basis to
the spec. The kernel rules are the authoritative answer.

## Source Basis

- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
