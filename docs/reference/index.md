# Reference

Reference is the product-concept dictionary for Nimi. Each page is a
field listing, table, or enumeration sourced from `.nimi/spec/**`. None
of these pages narrate — for narrative, see the domain sections
(Platform / Runtime / SDK / Desktop / Realm / Avatar /
Nimi Coding).

## Pages

| Page | Use when you need to know... |
| --- | --- |
| [Glossary](/reference/glossary) | What a cross-domain term means in one place |
| [World Fields](/reference/world-fields) | What a World looks like at the field level |
| [Character and LocalAgent Fields](/reference/agent-fields) | How Realm-owned Character identity relates to Runtime-owned LocalAgent materialization |
| [Six Primitives](/reference/six-primitives) | The cross-world contract surfaces in tabular form |
| [State Machines](/reference/state-machines) | Every named state machine and its canonical states |
| [Authority Domains](/reference/authority-domains) | Which domain owns which kind of truth |
| [Error Ownership](/reference/error-ownership) | Which layer owns which error contract |
| [Compatibility Posture](/reference/compatibility-posture) | The platform-wide compatibility envelope and forbidden compatibility shapes |
| [Forbidden Claims](/reference/forbidden-claims) | Public docs forbidden claim list with detection patterns |
| [Spec Map](/reference/spec-map) | How a public claim traces back to its `.nimi/spec/**` source |

## When To Use Each Page

If you need a single term defined, start at the
[Glossary](/reference/glossary). If you need the canonical fields of a
World or a Character/LocalAgent boundary, the
[World Fields](/reference/world-fields) and
[Agent Fields](/reference/agent-fields) pages are the field-level
sources. If you need to trace a public claim back to its kernel
contract, [Spec Map](/reference/spec-map) is the navigation index.

For named state machines, [State Machines](/reference/state-machines)
is the consolidated table. For ownership of any kind of truth or
error, [Authority Domains](/reference/authority-domains) and
[Error Ownership](/reference/error-ownership) say which domain answers.

## Source Basis

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
