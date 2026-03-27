package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestChatMessageHasRenderableContent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		message *runtimev1.ChatMessage
		want    bool
	}{
		{name: "nil", want: false},
		{
			name: "content",
			message: &runtimev1.ChatMessage{
				Content: "hello",
			},
			want: true,
		},
		{
			name: "text_part",
			message: &runtimev1.ChatMessage{
				Parts: []*runtimev1.ChatContentPart{textPart("render me")},
			},
			want: true,
		},
		{
			name: "image_part",
			message: &runtimev1.ChatMessage{
				Parts: []*runtimev1.ChatContentPart{imagePart("file:///tmp/image.png")},
			},
			want: true,
		},
		{
			name: "video_part",
			message: &runtimev1.ChatMessage{
				Parts: []*runtimev1.ChatContentPart{videoPart("file:///tmp/video.mp4")},
			},
			want: true,
		},
		{
			name: "audio_part",
			message: &runtimev1.ChatMessage{
				Parts: []*runtimev1.ChatContentPart{audioPart("file:///tmp/audio.wav")},
			},
			want: true,
		},
		{
			name: "empty",
			message: &runtimev1.ChatMessage{
				Parts: []*runtimev1.ChatContentPart{textPart("   ")},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := chatMessageHasRenderableContent(tt.message); got != tt.want {
				t.Fatalf("chatMessageHasRenderableContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestValidateResolvedTextGenerateInput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		systemPrompt string
		input        []*runtimev1.ChatMessage
		wantErr      bool
	}{
		{name: "empty", wantErr: true},
		{
			name:         "system_prompt_only",
			systemPrompt: "useful context",
			wantErr:      true,
		},
		{
			name: "system_message_only",
			input: []*runtimev1.ChatMessage{{
				Role:    "system",
				Content: "ignored",
			}},
			wantErr: true,
		},
		{
			name: "user_content",
			input: []*runtimev1.ChatMessage{{
				Role:    "user",
				Content: "hello",
			}},
			wantErr: false,
		},
		{
			name: "assistant_text_part",
			input: []*runtimev1.ChatMessage{{
				Role: "assistant",
				Parts: []*runtimev1.ChatContentPart{textPart("renderable")},
			}},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validateResolvedTextGenerateInput(tt.systemPrompt, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateResolvedTextGenerateInput() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestResolveTextGenerateArtifactPathFromScenarioArtifacts(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}

	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:   "job-text-image",
		TraceId: "trace-text-image",
		Head:    head,
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "artifact-uri",
			Uri:        "file:///tmp/prompt.png",
			MimeType:   "image/png",
		}, {
			ArtifactId: "artifact-bytes",
			MimeType:   "audio/wav",
			Bytes:      []byte("wave"),
		}, {
			ArtifactId: "artifact-data-uri",
			Uri:        "data:image/png;base64,AAAA",
			MimeType:   "image/png",
		}},
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}, func() {})

	path, mimeType, cleanup, err := svc.resolveTextGenerateArtifactPath(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.ChatContentArtifactRef{ArtifactId: "artifact-uri"},
	)
	if err != nil {
		t.Fatalf("resolveTextGenerateArtifactPath(uri) error = %v", err)
	}
	if path != "file:///tmp/prompt.png" || mimeType != "image/png" || cleanup != nil {
		t.Fatalf("unexpected uri resolution: path=%q mime=%q cleanup=%v", path, mimeType, cleanup != nil)
	}

	path, mimeType, cleanup, err = svc.resolveTextGenerateArtifactPath(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.ChatContentArtifactRef{ArtifactId: "artifact-bytes"},
	)
	if err != nil {
		t.Fatalf("resolveTextGenerateArtifactPath(bytes) error = %v", err)
	}
	if mimeType != "audio/wav" {
		t.Fatalf("resolveTextGenerateArtifactPath(bytes) mime = %q", mimeType)
	}
	if _, statErr := os.Stat(path); statErr != nil {
		t.Fatalf("temp file should exist: %v", statErr)
	}
	cleanup()
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("temp file should be removed after cleanup, got %v", statErr)
	}

	_, _, _, err = svc.resolveTextGenerateArtifactPath(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.ChatContentArtifactRef{ArtifactId: "artifact-data-uri"},
	)
	if err == nil {
		t.Fatal("resolveTextGenerateArtifactPath(data-uri) should fail")
	}
}

func TestResolveTextGenerateArtifactPartClassifiesMedia(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}

	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:   "job-text-media",
		TraceId: "trace-text-media",
		Head:    head,
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "image",
			Uri:        "file:///tmp/prompt.png",
			MimeType:   "image/png",
		}, {
			ArtifactId: "video",
			Uri:        "file:///tmp/prompt.mp4",
			MimeType:   "video/mp4",
		}, {
			ArtifactId: "audio",
			Uri:        "file:///tmp/prompt.wav",
			MimeType:   "audio/wav",
		}},
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}, func() {})

	tests := []struct {
		name     string
		ref      *runtimev1.ChatContentArtifactRef
		wantType runtimev1.ChatContentPartType
	}{
		{
			name: "image",
			ref: &runtimev1.ChatContentArtifactRef{
				ArtifactId: "image",
			},
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
		},
		{
			name: "video",
			ref: &runtimev1.ChatContentArtifactRef{
				ArtifactId: "video",
			},
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
		},
		{
			name: "audio",
			ref: &runtimev1.ChatContentArtifactRef{
				ArtifactId: "audio",
			},
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL,
		},
	}

	for _, tt := range tests {
		part, cleanup, err := svc.resolveTextGenerateArtifactPart(
			context.Background(),
			head,
			"llama/qwen3-chat",
			nil,
			nil,
			tt.ref,
		)
		if err != nil {
			t.Fatalf("%s: resolveTextGenerateArtifactPart() error = %v", tt.name, err)
		}
		if cleanup != nil {
			t.Fatalf("%s: expected no cleanup for uri-backed artifact", tt.name)
		}
		if part.GetType() != tt.wantType {
			t.Fatalf("%s: part type = %v, want %v", tt.name, part.GetType(), tt.wantType)
		}
	}
}

