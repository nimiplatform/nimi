package catalog

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func validateSnapshot(snapshot Snapshot) error {
	if len(snapshot.Models) == 0 {
		return errors.New("models must not be empty")
	}

	allowedUnits := map[string]struct{}{
		"token":   {},
		"char":    {},
		"second":  {},
		"request": {},
	}

	modelSet := make(map[string]ModelEntry, len(snapshot.Models))
	voiceSetRefs := make(map[string]struct{}, len(snapshot.Models))
	ttsModelRefs := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		provider := normalizeProvider(model.Provider)
		modelID := normalizeID(model.ModelID)
		if provider == "" || modelID == "" {
			return fmt.Errorf("model entry missing provider/model_id")
		}
		if strings.TrimSpace(model.ModelType) == "" {
			return fmt.Errorf("model %s:%s missing model_type", provider, modelID)
		}
		if strings.TrimSpace(model.UpdatedAt) == "" {
			return fmt.Errorf("model %s:%s missing updated_at", provider, modelID)
		}
		if len(model.Capabilities) == 0 {
			_, passiveLocalOffer := localPassiveModelTypes[strings.ToLower(strings.TrimSpace(model.ModelType))]
			if provider != localProviderID || !passiveLocalOffer || model.Install == nil || len(model.Variants) == 0 {
				return fmt.Errorf("model %s:%s missing capabilities", provider, modelID)
			}
		}
		if _, ok := allowedUnits[strings.TrimSpace(model.Pricing.Unit)]; !ok {
			return fmt.Errorf("model %s:%s has invalid pricing.unit %q", provider, modelID, model.Pricing.Unit)
		}
		for _, field := range []string{model.Pricing.Input, model.Pricing.Output, model.Pricing.Currency, model.Pricing.AsOf, model.Pricing.Notes} {
			if strings.TrimSpace(field) == "" {
				return fmt.Errorf("model %s:%s has incomplete pricing", provider, modelID)
			}
		}
		if err := validateCatalogSourceRef(provider, model.SourceRef); err != nil {
			return fmt.Errorf("model %s:%s has invalid source_ref: %w", provider, modelID, err)
		}
		key := provider + ":" + modelID
		if _, exists := modelSet[key]; exists {
			return fmt.Errorf("duplicate model entry %s", key)
		}
		modelSet[key] = model
		if modelRequiresVoice(model) {
			if strings.TrimSpace(model.VoiceSetID) == "" {
				return fmt.Errorf("model %s:%s missing voice_set_id", provider, modelID)
			}
			voiceSetRefs[provider+":"+normalizeID(model.VoiceSetID)] = struct{}{}
			ttsModelRefs[key] = struct{}{}
		}
		if model.VoiceRequestOptions != nil {
			if !modelRequiresVoice(model) {
				return fmt.Errorf("model %s:%s declares voice_request_options without audio.synthesize support", provider, modelID)
			}
			if err := validateVoiceRequestOptions(provider, modelID, model.VoiceRequestOptions); err != nil {
				return err
			}
		}
		if model.Transcription != nil {
			if !modelHasCapability(model, "audio.transcribe") {
				return fmt.Errorf("model %s:%s declares transcription metadata without audio.transcribe support", provider, modelID)
			}
			if err := validateTranscriptionOptions(provider, modelID, model.Transcription); err != nil {
				return err
			}
		}
		if model.ImageRequestOptions != nil {
			if !modelHasCapability(model, "image.generate") {
				return fmt.Errorf("model %s:%s declares image_request_options without image.generate support", provider, modelID)
			}
			if err := validateImageRequestOptions(provider, modelID, model.ImageRequestOptions); err != nil {
				return err
			}
		}
		if modelHasCapability(model, "image.generate") && model.ImageRequestOptions == nil {
			return fmt.Errorf("model %s:%s missing image_request_options", provider, modelID)
		}
		// K-MCAT-002 / K-MCAT-030 capability-conditional `embedding` block. It is
		// the catalog authority for the runtime memory embedding profile dimension
		// (K-MEM-004). It must only appear on `text.embed` models and must carry a
		// positive dimension; malformed material fails closed at load time.
		if model.Embedding != nil {
			if !modelHasCapability(model, "text.embed") {
				return fmt.Errorf("model %s:%s declares embedding metadata without text.embed support", provider, modelID)
			}
			if model.Embedding.Dimension <= 0 {
				return fmt.Errorf("model %s:%s embedding.dimension must be a positive integer", provider, modelID)
			}
		}
		if modelRequiresVideoGeneration(model) && model.VideoGeneration == nil {
			return fmt.Errorf("model %s:%s missing video_generation", provider, modelID)
		}
		if err := validateVideoGenerationCapability(provider, modelID, model.VideoGeneration); err != nil {
			return err
		}
	}
	if len(ttsModelRefs) > 0 && len(snapshot.Voices) == 0 {
		return errors.New("voices must not be empty when tts models exist")
	}

	seenVoice := make(map[string]struct{}, len(snapshot.Voices))
	ttsVoiceCoverage := make(map[string]struct{}, len(ttsModelRefs))
	for _, voice := range snapshot.Voices {
		provider := normalizeProvider(voice.Provider)
		voiceSetID := normalizeID(voice.VoiceSetID)
		voiceID := strings.TrimSpace(voice.VoiceID)
		if provider == "" || voiceSetID == "" || voiceID == "" {
			return fmt.Errorf("voice entry missing provider/voice_set_id/voice_id")
		}
		if strings.TrimSpace(voice.Name) == "" {
			return fmt.Errorf("voice %s:%s missing name", provider, voiceID)
		}
		if len(voice.Langs) == 0 {
			return fmt.Errorf("voice %s:%s missing langs", provider, voiceID)
		}
		if len(voice.ModelIDs) == 0 {
			return fmt.Errorf("voice %s:%s missing model_ids", provider, voiceID)
		}
		if err := validateCatalogSourceRef(provider, voice.SourceRef); err != nil {
			return fmt.Errorf("voice %s:%s has invalid source_ref: %w", provider, voiceID, err)
		}
		if _, ok := voiceSetRefs[provider+":"+voiceSetID]; !ok {
			return fmt.Errorf("voice %s:%s references missing voice set %s", provider, voiceID, voiceSetID)
		}
		for _, modelIDRaw := range voice.ModelIDs {
			modelID := normalizeID(modelIDRaw)
			if modelID == "" {
				return fmt.Errorf("voice %s:%s has empty model_id", provider, voiceID)
			}
			modelKey := provider + ":" + modelID
			if _, ok := modelSet[modelKey]; !ok {
				return fmt.Errorf("voice %s:%s references unknown model %s", provider, voiceID, modelID)
			}
			if _, ok := ttsModelRefs[modelKey]; ok {
				ttsVoiceCoverage[modelKey] = struct{}{}
			}
		}
		voiceKey := provider + ":" + voiceSetID + ":" + strings.ToLower(voiceID)
		if _, exists := seenVoice[voiceKey]; exists {
			return fmt.Errorf("duplicate voice entry %s", voiceKey)
		}
		seenVoice[voiceKey] = struct{}{}
	}
	for modelKey := range ttsModelRefs {
		if _, ok := ttsVoiceCoverage[modelKey]; ok {
			continue
		}
		return fmt.Errorf("tts model %s has no mapped voices", modelKey)
	}
	for _, profile := range snapshot.SelectionProfiles {
		provider := normalizeProvider(profile.Provider)
		profileID := strings.TrimSpace(profile.ProfileID)
		capability := strings.TrimSpace(profile.Capability)
		modelID := normalizeID(profile.ModelID)
		if provider == "" || profileID == "" || capability == "" || modelID == "" {
			return fmt.Errorf("selection profile missing provider/profile_id/capability/model_id")
		}
		if !providerregistry.Contains(provider) {
			return fmt.Errorf("selection profile %s references unknown provider %s", profileID, provider)
		}
		if profile.FreshnessSLADays <= 0 {
			return fmt.Errorf("selection profile %s:%s must declare freshness_sla_days > 0", provider, profileID)
		}
		if strings.TrimSpace(profile.ReviewedAt) == "" {
			return fmt.Errorf("selection profile %s:%s missing reviewed_at", provider, profileID)
		}
		model, ok := modelSet[provider+":"+modelID]
		if !ok {
			return fmt.Errorf("selection profile %s:%s references unknown model %s", provider, profileID, profile.ModelID)
		}
		if !modelHasCapability(model, capability) {
			return fmt.Errorf("selection profile %s:%s references model %s without capability %s", provider, profileID, profile.ModelID, capability)
		}
	}

	workflowModelByKey := make(map[string]VoiceWorkflowModel, len(snapshot.VoiceWorkflowModels))
	workflowTypeByKey := make(map[string]string, len(snapshot.VoiceWorkflowModels))
	for _, workflowModel := range snapshot.VoiceWorkflowModels {
		workflowModelID := normalizeID(workflowModel.WorkflowModelID)
		workflowType := normalizeWorkflowType(workflowModel.WorkflowType)
		if workflowModelID == "" || workflowType == "" || strings.TrimSpace(workflowModel.WorkflowFamily) == "" {
			return fmt.Errorf("voice workflow model missing workflow_model_id/workflow_type/workflow_family")
		}
		provider := normalizeProvider(workflowModel.Provider)
		if provider == "" {
			return fmt.Errorf("voice workflow model %s is missing its provider document identity", workflowModelID)
		}
		if err := validateCatalogSourceRef(provider, workflowModel.SourceRef); err != nil {
			return fmt.Errorf("voice workflow model %s has invalid source_ref: %w", workflowModelID, err)
		}
		if len(workflowModel.TargetModelRefs) == 0 {
			return fmt.Errorf("voice workflow model %s must include target_model_refs", workflowModelID)
		}
		for _, targetModelRaw := range workflowModel.TargetModelRefs {
			targetModelID := normalizeID(targetModelRaw)
			if targetModelID == "" {
				return fmt.Errorf("voice workflow model %s has empty target_model_ref", workflowModelID)
			}
			modelKey := provider + ":" + targetModelID
			if _, ok := modelSet[modelKey]; !ok {
				return fmt.Errorf("voice workflow model %s references unknown model %s", workflowModelID, targetModelID)
			}
		}
		if err := validateVoiceWorkflowRequestOptions(provider, workflowModelID, workflowType, workflowModel.RequestOptions); err != nil {
			return err
		}
		key := provider + ":" + workflowModelID
		if _, exists := workflowModelByKey[key]; exists {
			return fmt.Errorf("duplicate voice workflow model %s", key)
		}
		workflowModelByKey[key] = workflowModel
		workflowTypeByKey[key] = workflowType
	}

	bindingByModel := make(map[string]ModelWorkflowBinding, len(snapshot.ModelWorkflowBindings))
	for _, binding := range snapshot.ModelWorkflowBindings {
		modelID := normalizeID(binding.ModelID)
		if modelID == "" {
			return fmt.Errorf("model workflow binding missing model_id")
		}
		refs := normalizeStringSlice(binding.WorkflowModelRefs)
		if len(refs) == 0 {
			return fmt.Errorf("model workflow binding %s missing workflow_model_refs", modelID)
		}
		workflowTypes := normalizeStringSlice(binding.WorkflowTypes)
		for i := range workflowTypes {
			workflowTypes[i] = normalizeWorkflowType(workflowTypes[i])
			if workflowTypes[i] == "" {
				return fmt.Errorf("model workflow binding %s has invalid workflow_types entry", modelID)
			}
		}

		provider := normalizeProvider(binding.Provider)
		if provider == "" {
			return fmt.Errorf("model workflow binding %s is missing its provider document identity", modelID)
		}
		modelKey := provider + ":" + modelID
		if _, exists := bindingByModel[modelKey]; exists {
			return fmt.Errorf("duplicate model workflow binding %s", modelKey)
		}
		inferredTypes := make(map[string]struct{}, len(refs))
		for _, ref := range refs {
			refKey := provider + ":" + normalizeID(ref)
			refType, ok := workflowTypeByKey[refKey]
			if !ok {
				return fmt.Errorf("model workflow binding %s references unknown workflow model %s", modelKey, ref)
			}
			inferredTypes[refType] = struct{}{}
		}
		if len(workflowTypes) == 0 {
			for workflowType := range inferredTypes {
				workflowTypes = append(workflowTypes, workflowType)
			}
		}
		for _, workflowType := range workflowTypes {
			if _, ok := inferredTypes[workflowType]; !ok {
				return fmt.Errorf("model workflow binding %s declares unsupported workflow_type %s", modelKey, workflowType)
			}
		}
		bindingByModel[modelKey] = ModelWorkflowBinding{
			Provider:          provider,
			ModelID:           binding.ModelID,
			WorkflowModelRefs: refs,
			WorkflowTypes:     workflowTypes,
		}
	}

	policyByKey := make(map[string]VoiceHandlePolicy, len(snapshot.VoiceHandlePolicies))
	for _, policy := range snapshot.VoiceHandlePolicies {
		policyID := normalizeID(policy.PolicyID)
		if policyID == "" {
			return fmt.Errorf("voice handle policy missing policy_id")
		}
		workflowTypes := normalizeStringSlice(policy.AppliesToWorkflowTypes)
		if len(workflowTypes) == 0 {
			return fmt.Errorf("voice handle policy %s missing applies_to_workflow_types", policyID)
		}
		for i := range workflowTypes {
			workflowTypes[i] = normalizeWorkflowType(workflowTypes[i])
			if workflowTypes[i] == "" {
				return fmt.Errorf("voice handle policy %s has invalid applies_to_workflow_types entry", policyID)
			}
		}
		if !isAllowedVoicePersistence(policy.Persistence) {
			return fmt.Errorf("voice handle policy %s has invalid persistence %q", policyID, policy.Persistence)
		}
		if !isAllowedVoiceHandleScope(policy.Scope) {
			return fmt.Errorf("voice handle policy %s has invalid scope %q", policyID, policy.Scope)
		}
		if strings.TrimSpace(policy.DefaultTTL) == "" {
			return fmt.Errorf("voice handle policy %s missing default_ttl", policyID)
		}
		if !isAllowedVoiceDeleteSemantics(policy.DeleteSemantics) {
			return fmt.Errorf("voice handle policy %s has invalid delete_semantics %q", policyID, policy.DeleteSemantics)
		}
		provider := normalizeProvider(policy.Provider)
		if err := validateCatalogSourceRef(provider, policy.SourceRef); err != nil {
			return fmt.Errorf("voice handle policy %s has invalid source_ref: %w", policyID, err)
		}
		if _, exists := policyByKey[policyID]; exists {
			return fmt.Errorf("duplicate voice handle policy %s", policyID)
		}
		policy.AppliesToWorkflowTypes = workflowTypes
		policyByKey[policyID] = policy
	}
	if len(snapshot.VoiceWorkflowModels) > 0 && len(policyByKey) == 0 {
		return errors.New("voice_handle_policies must not be empty when voice_workflow_models exist")
	}

	return nil
}

