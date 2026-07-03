# Zhiyu Testing And Quarantine Contract

## Z-GATE-001 Old Tests Are Non-Authoritative

Before inventory classification, all `apps/zhiyu/test/**` tests, E2E, release
evidence scripts, screenshots, and `check:zhiyu-bootstrap` green output are
non-authoritative. They cannot prove product correctness, release readiness, or
spec admission.

## Z-GATE-002 Inventory Required

Each old test must be classified through `tables/test-quarantine-policy.yaml`
before it can be trusted by release or regression gates.

## Z-GATE-003 Real App Acceptance Later

Implementation acceptance after ZS4 must include real app shell checks, desktop
and narrow screenshots, main user paths, Runtime/auth/SDK connectivity,
failure/disabled states, long text/narrow layout, Chinese readability, and
button/input usability. This contract does not run E2E during ZS1.

## Z-GATE-004 Spec Gates Fail Closed

Spec and governance gates must fail closed on domain admission drift, table
family drift, direct AI consumption, duplicate turn reducer, config truth
localization, memory write feature, or old-test authority reuse.

## Z-GATE-005 Implementation Acceptance Matrix

Before Zhiyu implementation remediation is accepted, `tables/implementation-acceptance-matrix.yaml`
must cover every v1 story, every product state, and every admitted preflight
decision. The matrix is a product acceptance contract, not evidence that the
current implementation passes.

## Z-GATE-006 Real App Shell Acceptance Evidence

Post-remediation acceptance must launch the real app shell and inspect DOM/CDP
state, console errors, accessibility, desktop and narrow viewport screenshots,
main user-path interactions, Runtime/auth/SDK connectivity, failure states,
disabled states, long text and narrow layout, Chinese readability, and
button/input usability. Unit tests and closeout notes cannot replace this
evidence.

## Z-GATE-007 Pre-Remediation Blocking Gates

Implementation remediation cannot enter real app shell acceptance while
Zhiyu-specific boundary gates still fail for config truth localization, direct
image creation, local persistence truth, direct AI consumption, duplicate turn
reducers, or old-test authority reuse.
