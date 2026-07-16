package localservice

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// fakeFirstRunLocalExecutor is a test double for the runtime ai service
// FirstRunLocalExecution capability. It lets each test drive the per-scenario
// route resolution outcome the localservice minter must assert against.
type fakeFirstRunLocalExecutor struct {
	// routeByScenario overrides the resolved route for a scenario; default is
	// ROUTE_POLICY_LOCAL.
	routeByScenario map[runtimev1.ScenarioType]runtimev1.RoutePolicy
	// errByScenario forces an execution error for a scenario.
	errByScenario map[runtimev1.ScenarioType]error
	// emptyTargetScenarios resolves a scenario to a local route but with no
	// route target evidence.
	emptyTargetScenarios map[runtimev1.ScenarioType]bool
	// peekErr forces the submit-specific Peek to fail.
	peekErr error
	// peekState is the scheduling state the Peek returns.
	peekState string
	// executeHook observes the exact RPC-derived context used for execution.
	executeHook func(context.Context, runtimev1.ScenarioType, string) (FirstRunLocalExecutionTarget, error)
}

func (f *fakeFirstRunLocalExecutor) ExecuteFirstRunLocalBaseline(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	modelID string,
) (FirstRunLocalExecutionTarget, error) {
	if f.executeHook != nil {
		return f.executeHook(ctx, scenarioType, modelID)
	}
	if err := f.errByScenario[scenarioType]; err != nil {
		return FirstRunLocalExecutionTarget{}, err
	}
	route := runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	if override, ok := f.routeByScenario[scenarioType]; ok {
		route = override
	}
	target := "local"
	if f.emptyTargetScenarios[scenarioType] {
		target = ""
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		target = "cloud"
	}
	return FirstRunLocalExecutionTarget{
		RoutePolicy:      route,
		LocalRouteTarget: target,
		ModelResolved:    strings.TrimPrefix(modelID, "local/"),
		TraceID:          "trace_" + scenarioType.String(),
	}, nil
}

func TestFirstRunExecutionEvidencePropagatesCallerCancellation(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)
	contextObserved := false
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{
		executeHook: func(ctx context.Context, _ runtimev1.ScenarioType, _ string) (FirstRunLocalExecutionTarget, error) {
			contextObserved = true
			return FirstRunLocalExecutionTarget{}, ctx.Err()
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(
		ctx,
		firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot),
	)
	if !contextObserved {
		t.Fatal("first-run executor did not receive the caller context")
	}
	if state == firstRunExecutionStateReady || reason != firstRunExecutionReasonExecutionFailed {
		t.Fatalf("cancelled execution did not fail closed: state=%q reason=%q", state, reason)
	}
}

func (f *fakeFirstRunLocalExecutor) PeekFirstRunLocalBaseline(
	_ context.Context,
	capability string,
) (FirstRunLocalSchedulingJudgement, error) {
	if f.peekErr != nil {
		return FirstRunLocalSchedulingJudgement{}, f.peekErr
	}
	state := f.peekState
	if state == "" {
		state = "runnable"
	}
	return FirstRunLocalSchedulingJudgement{
		Capability:      capability,
		SchedulingState: state,
		Detail:          "submit-specific peek",
	}, nil
}

// mintReadyBaselineRef marks the Minimal baseline ready, mints a
// runtimeBaselineRef at the given install level, and returns the verified ref.
func mintReadyBaselineRefAtLevel(t *testing.T, svc *Service, runtimeDataRoot string, installLevel string) string {
	t.Helper()
	svc.SetEngineManager(&mockEngineManager{})
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())
	req := runtimeBaselineMintRequest(runtimeDataRoot)
	req.InstallLevel = installLevel
	record, state, reason, detail := svc.mintRuntimeBaselineReadiness(req)
	if state != runtimeBaselineStateReady {
		t.Fatalf("baseline mint state = %q reason=%q detail=%q, want ready", state, reason, detail)
	}
	return record.RuntimeBaselineRef
}

// mintReadyBaselineRef mints a Minimal-level runtimeBaselineRef.
func mintReadyBaselineRef(t *testing.T, svc *Service, runtimeDataRoot string) string {
	t.Helper()
	return mintReadyBaselineRefAtLevel(t, svc, runtimeDataRoot, runtimeBaselineInstallLevelMinimal)
}

func firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot string) firstRunExecutionMintRequest {
	return firstRunExecutionMintRequest{
		RuntimeBaselineRef:               baselineRef,
		SelectedLocalFactoryAIProfileRef: runtimeBaselineTestFactoryProfileRef,
		InstallLevel:                     runtimeBaselineInstallLevelMinimal,
		DataRootRef:                      runtimeDataRoot,
		HostProfile:                      runtimeBaselineCPUProfile(),
	}
}

// --- Positive: Minimal mint + resolve ---

func TestFirstRunExecutionEvidenceMintsMinimal(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	record, state, reason, detail := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state != firstRunExecutionStateReady {
		t.Fatalf("mint state = %q reason=%q detail=%q, want local_ai_ready", state, reason, detail)
	}
	if !strings.HasPrefix(record.ExecutionEvidenceRef, "execution_evidence_") {
		t.Fatalf("expected durable ULID ref, got %q", record.ExecutionEvidenceRef)
	}
	// All ten required_projection fields populated.
	if record.SelectedLocalFactoryAIProfileRef != runtimeBaselineTestFactoryProfileRef {
		t.Fatalf("missing selected_local_factory_aiProfile_ref: %+v", record)
	}
	if record.InstallLevel != runtimeBaselineInstallLevelMinimal {
		t.Fatalf("install_level = %q, want minimal", record.InstallLevel)
	}
	if record.RuntimeBaselineRef != baselineRef {
		t.Fatalf("runtimeBaselineRef = %q, want %q", record.RuntimeBaselineRef, baselineRef)
	}
	if record.DataRootRef != runtimeDataRoot {
		t.Fatalf("missing dataRootRef: %+v", record)
	}
	if len(record.LocalExecutionTargetEvidence) == 0 {
		t.Fatal("missing local_execution_target_evidence")
	}
	if len(record.SelectedBaselineCapabilityProof) != 3 {
		t.Fatalf("selected_baseline_capability_proof = %d, want 3 Minimal capabilities", len(record.SelectedBaselineCapabilityProof))
	}
	if record.SubmitSpecificSchedulingJudgement != nil {
		t.Fatal("scheduling judgement must be null when no submit-specific Peek was evaluated")
	}
	if record.TerminalResult != firstRunExecutionTerminalReady {
		t.Fatalf("terminal_result = %q, want local_ai_ready", record.TerminalResult)
	}
	if record.ObservedAt == "" {
		t.Fatal("missing timestamps")
	}
	if len(record.RuntimeAuditSequence) == 0 {
		t.Fatal("missing runtime_audit_sequence")
	}
	// Every proof must be a local route against a bound baseline asset.
	caps := map[string]bool{}
	for _, proof := range record.SelectedBaselineCapabilityProof {
		caps[proof.Capability] = true
		if proof.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL.String() {
			t.Fatalf("capability %q route = %q, want ROUTE_POLICY_LOCAL", proof.Capability, proof.RoutePolicy)
		}
		if proof.TerminalResult != firstRunExecutionCapabilityTerminalExecuted {
			t.Fatalf("capability %q terminal = %q, want local_executed", proof.Capability, proof.TerminalResult)
		}
		if strings.TrimSpace(proof.BoundAssetID) == "" {
			t.Fatalf("capability %q missing bound runtimeBaselineRef asset", proof.Capability)
		}
		if strings.TrimSpace(proof.LocalRouteTarget) == "" {
			t.Fatalf("capability %q missing local route target evidence", proof.Capability)
		}
	}
	for _, want := range []string{firstRunCapabilityLocalTextChat, firstRunCapabilityLocalBasicSTT, firstRunCapabilityLocalBasicTTS} {
		if !caps[want] {
			t.Fatalf("Minimal proof set missing %q", want)
		}
	}

	// Resolve re-confirms the ref.
	resolved, rState, rReason, rDetail := svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef:       record.ExecutionEvidenceRef,
		ExpectedRuntimeBaselineRef: baselineRef,
		ExpectedDataRootRef:        runtimeDataRoot,
		ExpectedInstallLevel:       runtimeBaselineInstallLevelMinimal,
		HostProfile:                runtimeBaselineCPUProfile(),
	})
	if rState != firstRunExecutionStateReady {
		t.Fatalf("resolve state = %q reason=%q detail=%q, want local_ai_ready", rState, rReason, rDetail)
	}
	if resolved.ExecutionEvidenceRef != record.ExecutionEvidenceRef {
		t.Fatal("resolve returned a different ref")
	}
}

