package nimillm

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestResolveImageArtifactMIMEFollowsReturnedBytes(t *testing.T) {
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00, 0x00, 0x00, 0x0d}
	webp := []byte{'R', 'I', 'F', 'F', 0x10, 0x00, 0x00, 0x00, 'W', 'E', 'B', 'P', 'V', 'P', '8', ' '}
	transport := &runtimev1.ImageGenerateScenarioSpec{Prompt: "apple", ResponseFormat: "b64_json"}
	for name, tc := range map[string]struct {
		spec    *runtimev1.ImageGenerateScenarioSpec
		payload []byte
		want    string
	}{
		"jpeg bytes over b64_json transport":  {spec: transport, payload: jpeg, want: "image/jpeg"},
		"png bytes over b64_json transport":   {spec: transport, payload: png, want: "image/png"},
		"webp bytes without a format":         {spec: &runtimev1.ImageGenerateScenarioSpec{Prompt: "apple"}, payload: webp, want: "image/webp"},
		"no bytes keeps the png default":      {spec: transport, payload: nil, want: "image/png"},
		"unrecognized bytes keep the default": {spec: transport, payload: []byte("not an image"), want: "image/png"},
	} {
		if got := ResolveImageArtifactMIME(tc.spec, tc.payload); got != tc.want {
			t.Fatalf("%s: got %q, want %q", name, got, tc.want)
		}
	}
}
