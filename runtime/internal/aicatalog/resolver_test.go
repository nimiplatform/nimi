package catalog

import (
	"slices"
	"strings"
	"testing"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestResolveVoicesDashScopeModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("dashscope", "qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty voices")
	}
	foundCherry := false
	for _, voice := range result.Voices {
		if voice.VoiceID == "cherry" {
			foundCherry = true
		}
		if voice.VoiceID == "Haruto" {
			t.Fatalf("dashscope catalog must not include Haruto")
		}
		if voice.VoiceID == voice.Name {
			t.Fatalf("expected canonical voice_id distinct from display name, got=%q", voice.VoiceID)
		}
	}
	if !foundCherry {
		t.Fatalf("expected cherry in built-in voice catalog")
	}
}

func TestDashScopeCosyVoiceCatalogAdmitsNativeStreamTTSOnlyForRealtimeCapableRoutes(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	cosyVoice, err := resolver.ResolveModelEntry("dashscope", "cosyvoice-v3-flash")
	if err != nil {
		t.Fatalf("ResolveModelEntry(cosyvoice-v3-flash): %v", err)
	}
	if cosyVoice.VoiceRequestOptions == nil || !cosyVoice.VoiceRequestOptions.SupportsNativeStreamTTS {
		t.Fatalf("cosyvoice-v3-flash must advertise native WebSocket TTS stream support")
	}

	batchQwen, err := resolver.ResolveModelEntry("dashscope", "qwen3-tts-vc")
	if err != nil {
		t.Fatalf("ResolveModelEntry(qwen3-tts-vc): %v", err)
	}
	if batchQwen.VoiceRequestOptions != nil && batchQwen.VoiceRequestOptions.SupportsNativeStreamTTS {
		t.Fatalf("non-realtime qwen3-tts-vc must not advertise native stream support")
	}
}

func TestOpenAICodexPrivateRouteUsesAuthenticatedInventorySource(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	model, err := resolver.ResolveModelEntry("openai_codex", "gpt-5.6-sol-wm")
	if err != nil {
		t.Fatalf("ResolveModelEntry: %v", err)
	}
	if model.SourceRef.SourceKind != "authenticated_provider_inventory" {
		t.Fatalf("source_kind = %q, want authenticated_provider_inventory", model.SourceRef.SourceKind)
	}
	if model.SourceRef.URL != "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0" {
		t.Fatalf("source URL = %q", model.SourceRef.URL)
	}
	if model.SourceRef.RetrievedAt != "2026-08-09" {
		t.Fatalf("retrieved_at = %q", model.SourceRef.RetrievedAt)
	}
	note := strings.ToLower(model.SourceRef.Note)
	if !strings.Contains(note, "authenticated") || !strings.Contains(note, "non-public") {
		t.Fatalf("source note does not identify the observation boundary: %q", model.SourceRef.Note)
	}
}

func TestOpenAICodexPublicModelRoutesUseTheirExactModelDocumentation(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	wants := map[string]string{
		"gpt-5.4":       "https://developers.openai.com/api/docs/models/gpt-5.4",
		"gpt-5.3-codex": "https://developers.openai.com/api/docs/models/gpt-5.3-codex",
	}
	for modelID, wantURL := range wants {
		model, resolveErr := resolver.ResolveModelEntry("openai_codex", modelID)
		if resolveErr != nil {
			t.Fatalf("ResolveModelEntry(%s): %v", modelID, resolveErr)
		}
		if model.SourceRef.URL != wantURL {
			t.Fatalf("%s source URL = %q, want %q", modelID, model.SourceRef.URL, wantURL)
		}
	}
}

func TestCatalogSourceRefRejectsInvalidInventoryObservation(t *testing.T) {
	tests := []SourceRef{
		{SourceKind: "internal_note", URL: "https://provider.example/models", RetrievedAt: "2026-08-09", Note: "Authenticated non-public observation."},
		{SourceKind: "authenticated_provider_inventory", URL: "https://provider.example", RetrievedAt: "2026-08-09", Note: "Authenticated non-public observation."},
		{SourceKind: "authenticated_provider_inventory", URL: "https://provider.example/models", RetrievedAt: "2026-08-09", Note: "Authenticated non-public observation."},
		{SourceKind: "authenticated_provider_inventory", URL: "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0", RetrievedAt: "not-a-date", Note: "Authenticated non-public observation."},
		{SourceKind: "authenticated_provider_inventory", URL: "https://provider.example/models", RetrievedAt: "2026-08-09", Note: "Private inventory."},
	}
	for _, sourceRef := range tests {
		if err := validateCatalogSourceRef("openai_codex", sourceRef); err == nil {
			t.Fatalf("expected invalid source_ref to be rejected: %#v", sourceRef)
		}
	}
}

