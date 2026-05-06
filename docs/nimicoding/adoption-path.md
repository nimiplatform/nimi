# Adoption Path

Who would adopt Nimi Coding, and why? This page names the
target personas and explains the value proposition for each.

## Target Personas

| Persona | What they get |
| --- | --- |
| Solo founder using AI heavily | Team-scale review discipline without a team |
| Small team (2-5 engineers) adopting AI | Structural review redundancy that scales without headcount |
| Open source maintainer accepting AI-authored PRs | Provable contribution discipline |
| Engineering org with AI-coding compliance pressure | Audit trail and structured acceptance |
| Researcher studying AI engineering practice | Observable methodology corpus |

## Solo Founder Using AI Heavily

The hardest case. A solo founder building an ambitious system
needs to operate at team-scale velocity without a team's
review redundancy.

Pain points:

- Code review by self is unreliable.
- Tests catch behavior bugs but not authority drift.
- AI's plausible-but-wrong outputs survive single-loop review.

What Nimi Coding provides:

- The auditor role can be routed through a different AI
  session or different vendor, simulating the structural
  separation a team would provide.
- The four-closure framework makes "is this done?" answerable
  with evidence rather than feeling.
- The forbidden-shortcuts catalog protects against patterns the
  founder may not have caught yet.

This is the project's own use case. Nimi (the product) is being
built by a solo founder using AI heavily, and Nimi Coding is
what makes it possible.

## Small Team (2-5 Engineers) Adopting AI

Small teams hit AI's failure modes earliest because they have
less review redundancy than a 20-person team. Five reviewers can
spot patterns three reviewers miss.

Pain points:

- AI accelerates output; review capacity does not scale linearly.
- Authority drift is not visible at the PR level; it accumulates
  over weeks.
- "Looked fine to me" approval becomes the default when reviewers
  are stretched.

What Nimi Coding provides:

- Audit is structurally separate from review. The team's PRs go
  through normal review; the audit (against the four closures)
  is a different loop.
- Forbidden-shortcuts catalog catches patterns even when
  reviewers are tired.
- Topic / wave discipline keeps the team focused on one major
  iteration line at a time.

For a small team, the value is **review redundancy that scales
without headcount**.

## Open Source Maintainer Accepting AI-Authored PRs

A maintainer reviewing AI-authored contributions needs evidence
of what the AI was bounded to, what closure conditions it
claimed, and where authority lives.

Pain points:

- AI-authored PRs may look polished and still drift from project
  spec.
- Reviewer cannot easily tell which parts of the AI's reasoning
  are evidence-backed vs hallucinated.
- "Trust the contributor" doesn't scale when contributors are
  models without persistent stake.

What Nimi Coding provides:

- A frozen packet that names what the contributor was bounded by.
- Audit lineage that the maintainer can read instead of
  reconstructing from PR description.
- Four-closure closeout that the maintainer can verify before
  merging.

For an OSS maintainer, the value is **structural evidence of
contribution discipline**.

## Engineering Org With AI-Coding Compliance Pressure

A larger organization that needs to audit how AI-assisted work
was governed — for compliance, security review, handoff between
teams — needs an artifact trail.

Pain points:

- "Was this AI-assisted?" is hard to answer retroactively.
- "What was the AI bounded to?" is hard to answer from the PR.
- Audit and compliance teams cannot read free-form Slack threads
  or chat transcripts as evidence.

What Nimi Coding provides:

- `.nimi/topics/**` is the structured artifact trail.
- `topic.yaml` is the lifecycle evidence.
- Closeout dimensions are the structured acceptance criteria.
- Audit lineage links suggestion → verdict → approval → action.

For an engineering org, the value is **audit-traceable
AI-assisted work**.

## Researcher Studying AI Engineering Practice

Researchers studying how AI coding succeeds or fails need a
structured artifact corpus to analyze.

Pain points:

- Most AI-coding evidence is in chat transcripts and is
  ephemeral.
- "What does AI failure mode X look like?" is hard to answer
  from anecdotes.
- Reproducibility across teams is poor when methodology is
  informal.

What Nimi Coding provides:

- A typed methodology corpus that other teams can adopt and
  produce comparable artifacts under.
- False-closure typology that names recurring failure shapes.
- Audit / packet / closeout artifacts as observable practice
  data.

For a researcher, the value is **observable AI-engineering
practice data**.

## When Not To Adopt

The methodology is **explicit about its applicability**:

| Situation | Use Nimi Coding? |
| --- | --- |
| High-risk or authority-bearing work | Yes |
| Complex remediation | Yes |
| Multi-wave iteration | Yes |
| Cross-module refactor | Yes |
| Tiny local fix | No (overhead exceeds value) |
| One-off script | No |
| Throwaway prototype | No |

Forcing the methodology onto small changes adds cost without
adding closure value. The default posture for small changes is
"normal engineering hygiene without topic discipline."

## Reader Scenario: A Solo Founder First Adopting Nimi Coding

A solo founder is building an ambitious system with heavy AI
assistance.

1. **Acquire the package.** See
   [Installation](/nimicoding/installation) for the current
   pre-launch posture; a public install command is gated on
   admitted distribution evidence.
2. **Run `nimicoding start`.** Bootstrap admits.
3. **Reconstruct spec.** `nimicoding handoff --skill spec_reconstruction --json` to admitted host.
4. **Adopt the methodology for the next high-risk change.** Author
   a topic; admit a wave; freeze a packet.
5. **Route the audit.** Use a different AI session for the auditor
   role.
6. **Close the wave.** Across four closures.
7. **Continue.** Subsequent high-risk changes go through the same
   discipline.

Six months in, the founder has structured artifact evidence of
every substantial change. Authority drift is detectable.
Mistakes that survived the primary loop get caught by the audit
loop.

## Reader Scenario: A Maintainer Adopts Nimi Coding For PR Review

An OSS maintainer with a moderate-traffic project decides to
adopt Nimi Coding for AI-authored PRs.

1. **Add package as a dev dependency.** Install Nimi Coding in
   the project.
2. **Bootstrap `.nimi/**` in main branch.** Methodology + spec
   structure becomes part of the project.
3. **Update contributor guide.** AI-authored PRs must include
   topic / wave / packet artifacts.
4. **Reviewer reads artifacts.** Frozen packet + audit + closeout
   become part of the PR review.
5. **Merge after closeout.** Wave closes; PR can merge.

The change is structural for AI contributions; human
contributions are unaffected if they are routine.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
