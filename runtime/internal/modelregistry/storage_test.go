package modelregistry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func withIsolatedResolvedBundles(t *testing.T) {
	t.Helper()
	t.Setenv("NIMI_RUNTIME_LOCAL_MODELS_PATH", "")
	t.Setenv("NIMI_RUNTIME_LOCAL_MODELS_ROOT", t.TempDir())
	resolvedBundleManifestIndexMu.Lock()
	resolvedBundleManifestIndexCache = make(map[string]*resolvedBundleManifestIndex)
	resolvedBundleManifestIndexMu.Unlock()
	t.Cleanup(func() {
		resolvedBundleManifestIndexMu.Lock()
		resolvedBundleManifestIndexCache = make(map[string]*resolvedBundleManifestIndex)
		resolvedBundleManifestIndexMu.Unlock()
	})
}

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

func TestNewFromFileNormalizesDefaultsAndInvalidStatus(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "model-registry.json")

	payload := persistedRegistry{
		SchemaVersion: 1,
		Entries: []persistedEntry{
			{
				ModelID: " dashscope/gpt-test ",
				Status:  999,
				Source:  "dashscope",
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write payload: %v", err)
	}

	loaded, err := NewFromFile(path)
	if err != nil {
		t.Fatalf("NewFromFile: %v", err)
	}

	item, ok := loaded.Get("dashscope/gpt-test")
	if !ok {
		t.Fatal("expected normalized entry to be loaded")
	}
	if item.Version != "latest" {
		t.Fatalf("expected version default, got=%q", item.Version)
	}
	if item.ProviderHint != ProviderHintDashScope {
		t.Fatalf("expected inferred provider hint, got=%q", item.ProviderHint)
	}
	if item.Status != runtimev1.ModelStatus_MODEL_STATUS_UNSPECIFIED {
		t.Fatalf("expected invalid status to normalize to unspecified, got=%v", item.Status)
	}
}

func TestSaveToFileRemovesTempFileOnRenameFailure(t *testing.T) {
	dir := t.TempDir()
	registry := New()
	registry.Upsert(Entry{
		ModelID: "qwen2.5",
		Status:  runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	})

	targetDir := filepath.Join(dir, "target")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir: %v", err)
	}

	err := registry.SaveToFile(targetDir)
	if err == nil {
		t.Fatal("expected rename failure when target path is a directory")
	}

	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		t.Fatalf("read dir: %v", readErr)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "target.tmp.") {
			t.Fatalf("unexpected temp file left behind: %s", entry.Name())
		}
	}
}