// --- Positive: Recommended adds confirmed-plan capabilities on the floor ---

func TestFirstRunExecutionEvidenceMintsRecommended(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRefAtLevel(t, svc, runtimeDataRoot, runtimeBaselineInstallLevelRecommended)

	// Recommended with no extra confirmed-plan capabilities still produces the
	// Minimal floor (text + STT + TTS) — every capability has an admitted
	// binding so the mint succeeds.
	req := firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
	req.InstallLevel = runtimeBaselineInstallLevelRecommended
	record, state, reason, detail := svc.mintFirstRunExecutionEvidence(context.Background(), req)
	if state != firstRunExecutionStateReady {
		t.Fatalf("recommended mint state = %q reason=%q detail=%q, want local_ai_ready", state, reason, detail)
	}
	if record.InstallLevel != runtimeBaselineInstallLevelRecommended {
		t.Fatalf("install_level = %q, want recommended", record.InstallLevel)
	}
	if len(record.SelectedBaselineCapabilityProof) != 3 {
		t.Fatalf("recommended floor proof set = %d, want 3", len(record.SelectedBaselineCapabilityProof))
	}
}

// --- Positive: submit-specific scheduling judgement recorded only when evaluated ---

func TestFirstRunExecutionEvidenceRecordsSubmitSpecificSchedulingJudgement(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{peekState: "runnable"})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	req := firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
	req.SubmitSchedulingEvaluated = true
	record, state, _, detail := svc.mintFirstRunExecutionEvidence(context.Background(), req)
	if state != firstRunExecutionStateReady {
		t.Fatalf("mint state = %q detail=%q, want ready", state, detail)
	}
	if record.SubmitSpecificSchedulingJudgement == nil {
		t.Fatal("submit-specific scheduling judgement must be recorded when a Peek was evaluated")
	}
	if !record.SubmitSpecificSchedulingJudgement.Evaluated {
		t.Fatal("recorded judgement must be marked evaluated")
	}
	if record.SubmitSpecificSchedulingJudgement.SchedulingState != "runnable" {
		t.Fatalf("scheduling_state = %q, want runnable", record.SubmitSpecificSchedulingJudgement.SchedulingState)
	}
}

// --- Negative: cloud remoteTarget route on a baseline capability ---

func TestFirstRunExecutionEvidenceRejectsCloudRouteTarget(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{
		routeByScenario: map[runtimev1.ScenarioType]runtimev1.RoutePolicy{
			runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
	})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	record, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state == firstRunExecutionStateReady || record.ExecutionEvidenceRef != "" {
		t.Fatal("minter accepted a cloud route target for a baseline capability")
	}
	if reason != firstRunExecutionReasonRouteNotLocal {
		t.Fatalf("reason = %q, want %q", reason, firstRunExecutionReasonRouteNotLocal)
	}
}

// --- Negative: hybrid/cloud-first route policy ---

func TestFirstRunExecutionEvidenceRejectsHybridRoute(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	// ROUTE_POLICY_UNSPECIFIED stands in for a cloud-first / hybrid resolution
	// that did not resolve to a local route target.
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{
		routeByScenario: map[runtimev1.ScenarioType]runtimev1.RoutePolicy{
			runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE: runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED,
		},
	})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state == firstRunExecutionStateReady {
		t.Fatal("minter accepted a non-local (hybrid/cloud-first) route policy")
	}
	if reason != firstRunExecutionReasonRouteNotLocal {
		t.Fatalf("reason = %q, want %q", reason, firstRunExecutionReasonRouteNotLocal)
	}
}

// --- Negative: forbidden media-generation scenario has no baseline binding ---