func TestCatalogSourceRefRejectsAuthenticatedInventoryForAnotherProvider(t *testing.T) {
	sourceRef := SourceRef{
		SourceKind:  "authenticated_provider_inventory",
		URL:         "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
		RetrievedAt: "2026-08-09",
		Note:        "Authenticated non-public provider inventory observation.",
	}
	if err := validateCatalogSourceRef("dashscope", sourceRef); err == nil {
		t.Fatal("expected an OpenAI Codex inventory endpoint to be rejected for dashscope")
	}
}

func TestResolveAPIModelIDVolcengineAliasesUseCanonical(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	tests := []struct {
		name  string
		alias string
		want  string
	}{
		{
			name:  "text alias",
			alias: "doubao-seed-2.0-pro",
			want:  "doubao-seed-2-0-pro-260215",
		},
		{
			name:  "video alias",
			alias: "seedance-2.0",
			want:  "doubao-seedance-2-0-260128",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolver.ResolveAPIModelID("volcengine", tt.alias); got != tt.want {
				t.Fatalf("ResolveAPIModelID(volcengine, %q) = %q, want %q", tt.alias, got, tt.want)
			}
		})
	}
}

func TestResolveVoicesRejectsDroppedDashScopeQwenTTSAlias(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoices("dashscope", "qwen-tts")
	if err == nil {
		t.Fatalf("expected qwen-tts to be rejected")
	}
	if err != ErrModelNotFound {
		t.Fatalf("expected ErrModelNotFound, got: %v", err)
	}
}

func TestResolveVoicesVolcengineOpenSpeechCanonicalModels(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	models, _, listErr := resolver.ListModelsForProvider("volcengine_openspeech")
	if listErr != nil {
		t.Fatalf("ListModelsForProvider(volcengine_openspeech): %v", listErr)
	}
	if len(models) == 0 {
		t.Fatal("expected non-empty volcengine_openspeech models")
	}

	for _, modelID := range []string{"volc.service_type.10029", "doubao-tts"} {
		result, err := resolver.ResolveVoices("volcengine_openspeech", modelID)
		if err != nil {
			t.Fatalf("ResolveVoices(%s): %v", modelID, err)
		}
		if len(result.Voices) != 2 {
			t.Fatalf("expected 2 voices for %s, got=%d", modelID, len(result.Voices))
		}
	}
}

func TestParseProviderDocumentYAMLRejectsFilenameProviderInference(t *testing.T) {
	raw := []byte(`version: 1
catalog_version: test-v1
inventory_mode: static_source
models:
  - model_id: gpt-test
    capabilities: [text.generate]
`)
	if _, err := parseProviderDocumentYAML(raw, "openai.yaml"); err == nil || !strings.Contains(err.Error(), "provider is required") {
		t.Fatalf("missing explicit provider error = %v", err)
	}
}

func TestParseProviderDocumentYAMLPreservesDashScopeCanonicalVoiceIDs(t *testing.T) {
	raw, err := runtimecatalog.DefaultProvidersFS.ReadFile("providers/dashscope.yaml")
	if err != nil {
		t.Fatalf("ReadFile(dashscope.yaml): %v", err)
	}

	doc, err := parseProviderDocumentYAML(raw, "dashscope.yaml")
	if err != nil {
		t.Fatalf("parseProviderDocumentYAML: %v", err)
	}

	foundArthur := false
	foundCherry := false
	for _, voice := range doc.Voices {
		switch voice.Name {
		case "Arthur":
			foundArthur = true
			if voice.VoiceID != "arthur" {
				t.Fatalf("expected Arthur voice_id=arthur, got=%q", voice.VoiceID)
			}
		case "Cherry":
			foundCherry = true
			if voice.VoiceID != "cherry" {
				t.Fatalf("expected Cherry voice_id=cherry, got=%q", voice.VoiceID)
			}
		}
	}
	if !foundArthur {
		t.Fatal("expected Arthur in dashscope provider document")
	}
	if !foundCherry {
		t.Fatal("expected Cherry in dashscope provider document")
	}
}

