# ShiJi Knowledge Contract

> Rule namespace: SJ-KNOW-*
> Scope: Knowledge scaffolding, concept tracking, learning verification

## SJ-KNOW-001 — Knowledge Tracking Model

Knowledge tracking records what the student has encountered and understood:

1. Each historical concept has a `concept_key` (e.g., `politics.cabinet`, `philosophy.xinxue.zhixingheyi`)
2. Concepts are organized by domain: `politics`, `military`, `philosophy`, `economy`, `culture`, `geography`, `institution`
3. Each concept tracks a `depth` level:
   - **0 (mentioned)** — concept appeared in narrative but was not explained
   - **1 (explained)** — agent explained the concept in character voice
   - **2 (verified)** — student answered a verification question correctly
4. Tracking persists in `knowledge_entries` SQLite table, scoped by learner + world
5. Concept keys derive from Lorebook entry keys when a lorebook entry is injected into dialogue

## SJ-KNOW-002 — Knowledge Scaffolding Integration

Knowledge state informs the prompt builder (per SJ-DIAL-003):

1. Concepts at depth >= 1 are listed in the prompt as "student already understands [X]" — agent must not re-explain
2. Concepts at depth 0 that are contextually relevant are flagged as "may explain if natural" — agent should weave in explanation
3. New concepts (not yet in tracker) that appear in lorebook injection are limited to 3 per turn maximum
4. The `knowledge-scaffolder.ts` module reads the tracker, compares against current lorebook injections, and produces the knowledge state block for the prompt builder

## SJ-KNOW-003 — Explanation Detection

Post-process detects when an agent has explained a concept:

1. After AI generation, scan output for concept key markers (keywords from lorebook entries)
2. If a concept at depth 0 receives substantive treatment (more than passing mention), upgrade to depth 1
3. Detection uses keyword co-occurrence with explanation indicators (e.g., "你知道...吗", "所谓...", "说白了就是...")
4. Depth upgrades persist immediately to SQLite
5. False negatives are acceptable (conservative detection); false positives are not

## SJ-KNOW-004 — Verification Questions

Verification tests understanding at chapter boundaries (per SJ-DIAL-006 verification trigger):

1. Select concepts at depth 1 (explained but not verified) relevant to the current chapter
2. Prompt builder instructs agent to pose a bounded fill-in-the-blank question in character voice
3. Question must have a concrete correct answer (not open-ended)
4. Agent evaluates student's response in-character
5. Correct answer: depth upgrades to 2, agent expresses genuine appreciation
6. Incorrect answer: depth stays at 1, agent encourages without criticism ("not yet, you'll understand when you see more")
7. Maximum 1 verification question per 5 turns (not every turn)

## SJ-KNOW-005 — Knowledge Graph Visualization

The knowledge graph page presents accumulated learning:

1. Top level: group by World (historical period)
2. Second level: group by domain (politics, military, philosophy, etc.)
3. Leaf nodes: individual concepts with depth indicator (color-coded: grey=0, blue=1, gold=2)
4. Statistics: total concepts, verified percentage, domain distribution
5. Clicking a concept shows: definition, which session it was learned in, verification status

## SJ-KNOW-006 — Cross-World Knowledge Connections

Some concepts span multiple periods (e.g., "科举制" appears in Sui, Tang, Song, Ming):

1. Concepts with the same `concept_key` across worlds are linked
2. Knowledge graph shows cross-period connections as dotted lines
3. Learning a concept in one period carries awareness (depth 0) to other periods where it appears
4. This encourages exploration of related periods

## SJ-KNOW-007 — Typed Knowledge Provenance

Knowledge records must retain content provenance:

1. Each `knowledge_entries` row stores `worldId`, `contentType`, and `truthMode` alongside `concept_key` and `depth`
2. Knowledge graph and world detail views must distinguish canonical historical knowledge from non-canonical story or cultural knowledge according to `content-classification.yaml`, using display labels rather than raw enum keys in student-facing UI
3. Verification progress for non-canonical classification pairs must not be presented as canonical history mastery
