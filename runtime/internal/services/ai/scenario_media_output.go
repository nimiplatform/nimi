package ai

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func buildScenarioOutputFromArtifacts(
	job *runtimev1.ScenarioJob,
	artifacts []*runtimev1.ScenarioArtifact,
) *runtimev1.ScenarioOutput {
	if job == nil {
		return nil
	}

	clonedArtifacts := cloneScenarioArtifacts(artifacts)

	switch job.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateResult{
					Artifacts: clonedArtifacts,
				},
			},
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateResult{
					Artifacts: clonedArtifacts,
				},
			},
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeResult{
					Artifacts: clonedArtifacts,
				},
			},
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		text := ""
		if len(artifacts) > 0 && artifacts[0] != nil {
			text = string(artifacts[0].GetBytes())
		}
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeResult{
					Text:      text,
					Artifacts: clonedArtifacts,
				},
			},
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_MusicGenerate{
				MusicGenerate: &runtimev1.MusicGenerateResult{
					Artifacts: clonedArtifacts,
				},
			},
		}
	default:
		return nil
	}
}
