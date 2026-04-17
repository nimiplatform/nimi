package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func validateScenarioExecutionMode(scenarioType runtimev1.ScenarioType, mode runtimev1.ExecutionMode) error {
	allowed := scenarioAllowedModes(scenarioType)
	if len(allowed) == 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	for _, candidate := range allowed {
		if candidate == mode {
			return nil
		}
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func scenarioAllowedModes(scenarioType runtimev1.ScenarioType) []runtimev1.ExecutionMode {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return []runtimev1.ExecutionMode{
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return []runtimev1.ExecutionMode{
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return []runtimev1.ExecutionMode{
			runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return []runtimev1.ExecutionMode{
			runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
			runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		}
	default:
		return nil
	}
}

// scenarioRequiredCapabilities lists the catalog capabilities that can satisfy
// each scenario type. Voice workflows are represented by synthetic capability
// markers and resolved by the catalog layer.
func scenarioRequiredCapabilities(scenarioType runtimev1.ScenarioType) []string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return []string{aicapabilities.TextGenerate}
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return []string{aicapabilities.TextEmbed}
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return []string{aicapabilities.ImageGenerate}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return []string{aicapabilities.VideoGenerate}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return []string{aicapabilities.AudioSynthesize}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return []string{aicapabilities.AudioTranscribe}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return []string{aicapabilities.VoiceWorkflowTTSV2V}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return []string{aicapabilities.VoiceWorkflowTTST2V}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return []string{aicapabilities.MusicGenerate}
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return []string{aicapabilities.WorldGenerate}
	default:
		return nil
	}
}