func TestFirstRunExecutionEvidenceRejectsForbiddenScenario(t *testing.T) {
	// VIDEO_GENERATE / MUSIC_GENERATE / WORLD_GENERATE / IMAGE_GENERATE are not
	// admitted first-run baseline capabilities. They have no capability id with
	// a binding, so a recommended capability naming one fails closed.
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRefAtLevel(t, svc, runtimeDataRoot, runtimeBaselineInstallLevelRecommended)

	for _, forbidden := range []string{
		"video_generation_execution",
		"music_generation_execution",
		"world_generation_execution",
		"image_generation_execution",
	} {
		req := firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
		req.InstallLevel = runtimeBaselineInstallLevelRecommended
		req.RecommendedCapabilities = []string{forbidden}
		_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req)
		if state == firstRunExecutionStateReady {
			t.Fatalf("minter accepted forbidden capability %q", forbidden)
		}
		if reason != firstRunExecutionReasonCapabilityUnsupported {
			t.Fatalf("forbidden %q reason = %q, want %q", forbidden, reason, firstRunExecutionReasonCapabilityUnsupported)
		}
	}
}

// --- Negative: connector-setup-only / app-pack "proof" is not a local baseline capability ---

func TestFirstRunExecutionEvidenceRejectsConnectorAndAppPackProof(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRefAtLevel(t, svc, runtimeDataRoot, runtimeBaselineInstallLevelRecommended)

	for _, forbidden := range []string{"connector_setup", "app_specific_pack"} {
		req := firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
		req.InstallLevel = runtimeBaselineInstallLevelRecommended
		req.RecommendedCapabilities = []string{forbidden}
		_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req)
		if state == firstRunExecutionStateReady {
			t.Fatalf("minter accepted connector/app-pack proof %q", forbidden)
		}
		if reason != firstRunExecutionReasonCapabilityUnsupported {
			t.Fatalf("%q reason = %q, want %q", forbidden, reason, firstRunExecutionReasonCapabilityUnsupported)
		}
	}
}

// --- Negative: runtimeBaselineRef missing / string-only / stale / binding-mismatch ---

func TestFirstRunExecutionEvidenceRejectsBadBaselineRef(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	// missing runtimeBaselineRef
	req := firstRunExecutionMintRequestFor("", runtimeDataRoot)
	if _, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req); state == firstRunExecutionStateReady || reason != firstRunExecutionReasonBaselineNotReady {
		t.Fatalf("missing runtimeBaselineRef accepted: state=%q reason=%q", state, reason)
	}
	// string-only runtimeBaselineRef with no backing record
	req = firstRunExecutionMintRequestFor("runtime_baseline_renderersupplied", runtimeDataRoot)
	if _, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req); state == firstRunExecutionStateReady || reason != firstRunExecutionReasonBaselineNotReady {
		t.Fatalf("string-only runtimeBaselineRef accepted: state=%q reason=%q", state, reason)
	}
	// binding mismatch: divergent factory profile ref
	req = firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
	req.SelectedLocalFactoryAIProfileRef = "aiprofile/some-other-profile@9"
	if _, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req); state == firstRunExecutionStateReady || reason != firstRunExecutionReasonFactoryProfileInvalid {
		t.Fatalf("divergent factory profile accepted: state=%q reason=%q", state, reason)
	}
	// binding mismatch: divergent dataRootRef
	req = firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot+"-divergent")
	if _, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req); state == firstRunExecutionStateReady || reason != firstRunExecutionReasonDataRootInvalid {
		t.Fatalf("divergent dataRootRef accepted: state=%q reason=%q", state, reason)
	}
}

// --- Negative: warmup-only / route-health substituted for execution ---

func TestFirstRunExecutionEvidenceRejectsFailedExecution(t *testing.T) {
	// A route-health or warmup-only check is not execution; when the admitted
	// local execution path itself fails (engine produced no terminal result)
	// the minter fails closed — it never records the ref on a non-executed
	// capability.
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{
		errByScenario: map[runtimev1.ScenarioType]error{
			runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE: errors.New("local engine produced no terminal output"),
		},
	})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state == firstRunExecutionStateReady {
		t.Fatal("minter recorded a ref for a non-executed capability")
	}
	if reason != firstRunExecutionReasonExecutionFailed {
		t.Fatalf("reason = %q, want %q", reason, firstRunExecutionReasonExecutionFailed)
	}
}

