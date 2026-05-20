package ai

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

// FirstRunLocalExecutionRequest is the normalized internal request for a single
// first-run baseline capability execution. The `ai` service runs it through the
// admitted local execution path and asserts the resolved route is local.
//
// ModelID is the runtimeBaselineRef-bound local model asset id for the
// capability. The "local/" prefix is applied internally so route resolution is
// pinned to the local provider; callers pass the bound asset id directly.
type FirstRunLocalExecutionRequest struct {
	ScenarioType runtimev1.ScenarioType
	ModelID      string
}

// FirstRunLocalExecutionResult is the route + execution evidence the localservice
// minter records into an executionEvidenceRef capability proof. It is produced
// only after a real local execution resolved to a local route target.
type FirstRunLocalExecutionResult struct {
	// RoutePolicy is always ROUTE_POLICY_LOCAL for a successful result.
	RoutePolicy runtimev1.RoutePolicy
	// LocalRouteTarget is the resolved local execution route target backend name.
	LocalRouteTarget string
	// ModelResolved is the runtime-resolved local model id the execution ran.
	ModelResolved string
	// TraceID is the execution trace id stamped by this local execution path.
	TraceID string
}

// firstRunBaselineScenarioAllowed reports whether a ScenarioType is an admitted
// first-run baseline scenario. Only local text/chat, basic STT, and basic TTS
// are admitted; every cloud-shaped or media-generation scenario fails closed.
func firstRunBaselineScenarioAllowed(scenario runtimev1.ScenarioType) bool {
	switch scenario {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return true
	default:
		return false
	}
}

// ExecuteFirstRunLocalBaseline runs one first-run baseline capability through
// the admitted Runtime local execution path. It is local-only by construction:
// it pins the route to ROUTE_POLICY_LOCAL with no RemoteTarget and a denied
// fallback, then asserts the resolved provider route is ROUTE_POLICY_LOCAL — a
// cloud / remote / hybrid resolution fails the call closed. It never accepts a
// RemoteTarget and never rescues a non-local route.
//
// This is the cross-service capability the localservice executionEvidenceRef
// minter consumes through the FirstRunLocalExecutor interface (K-AIEXEC-007).
// It does not weaken the route-agnostic ExecuteScenario path.
func (s *Service) ExecuteFirstRunLocalBaseline(ctx context.Context, req FirstRunLocalExecutionRequest) (FirstRunLocalExecutionResult, error) {
	if s == nil || s.selector == nil {
		return FirstRunLocalExecutionResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if !firstRunBaselineScenarioAllowed(req.ScenarioType) {
		return FirstRunLocalExecutionResult{}, grpcerr.WithReasonCodeOptions(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			grpcerr.ReasonOptions{
				Message: fmt.Sprintf("scenario %s is not an admitted first-run local baseline scenario", req.ScenarioType.String()),
			},
		)
	}
	modelID := strings.TrimSpace(req.ModelID)
	if modelID == "" {
		return FirstRunLocalExecutionResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	// Pin the resolved model to the local provider. The local provider's
	// ResolveModelID strips the "local/" prefix; the prefix forces the route
	// selector down the local path so a cloud preferred-route alias on the
	// asset id can never silently route this baseline proof to cloud.
	localModelID := "local/" + strings.TrimPrefix(modelID, "local/")

	// Local-only route resolution: ROUTE_POLICY_LOCAL, no RemoteTarget, denied
	// fallback. resolveProviderWithTarget(remoteTarget=nil) never produces a
	// cloud provider for a local preferred route; the assertion below still
	// fails closed defensively if route resolution ever diverged.
	selectedProvider, routeDecision, modelResolved, _, err := s.selector.resolveProviderWithTarget(
		ctx,
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		localModelID,
		nil,
	)
	if err != nil {
		return FirstRunLocalExecutionResult{}, err
	}
	// Central correctness requirement: the resolved route MUST be a local route
	// target. A remoteTarget, a cloud provider, or any non-local route fails the
	// first-run baseline execution proof closed.
	if routeDecision != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return FirstRunLocalExecutionResult{}, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			grpcerr.ReasonOptions{
				Message: fmt.Sprintf("first-run baseline execution resolved route %s, expected ROUTE_POLICY_LOCAL", routeDecision.String()),
			},
		)
	}
	localBackend, ok := selectedProvider.(*localProvider)
	if !ok || localBackend == nil || localBackend.Route() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return FirstRunLocalExecutionResult{}, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			grpcerr.ReasonOptions{
				Message: "first-run baseline execution did not resolve to the local provider",
			},
		)
	}

	traceID := ulid.Make().String()
	if err := s.runFirstRunLocalBaselineScenario(ctx, req.ScenarioType, localBackend, modelResolved); err != nil {
		return FirstRunLocalExecutionResult{}, err
	}

	target := strings.TrimSpace(routeDecision.String())
	if backendName := strings.TrimSpace(routeDecisionBackendName(routeDecision)); backendName != "" {
		target = backendName
	}
	return FirstRunLocalExecutionResult{
		RoutePolicy:      routeDecision,
		LocalRouteTarget: target,
		ModelResolved:    strings.TrimSpace(modelResolved),
		TraceID:          traceID,
	}, nil
}

