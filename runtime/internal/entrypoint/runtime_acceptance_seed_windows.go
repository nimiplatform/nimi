//go:build windows && !nimi_runtime_e2e

package entrypoint

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func ensureWindowsAcceptanceRuntimeSeed(securityStateRoot string, cfg config.Config) error {
	profile, err := loadWindowsAcceptanceProfile(securityStateRoot, time.Now().UTC())
	if err != nil {
		return err
	}
	if profile == nil {
		return fmt.Errorf("non-release acceptance build requires an installer-owned profile")
	}
	runtimeRoot := filepath.Dir(cfg.LocalStatePath)
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return fmt.Errorf("create acceptance Runtime root: %w", err)
	}
	if err := writeWindowsAcceptanceLocalStateIfMissing(cfg.LocalStatePath, profile.ProviderBaseURL); err != nil {
		return err
	}
	if err := writeWindowsAcceptanceCatalogs(cfg.ModelCatalogCustomDir); err != nil {
		return err
	}
	evidence := map[string]any{
		"schemaVersion":               1,
		"checkpoint":                  profile.Checkpoint,
		"nonRelease":                  true,
		"trialId":                     profile.TrialID,
		"runtimeCandidateId":          profile.RuntimeCandidateID,
		"developmentStateCandidateId": profile.DevelopmentStateCandidateID,
		"acceptanceRoundId":           profile.AcceptanceRoundID,
		"serviceOwned":                true,
		"runtimeId":                   cfg.RuntimeID,
		"runtimeBinarySha256":         profile.RuntimeBinarySHA256,
		"runtimeBuildRecordSha256":    profile.RuntimeBuildRecordSHA256,
		"sourceDirtyDescriptorSha256": profile.SourceDirtyDescriptorSHA256,
		"sourceTreeSha256":            profile.SourceTreeSHA256,
	}
	if acceptance := cfg.NonReleaseDevKernelCheckpoint; acceptance != nil {
		evidence["primaryAccountId"] = acceptance.PrimaryAccountID
		evidence["secondaryAccountId"] = acceptance.SecondaryAccountID
		evidence["localAgentRef"] = acceptance.LocalAgentRef
		evidence["runtimeSourceRef"] = acceptance.RuntimeSourceRef
	}
	return writeJSONFileAtomically(filepath.Join(runtimeRoot, "acceptance-seed.json"), evidence, true)
}

func writeWindowsAcceptanceLocalStateIfMissing(path, providerBaseURL string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	asset := func(id, modelID string, kind int, capabilities []string, metadata map[string]any) map[string]any {
		return map[string]any{
			"localAssetId":      id,
			"assetId":           "local/" + modelID,
			"kind":              kind,
			"engine":            "llama",
			"entry":             modelID + ".gguf",
			"files":             []string{modelID + ".gguf"},
			"license":           "non-release-checkpoint-fixture",
			"sourceRepo":        "dev-kernel-checkpoint",
			"sourceRevision":    "installer-owned",
			"hashes":            map[string]string{},
			"status":            2,
			"installedAt":       now,
			"updatedAt":         now,
			"healthDetail":      "service-owned dev-kernel checkpoint route active",
			"engineRuntimeMode": 2,
			"endpoint":          providerBaseURL,
			"capabilities":      capabilities,
			"logicalModelId":    "local/" + modelID,
			"family":            "dev-kernel-checkpoint",
			"artifactRoles":     []string{},
			"preferredEngine":   "llama",
			"fallbackEngines":   []string{},
			"bundleState":       2,
			"warmState":         3,
			"hostRequirements":  map[string]any{},
			"engineConfig":      map[string]any{},
			"metadata":          metadata,
		}
	}
	snapshot := map[string]any{
		"schemaVersion": 2,
		"savedAt":       now,
		"assets": []map[string]any{
			asset("local-asset-runtime-agent-live-e2e-chat", "runtime-agent-live-e2e", 1, []string{"chat", "text.generate"}, map[string]any{"fixture": "dev-kernel-checkpoint"}),
			asset("local-asset-runtime-agent-live-e2e-embedding", "runtime-agent-live-e2e-embedding", 6, []string{"text.embed"}, map[string]any{"fixture": "dev-kernel-checkpoint", "embedding.dimension": 4}),
		},
		"services":  []any{},
		"transfers": []any{},
		"audits":    []any{},
	}
	return writeJSONFileAtomically(path, snapshot, true)
}