// --- Negative: a local route resolution with no route target evidence ---

func TestFirstRunExecutionEvidenceRejectsEmptyRouteTargetEvidence(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{
		emptyTargetScenarios: map[runtimev1.ScenarioType]bool{
			runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE: true,
		},
	})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state == firstRunExecutionStateReady {
		t.Fatal("minter accepted a capability with no local route target evidence")
	}
	if reason != firstRunExecutionReasonRouteNotLocal {
		t.Fatalf("reason = %q, want %q", reason, firstRunExecutionReasonRouteNotLocal)
	}
}

// --- Negative: missing executor ---

func TestFirstRunExecutionEvidenceRejectsMissingExecutor(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state == firstRunExecutionStateReady || reason != firstRunExecutionReasonExecutorMissing {
		t.Fatalf("mint without executor accepted: state=%q reason=%q", state, reason)
	}
}

// --- Negative: scheduling peek failure does not become silent success ---

func TestFirstRunExecutionEvidenceSchedulingPeekFailureFailsClosed(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{peekErr: errors.New("scheduler unavailable")})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	req := firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot)
	req.SubmitSchedulingEvaluated = true
	_, state, reason, _ := svc.mintFirstRunExecutionEvidence(context.Background(), req)
	if state == firstRunExecutionStateReady || reason != firstRunExecutionReasonSchedulingFailed {
		t.Fatalf("scheduling peek failure not failed closed: state=%q reason=%q", state, reason)
	}
}

// --- Negative resolve: string-only executionEvidenceRef ---

func TestFirstRunExecutionEvidenceResolveRejectsStringOnlyRef(t *testing.T) {
	svc, _ := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()

	for _, ref := range []string{"", "execution_evidence_renderersupplied"} {
		_, state, reason, _ := svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{ExecutionEvidenceRef: ref})
		if state == firstRunExecutionStateReady {
			t.Fatalf("resolve accepted string-only ref %q", ref)
		}
		if ref == "" && reason != firstRunExecutionReasonRefMissing {
			t.Fatalf("empty ref reason = %q, want %q", reason, firstRunExecutionReasonRefMissing)
		}
		if ref != "" && reason != firstRunExecutionReasonRefUnknown {
			t.Fatalf("unbacked ref reason = %q, want %q", reason, firstRunExecutionReasonRefUnknown)
		}
	}
}

// --- Negative resolve: ref with divergent verified composition inputs ---

func TestFirstRunExecutionEvidenceResolveRejectsBindingMismatch(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)
	record, state, _, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state != firstRunExecutionStateReady {
		t.Fatal("setup mint failed")
	}

	// Divergent expected runtimeBaselineRef.
	_, rState, rReason, _ := svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef:       record.ExecutionEvidenceRef,
		ExpectedRuntimeBaselineRef: "runtime_baseline_divergent",
	})
	if rState == firstRunExecutionStateReady || rReason != firstRunExecutionReasonRefMismatch {
		t.Fatalf("divergent runtimeBaselineRef accepted at resolve: state=%q reason=%q", rState, rReason)
	}
	// Divergent expected dataRootRef.
	_, rState, rReason, _ = svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef: record.ExecutionEvidenceRef,
		ExpectedDataRootRef:  runtimeDataRoot + "-divergent",
	})
	if rState == firstRunExecutionStateReady || rReason != firstRunExecutionReasonRefMismatch {
		t.Fatalf("divergent dataRootRef accepted at resolve: state=%q reason=%q", rState, rReason)
	}
}

// --- Negative resolve: incomplete Minimal capability set (TTS missing), and
// recorded cloud route ---

