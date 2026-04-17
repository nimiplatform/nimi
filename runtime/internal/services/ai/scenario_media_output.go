package ai

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const worldManifestMIME = "application/vnd.nimi.world+json"

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
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_WorldGenerate{
				WorldGenerate: buildWorldGenerateResult(clonedArtifacts),
			},
		}
	default:
		return nil
	}
}

func buildWorldGenerateResult(artifacts []*runtimev1.ScenarioArtifact) *runtimev1.WorldGenerateResult {
	result := &runtimev1.WorldGenerateResult{
		Artifacts: cloneScenarioArtifacts(artifacts),
		SpzUrls:   map[string]string{},
	}
	for _, artifact := range artifacts {
		if artifact == nil || !strings.EqualFold(strings.TrimSpace(artifact.GetMimeType()), worldManifestMIME) || len(artifact.GetBytes()) == 0 {
			continue
		}
		var payload struct {
			WorldID           string            `json:"world_id"`
			DisplayName       string            `json:"display_name"`
			WorldMarbleURL    string            `json:"world_marble_url"`
			Caption           string            `json:"caption"`
			ThumbnailURL      string            `json:"thumbnail_url"`
			PanoURL           string            `json:"pano_url"`
			ColliderMeshURL   string            `json:"collider_mesh_url"`
			SPZURLs           map[string]string `json:"spz_urls"`
			Model             string            `json:"model"`
			SemanticsMetadata struct {
				GroundPlaneOffset float64 `json:"ground_plane_offset"`
				MetricScaleFactor float64 `json:"metric_scale_factor"`
			} `json:"semantics_metadata"`
		}
		if err := json.Unmarshal(artifact.GetBytes(), &payload); err != nil {
			continue
		}
		result.WorldId = strings.TrimSpace(payload.WorldID)
		result.DisplayName = strings.TrimSpace(payload.DisplayName)
		result.WorldMarbleUrl = strings.TrimSpace(payload.WorldMarbleURL)
		result.Caption = strings.TrimSpace(payload.Caption)
		result.ThumbnailUrl = strings.TrimSpace(payload.ThumbnailURL)
		result.PanoUrl = strings.TrimSpace(payload.PanoURL)
		result.ColliderMeshUrl = strings.TrimSpace(payload.ColliderMeshURL)
		result.Model = strings.TrimSpace(payload.Model)
		if len(payload.SPZURLs) > 0 {
			result.SpzUrls = payload.SPZURLs
		}
		if payload.SemanticsMetadata.GroundPlaneOffset != 0 || payload.SemanticsMetadata.MetricScaleFactor != 0 {
			result.SemanticsMetadata = &runtimev1.WorldGenerateSemanticsMetadata{
				GroundPlaneOffset: payload.SemanticsMetadata.GroundPlaneOffset,
				MetricScaleFactor: payload.SemanticsMetadata.MetricScaleFactor,
			}
		}
		break
	}
	return result
}