var authenticatedProviderInventoryEndpointByProvider = map[string]string{
	"openai_codex": "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
}

func validateCatalogSourceRef(provider string, sourceRef SourceRef) error {
	sourceURL := strings.TrimSpace(sourceRef.URL)
	retrievedAt := strings.TrimSpace(sourceRef.RetrievedAt)
	if sourceURL == "" || retrievedAt == "" {
		return errors.New("url and retrieved_at are required")
	}
	if parsed, err := time.Parse("2006-01-02", retrievedAt); err != nil || parsed.Format("2006-01-02") != retrievedAt {
		return errors.New("retrieved_at must be an exact YYYY-MM-DD calendar date")
	}

	sourceKind := strings.TrimSpace(sourceRef.SourceKind)
	switch sourceKind {
	case "", "provider_documentation":
		return nil
	case "authenticated_provider_inventory":
		parsed, err := url.Parse(sourceURL)
		if err != nil || !strings.EqualFold(parsed.Scheme, "https") || strings.TrimSpace(parsed.Host) == "" || parsed.EscapedPath() == "" || parsed.EscapedPath() == "/" {
			return errors.New("authenticated_provider_inventory must use an exact HTTPS endpoint")
		}
		expectedEndpoint, admitted := authenticatedProviderInventoryEndpointByProvider[normalizeProvider(provider)]
		if !admitted {
			return fmt.Errorf("authenticated_provider_inventory is not admitted for provider %s", normalizeProvider(provider))
		}
		if sourceURL != expectedEndpoint {
			return errors.New("authenticated_provider_inventory must use the exact official inventory endpoint for its provider")
		}
		note := strings.ToLower(strings.TrimSpace(sourceRef.Note))
		if !strings.Contains(note, "authenticated") || !strings.Contains(note, "non-public") {
			return errors.New("authenticated_provider_inventory must explicitly identify an authenticated non-public observation")
		}
		return nil
	default:
		return fmt.Errorf("unsupported source_kind %q", sourceKind)
	}
}