func TestResolveTextGenerateArtifactPartCleansUpUnsupportedTempArtifacts(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}

	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:   "job-text-unsupported-media",
		TraceId: "trace-text-unsupported-media",
		Head:    head,
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "unsupported-binary",
			MimeType:   "application/octet-stream",
			Bytes:      []byte("payload"),
		}},
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}, func() {})

	_, _, err := svc.resolveTextGenerateArtifactPart(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.ChatContentArtifactRef{ArtifactId: "unsupported-binary"},
	)
	if err == nil {
		t.Fatal("resolveTextGenerateArtifactPart(unsupported mime) should fail")
	}
}

func TestResolveTextGenerateArtifactPathRejectsInvalidRefs(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}

	if _, _, _, err := svc.resolveTextGenerateArtifactPath(context.Background(), head, "llama/qwen3-chat", nil, nil, nil); err == nil {
		t.Fatal("resolveTextGenerateArtifactPath(nil) should fail")
	}
	if _, _, _, err := svc.resolveTextGenerateArtifactPath(
		context.Background(),
		head,
		"openai/gpt-4.1",
		&nimillm.RemoteTarget{ProviderType: "openai"},
		nil,
		&runtimev1.ChatContentArtifactRef{LocalArtifactId: "local-artifact-1"},
	); err == nil {
		t.Fatal("resolveTextGenerateArtifactPath(non-llama local artifact) should fail")
	}
	if _, _, _, err := svc.resolveTextGenerateArtifactPath(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.ChatContentArtifactRef{LocalArtifactId: "local-artifact-2"},
	); err == nil {
		t.Fatal("resolveTextGenerateArtifactPath(local artifact without profile) should fail")
	}
	if _, _, err := svc.resolveTextGenerateArtifactPart(context.Background(), head, "llama/qwen3-chat", nil, nil, nil); err == nil {
		t.Fatal("resolveTextGenerateArtifactPart(nil) should fail")
	}
}

