# Comparison

Where does Nimi Coding sit next to the engineering practices you
already know? This page lines it up against the neighbors:
vanilla AI coding, traditional code review, DevOps / GitOps
governance, Domain-Driven Design / Resource-Driven Design, and
agile / scrum.

## vs. Vanilla AI Coding (Cursor / Copilot / Claude Code Standalone)

| Dimension | Vanilla AI Coding | Nimi Coding |
| --- | --- | --- |
| Authority | Implicit | Named (`.nimi/spec/**`) |
| Acceptance | Single-dimensional ("looks good") | Four-closure framework |
| Scope | Free-form | Frozen packet with bounded write set |
| Closure | Developer says "done" | Closure must be evidenced |
| Audit loop | Same loop as authorship | Structurally separated auditor |
| Host-coupled | Yes | No (vendor-neutral) |
| Forbidden patterns | Implicit | Named catalog |

Vanilla AI coding optimizes for speed of authorship. Nimi
Coding optimizes for **provable correctness of completion**.

## vs. Traditional Code Review

| Dimension | Code Review | Nimi Coding |
| --- | --- | --- |
| Loop separation | Often same team that wrote | Structurally separate auditor |
| Output | Approve / Request Changes | Verdict (PASS / NEEDS_REVISION / FAIL / OVERFLOW) |
| Closure dimensions | One (approve / not) | Four (authority / semantic / consumer / drift) |
| What it catches | Bugs in functions | Authority drift, parallel truth, consumer failure |
| Cadence | Per-PR | Per-wave (broader unit) |
| Artifact | PR comments | Frozen packet + audit + closeout records |

Code review catches local bugs. Nimi Coding catches structural
drift. They are complementary, not substitutable.

A team can use Nimi Coding **inside** their PR workflow: the PR
implements one wave; the wave's audit and closeout records ride
along with the PR; the merge happens after wave closeout.

## vs. DevOps / GitOps Governance

| Dimension | DevOps / GitOps | Nimi Coding |
| --- | --- | --- |
| Layer | Deployment, infrastructure-as-code | Spec-level meaning |
| Question answered | "Did this change land safely?" | "Does this change mean the right thing?" |
| Artifacts | Pipelines, runbooks, infrastructure manifests | Topics, packets, audit records |
| Invariants | Build pass, test pass, deploy success | Authority closure, semantic closure, consumer closure, drift resistance |

DevOps governs deployment. Nimi Coding governs the **meaning**
of the change at the spec level — what truth moved, who owns it
now, what was explicitly forbidden.

The two compose. Nimi Coding fits **in front of** DevOps, not
next to it. A change passes Nimi Coding closeout (meaning is
correct), then passes DevOps gates (deployment is safe).

## vs. Domain-Driven Design / Resource-Driven Design

| Dimension | DDD / RDD | Nimi Coding |
| --- | --- | --- |
| Subject | Domain shape | Work that changes a domain |
| Vocabulary | Bounded context, entity, value object | Topic, wave, packet, closure dimensions |
| Static or dynamic | Mostly static (designs the domain) | Dynamic (governs the work that evolves the domain) |
| Output | Domain model | Audit-traceable change record |

DDD says "your bounded context is X." Nimi Coding says "your
wave's owner domain is X, and the closure conditions are these
four." The two compose well — DDD shapes the domain; Nimi Coding
shapes the work that changes the domain.

A team adopting both gets:

- A clean domain model from DDD
- Provable change discipline from Nimi Coding

## vs. Agile / Scrum

| Dimension | Agile / Scrum | Nimi Coding |
| --- | --- | --- |
| Subject | Cadence, communication, iteration | Authority drift, AI failure modes |
| Layer | Process | Methodology |
| Time unit | Sprint | Topic / wave |
| Output | Story → Done | Wave → closed (4-dim) |
| Silence on AI drift? | Yes (pre-AI invention) | No (is the response) |

Agile / Scrum manage cadence and stakeholder communication.
They are silent on authority drift, parallel truth, and
AI-induced false closure (because they predate the problem).

Nimi Coding is silent on cadence (a different layer). They are
not in tension; they live at different layers and can coexist.

## Differentiation Summary

| Distinctive | What it gives |
| --- | --- |
| Spec-first authority | Truth lives under `.nimi/spec/**`, not in PRs or chat transcripts |
| Four-closure framework | Closure is multidimensional; all four required |
| Independent auditor | Audit comes from a separate loop, not the author |
| Forbidden-shortcuts catalog | Anti-patterns are named and packet-declared |
| Host-agnostic boundary | Switch AI hosts without changing methodology |
| Fail-closed everywhere | When authority is missing, output is rejected |
| Topic / wave / packet / preflight / audit / closeout | A single coherent worldview, not a pile of templates |

## Reader Scenario: Adopting Both DDD And Nimi Coding

A team has an existing DDD-shaped codebase. They want to bring
in AI assistance without losing structural integrity.

1. **Keep the DDD domain model.** Bounded contexts, entities,
   value objects stay.
2. **Adopt Nimi Coding for AI-assisted change.** When AI
   participates in modifying the codebase, the change goes
   through topic / wave / packet discipline.
3. **Each AI-assisted change names its bounded context as the
   wave's owner domain.** The DDD context is the natural
   wave-domain anchor.
4. **Closure dimensions check structural integrity.** "Did the
   AI's change cross the bounded context?" is a structural
   check Nimi Coding admits.

The two layers cooperate. DDD shapes the domain; Nimi Coding
governs the work that changes it.

## Reader Scenario: An Org Adopting Code Review + Nimi Coding

An organization has rigorous code review. They are bringing in
AI tooling. They want to keep code review and add Nimi Coding.

1. **Code review continues.** Per-PR review for local bugs,
   style, idioms.
2. **Nimi Coding wraps PRs.** Each PR implements one wave; the
   wave's audit and closeout artifacts accompany the PR.
3. **Audit reviewer is a separate loop.** A different AI session
   or vendor performs the audit; review reads the audit
   artifacts.
4. **Reviewers check both layers.** "Does the code work?" (code
   review) and "Does the wave close all four dimensions?" (Nimi
   Coding).

Two complementary gates. Together they catch what neither alone
would.

## Where Nimi Coding Does Not Fit

| Situation | Why not |
| --- | --- |
| Tiny low-risk changes | Topic overhead is real; explicit applicability rule says small changes don't need topic discipline |
| One-off scripts | Wave / packet model is heavyweight for ephemeral work |
| Pre-AI codebases with no AI exposure | The methodology is responding to AI failure modes; classic engineering hygiene already covers what's needed |

The methodology is **explicit about its applicability** —
high-risk or authority-bearing work; complex remediations;
multi-wave iterations. Forcing it onto small changes adds cost
without adding closure value.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
