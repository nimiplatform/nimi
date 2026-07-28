package ai

import (
	"context"
	"encoding/binary"
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
	if s == nil || s.selector == nil || s.scheduler == nil {
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
	releaseScheduler, _, err := s.scheduler.Acquire(ctx, "runtime.first_run")
	if err != nil {
		return FirstRunLocalExecutionResult{}, schedulerAcquireError(err)
	}
	defer releaseScheduler()

	// Pin the resolved model to the local provider. The local provider's
	// ResolveModelID strips the "local/" prefix; the prefix forces the route
	// selector down the local path so a cloud preferred-route alias on the
	// asset id can never silently route this baseline proof to cloud.
	localModelID := "local/" + strings.TrimPrefix(modelID, "local/")
	modal := scenarioModalFromType(req.ScenarioType)
	localPlan, err := s.prepareLocalModelExecutionPlan(ctx, localModelID, nil, modal, nil)
	if err != nil {
		return FirstRunLocalExecutionResult{}, err
	}

	// Local-only route resolution: after prepareLocalModelExecutionPlan has
	// validated and, when needed, started the RuntimeLocalService-owned asset,
	// bind directly to the in-process local provider. The generic route
	// availability check is text-capability shaped; first-run STT/TTS must use
	// the modality-aware local execution proof below instead of a text probe.
	selectedProvider := s.selector.local
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
	routeDecision := runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	modelResolved := localPlan.resolvedProviderModelID(localBackend.ResolveModelID(localModelID))

	releaseLease, err := s.acquireSelectedLocalModelLeaseWithPlan(ctx, localPlan, localModelID, nil, modal, "first_run_local_baseline")
	if err != nil {
		return FirstRunLocalExecutionResult{}, err
	}
	defer releaseLease()

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
		execCtx, cancel := withTimeout(ctx, 0, defaultGenerateTimeout)
		defer cancel()
		spec := &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{
				{Role: "user", Content: firstRunBaselineTextProbe},
			},
			MaxTokens: firstRunBaselineMaxTokens,
		}
		text, _, _, finish, err := local.GenerateTextScenario(execCtx, modelResolved, spec, firstRunBaselineTextProbe)
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
		execCtx, cancel := withTimeout(ctx, 0, defaultSynthesizeTimeout)
		defer cancel()
		backend, backendModelID, _ := local.resolveMediaBackendForModal(modelResolved, runtimev1.Modal_MODAL_TTS)
		if backend == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		spec := &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:        firstRunBaselineTextProbe,
			AudioFormat: firstRunBaselineAudioFormat,
		}
		payload, _, err := backend.SynthesizeSpeech(execCtx, backendModelID, spec, firstRunBaselineTTSExtensions())
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
		execCtx, cancel := withTimeout(ctx, 0, defaultTranscribeTimeout)
		defer cancel()
		backend, backendModelID, _ := local.resolveMediaBackendForModal(modelResolved, runtimev1.Modal_MODAL_STT)
		if backend == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		spec := &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: firstRunBaselineSTTMimeType,
		}
		text, _, err := backend.Transcribe(execCtx, backendModelID, spec, firstRunBaselineSTTAudioProbe(), firstRunBaselineSTTMimeType, firstRunBaselineSTTExtensions())
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
	// firstRunBaselineSTTSampleRateHz is the deterministic WAV probe sample rate.
	firstRunBaselineSTTSampleRateHz = 16_000
	// firstRunBaselineSTTChannels is the deterministic WAV probe channel count.
	firstRunBaselineSTTChannels = 1
	// firstRunBaselineSTTBitsPerSample is the deterministic WAV probe bit depth.
	firstRunBaselineSTTBitsPerSample = 16
	// firstRunBaselineSTTDurationSeconds is long enough to be a valid ASR
	// tensor while remaining a minimal first-run execution proof payload.
	firstRunBaselineSTTDurationSeconds = 1
)

func firstRunBaselineSTTExtensions() map[string]any {
	return map[string]any{
		"nimi_first_run_baseline_probe": true,
		"nimi_allow_empty_transcript":   true,
	}
}

func firstRunBaselineTTSExtensions() map[string]any {
	return map[string]any{
		"nimi_first_run_baseline_probe": true,
	}
}

// firstRunBaselineSTTAudioProbe returns a valid mono PCM WAV payload for the
// local STT baseline execution. The audio intentionally contains silence: the
// execution proof needs the local ASR path to run to a terminal result, while
// no-speech is allowed only through the private first-run extension.
func firstRunBaselineSTTAudioProbe() []byte {
	const headerSize = 44
	bytesPerSample := firstRunBaselineSTTBitsPerSample / 8
	blockAlign := firstRunBaselineSTTChannels * bytesPerSample
	sampleCount := firstRunBaselineSTTSampleRateHz * firstRunBaselineSTTDurationSeconds
	dataSize := sampleCount * blockAlign
	payload := make([]byte, headerSize+dataSize)

	copy(payload[0:4], "RIFF")
	binary.LittleEndian.PutUint32(payload[4:8], uint32(36+dataSize))
	copy(payload[8:12], "WAVE")
	copy(payload[12:16], "fmt ")
	binary.LittleEndian.PutUint32(payload[16:20], 16)
	binary.LittleEndian.PutUint16(payload[20:22], 1)
	binary.LittleEndian.PutUint16(payload[22:24], firstRunBaselineSTTChannels)
	binary.LittleEndian.PutUint32(payload[24:28], firstRunBaselineSTTSampleRateHz)
	binary.LittleEndian.PutUint32(payload[28:32], uint32(firstRunBaselineSTTSampleRateHz*blockAlign))
	binary.LittleEndian.PutUint16(payload[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(payload[34:36], firstRunBaselineSTTBitsPerSample)
	copy(payload[36:40], "data")
	binary.LittleEndian.PutUint32(payload[40:44], uint32(dataSize))
	return payload
}
