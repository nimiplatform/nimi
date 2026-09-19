package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// commitUnresolvedSpeechCandidateForTest commits a saved candidate Loadout with
// a legal unresolved required model slot. It is never selected.
func commitUnresolvedSpeechCandidateForTest(t *testing.T, svc *Service, displayName string) *runtimev1.Loadout {
	t.Helper()
	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		RecipeId:           capabilitydriver.Qwen3TTSCustomVoiceRecipeID,
		Options:            &structpb.Struct{},
		DisplayName:        displayName,
	})
	if err != nil {
		t.Fatalf("PrepareLoadout(candidate): %v", err)
	}
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNRESOLVED {
		t.Fatalf("candidate proposal validation = %s, want unresolved", prepared.GetProposedLoadout().GetValidationState())
	}
	return commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
}

func TestResolveLocalEnvironmentPlanTargetsSavedCandidateWithoutSelection(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	candidate := commitUnresolvedSpeechCandidateForTest(t, svc, "candidate environment target")

	resp, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CandidateLoadoutId: candidate.GetLoadoutId(),
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentPlan(candidate): %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetPackId() != "local-speech" || plan.GetConsumerScope() != "speech.qwen3-tts.python" {
		t.Fatalf("candidate environment target = %q/%q, want local-speech/speech.qwen3-tts.python", plan.GetPackId(), plan.GetConsumerScope())
	}
	if plan.GetCandidateLoadoutId() != candidate.GetLoadoutId() || plan.GetCandidateRevision() != candidate.GetRevision() || plan.GetCandidateRevision() == "" {
		t.Fatalf("candidate identity projection = %q/%q, want %q/%q", plan.GetCandidateLoadoutId(), plan.GetCandidateRevision(), candidate.GetLoadoutId(), candidate.GetRevision())
	}
	if len(plan.GetDependencies()) == 0 || plan.GetState() != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("candidate plan = state:%q deps:%d, want a confirmable setup plan", plan.GetState(), len(plan.GetDependencies()))
	}

	// Resolving a candidate neither requires nor mutates machine selection.
	svc.mu.RLock()
	selectionCount := len(svc.loadoutSelections)
	svc.mu.RUnlock()
	if selectionCount != 0 {
		t.Fatalf("candidate resolution touched machine selection: %d selections", selectionCount)
	}
	// A matching capability hint is accepted.
	if _, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		CandidateLoadoutId: candidate.GetLoadoutId(),
	}); err != nil {
		t.Fatalf("candidate with matching capability hint: %v", err)
	}
	// The selection path still requires a machine selection.
	if _, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
	}); status.Code(err) != codes.FailedPrecondition || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("selection path without selection = code:%s reason:%s", status.Code(err), grpcReasonForTest(err))
	}
}

func TestResolveLocalEnvironmentPlanCandidateFailures(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	candidate := commitUnresolvedSpeechCandidateForTest(t, svc, "candidate failure cases")

	if _, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CandidateLoadoutId: "loadout_missing",
	}); status.Code(err) != codes.NotFound || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND {
		t.Fatalf("missing candidate = code:%s reason:%s", status.Code(err), grpcReasonForTest(err))
	}
	if _, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioTranscribeContract,
		CandidateLoadoutId: candidate.GetLoadoutId(),
	}); status.Code(err) != codes.FailedPrecondition || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH {
		t.Fatalf("mismatched candidate capability = code:%s reason:%s", status.Code(err), grpcReasonForTest(err))
	}
}