func TestFirstRunExecutionEvidenceResolveRejectsIncompleteAndCloudRecorded(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)
	record, state, _, _ := svc.mintFirstRunExecutionEvidence(context.Background(), firstRunExecutionMintRequestFor(baselineRef, runtimeDataRoot))
	if state != firstRunExecutionStateReady {
		t.Fatal("setup mint failed")
	}

	// Incomplete: drop the TTS capability proof from the stored record.
	incomplete := record
	pruned := make([]firstRunExecutionCapabilityProof, 0, 2)
	for _, proof := range record.SelectedBaselineCapabilityProof {
		if proof.Capability == firstRunCapabilityLocalBasicTTS {
			continue
		}
		pruned = append(pruned, proof)
	}
	incomplete.SelectedBaselineCapabilityProof = pruned
	svc.upsertFirstRunExecutionEvidenceRecord(incomplete)
	_, rState, rReason, _ := svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef: incomplete.ExecutionEvidenceRef,
	})
	if rState == firstRunExecutionStateReady || rReason != firstRunExecutionReasonRefIncomplete {
		t.Fatalf("incomplete capability set accepted at resolve: state=%q reason=%q", rState, rReason)
	}

	// Recorded cloud route: mutate a proof's route to cloud.
	cloudTainted := record
	tainted := make([]firstRunExecutionCapabilityProof, len(record.SelectedBaselineCapabilityProof))
	copy(tainted, record.SelectedBaselineCapabilityProof)
	tainted[0].RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD.String()
	cloudTainted.SelectedBaselineCapabilityProof = tainted
	svc.upsertFirstRunExecutionEvidenceRecord(cloudTainted)
	_, rState, rReason, _ = svc.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef: cloudTainted.ExecutionEvidenceRef,
	})
	if rState == firstRunExecutionStateReady || rReason != firstRunExecutionReasonRefRouteCloud {
		t.Fatalf("recorded cloud route accepted at resolve: state=%q reason=%q", rState, rReason)
	}
}

// --- RPC fail-closed surface ---

func TestFirstRunExecutionEvidenceRPCFailClosed(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	svc.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	baselineRef := mintReadyBaselineRef(t, svc, runtimeDataRoot)

	mintResp, err := svc.MintFirstRunExecutionEvidence(context.Background(), &runtimev1.MintFirstRunExecutionEvidenceRequest{
		RuntimeBaselineRef:               baselineRef,
		SelectedLocalFactoryAiProfileRef: runtimeBaselineTestFactoryProfileRef,
		InstallLevel:                     runtimeBaselineInstallLevelMinimal,
		DataRootRef:                      runtimeDataRoot,
		HostProfile:                      runtimeBaselineCPUProfile(),
	})
	if err != nil {
		t.Fatalf("mint RPC transport error: %v", err)
	}
	if mintResp.GetState() != firstRunExecutionStateReady || mintResp.GetRef() == nil {
		t.Fatalf("mint RPC state = %q ref=%v, want ready ref", mintResp.GetState(), mintResp.GetRef())
	}
	if len(mintResp.GetRef().GetSelectedBaselineCapabilityProof()) != 3 {
		t.Fatalf("RPC ref proof count = %d, want 3", len(mintResp.GetRef().GetSelectedBaselineCapabilityProof()))
	}
	ref := mintResp.GetRef().GetExecutionEvidenceRef()

	resolveResp, err := svc.ResolveFirstRunExecutionEvidence(context.Background(), &runtimev1.ResolveFirstRunExecutionEvidenceRequest{
		ExecutionEvidenceRef: ref,
		HostProfile:          runtimeBaselineCPUProfile(),
	})
	if err != nil {
		t.Fatalf("resolve RPC transport error: %v", err)
	}
	if resolveResp.GetState() != firstRunExecutionStateReady || resolveResp.GetRef() == nil {
		t.Fatalf("resolve RPC state = %q, want ready", resolveResp.GetState())
	}

	// Renderer-supplied string ref with no backing record fails closed.
	badResp, err := svc.ResolveFirstRunExecutionEvidence(context.Background(), &runtimev1.ResolveFirstRunExecutionEvidenceRequest{
		ExecutionEvidenceRef: "execution_evidence_renderersupplied",
	})
	if err != nil {
		t.Fatalf("resolve RPC transport error for bad ref: %v", err)
	}
	if badResp.GetState() == firstRunExecutionStateReady || badResp.GetRef() != nil {
		t.Fatal("resolve RPC accepted a renderer-supplied string ref with no backing record")
	}
}