func TestParseProviderDocumentYAMLAllowsDynamicEndpointWithoutModels(t *testing.T) {
	raw := []byte(`version: 1
provider: openrouter
catalog_version: 2026-04-18-openrouter-dynamic-v1
inventory_mode: dynamic_endpoint
dynamic_inventory:
  discovery_transport: connector_list_models
  cache_ttl_sec: 300
  selection_mode: pass_through
  failure_policy: use_cache_then_fail_closed
  allowed_capabilities: [text.generate]
`)

	doc, err := parseProviderDocumentYAML(raw, "openrouter.yaml")
	if err != nil {
		t.Fatalf("parseProviderDocumentYAML: %v", err)
	}
	if doc.InventoryMode != "dynamic_endpoint" {
		t.Fatalf("expected dynamic_endpoint inventory_mode, got %q", doc.InventoryMode)
	}
	if doc.DynamicInventory == nil {
		t.Fatal("expected dynamic_inventory to be preserved")
	}
	if len(doc.Models) != 0 {
		t.Fatalf("expected dynamic provider to omit models, got %d rows", len(doc.Models))
	}
}

func TestResolveVoicesLocalModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("local", "qwen3-tts-local")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty local voices")
	}
	if result.Voices[0].VoiceID != "user-custom" {
		t.Fatalf("unexpected local voice id: %s", result.Voices[0].VoiceID)
	}
	model, err := resolver.ResolveModelEntry("local", "qwen3-tts-local")
	if err != nil {
		t.Fatalf("ResolveModelEntry: %v", err)
	}
	if want := []string{"preset_voice_id", "provider_voice_ref"}; !slices.Equal(model.VoiceRefKinds, want) {
		t.Fatalf("local qwen3 TTS voice ref kinds=%v, want %v", model.VoiceRefKinds, want)
	}
}

func TestLocalModelsDoNotAdvertiseUnresolvedVoiceAssets(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	for _, modelID := range []string{
		"qwen3-tts-local",
		"qwen3-tts-base-local",
		"qwen3-tts-voicedesign-local",
		"cosyvoice2-local",
		"gpt-sovits-local",
		"f5-tts-local",
		"voxcpm2-local",
	} {
		model, resolveErr := resolver.ResolveModelEntry("local", modelID)
		if resolveErr != nil {
			t.Fatalf("ResolveModelEntry(%s): %v", modelID, resolveErr)
		}
		if slices.Contains(model.VoiceRefKinds, "voice_asset_id") {
			t.Fatalf("local model %s advertises unresolved voice assets: %v", modelID, model.VoiceRefKinds)
		}
	}
}

func TestResolveVoicesElevenLabsModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("elevenlabs", "eleven_multilingual_v2")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty elevenlabs voices")
	}
	foundRachel := false
	for _, voice := range result.Voices {
		if voice.VoiceID == "21m00Tcm4TlvDq8ikWAM" {
			foundRachel = true
		}
	}
	if !foundRachel {
		t.Fatalf("expected Rachel in built-in elevenlabs voice catalog")
	}
}

func TestResolveVoicesRequiresExplicitProvider(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	if _, err := resolver.ResolveVoices("", "qwen3-tts-instruct-flash"); err != ErrModelNotFound {
		t.Fatalf("provider-less ResolveVoices error = %v, want ErrModelNotFound", err)
	}
}

func TestResolveVoicesMissingModelReturnsErrModelNotFound(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	_, err = resolver.ResolveVoices("dashscope", "qwen3-tts-non-existent")
	if err == nil {
		t.Fatalf("expected ErrModelNotFound")
	}
	if err != ErrModelNotFound {
		t.Fatalf("expected ErrModelNotFound, got: %v", err)
	}
}

func TestResolveVoiceWorkflowDashScope(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("dashscope", "qwen3-tts-vc", "voice_clone")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "dashscope" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_clone" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if strings.TrimSpace(resolved.WorkflowModelID) == "" {
		t.Fatalf("workflow model id must be set")
	}
	if got := strings.TrimSpace(resolved.APIModelID); got != "qwen3-tts-vc-2026-01-22" {
		t.Fatalf("api model id mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "dashscope" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "dashscope_provider_persistent_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyDeleteSemantics); got != "best_effort_provider_delete" {
		t.Fatalf("delete semantics mismatch: got=%q", got)
	}
	if !resolved.RuntimeReconciliationRequired {
		t.Fatalf("expected runtime reconciliation requirement")
	}
}