func TestInferNativeProjectionForMediaModel(t *testing.T) {
	withIsolatedResolvedBundles(t)
	projection, err := InferNativeProjection(
		"local/wan2.2-video",
		[]string{"video.generate"},
		[]string{"transformer.gguf", "vae.safetensors"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)
	if err != nil {
		t.Fatalf("infer native projection: %v", err)
	}

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
	withIsolatedResolvedBundles(t)
	projection, err := InferNativeProjection(
		"speech/qwen3asr",
		[]string{"audio.transcribe"},
		[]string{"model.safetensors"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)
	if err != nil {
		t.Fatalf("infer native projection: %v", err)
	}

	if projection.PreferredEngine != "speech" {
		t.Fatalf("preferred engine mismatch: %q", projection.PreferredEngine)
	}
	if projection.HostRequirements == nil {
		t.Fatal("speech model host requirements must be populated")
	}
	if projection.HostRequirements.GetGpuRequired() {
		t.Fatal("qwen3_asr transcribe path should not require GPU by default")
	}
	if !projection.HostRequirements.GetPythonRuntimeRequired() {
		t.Fatal("qwen3_asr transcribe path should require python runtime")
	}
	if got := projection.HostRequirements.GetRequiredBackends(); len(got) != 1 || got[0] != "qwen3_asr" {
		t.Fatalf("required backends mismatch: %#v", got)
	}
}

func TestInferNativeProjectionForVoiceWorkflowModel(t *testing.T) {
	withIsolatedResolvedBundles(t)
	projection, err := InferNativeProjection(
		"speech/qwen3tts",
		[]string{"voice_workflow.tts_v2v"},
		[]string{"model.safetensors"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)
	if err != nil {
		t.Fatalf("infer native projection: %v", err)
	}

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
	if got := projection.HostRequirements.GetRequiredBackends(); len(got) != 1 || got[0] != "qwen3_tts" {
		t.Fatalf("required backends mismatch: %#v", got)
	}
}

func TestInferNativeProjectionForLlamaModel(t *testing.T) {
	withIsolatedResolvedBundles(t)
	projection, err := InferNativeProjection(
		"llama/qwen3-chat",
		[]string{"text.generate"},
		[]string{"model.gguf", "tokenizer.json"},
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)
	if err != nil {
		t.Fatalf("infer native projection: %v", err)
	}

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

func TestInferNativeProjectionFailsClosedOnCorruptResolvedManifest(t *testing.T) {
	root := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCAL_MODELS_ROOT", root)

	manifestDir := filepath.Join(root, "resolved", "local", "qwen2.5")
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(manifestDir, "asset.manifest.json"), []byte("{invalid"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err := InferNativeProjection("local/qwen2.5", []string{"text.generate"}, nil, runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
	if err == nil {
		t.Fatal("expected corrupt manifest to fail closed")
	}
	if !strings.Contains(err.Error(), "parse resolved manifest") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolvedBundleManifestCandidatesStayUnderRoot(t *testing.T) {
	resolvedRoot := filepath.Join(t.TempDir(), "resolved")
	candidates := resolvedBundleManifestCandidates(resolvedRoot, "local/../../../etc/passwd")
	if len(candidates) != 0 {
		t.Fatalf("expected traversal candidates to be rejected, got=%v", candidates)
	}
}

func TestInferNativeProjectionUnionsHostRequirements(t *testing.T) {
	withIsolatedResolvedBundles(t)
	projection, err := InferNativeProjection(
		"local/multi-modal",
		[]string{"video.generate", "audio.transcribe"},
		nil,
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	)
	if err != nil {
		t.Fatalf("infer native projection: %v", err)
	}
	if !projection.HostRequirements.GetGpuRequired() {
		t.Fatal("expected GPU requirement to be preserved")
	}
	if !projection.HostRequirements.GetPythonRuntimeRequired() {
		t.Fatal("expected python runtime requirement to be preserved")
	}
	got := projection.HostRequirements.GetRequiredBackends()
	want := []string{"diffusers", "qwen3_asr", "stable-diffusion.cpp"}
	if len(got) != len(want) {
		t.Fatalf("required backends mismatch: got=%v want=%v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("required backends mismatch: got=%v want=%v", got, want)
		}
	}
}

func TestRegistryListDescriptorsPropagatesProjectionError(t *testing.T) {
	root := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCAL_MODELS_ROOT", root)

	manifestDir := filepath.Join(root, "resolved", "local", "qwen2.5")
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(manifestDir, "asset.manifest.json"), []byte("{invalid"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	registry := New()
	registry.Upsert(Entry{
		ModelID:      "local/qwen2.5",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
	})

	_, err := registry.ListDescriptors()
	if err == nil {
		t.Fatal("expected descriptor listing to propagate projection error")
	}
}

func TestFindResolvedBundleManifestByModelIDRefreshesIndexWhenRootChanges(t *testing.T) {
	root := filepath.Join(t.TempDir(), "resolved")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir resolved root: %v", err)
	}

	pathOne := filepath.Join(root, "vendor-a", "asset.manifest.json")
	writeResolvedManifest(t, pathOne, resolvedBundleManifestDisk{
		ModelID: "local/qwen2.5",
		Family:  "vendor-a",
	})

	got, err := findResolvedBundleManifestByModelID(root, "local/qwen2.5")
	if err != nil {
		t.Fatalf("first manifest lookup: %v", err)
	}
	if got != pathOne {
		t.Fatalf("unexpected first manifest path: got=%q want=%q", got, pathOne)
	}

	if err := os.Remove(pathOne); err != nil {
		t.Fatalf("remove first manifest: %v", err)
	}
	pathTwo := filepath.Join(root, "vendor-b", "asset.manifest.json")
	writeResolvedManifest(t, pathTwo, resolvedBundleManifestDisk{
		ModelID: "local/qwen2.5",
		Family:  "vendor-b",
	})
	changedAt := time.Now().UTC().Add(2 * time.Second)
	if err := os.Chtimes(root, changedAt, changedAt); err != nil {
		t.Fatalf("chtimes resolved root: %v", err)
	}

	got, err = findResolvedBundleManifestByModelID(root, "local/qwen2.5")
	if err != nil {
		t.Fatalf("second manifest lookup: %v", err)
	}
	if got != pathTwo {
		t.Fatalf("expected refreshed manifest path: got=%q want=%q", got, pathTwo)
	}
}

func writeResolvedManifest(t *testing.T, path string, manifest resolvedBundleManifestDisk) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
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

func TestInferModelFamilyGemma(t *testing.T) {
	tests := []struct {
		modelID string
		want    string
	}{
		{"google/gemma-4-12b-it-gguf", "gemma"},
		{"google/gemma-2-9b-it", "gemma"},
		{"google/gemma4-26b-a4b-it-gguf", "gemma"},
		{"meta/llama-3.3-70b", "llama"},
		{"generic-model-v1", "generic"},
	}
	for _, tt := range tests {
		t.Run(tt.modelID, func(t *testing.T) {
			got := inferModelFamily(tt.modelID)
			if got != tt.want {
				t.Fatalf("inferModelFamily(%q) = %q, want %q", tt.modelID, got, tt.want)
			}
		})
	}
}

func TestInferCapabilitiesGemma4(t *testing.T) {
	hasCap := func(caps []string, target string) bool {
		for _, c := range caps {
			if c == target {
				return true
			}
		}
		return false
	}

	// Gemma 4 should get text.generate.vision
	caps := InferCapabilities("google/gemma-4-12b-it-gguf")
	if !hasCap(caps, "text.generate.vision") {
		t.Fatalf("gemma-4 should have text.generate.vision, got %v", caps)
	}

	// gemma4 variant also works
	caps = InferCapabilities("gemma4-26b-a4b-it")
	if !hasCap(caps, "text.generate.vision") {
		t.Fatalf("gemma4 should have text.generate.vision, got %v", caps)
	}

	// Gemma 4 e2b should NOT get audio (gated by version gate)
	caps = InferCapabilities("google/gemma-4-e2b-it-gguf")
	if hasCap(caps, "text.generate.audio") {
		t.Fatalf("gemma-4-e2b should NOT have text.generate.audio (gated), got %v", caps)
	}

	// Gemma 2 should NOT get vision
	caps = InferCapabilities("google/gemma-2-9b-it")
	if hasCap(caps, "text.generate.vision") {
		t.Fatalf("gemma-2 should NOT have text.generate.vision, got %v", caps)
	}
}