func modelHasCapability(model ModelEntry, capability string) bool {
	return normalizeCapabilitySet(model.Capabilities)[strings.ToLower(strings.TrimSpace(capability))]
}

func normalizeCapabilitySet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		out[normalized] = true
	}
	return out
}

func validateVoiceRequestOptions(provider string, modelID string, options *VoiceRequestOptions) error {
	if options == nil {
		return nil
	}
	if len(options.TimingModes) == 0 {
		return fmt.Errorf("model %s:%s voice_request_options.timing_modes must not be empty", provider, modelID)
	}
	if len(options.AudioFormats) == 0 {
		return fmt.Errorf("model %s:%s voice_request_options.audio_formats must not be empty", provider, modelID)
	}
	allowedTimingModes := map[string]struct{}{
		"none": {},
		"word": {},
		"char": {},
	}
	for _, mode := range options.TimingModes {
		normalized := strings.ToLower(strings.TrimSpace(mode))
		if _, ok := allowedTimingModes[normalized]; !ok {
			return fmt.Errorf("model %s:%s voice_request_options.timing_modes contains unsupported value %q", provider, modelID, mode)
		}
	}
	if err := validateProviderExtensions(provider, modelID, "voice_request_options", options.ProviderExtensions); err != nil {
		return err
	}
	return validateVoiceRenderHints(provider, modelID, options.VoiceRenderHints)
}

