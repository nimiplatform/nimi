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
	ignored, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return executeTextGenerateScenario(ctx, s, req, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return executeTextEmbedScenario(ctx, s, req, ignored)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
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
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, "Voice clone"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN, "Voice design"},
		{runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, "Music generation"},
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

var scenarioExtensionRegistry = map[runtimev1.ScenarioType]map[string]scenarioExtensionStrategy{
	runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE: {
		textGenerateRouteDescribeExtensionNamespace: scenarioExtensionStrategyStrict,
	},
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
	runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE: {
		"nimi.scenario.voice_clone.request": scenarioExtensionStrategyStrict,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN: {
		"nimi.scenario.voice_design.request": scenarioExtensionStrategyStrict,
	},
	runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE: {
		"nimi.scenario.music_generate.request": scenarioExtensionStrategyBestEffort,
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
	}
	return nil, nil
}

func unsupportedScenarioExtensionError(scenarioType runtimev1.ScenarioType) error {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
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