func TestTextGenerateArtifactHelpers(t *testing.T) {
	t.Parallel()

	if isLlamaTextGenerateRoute("openai/gpt-4.1", &nimillm.RemoteTarget{ProviderType: "openai"}, nil) {
		t.Fatal("remote target should not resolve as llama route")
	}

	tests := []struct {
		name     string
		explicit string
		resolved string
		location string
		wantType runtimev1.ChatContentPartType
		wantErr  bool
	}{
		{
			name:     "image_from_explicit_mime",
			explicit: "image/png",
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
		},
		{
			name:     "video_from_resolved_mime",
			resolved: "video/mp4",
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
		},
		{
			name:     "audio_from_location",
			location: "https://example.test/prompt.wav",
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL,
		},
		{
			name:     "unsupported",
			location: "https://example.test/prompt.txt",
			wantType: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_UNSPECIFIED,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := classifyTextGenerateArtifactMedia(tt.explicit, tt.resolved, tt.location)
			if (err != nil) != tt.wantErr {
				t.Fatalf("classifyTextGenerateArtifactMedia() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.wantType {
				t.Fatalf("classifyTextGenerateArtifactMedia() = %v, want %v", got, tt.wantType)
			}
		})
	}

	if got := inferMimeTypeFromLocation("file:///tmp/prompt.jpeg"); got != "image/jpeg" {
		t.Fatalf("inferMimeTypeFromLocation(file) = %q", got)
	}
	if got := inferMimeTypeFromLocation("https://example.test/prompt.webm"); got != "video/webm" {
		t.Fatalf("inferMimeTypeFromLocation(url) = %q", got)
	}
	if got := inferMimeTypeFromLocation("/tmp/prompt.mp3"); got != "audio/mpeg" {
		t.Fatalf("inferMimeTypeFromLocation(path) = %q", got)
	}
	if got := inferMimeTypeFromLocation("/tmp/prompt.unknown"); got != "" {
		t.Fatalf("inferMimeTypeFromLocation(unknown) = %q", got)
	}
	if got := extensionForMimeType("image/png"); got != ".png" {
		t.Fatalf("extensionForMimeType(image/png) = %q", got)
	}
	if got := extensionForMimeType("audio/ogg"); got != ".ogg" {
		t.Fatalf("extensionForMimeType(audio/ogg) = %q", got)
	}
	if got := extensionForMimeType("application/octet-stream"); got != "" {
		t.Fatalf("extensionForMimeType(unknown) = %q", got)
	}
	if got := firstNonEmpty("", "  ", "value", "fallback"); got != "value" {
		t.Fatalf("firstNonEmpty() = %q", got)
	}
}

func TestResolveTextGenerateScenarioResolvesArtifactRefsAndCleansUp(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}

	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:   "job-text-resolution",
		TraceId: "trace-text-resolution",
		Head:    head,
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "artifact-audio",
			MimeType:   "audio/wav",
			Bytes:      []byte("wave"),
		}},
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}, func() {})

	resolved, err := svc.resolveTextGenerateScenario(
		context.Background(),
		head,
		"llama/qwen3-chat",
		nil,
		nil,
		&runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{artifactRefPart(&runtimev1.ChatContentArtifactRef{
						ArtifactId: "artifact-audio",
					})},
			}},
		},
	)
	if err != nil {
		t.Fatalf("resolveTextGenerateScenario() error = %v", err)
	}
	if len(resolved.spec.GetInput()) != 1 || len(resolved.spec.GetInput()[0].GetParts()) != 1 {
		t.Fatalf("resolved scenario should preserve one chat part: %#v", resolved.spec)
	}
	part := resolved.spec.GetInput()[0].GetParts()[0]
	if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL {
		t.Fatalf("resolved part type = %v", part.GetType())
	}
	path := part.GetAudioUrl()
	if _, statErr := os.Stat(path); statErr != nil {
		t.Fatalf("resolved temp artifact should exist before release: %v", statErr)
	}
	resolved.release()
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("resolved temp artifact should be removed after release, got %v", statErr)
	}
}

