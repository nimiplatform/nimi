package nimillm

import (
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestVideoContentWithPromptPreservesAllInputs(t *testing.T) {
	text := func(value string) *runtimev1.VideoContentItem {
		return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: value}
	}
	audio := &runtimev1.VideoContentItem{
		Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO,
		AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/reference.mp3"},
	}
	for _, tc := range []struct {
		name, prompt, want string
		content            []*runtimev1.VideoContentItem
		wantTypes          []string
	}{
		{"top-level only", "Harbor", "Harbor", nil, []string{"text"}},
		{"audio", "Harbor", "Harbor", []*runtimev1.VideoContentItem{audio}, []string{"text", "audio_url"}},
		{"both text forms", "Harbor", "Harbor\nSunset", []*runtimev1.VideoContentItem{text("Sunset")}, []string{"text", "text"}},
		{"mirror", "Harbor", "Harbor\nSunset", []*runtimev1.VideoContentItem{text("Harbor"), text("Sunset")}, []string{"text", "text"}},
		{"intentional repetition", "Harbor", "Harbor\nSunset\nHarbor", []*runtimev1.VideoContentItem{text("Harbor"), text("Sunset"), text("Harbor")}, []string{"text", "text", "text"}},
		{"media order", "Harbor", "Harbor\nSunset", []*runtimev1.VideoContentItem{audio, text("Harbor"), text("Sunset")}, []string{"audio_url", "text", "text"}},
		{"content only", "", "Harbor\nSunset", []*runtimev1.VideoContentItem{text("Harbor"), text("Sunset")}, []string{"text", "text"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec := &runtimev1.VideoGenerateScenarioSpec{Prompt: tc.prompt, Content: tc.content}
			original := proto.Clone(spec)
			if got := VideoPrompt(spec); got != tc.want {
				t.Fatalf("prompt %q, want %q", got, tc.want)
			}
			payload := VideoContentPayload(spec)
			var types []string
			for _, item := range payload {
				types = append(types, item["type"].(string))
			}
			if !reflect.DeepEqual(types, tc.wantTypes) {
				t.Fatalf("content order %v, want %v", types, tc.wantTypes)
			}
			if !proto.Equal(spec, original) {
				t.Fatal("projection mutated the input")
			}
			spec.Content = VideoContentWithPrompt(spec)
			once := proto.Clone(spec)
			spec.Content = VideoContentWithPrompt(spec)
			if !proto.Equal(spec, once) || VideoPrompt(spec) != tc.want {
				t.Fatal("normalization is not idempotent")
			}
		})
	}
}