func writeWindowsAcceptanceCatalogs(root string) error {
	if root == "" {
		return fmt.Errorf("acceptance model catalog root is required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("create acceptance model catalog root: %w", err)
	}
	catalogs := map[string]string{
		"local.yaml": `version: 1
provider: local
catalog_version: dev-kernel-checkpoint
models:
  - model_id: runtime-agent-live-e2e
    provider: local
    model_type: chat
    updated_at: "2026-07-13"
    capabilities: [text.generate]
    pricing: {unit: request, input: "0", output: "0", currency: none, as_of: "2026-07-13", notes: Non-release dev-kernel checkpoint route.}
    source_ref: {url: http://127.0.0.1/dev-kernel-checkpoint/catalog, retrieved_at: "2026-07-13", note: Installer-owned non-release checkpoint route.}
    fitness: {param_count: 1, context_length: 32768}
    aliases: [local/runtime-agent-live-e2e]
`,
		"openai.yaml": `version: 1
provider: openai
catalog_version: dev-kernel-checkpoint-media
models:
  - model_id: gpt-image-1.5
    provider: openai
    model_type: image
    updated_at: "2026-07-13"
    capabilities: [image.generate]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-13", notes: Non-release checkpoint image route.}
    source_ref: {url: http://127.0.0.1/dev-kernel-checkpoint/image, retrieved_at: "2026-07-13", note: Installer-owned non-release checkpoint route.}
    image_request_options: {response_formats: [b64_json, url], max_images_per_request: 1, supports_negative_prompt: true, supports_reference_images: true, supports_mask: true, supports_seed: true, supports_size: true, supports_aspect_ratio: true, supports_quality: true, supports_style: true}
  - model_id: gpt-4o-mini-transcribe-runtime-live
    provider: openai
    model_type: stt
    updated_at: "2026-07-13"
    capabilities: [audio.transcribe]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-13", notes: Non-release checkpoint transcription route.}
    source_ref: {url: http://127.0.0.1/dev-kernel-checkpoint/transcription, retrieved_at: "2026-07-13", note: Installer-owned non-release checkpoint route.}
    transcription: {tiers: [core_transcript], response_formats: [json], supports_language: true, supports_prompt: true}
`,
		"dashscope.yaml": `version: 1
provider: dashscope
catalog_version: dev-kernel-checkpoint-voice
models:
  - model_id: qwen3-tts-runtime-live-native-stream
    provider: dashscope
    model_type: tts
    updated_at: "2026-07-13"
    capabilities: [audio.synthesize]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-13", notes: Non-release checkpoint voice route.}
    source_ref: {url: http://127.0.0.1/dev-kernel-checkpoint/voice, retrieved_at: "2026-07-13", note: Installer-owned non-release checkpoint route.}
    voice_set_id: dashscope:runtime-agent-live-e2e-voice-set
    voice_discovery_mode: static_catalog
    voice_request_options: {timing_modes: [none, word], audio_formats: [wav], supports_native_stream_tts: true}
    voice_ref_kinds: [preset_voice_id, voice_asset_id]
voices:
  - voice_set_id: dashscope:runtime-agent-live-e2e-voice-set
    provider: dashscope
    voice_id: runtime-live-voice
    name: Runtime Live Voice
    langs: [zh, en]
    model_ids: [qwen3-tts-runtime-live-native-stream]
    source_ref: {url: http://127.0.0.1/dev-kernel-checkpoint/voice, retrieved_at: "2026-07-13", note: Installer-owned non-release checkpoint route.}
`,
	}
	for name, content := range catalogs {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			return fmt.Errorf("write acceptance model catalog %s: %w", name, err)
		}
	}
	return nil
}

func writeJSONFileAtomically(path string, value any, onlyIfMissing bool) error {
	if onlyIfMissing {
		if _, err := os.Stat(path); err == nil {
			return nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect acceptance seed %s: %w", path, err)
		}
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal acceptance seed: %w", err)
	}
	payload = append(payload, '\n')
	temp := path + ".tmp"
	if err := os.WriteFile(temp, payload, 0o600); err != nil {
		return fmt.Errorf("write acceptance seed: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return fmt.Errorf("promote acceptance seed: %w", err)
	}
	return nil
}
