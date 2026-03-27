package nimillm

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestAdaptersRejectMissingAPIKey(t *testing.T) {
	ttsReq := newTTSSecurityJob("hello", "voice-1")
	imageReq := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat"},
			},
		},
	}
	videoReq := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "orbiting satellite"},
			},
		},
	}
	transcribeReq := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
							AudioBytes: []byte("audio"),
						},
					},
				},
			},
		},
	}

	cases := []struct {
		name string
		call func() error
	}{
		{
			name: "azure speech",
			call: func() error {
				_, _, _, err := ExecuteAzureSpeechTTS(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, ttsReq, "azure/model")
				return err
			},
		},
		{
			name: "elevenlabs",
			call: func() error {
				_, _, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, ttsReq, "elevenlabs/model")
				return err
			},
		},
		{
			name: "fish audio",
			call: func() error {
				_, _, _, err := ExecuteFishAudioTTS(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, ttsReq, "fish_audio/model")
				return err
			},
		},
		{
			name: "google cloud tts",
			call: func() error {
				_, _, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, ttsReq, "google_cloud_tts/model")
				return err
			},
		},
		{
			name: "google veo",
			call: func() error {
				_, _, _, err := ExecuteGoogleVeoOperation(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", videoReq, "google_veo/model")
				return err
			},
		},
		{
			name: "kling",
			call: func() error {
				_, _, _, err := ExecuteKlingTask(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", imageReq, "kling/model")
				return err
			},
		},
		{
			name: "luma",
			call: func() error {
				_, _, _, err := ExecuteLumaTask(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", videoReq, "luma/model")
				return err
			},
		},
		{
			name: "pika",
			call: func() error {
				_, _, _, err := ExecutePikaTask(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", videoReq, "pika/model")
				return err
			},
		},
		{
			name: "runway",
			call: func() error {
				_, _, _, err := ExecuteRunwayTask(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", videoReq, "runway/model")
				return err
			},
		},
		{
			name: "flux",
			call: func() error {
				_, _, _, err := ExecuteFluxImage(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, nil, "job-1", imageReq, "flux/model")
				return err
			},
		},
		{
			name: "bytedance openspeech",
			call: func() error {
				_, _, _, err := ExecuteBytedanceOpenSpeech(context.Background(), MediaAdapterConfig{BaseURL: "https://example.com"}, transcribeReq, "bytedance/model")
				return err
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
				t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got err=%v reason=%v ok=%v", err, reason, ok)
			}
		})
	}
}