func validateVoiceRenderHints(provider string, modelID string, hints *VoiceRenderHintsSchema) error {
	if hints == nil {
		return nil
	}
	for field, value := range map[string]*NumericRange{
		"stability":        hints.Stability,
		"similarity_boost": hints.SimilarityBoost,
		"style":            hints.Style,
		"speed":            hints.Speed,
	} {
		if err := validateNumericRange(provider, modelID, "voice_render_hints."+field, value); err != nil {
			return err
		}
	}
	return nil
}

func validateTranscriptionOptions(provider string, modelID string, options *TranscriptionOptions) error {
	if options == nil {
		return nil
	}
	if len(options.Tiers) == 0 {
		return fmt.Errorf("model %s:%s transcription.tiers must not be empty", provider, modelID)
	}
	if len(options.ResponseFormats) == 0 {
		return fmt.Errorf("model %s:%s transcription.response_formats must not be empty", provider, modelID)
	}
	allowedTiers := map[string]struct{}{
		"core_transcript":          {},
		"timed_transcript":         {},
		"speaker_aware_transcript": {},
	}
	for _, tier := range options.Tiers {
		normalized := strings.ToLower(strings.TrimSpace(tier))
		if _, ok := allowedTiers[normalized]; !ok {
			return fmt.Errorf("model %s:%s transcription.tiers contains unsupported value %q", provider, modelID, tier)
		}
	}
	if options.MaxSpeakerCount < 0 {
		return fmt.Errorf("model %s:%s transcription.max_speaker_count must be >= 0", provider, modelID)
	}
	if options.MaxSpeakerCount > 0 && !options.SupportsDiarization {
		return fmt.Errorf("model %s:%s transcription.max_speaker_count requires supports_diarization=true", provider, modelID)
	}
	return validateProviderExtensions(provider, modelID, "transcription", options.ProviderExtensions)
}

