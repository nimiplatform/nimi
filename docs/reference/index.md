# Reference

Reference is the product-concept dictionary for Nimi. Each page is a
field listing, table, or enumeration sourced from `.nimi/spec/**`. None
of these pages narrate — for narrative, see the domain sections
(Platform / Runtime / SDK / Desktop / Realm / Avatar / Cognition /
Nimi Coding).

## Pages

| Page | Use when you need to know... |
| --- | --- |
| [Glossary](/reference/glossary) | What a cross-domain term means in one place |
| [World Fields](/reference/world-fields) | What a World looks like at the field level |
| [Agent Fields](/reference/agent-fields) | What an Agent looks like at the field level |
| [Six Primitives](/reference/six-primitives) | The cross-world contract surfaces in tabular form |
| [State Machines](/reference/state-machines) | Every named state machine and its canonical states |
| [Authority Domains](/reference/authority-domains) | Which domain owns which kind of truth |
| [Error Ownership](/reference/error-ownership) | Which layer owns which error contract |
| [Compatibility Posture](/reference/compatibility-posture) | Pre-launch posture and forbidden compatibility shapes |
| [Forbidden Claims](/reference/forbidden-claims) | Public docs forbidden claim list with detection patterns |
| [Spec Map](/reference/spec-map) | How a public claim traces back to its `.nimi/spec/**` source |

## How To Read

These pages are reference, not lessons or recipes. They assume you
already understand the domain narrative and want to look up exact
field names, states, owners, or contracts.

If a term is unfamiliar, start at the [Glossary](/reference/glossary).
If you want a walkthrough, return to the relevant domain section.

## Authority

Every reference entry is sourced from `.nimi/spec/**`. When a reference
page disagrees with the kernel rule, the kernel rule wins and the
reference page is corrected. Reference pages do not invent fields or
contracts; they project what the spec already records.

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