func TestVoiceListRoutePolicyHelpers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		model  string
		remote *nimillm.RemoteTarget
		want   runtimev1.RoutePolicy
	}{
		{
			name:  "local_prefix",
			model: "speech/qwen3tts",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			name:  "sidecar_prefix",
			model: "sidecar/musicgen",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			name:  "cloud_prefix",
			model: "openai/gpt-4.1",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		{
			name:   "remote_target_forces_cloud",
			model:  "llama/qwen3-chat",
			remote: &nimillm.RemoteTarget{ProviderType: "openai"},
			want:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		{
			name:  "bare_model_defaults_local",
			model: "qwen3-chat",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := inferVoiceListRoutePolicy(tt.model, tt.remote); got != tt.want {
				t.Fatalf("inferVoiceListRoutePolicy() = %v, want %v", got, tt.want)
			}
		})
	}

	if offset, err := parseVoiceAssetPageToken(""); err != nil || offset != 0 {
		t.Fatalf("parseVoiceAssetPageToken(empty) = (%d, %v)", offset, err)
	}
	if offset, err := parseVoiceAssetPageToken("12"); err != nil || offset != 12 {
		t.Fatalf("parseVoiceAssetPageToken(valid) = (%d, %v)", offset, err)
	}
	if _, err := parseVoiceAssetPageToken("-1"); err == nil {
		t.Fatal("parseVoiceAssetPageToken(negative) should fail")
	}
	if _, err := parseVoiceAssetPageToken("bad-token"); err == nil {
		t.Fatal("parseVoiceAssetPageToken(non-numeric) should fail")
	}
}

func TestVoiceWorkflowHelperFunctions(t *testing.T) {
	t.Parallel()

	cloneSummary := voiceWorkflowInputSummary(&runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "speech/qwen3tts",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioUri:   "file:///tmp/reference.wav",
						ReferenceAudioBytes: []byte("voice"),
						Text:                "hello",
						LanguageHints:       []string{"en", "zh"},
						PreferredName:       "clone-name",
					},
				},
			},
		},
	})
	if cloneSummary != "speech/qwen3tts|file:///tmp/reference.wav|5|hello|en,zh|clone-name" {
		t.Fatalf("voiceWorkflowInputSummary(clone) = %q", cloneSummary)
	}

	designSummary := voiceWorkflowInputSummary(&runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: "speech/qwen3tts",
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: "warm narrator",
						PreviewText:     "preview line",
						Language:        "en",
						PreferredName:   "design-name",
					},
				},
			},
		},
	})
	if designSummary != "speech/qwen3tts|warm narrator|preview line|en|design-name" {
		t.Fatalf("voiceWorkflowInputSummary(design) = %q", designSummary)
	}

	if got := voiceWorkflowInputSummary(nil); got != "" {
		t.Fatalf("voiceWorkflowInputSummary(nil) = %q", got)
	}
	if got := voiceWorkflowInputSummary(&runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{},
	}); got != "" {
		t.Fatalf("voiceWorkflowInputSummary(default) = %q", got)
	}

	clonePreferred := resolveVoiceWorkflowPreferredName(&runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					Input: &runtimev1.VoiceV2VInput{
						PreferredName: "preferred-clone",
					},
				},
			},
		},
	})
	if clonePreferred != "preferred-clone" {
		t.Fatalf("resolveVoiceWorkflowPreferredName(clone) = %q", clonePreferred)
	}

	designPreferred := resolveVoiceWorkflowPreferredName(&runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					Input: &runtimev1.VoiceT2VInput{
						PreferredName: "preferred-design",
					},
				},
			},
		},
	})
	if designPreferred != "preferred-design" {
		t.Fatalf("resolveVoiceWorkflowPreferredName(design) = %q", designPreferred)
	}
	if got := resolveVoiceWorkflowPreferredName(nil); !strings.HasPrefix(got, "nimi-voice-") {
		t.Fatalf("resolveVoiceWorkflowPreferredName(nil) = %q", got)
	}

}
