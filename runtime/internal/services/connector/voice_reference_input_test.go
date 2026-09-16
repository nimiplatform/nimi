package connector

import (
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"testing"
)

func TestVoiceReferenceInputFollowsExactWorkflow(t *testing.T) {
	r, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	current := VoiceReferenceInputProjection(r, "account", "dashscope", "qwen-audio-3.0-tts-plus", "voice.create")
	if current == nil || current.SupportsBytes || !current.SupportsUri || current.TextMode != "unsupported" || len(current.MimeTypes) != 4 {
		t.Fatalf("current clone conditions lost: %+v", current)
	}
	old := VoiceReferenceInputProjection(r, "account", "dashscope", "qwen3-tts-vc", "voice.create")
	if old == nil || !old.SupportsBytes || !old.SupportsUri || old.TextMode != "unsupported" {
		t.Fatalf("different target must retain its own inputs: %+v", old)
	}
	if got := VoiceReferenceInputProjection(r, "account", "dashscope", "qwen3-tts-vd", "voice.create"); got != nil {
		t.Fatalf("design-only target fabricated clone support: %+v", got)
	}
	if got := VoiceReferenceInputProjection(r, "account", "dashscope", "qwen-audio-3.0-tts-plus", "audio.synthesize"); got != nil {
		t.Fatal("input projection crossed task boundary")
	}
}
