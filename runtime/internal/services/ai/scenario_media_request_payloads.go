package ai

import (
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func cloneScenarioArtifacts(input []*runtimev1.ScenarioArtifact) []*runtimev1.ScenarioArtifact {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.ScenarioArtifact, 0, len(input))
	for _, item := range input {
		if item == nil {
			continue
		}
		cloned := proto.Clone(item)
		copied, ok := cloned.(*runtimev1.ScenarioArtifact)
		if !ok {
			continue
		}
		out = append(out, copied)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneSubmitScenarioJobRequest(input *runtimev1.SubmitScenarioJobRequest) *runtimev1.SubmitScenarioJobRequest {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.SubmitScenarioJobRequest)
	if !ok {
		return nil
	}
	return copied
}

func extractScenarioExtensions(req *runtimev1.SubmitScenarioJobRequest) *structpb.Struct {
	if req == nil {
		return nil
	}
	namespace := mediaScenarioExtensionNamespace(req.GetScenarioType())
	if namespace == "" {
		return nil
	}
	for _, ext := range req.GetExtensions() {
		if strings.TrimSpace(ext.GetNamespace()) != namespace {
			continue
		}
		if ext.GetPayload() == nil || len(ext.GetPayload().GetFields()) == 0 {
			return nil
		}
		return ext.GetPayload()
	}
	return nil
}

func mediaScenarioExtensionNamespace(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "nimi.scenario.image.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "nimi.scenario.video.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "nimi.scenario.speech_synthesize.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "nimi.scenario.speech_transcribe.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return "nimi.scenario.music_generate.request"
	default:
		return ""
	}
}