func validateImageRequestOptions(provider string, modelID string, options *ImageRequestOptions) error {
	if options == nil {
		return nil
	}
	if len(options.ResponseFormats) == 0 {
		return fmt.Errorf("model %s:%s image_request_options.response_formats must not be empty", provider, modelID)
	}
	allowedResponseFormats := map[string]struct{}{
		"b64_json": {},
		"url":      {},
	}
	for _, format := range options.ResponseFormats {
		normalized := strings.ToLower(strings.TrimSpace(format))
		if _, ok := allowedResponseFormats[normalized]; !ok {
			return fmt.Errorf("model %s:%s image_request_options.response_formats contains unsupported value %q", provider, modelID, format)
		}
	}
	if options.MaxImagesPerRequest <= 0 {
		return fmt.Errorf("model %s:%s image_request_options.max_images_per_request must be > 0", provider, modelID)
	}
	if options.MaxImagesPerRequest > 16 {
		return fmt.Errorf("model %s:%s image_request_options.max_images_per_request must be <= 16", provider, modelID)
	}
	return validateProviderExtensions(provider, modelID, "image_request_options", options.ProviderExtensions)
}

func validateVoiceWorkflowRequestOptions(
	provider string,
	workflowModelID string,
	workflowType string,
	options *VoiceWorkflowRequestOptions,
) error {
	if options == nil {
		return fmt.Errorf("voice workflow model %s:%s missing request_options", provider, workflowModelID)
	}
	switch normalizeWorkflowType(workflowType) {
	case "reference_audio":
		if !isAllowedVoiceWorkflowMode(options.TextPromptMode) {
			return fmt.Errorf("voice workflow model %s:%s request_options.text_prompt_mode must be unsupported|optional|required", provider, workflowModelID)
		}
		if options.SupportsLanguageHints == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.supports_language_hints must be explicit", provider, workflowModelID)
		}
		if options.SupportsPreferredName == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.supports_preferred_name must be explicit", provider, workflowModelID)
		}
		if options.ReferenceAudioURIInput == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.reference_audio_uri_input must be explicit", provider, workflowModelID)
		}
		if options.ReferenceAudioBytesInput == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.reference_audio_bytes_input must be explicit", provider, workflowModelID)
		}
		if !*options.ReferenceAudioURIInput && !*options.ReferenceAudioBytesInput {
			return fmt.Errorf("voice workflow model %s:%s must admit at least one reference audio input path", provider, workflowModelID)
		}
		if len(options.AllowedReferenceAudioMimeTypes) == 0 {
			return fmt.Errorf("voice workflow model %s:%s request_options.allowed_reference_audio_mime_types must not be empty", provider, workflowModelID)
		}
	case "text_description":
		if !isAllowedVoiceWorkflowMode(options.InstructionTextMode) {
			return fmt.Errorf("voice workflow model %s:%s request_options.instruction_text_mode must be unsupported|optional|required", provider, workflowModelID)
		}
		if !isAllowedVoiceWorkflowMode(options.PreviewTextMode) {
			return fmt.Errorf("voice workflow model %s:%s request_options.preview_text_mode must be unsupported|optional|required", provider, workflowModelID)
		}
		if options.SupportsLanguage == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.supports_language must be explicit", provider, workflowModelID)
		}
		if options.SupportsPreferredName == nil {
			return fmt.Errorf("voice workflow model %s:%s request_options.supports_preferred_name must be explicit", provider, workflowModelID)
		}
	default:
		return fmt.Errorf("voice workflow model %s:%s has unsupported workflow_type %q", provider, workflowModelID, workflowType)
	}
	return validateProviderExtensions(provider, workflowModelID, "request_options", options.ProviderExtensions)
}

func validateProviderExtensions(provider string, modelID string, field string, extensions *ProviderExtensionMetadata) error {
	if extensions == nil {
		return nil
	}
	if strings.TrimSpace(extensions.Namespace) == "" || strings.TrimSpace(extensions.SchemaVersion) == "" {
		return fmt.Errorf("model %s:%s %s.provider_extensions must include namespace and schema_version", provider, modelID, field)
	}
	return nil
}

func validateNumericRange(provider string, modelID string, field string, value *NumericRange) error {
	if value == nil {
		return nil
	}
	if value.Max < value.Min {
		return fmt.Errorf("model %s:%s %s max must be >= min", provider, modelID, field)
	}
	return nil
}

func isAllowedVoiceWorkflowMode(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "unsupported", "optional", "required":
		return true
	default:
		return false
	}
}
