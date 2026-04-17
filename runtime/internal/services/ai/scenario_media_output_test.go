package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestBuildScenarioOutputFromArtifactsForImage(t *testing.T) {
	job := &runtimev1.ScenarioJob{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}
	artifacts := []*runtimev1.ScenarioArtifact{{ArtifactId: "img-art-1"}}

	output := buildScenarioOutputFromArtifacts(job, artifacts)
	value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_ImageGenerate)
	if !ok {
		t.Fatalf("expected image_generate output, got %#v", output.GetOutput())
	}
	if len(value.ImageGenerate.GetArtifacts()) != 1 || value.ImageGenerate.GetArtifacts()[0].GetArtifactId() != "img-art-1" {
		t.Fatalf("unexpected image artifacts: %#v", value.ImageGenerate.GetArtifacts())
	}
}

func TestBuildScenarioOutputFromArtifactsForSpeechTranscribe(t *testing.T) {
	job := &runtimev1.ScenarioJob{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
	}
	artifacts := []*runtimev1.ScenarioArtifact{{ArtifactId: "stt-art-1", Bytes: []byte("hello runtime")}}

	output := buildScenarioOutputFromArtifacts(job, artifacts)
	value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_SpeechTranscribe)
	if !ok {
		t.Fatalf("expected speech_transcribe output, got %#v", output.GetOutput())
	}
	if value.SpeechTranscribe.GetText() != "hello runtime" {
		t.Fatalf("unexpected transcription text: %q", value.SpeechTranscribe.GetText())
	}
	if len(value.SpeechTranscribe.GetArtifacts()) != 1 || value.SpeechTranscribe.GetArtifacts()[0].GetArtifactId() != "stt-art-1" {
		t.Fatalf("unexpected transcription artifacts: %#v", value.SpeechTranscribe.GetArtifacts())
	}
}

func TestBuildScenarioOutputFromArtifactsForVideoSpeechAndMusic(t *testing.T) {
	cases := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		assert       func(*testing.T, *runtimev1.ScenarioOutput)
	}{
		{
			name:         "video",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
			assert: func(t *testing.T, output *runtimev1.ScenarioOutput) {
				t.Helper()
				value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_VideoGenerate)
				if !ok {
					t.Fatalf("expected video_generate output, got %#v", output.GetOutput())
				}
				if len(value.VideoGenerate.GetArtifacts()) != 1 || value.VideoGenerate.GetArtifacts()[0].GetArtifactId() != "art-1" {
					t.Fatalf("unexpected video artifacts: %#v", value.VideoGenerate.GetArtifacts())
				}
			},
		},
		{
			name:         "speech_synthesize",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			assert: func(t *testing.T, output *runtimev1.ScenarioOutput) {
				t.Helper()
				value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_SpeechSynthesize)
				if !ok {
					t.Fatalf("expected speech_synthesize output, got %#v", output.GetOutput())
				}
				if len(value.SpeechSynthesize.GetArtifacts()) != 1 || value.SpeechSynthesize.GetArtifacts()[0].GetArtifactId() != "art-1" {
					t.Fatalf("unexpected speech synthesis artifacts: %#v", value.SpeechSynthesize.GetArtifacts())
				}
			},
		},
		{
			name:         "music",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
			assert: func(t *testing.T, output *runtimev1.ScenarioOutput) {
				t.Helper()
				value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_MusicGenerate)
				if !ok {
					t.Fatalf("expected music_generate output, got %#v", output.GetOutput())
				}
				if len(value.MusicGenerate.GetArtifacts()) != 1 || value.MusicGenerate.GetArtifacts()[0].GetArtifactId() != "art-1" {
					t.Fatalf("unexpected music artifacts: %#v", value.MusicGenerate.GetArtifacts())
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			output := buildScenarioOutputFromArtifacts(
				&runtimev1.ScenarioJob{ScenarioType: tc.scenarioType},
				[]*runtimev1.ScenarioArtifact{{ArtifactId: "art-1"}},
			)
			tc.assert(t, output)
		})
	}
}

func TestBuildScenarioOutputFromArtifactsForWorld(t *testing.T) {
	manifest := []byte(`{"world_id":"world-123","display_name":"Demo World","world_marble_url":"https://marble.worldlabs.ai/world/world-123","caption":"A test world","thumbnail_url":"https://example.com/thumb.jpg","pano_url":"https://example.com/pano.jpg","collider_mesh_url":"https://example.com/collider.glb","spz_urls":{"full_res":"https://example.com/world.spz"},"model":"marble-1.1","semantics_metadata":{"ground_plane_offset":1.25,"metric_scale_factor":2.5}}`)
	output := buildScenarioOutputFromArtifacts(
		&runtimev1.ScenarioJob{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE},
		[]*runtimev1.ScenarioArtifact{{
			ArtifactId: "world-art-1",
			MimeType:   worldManifestMIME,
			Bytes:      manifest,
		}},
	)
	value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_WorldGenerate)
	if !ok {
		t.Fatalf("expected world_generate output, got %#v", output.GetOutput())
	}
	if value.WorldGenerate.GetWorldId() != "world-123" {
		t.Fatalf("unexpected world id: %q", value.WorldGenerate.GetWorldId())
	}
	if value.WorldGenerate.GetSpzUrls()["full_res"] != "https://example.com/world.spz" {
		t.Fatalf("unexpected spz urls: %#v", value.WorldGenerate.GetSpzUrls())
	}
	if value.WorldGenerate.GetSemanticsMetadata().GetMetricScaleFactor() != 2.5 {
		t.Fatalf("unexpected semantics metadata: %#v", value.WorldGenerate.GetSemanticsMetadata())
	}
}

func TestBuildScenarioOutputFromArtifactsReturnsNilForUnsupportedScenarioTypes(t *testing.T) {
	cases := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
	}{
		{
			name:         "unspecified",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED,
		},
		{
			name:         "voice_clone",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			output := buildScenarioOutputFromArtifacts(
				&runtimev1.ScenarioJob{ScenarioType: tc.scenarioType},
				[]*runtimev1.ScenarioArtifact{{ArtifactId: "art-1"}},
			)
			if output != nil {
				t.Fatalf("expected nil output for unsupported scenario type %v, got %#v", tc.scenarioType, output)
			}
		})
	}
}