// FirstRunSchedulingJudgement is a submit-specific scheduling judgement for a
// single first-run baseline capability target (K-AIEXEC-003 / K-SCHED-002).
type FirstRunSchedulingJudgement struct {
	Capability      string
	SchedulingState string
	Detail          string
}

// PeekFirstRunLocalBaseline evaluates a submit-specific scheduling Peek for a
// single first-run baseline capability target. It is a per-target judgement —
// never a scope aggregate probe — so the localservice minter may record it as
// submit-specific execution evidence (K-AIEXEC-003). The caller decides whether
// to evaluate it; when it is not evaluated the minter records a null judgement.
func (s *Service) PeekFirstRunLocalBaseline(ctx context.Context, capability string) (FirstRunSchedulingJudgement, error) {
	if s == nil || s.scheduler == nil {
		return FirstRunSchedulingJudgement{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	cap := strings.TrimSpace(capability)
	if cap == "" {
		return FirstRunSchedulingJudgement{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	batch := s.scheduler.Peek(ctx, scheduler.PeekInput{
		Targets: []scheduler.SchedulingEvaluationTarget{
			{Capability: cap},
		},
	})
	// Read the submit-specific target judgement, never the scope aggregate.
	if len(batch.TargetJudgements) == 0 {
		return FirstRunSchedulingJudgement{}, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "scheduler peek produced no submit-specific target judgement"},
		)
	}
	target := batch.TargetJudgements[0]
	return FirstRunSchedulingJudgement{
		Capability:      cap,
		SchedulingState: string(target.Judgement.State),
		Detail:          strings.TrimSpace(target.Judgement.Detail),
	}, nil
}

// routeDecisionBackendName returns a stable local route target label.
func routeDecisionBackendName(route runtimev1.RoutePolicy) string {
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return "local"
	}
	return route.String()
}

// runFirstRunLocalBaselineScenario executes the minimal baseline payload for a
// capability against the local backend. The payload is a deterministic minimal
// probe-of-execution: it proves the local engine produced a real terminal
// result, not that route health was checked. Any execution error fails closed.
func (s *Service) runFirstRunLocalBaselineScenario(
	ctx context.Context,
	scenario runtimev1.ScenarioType,
	local *localProvider,
	modelResolved string,
) error {
	switch scenario {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		spec := &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{
				{Role: "user", Content: firstRunBaselineTextProbe},
			},
			MaxTokens: firstRunBaselineMaxTokens,
		}
		text, _, finish, err := local.GenerateTextScenario(ctx, modelResolved, spec, firstRunBaselineTextProbe)
		if err != nil {
			return err
		}
		if finish == runtimev1.FinishReason_FINISH_REASON_ERROR || strings.TrimSpace(text) == "" {
			return grpcerr.WithReasonCodeOptions(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
				grpcerr.ReasonOptions{Message: "local text baseline execution produced no terminal output"},
			)
		}
		return nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		backend, backendModelID, _ := local.resolveMediaBackendForModal(modelResolved, runtimev1.Modal_MODAL_TTS)
		if backend == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		spec := &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:        firstRunBaselineTextProbe,
			AudioFormat: firstRunBaselineAudioFormat,
		}
		payload, _, err := backend.SynthesizeSpeech(ctx, backendModelID, spec, nil)
		if err != nil {
			return err
		}
		if len(payload) == 0 {
			return grpcerr.WithReasonCodeOptions(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
				grpcerr.ReasonOptions{Message: "local TTS baseline execution produced no audio payload"},
			)
		}
		return nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		backend, backendModelID, _ := local.resolveMediaBackendForModal(modelResolved, runtimev1.Modal_MODAL_STT)
		if backend == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		spec := &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: firstRunBaselineSTTMimeType,
		}
		text, _, err := backend.Transcribe(ctx, backendModelID, spec, firstRunBaselineSTTAudioProbe(), firstRunBaselineSTTMimeType, nil)
		if err != nil {
			return err
		}
		_ = text
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

const (
	// firstRunBaselineTextProbe is the deterministic minimal text payload the
	// first-run text/chat and TTS baseline executions run.
	firstRunBaselineTextProbe = "nimi first-run local baseline execution probe"
	// firstRunBaselineMaxTokens bounds the local text baseline generation.
	firstRunBaselineMaxTokens = 16
	// firstRunBaselineAudioFormat is the TTS baseline output format.
	firstRunBaselineAudioFormat = "wav"
	// firstRunBaselineSTTMimeType is the STT baseline input mime type.
	firstRunBaselineSTTMimeType = "audio/wav"
)

// firstRunBaselineSTTAudioProbe returns a minimal non-empty WAV payload (a
// 44-byte RIFF/WAVE header with zero samples) for the local STT baseline
// execution. Transcribe rejects an empty payload, so a real byte payload is
// supplied; the local STT engine produces the terminal transcription result.
func firstRunBaselineSTTAudioProbe() []byte {
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	header[4] = 36 // chunk size = 36 + data size(0)
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	header[16] = 16   // fmt chunk size
	header[20] = 1    // PCM
	header[22] = 1    // mono
	header[24] = 0x80 // 16000 Hz sample rate (0x3E80)
	header[25] = 0x3E
	header[28] = 0x00 // byte rate (32000 = 0x7D00)
	header[29] = 0x7D
	header[32] = 2  // block align
	header[34] = 16 // bits per sample
	copy(header[36:40], "data")
	// data size = 0
	return header
}