func TestCandidateEnvironmentPlanBindsCandidateRevision(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	candidate := commitUnresolvedSpeechCandidateForTest(t, svc, "revision-bound candidate")
	resolution := &runtimev1.ResolveLocalEnvironmentPlanRequest{CandidateLoadoutId: candidate.GetLoadoutId()}

	first, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
	if err != nil {
		t.Fatalf("resolve first candidate plan: %v", err)
	}
	if first.GetPlan().GetCandidateRevision() != candidate.GetRevision() {
		t.Fatalf("first candidate revision = %q, want %q", first.GetPlan().GetCandidateRevision(), candidate.GetRevision())
	}

	// A committed candidate write rotates the candidate revision and must
	// invalidate every plan resolved against the older revision.
	updated, err := svc.UpdateLoadout(context.Background(), &runtimev1.UpdateLoadoutRequest{
		LoadoutId: candidate.GetLoadoutId(), CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		RecipeId: capabilitydriver.Qwen3TTSCustomVoiceRecipeID, DisplayName: "revision-bound candidate renamed",
	})
	if err != nil {
		t.Fatalf("UpdateLoadout(candidate): %v", err)
	}
	if updated.GetLoadout().GetRevision() == candidate.GetRevision() || updated.GetLoadout().GetRevision() == "" {
		t.Fatalf("candidate revision did not rotate: before=%q after=%q", candidate.GetRevision(), updated.GetLoadout().GetRevision())
	}
	second, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
	if err != nil {
		t.Fatalf("resolve second candidate plan: %v", err)
	}
	if second.GetPlan().GetPlanId() == first.GetPlan().GetPlanId() {
		t.Fatalf("candidate plan id did not change after a candidate revision rotation: %q", second.GetPlan().GetPlanId())
	}
	if second.GetPlan().GetCandidateRevision() != updated.GetLoadout().GetRevision() {
		t.Fatalf("second candidate revision = %q, want %q", second.GetPlan().GetCandidateRevision(), updated.GetLoadout().GetRevision())
	}
	if _, err := svc.ApplyLocalEnvironmentPlan(context.Background(), &runtimev1.ApplyLocalEnvironmentPlanRequest{
		Resolution: resolution, ExpectedPlanId: first.GetPlan().GetPlanId(), Confirmed: true,
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("stale candidate plan apply = %v, want FailedPrecondition", err)
	}
}

func TestApplyCandidateEnvironmentPlanDoesNotSelectOrReconfigure(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	candidate := commitUnresolvedSpeechCandidateForTest(t, svc, "apply candidate")
	markLocalEnvironmentPlanReadyForTest(t, svc, localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-speech",
	})
	resolution := &runtimev1.ResolveLocalEnvironmentPlanRequest{CandidateLoadoutId: candidate.GetLoadoutId()}
	resolved, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
	if err != nil {
		t.Fatalf("resolve ready candidate plan: %v", err)
	}
	if resolved.GetPlan().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("ready candidate plan state = %q, want ready_managed", resolved.GetPlan().GetState())
	}

	svc.mu.RLock()
	loadoutCount := len(svc.loadouts)
	svc.mu.RUnlock()
	applied, err := svc.ApplyLocalEnvironmentPlan(context.Background(), &runtimev1.ApplyLocalEnvironmentPlanRequest{
		Resolution: resolution, ExpectedPlanId: resolved.GetPlan().GetPlanId(), Confirmed: true,
	})
	if err != nil {
		t.Fatalf("ApplyLocalEnvironmentPlan(candidate): %v", err)
	}
	if applied.GetPlan().GetPlanId() != resolved.GetPlan().GetPlanId() || len(applied.GetJobs()) != 0 {
		t.Fatalf("candidate apply = plan:%q jobs:%d", applied.GetPlan().GetPlanId(), len(applied.GetJobs()))
	}
	if applied.GetPlan().GetCandidateLoadoutId() != candidate.GetLoadoutId() {
		t.Fatalf("applied plan lost candidate identity: %+v", applied.GetPlan())
	}

	// Applying a candidate plan never selects the candidate and never creates or
	// rewrites Loadout or machine selection state.
	svc.mu.RLock()
	selectionCount := len(svc.loadoutSelections)
	afterLoadouts := len(svc.loadouts)
	svc.mu.RUnlock()
	if selectionCount != 0 {
		t.Fatalf("candidate apply selected a Loadout: %d selections", selectionCount)
	}
	if afterLoadouts != loadoutCount {
		t.Fatalf("candidate apply changed Loadout inventory: before=%d after=%d", loadoutCount, afterLoadouts)
	}
	projection, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.GetAggregate().GetSelections()) != 0 {
		t.Fatalf("candidate apply projected a machine selection: %+v", projection.GetAggregate().GetSelections())
	}
}