func TestResolveVoiceWorkflowDashScopeDesign(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("dashscope", "qwen3-tts-vd", "voice_design")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "dashscope" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_design" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if strings.TrimSpace(resolved.WorkflowModelID) == "" {
		t.Fatalf("workflow model id must be set")
	}
	if got := strings.TrimSpace(resolved.APIModelID); got != "qwen3-tts-vd-2026-01-26" {
		t.Fatalf("api model id mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "dashscope" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowElevenLabsClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_multilingual_sts_v2", "voice_clone")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "elevenlabs" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_clone" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "elevenlabs-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "elevenlabs" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "elevenlabs_provider_persistent_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowElevenLabsDesignUsesDedicatedModels(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_ttv_v3", "voice_design")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "elevenlabs" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_design" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "elevenlabs-voice-design" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}

	_, err = resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_multilingual_v2", "voice_design")
	if err == nil {
		t.Fatalf("expected ordinary ElevenLabs TTS model to reject voice_design")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowDesignOnlyModelRejectsClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_ttv_v3", "voice_clone")
	if err == nil {
		t.Fatalf("expected design-only model to reject voice_clone")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowFishAudioClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("fish_audio", "s1", "voice_clone")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "fish_audio" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_clone" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "fish-audio-create-model" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
}

func TestResolveVoiceWorkflowCloneOnlyModelRejectsDesign(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("fish_audio", "s1", "voice_design")
	if err == nil {
		t.Fatalf("expected clone-only model to reject voice_design")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowStepFunClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("stepfun", "step-tts-2", "voice_clone")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "stepfun" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "voice_clone" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "stepfun-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.TextPromptMode); got != "required" {
		t.Fatalf("text prompt mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowLocalQwenClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("local", "qwen3-tts-base-local", "voice_clone")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "local" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowModelID != "qwen3-local-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "qwen3_tts" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "local_runtime_session_ephemeral_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyPersistence); got != "session_ephemeral" {
		t.Fatalf("handle persistence mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyDeleteSemantics); got != "runtime_authoritative_delete" {
		t.Fatalf("delete semantics mismatch: got=%q", got)
	}
	if resolved.RuntimeReconciliationRequired {
		t.Fatalf("local session-ephemeral workflow should not require runtime reconciliation")
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.TextPromptMode); got != "optional" {
		t.Fatalf("text prompt mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowLocalQwenDesign(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("local", "speech/qwen3tts-design", "voice_design")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "local" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowModelID != "qwen3-local-voice-design" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "qwen3_tts" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.InstructionTextMode); got != "required" {
		t.Fatalf("instruction text mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowUnsupportedReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("dashscope", "qwen3-tts-instruct-flash", "voice_clone")
	if err == nil {
		t.Fatalf("expected voice workflow unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowLocalUnsupportedReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("local", "kokoro-local", "voice_clone")
	if err == nil {
		t.Fatalf("expected local voice workflow unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowLocalPlainSynthLaneUnsupported(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("local", "speech/qwen3tts", "voice_clone")
	if err == nil {
		t.Fatalf("expected plain synth qwen3 lane to be unsupported for voice clone")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
	_, err = resolver.ResolveVoiceWorkflow("local", "speech/qwen3tts", "voice_design")
	if err == nil {
		t.Fatalf("expected plain synth qwen3 lane to be unsupported for voice design")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowLocalUnsupportedDesignReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("local", "kokoro-local", "voice_design")
	if err == nil {
		t.Fatalf("expected local voice design unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestSupportsScenarioVoiceWorkflowUsesBindings(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	supported, err := resolver.SupportsScenario("dashscope", "qwen3-tts-vd", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
	if err != nil {
		t.Fatalf("SupportsScenario voice design: %v", err)
	}
	if !supported {
		t.Fatalf("expected voice design to be supported for dashscope/qwen3-tts-vd")
	}

	supported, err = resolver.SupportsScenario("dashscope", "qwen3-tts-vd", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
	if err != nil {
		t.Fatalf("SupportsScenario voice clone: %v", err)
	}
	if supported {
		t.Fatalf("expected voice clone to be unsupported for dashscope/qwen3-tts-vd")
	}
}

func TestSupportsScenarioSpeechTranscribeForAuditedSourceProviders(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	cases := []struct {
		provider string
		modelID  string
	}{
		{provider: "openai", modelID: "gpt-4o-transcribe"},
		{provider: "gemini", modelID: "gemini-2.5-flash"},
		{provider: "dashscope", modelID: "qwen3-asr-flash"},
		{provider: "glm", modelID: "glm-asr-2512"},
	}

	for _, tc := range cases {
		supported, err := resolver.SupportsScenario(tc.provider, tc.modelID, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
		if err != nil {
			t.Fatalf("SupportsScenario(%s,%s): %v", tc.provider, tc.modelID, err)
		}
		if !supported {
			t.Fatalf("expected speech transcribe support for %s/%s", tc.provider, tc.modelID)
		}
	}
}
