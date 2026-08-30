package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) ExecuteScenario(ctx context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := req.GetExecutionMode()
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		mode = runtimev1.ExecutionMode_EXECUTION_MODE_SYNC
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return nil, err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	defaultTimeout := defaultGenerateTimeout
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED {
		defaultTimeout = defaultEmbedTimeout
	}
	if _, err := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultTimeout); err != nil {
		return nil, err
	}
	ignored, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	ctx, _, err = s.captureScenarioExecutionIntent(ctx, req.GetHead(), scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return nil, err
	}
	if err := s.reportScenarioSpendDisclosure(ctx, req.GetHead(), req.GetScenarioType()); err != nil {
		return nil, err
	}
	var response *runtimev1.ExecuteScenarioResponse
	var executionErr error
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		response, executionErr = executeTextGenerateScenario(ctx, s, req, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		response, executionErr = executeTextEmbedScenario(ctx, s, req, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return response, s.projectRuntimeRestartExecutionError(ctx, executionErr)
}

func (s *Service) ListScenarioProfiles(_ context.Context, _ *runtimev1.ListScenarioProfilesRequest) (*runtimev1.ListScenarioProfilesResponse, error) {
	entries := []struct {
		scenario runtimev1.ScenarioType
		desc     string
	}{
		{runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, "Text generation"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, "Text embedding"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, "Image generation"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, "Video generation"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, "Speech synthesis"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, "Speech transcription"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, "Voice creation"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, "Music generation"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE, "World generation"},
	}
	profiles := make([]*runtimev1.ScenarioProfile, 0, len(entries))
	for _, entry := range entries {
		profiles = append(profiles, &runtimev1.ScenarioProfile{
			ScenarioType:            entry.scenario,
			SupportedExecutionModes: scenarioAllowedModes(entry.scenario),
			Description:             entry.desc,
		})
	}
	return &runtimev1.ListScenarioProfilesResponse{Profiles: profiles}, nil
}

type scenarioExtensionStrategy string

const (
	scenarioExtensionStrategyStrict     scenarioExtensionStrategy = "strict"
	scenarioExtensionStrategyBestEffort scenarioExtensionStrategy = "best_effort"
)

var internalFirstRunScenarioExtensionKeys = map[string]struct{}{
	"nimi_first_run_baseline_probe": {},
	"nimi_allow_empty_transcript":   {},
}

var scenarioExtensionRegistry = map[runtimev1.ScenarioType]map[string]scenarioExtensionStrategy{
	runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE: {
		"nimi.scenario.image.request": scenarioExtensionStrategyBestEffort,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE: {
		"nimi.scenario.video.request": scenarioExtensionStrategyBestEffort,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE: {
		"nimi.scenario.speech_synthesize.request": scenarioExtensionStrategyBestEffort,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE: {
		"nimi.scenario.speech_transcribe.request": scenarioExtensionStrategyBestEffort,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE: {
		"nimi.scenario.voice_create.request": scenarioExtensionStrategyStrict,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE: {
		"nimi.scenario.music_generate.request": scenarioExtensionStrategyBestEffort,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE: {
		"nimi.scenario.world_generate.request": scenarioExtensionStrategyBestEffort,
	},
}

func classifyScenarioExtensions(scenarioType runtimev1.ScenarioType, items []*runtimev1.ScenarioExtension) ([]*runtimev1.IgnoredScenarioExtension, error) {
	if len(items) == 0 {
		return nil, nil
	}
	allowedNamespaces := scenarioExtensionRegistry[scenarioType]
	for _, item := range items {
		namespace := strings.TrimSpace(item.GetNamespace())
		if namespace == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if _, ok := allowedNamespaces[namespace]; !ok {
			return nil, unsupportedScenarioExtensionError(scenarioType)
		}
		if hasInternalFirstRunScenarioExtensionKey(item) {
			return nil, unsupportedScenarioExtensionError(scenarioType)
		}
	}
	return nil, nil
}

func hasInternalFirstRunScenarioExtensionKey(item *runtimev1.ScenarioExtension) bool {
	if item == nil || item.GetPayload() == nil {
		return false
	}
	for key := range item.GetPayload().GetFields() {
		if _, reserved := internalFirstRunScenarioExtensionKeys[strings.TrimSpace(key)]; reserved {
			return true
		}
	}
	return false
}

func unsupportedScenarioExtensionError(scenarioType runtimev1.ScenarioType) error {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}

func cloneIgnoredScenarioExtensions(items []*runtimev1.IgnoredScenarioExtension) []*runtimev1.IgnoredScenarioExtension {
	if len(items) == 0 {
		return nil
	}
	out := make([]*runtimev1.IgnoredScenarioExtension, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		out = append(out, &runtimev1.IgnoredScenarioExtension{
			Namespace: item.GetNamespace(),
			Reason:    item.GetReason(),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
