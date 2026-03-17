package modelregistry

import (
	"path/filepath"
	"sort"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRegistrySaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "model-registry.json")

	registry := New()
	now := time.Now().UTC().Round(time.Millisecond)
	registry.Upsert(Entry{
		ModelID:      "qwen-max",
		Version:      "v1",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate", "text.embed"},
		Files:        []string{"model.gguf", "tokenizer.json"},
		LastHealthAt: now,
		Source:       "dashscope",
		ProviderHint: ProviderHintDashScope,
	})
	registry.Upsert(Entry{
		ModelID:      "deepseek-v3",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		Source:       "volcengine",
		ProviderHint: ProviderHintVolcengine,
	})

	if err := registry.SaveToFile(path); err != nil {
		t.Fatalf("save registry: %v", err)
	}

	loaded, err := NewFromFile(path)
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}

	item, exists := loaded.Get("qwen-max")
	if !exists {
		t.Fatalf("qwen-max must exist")
	}
	if item.ProviderHint != ProviderHintDashScope {
		t.Fatalf("provider hint mismatch: got=%s", item.ProviderHint)
	}
	if item.LastHealthAt.IsZero() {
		t.Fatalf("last health must be restored")
	}
	if len(item.Files) != 2 || item.Files[0] != "model.gguf" {
		t.Fatalf("files must be restored: %#v", item.Files)
	}

	item, exists = loaded.Get("deepseek-v3")
	if !exists {
		t.Fatalf("deepseek-v3 must exist")
	}
	if item.ProviderHint != ProviderHintVolcengine {
		t.Fatalf("provider hint mismatch: got=%s", item.ProviderHint)
	}
}

func TestInferNativeProjectionForMediaModel(t *testing.T) {
	projection := InferNativeProjection(
		"local/wan2.2-video",
		[]string{"video.generate"},
		[]string{"transformer.gguf", "vae.safetensors"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)

	if projection.PreferredEngine != "media" {
		t.Fatalf("preferred engine mismatch: %q", projection.PreferredEngine)
	}
	if len(projection.FallbackEngines) != 0 {
		t.Fatalf("fallback engines mismatch: %#v", projection.FallbackEngines)
	}
	if projection.BundleState != runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY {
		t.Fatalf("bundle state mismatch: %v", projection.BundleState)
	}
	if !projection.HostRequirements.GetGpuRequired() {
		t.Fatalf("media model should require GPU")
	}
}

func TestInferNativeProjectionForSpeechModel(t *testing.T) {
	projection := InferNativeProjection(
		"speech/whisper-large-v3",
		[]string{"audio.transcribe"},
		[]string{"model.bin"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)

	if projection.PreferredEngine != "speech" {
		t.Fatalf("preferred engine mismatch: %q", projection.PreferredEngine)
	}
	if projection.HostRequirements == nil {
		t.Fatal("speech model host requirements must be populated")
	}
	if projection.HostRequirements.GetGpuRequired() {
		t.Fatal("whispercpp transcribe path should not require GPU")
	}
	if projection.HostRequirements.GetPythonRuntimeRequired() {
		t.Fatal("whispercpp transcribe path should not require python runtime")
	}
	if got := projection.HostRequirements.GetRequiredBackends(); len(got) != 1 || got[0] != "whispercpp" {
		t.Fatalf("required backends mismatch: %#v", got)
	}
}

func TestInferNativeProjectionForVoiceWorkflowModel(t *testing.T) {
	projection := InferNativeProjection(
		"speech/qwen3tts",
		[]string{"voice_workflow.tts_v2v"},
		[]string{"model.safetensors"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)

	if projection.PreferredEngine != "speech" {
		t.Fatalf("preferred engine mismatch: %q", projection.PreferredEngine)
	}
	if projection.HostRequirements == nil {
		t.Fatal("voice workflow host requirements must be populated")
	}
	if !projection.HostRequirements.GetGpuRequired() {
		t.Fatal("voice workflow path should require GPU")
	}
	if !projection.HostRequirements.GetPythonRuntimeRequired() {
		t.Fatal("voice workflow path should require python runtime")
	}
	if got := projection.HostRequirements.GetRequiredBackends(); len(got) != 1 || got[0] != "qwen3tts" {
		t.Fatalf("required backends mismatch: %#v", got)
	}
}

func TestInferNativeProjectionForLlamaModel(t *testing.T) {
	projection := InferNativeProjection(
		"llama/qwen3-chat",
		[]string{"text.generate"},
		[]string{"model.gguf", "tokenizer.json"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)

	if projection.PreferredEngine != "llama" {
		t.Fatalf("preferred engine mismatch: %q", projection.PreferredEngine)
	}
	foundLLMRole := false
	for _, role := range projection.ArtifactRoles {
		if role == "llm" {
			foundLLMRole = true
			break
		}
	}
	if !foundLLMRole {
		t.Fatalf("artifact roles should include llm: %#v", projection.ArtifactRoles)
	}
	if projection.HostRequirements == nil {
		t.Fatal("llama host requirements must be populated")
	}
	if got := projection.HostRequirements.GetRequiredBackends(); len(got) != 1 || got[0] != "llama.cpp" {
		t.Fatalf("required backends mismatch: %#v", got)
	}
}

func TestInferNativeProjectionFallbackEnginesExcludesDiffusers(t *testing.T) {
	filtered := publicFallbackEngines([]string{"media.diffusers", "sidecar", "media.diffusers"})
	if len(filtered) != 1 || filtered[0] != "sidecar" {
		t.Fatalf("fallback engines should filter diffusers: %#v", filtered)
	}
}

func TestInferCapabilitiesVision(t *testing.T) {
	tests := []struct {
		name      string
		modelID   string
		wantCap   string
		wantFound bool
	}{
		{
			name:      "vision keyword produces text.generate.vision",
			modelID:   "openai/gpt-4-vision-preview",
			wantCap:   "text.generate.vision",
			wantFound: true,
		},
		{
			name:      "vl keyword produces text.generate.vision",
			modelID:   "dashscope/qwen-vl-max",
			wantCap:   "text.generate.vision",
			wantFound: true,
		},
		{
			name:      "plain text model has no vision capability",
			modelID:   "openai/gpt-4o-mini",
			wantCap:   "text.generate.vision",
			wantFound: false,
		},
		{
			name:      "all models get text.generate",
			modelID:   "openai/gpt-4o-mini",
			wantCap:   "text.generate",
			wantFound: true,
		},
		{
			name:      "tts model has no vision",
			modelID:   "openai/tts-1",
			wantCap:   "text.generate.vision",
			wantFound: false,
		},
		{
			name:      "tts model has audio.synthesize",
			modelID:   "openai/tts-1",
			wantCap:   "audio.synthesize",
			wantFound: true,
		},
		{
			name:      "embed model gets text.embed",
			modelID:   "openai/text-embedding-ada-002",
			wantCap:   "text.embed",
			wantFound: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			caps := InferCapabilities(tt.modelID)
			sorted := append([]string(nil), caps...)
			sort.Strings(sorted)
			found := false
			for _, c := range sorted {
				if c == tt.wantCap {
					found = true
					break
				}
			}
			if found != tt.wantFound {
				t.Fatalf("InferCapabilities(%q) capability %q: found=%v want=%v (all caps=%v)", tt.modelID, tt.wantCap, found, tt.wantFound, caps)
			}
		})
	}
}
