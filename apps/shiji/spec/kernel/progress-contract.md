# ShiJi Progress Contract

> Rule namespace: SJ-PROG-*
> Scope: Learning progress tracking, chapter timeline, achievements

## SJ-PROG-001 — Learner Profile

Each authenticated user has a local learner profile:

1. Profile persists in `learner_profiles` SQLite table
2. Tracks: child-facing identity, guardian-entered learning context, total sessions completed, total dialogue hours, worlds explored, concepts learned
3. Profile is local-only (not synced to Realm) — education data stays on device
4. Parent mode (PIN-protected per SJ-SHELL-005) can view and export profile data

## SJ-PROG-002 — Chapter Progress

Chapter progress tracks advancement through each world's narrative:

1. Persists in `chapter_progress` SQLite table
2. Each chapter records: index, title (from trunk event), summary, start/end timestamps
3. Chapter boundary = trunk event arrival (per SJ-DIAL-007)
4. Metacognition flag tracks whether the "looking back" reflection occurred
5. Verification score records the chapter-end verification result (if applicable)

## SJ-PROG-003 — Progress Overview

The progress page presents learning statistics:

1. **Summary cards** — total hours, worlds explored, concepts learned (depth >= 1), verification pass rate
2. **World progress grid** — each explored world shows chapter completion bar (e.g., 3/7 chapters)
3. **Recent sessions** — last 5 sessions with world, agent, duration, and chapter reached
4. **Timeline view** — chronological view of all chapters completed across all worlds

## SJ-PROG-004 — Achievement System

Achievements reward exploration and learning milestones:

1. **Explore achievements** — first entry into a period, explore N periods, explore all periods of an era
2. **Knowledge achievements** — first concept verified, verify N concepts, master a domain (all concepts at depth 2)
3. **Dialogue achievements** — complete a chapter, make a historically divergent choice, experience N campfire scenes
4. **Special achievements** — understand an antagonist's perspective, connect a concept across periods, complete a full life arc
5. Achievements persist in `achievements` SQLite table with unlock timestamp
6. Achievement definitions are hardcoded in the app (not from Realm)
7. New achievements show a non-intrusive toast notification

## SJ-PROG-005 — Learning Report Export

Parent/teacher report generation:

1. Accessible only via parent mode (PIN-protected)
2. Report includes: exploration coverage, time distribution, concept mastery by domain, verification scores, chapter completion
3. Export formats: PDF (primary), JSON (machine-readable)
4. Report generation is local — no data leaves the device
5. Report covers a configurable date range (last week / month / all time)

## SJ-PROG-006 — Typed Progress Breakdown

Progress statistics and reports must preserve content classification:

1. Summary statistics distinguish the `contentType` categories defined in `content-classification.yaml` instead of merging them into one mastery number
2. Canonical history mastery uses only the canonical classification pair defined in `content-classification.yaml`
3. Non-canonical learning counts may appear in reports, but only as separate categories and with student-facing labels sourced from `content-classification.yaml`

## SJ-PROG-007 — Learner Context Review

Parent mode exposes learner-context review surfaces:

1. Guardian-entered learner profile fields are editable only through protected parent mode
2. Approved adaptation notes may be reviewed and corrected by the guardian
3. Learning reports may reference learner goals or communication preferences for context, but must not present speculative psychometric judgments as facts
