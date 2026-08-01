package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	runtimeAgentAIConfigCapabilityTextGenerate        = "text.generate"
	runtimeAgentAIConfigCapabilityTextEmbed           = "text.embed"
	runtimeAgentAIConfigCapabilityImageGenerate       = "image.generate"
	runtimeAgentAIConfigCapabilityAudioSynthesize     = "audio.synthesize"
	runtimeAgentAIConfigCapabilityAudioTranscribe     = "audio.transcribe"
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone  = "voice_workflow.voice_clone"
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign = "voice_workflow.voice_design"

	runtimeAgentAIConfigSeedAppID = "runtime"

	runtimeAgentAIConfigChangedEventType = "runtime.agent.ai_config.changed"
	runtimeAgentAIConfigSeededEventType  = "runtime.agent.ai_config.seeded"
)

var admittedRuntimeAgentAIConfigCapabilities = []string{
	runtimeAgentAIConfigCapabilityTextGenerate,
	runtimeAgentAIConfigCapabilityTextEmbed,
	runtimeAgentAIConfigCapabilityImageGenerate,
	runtimeAgentAIConfigCapabilityAudioSynthesize,
	runtimeAgentAIConfigCapabilityAudioTranscribe,
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone,
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign,
}

var runtimeAgentAIConfigReservedSelectedParamKeys = []string{
	"profile_entries",
	"entry_overrides",
	"profile_overrides",
}

var runtimeAgentAIConfigForbiddenSelectedParamKeys = map[string]struct{}{
	"assetid":           {},
	"assetpath":         {},
	"accesskey":         {},
	"apikey":            {},
	"authorization":     {},
	"bearer":            {},
	"componentid":       {},
	"componentkind":     {},
	"clientsecret":      {},
	"connectorid":       {},
	"credential":        {},
	"credentials":       {},
	"durabletargetref":  {},
	"encodermodelid":    {},
	"entryoverrides":    {},
	"filepath":          {},
	"filename":          {},
	"localassetid":      {},
	"localprofileref":   {},
	"logicalmodelid":    {},
	"model":             {},
	"modelid":           {},
	"path":              {},
	"password":          {},
	"privatekey":        {},
	"profilebindingid":  {},
	"profileentries":    {},
	"profileoverrides":  {},
	"provider":          {},
	"providersecret":    {},
	"qwenmodelid":       {},
	"role":              {},
	"sourcefilename":    {},
	"secret":            {},
	"secretkey":         {},
	"targetref":         {},
	"token":             {},
	"vaemodelid":        {},
	"workflowbindingid": {},
}

var runtimeAgentAIConfigSelectedParamAllowlist = map[string]map[string]struct{}{
	runtimeAgentAIConfigCapabilityTextGenerate: runtimeAgentAIConfigParamKeySet(
		"temperature", "topP", "topK", "maxTokens", "presencePenalty", "frequencyPenalty",
		"stopSequences", "stop", "timeoutMs", "responseFormat",
	),
	runtimeAgentAIConfigCapabilityTextEmbed: runtimeAgentAIConfigParamKeySet("timeoutMs"),
	runtimeAgentAIConfigCapabilityImageGenerate: runtimeAgentAIConfigParamKeySet(
		"width", "height", "size", "steps", "step", "cfgScale", "cfg_scale", "sampler", "scheduler",
		"seed", "count", "n", "negativePrompt", "negative_prompt", "aspectRatio", "aspect_ratio",
		"quality", "style", "referenceImages", "reference_images", "mask", "responseFormat", "response_format",
		"timeoutMs", "timeout_ms", "mode", "method",
	),
	"video.generate": runtimeAgentAIConfigParamKeySet(
		"mode", "negativePrompt", "negative_prompt", "ratio", "durationSec", "duration_sec", "resolution", "fps",
		"seed", "cameraFixed", "camera_fixed", "generateAudio", "generate_audio", "timeoutMs", "timeout_ms",
	),
	runtimeAgentAIConfigCapabilityAudioSynthesize: runtimeAgentAIConfigParamKeySet(
		"voice", "voiceId", "voiceReference", "voice_reference", "language", "speed", "pitch",
		"responseFormat", "response_format", "timeoutMs", "timeout_ms",
	),
	runtimeAgentAIConfigCapabilityAudioTranscribe: runtimeAgentAIConfigParamKeySet(
		"language", "responseFormat", "response_format", "speakerCount", "speaker_count", "prompt",
		"timestamps", "diarization", "timeoutMs", "timeout_ms",
	),
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone:  runtimeAgentAIConfigParamKeySet("timeoutMs", "timeout_ms", "responseFormat", "response_format"),
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign: runtimeAgentAIConfigParamKeySet("timeoutMs", "timeout_ms", "responseFormat", "response_format"),
}

func runtimeAgentAIConfigParamKeySet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[normalizeRuntimeAgentAIConfigFieldName(value)] = struct{}{}
	}
	return set
}

func normalizeRuntimeAgentAIConfigFieldName(value string) string {
	var normalized strings.Builder
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') {
			normalized.WriteRune(character)
		}
	}
	return normalized.String()
}

func runtimeAgentAIConfigSelectedParamsContainForbiddenField(params *structpb.Struct) bool {
	if params == nil {
		return false
	}
	return runtimeAgentAIConfigStructContainsForbiddenSelectedParamField(params.GetFields())
}

func runtimeAgentAIConfigStructContainsForbiddenSelectedParamField(fields map[string]*structpb.Value) bool {
	for key, value := range fields {
		if runtimeAgentAIConfigForbiddenSelectedParamKey(key) {
			return true
		}
		if value == nil {
			continue
		}
		if nested := value.GetStructValue(); nested != nil && runtimeAgentAIConfigStructContainsForbiddenSelectedParamField(nested.GetFields()) {
			return true
		}
		if list := value.GetListValue(); list != nil {
			for _, item := range list.GetValues() {
				if runtimeAgentAIConfigValueContainsForbiddenSelectedParamField(item) {
					return true
				}
			}
		}
	}
	return false
}

func runtimeAgentAIConfigForbiddenSelectedParamKey(key string) bool {
	normalized := normalizeRuntimeAgentAIConfigFieldName(key)
	if _, forbidden := runtimeAgentAIConfigForbiddenSelectedParamKeys[normalized]; forbidden {
		return true
	}
	// Keep the credential denylist closed under common compound spellings while
	// preserving the admitted generation parameter maxTokens.
	for _, marker := range []string{"apikey", "authorization", "credential", "password", "privatekey", "secret"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return strings.Contains(normalized, "token") && normalized != "maxtokens"
}

func runtimeAgentAIConfigSelectedParamsMatchCapability(capability string, params *structpb.Struct) bool {
	_, ok := normalizeRuntimeAgentAIConfigSelectedParams(capability, params)
	return ok
}

func canonicalRuntimeAgentAIConfigSelectedParamKey(normalized string) string {
	switch normalized {
	case "topp":
		return "topP"
	case "topk":
		return "topK"
	case "maxtokens":
		return "maxTokens"
	case "presencepenalty":
		return "presencePenalty"
	case "frequencypenalty":
		return "frequencyPenalty"
	case "stopsequences":
		return "stopSequences"
	case "timeoutms":
		return "timeoutMs"
	case "responseformat":
		return "responseFormat"
	case "cfgscale":
		return "cfgScale"
	case "negativeprompt":
		return "negativePrompt"
	case "aspectratio":
		return "aspectRatio"
	case "referenceimages":
		return "referenceImages"
	case "durations":
		return "durationSec"
	case "durationsec":
		return "durationSec"
	case "camerafixed":
		return "cameraFixed"
	case "generateaudio":
		return "generateAudio"
	case "voiceid":
		return "voiceId"
	case "voicereference":
		return "voiceReference"
	case "speakercount":
		return "speakerCount"
	default:
		return normalized
	}
}

func normalizeRuntimeAgentAIConfigSelectedParams(
	capability string,
	params *structpb.Struct,
) (*structpb.Struct, bool) {
	if params == nil {
		return nil, true
	}
	allowed, ok := runtimeAgentAIConfigSelectedParamAllowlist[capability]
	if !ok || runtimeAgentAIConfigSelectedParamsContainForbiddenField(params) {
		return nil, false
	}
	out := &structpb.Struct{Fields: make(map[string]*structpb.Value, len(params.GetFields()))}
	seen := make(map[string]struct{}, len(params.GetFields()))
	for key, value := range params.GetFields() {
		normalized := normalizeRuntimeAgentAIConfigFieldName(key)
		if _, admitted := allowed[normalized]; !admitted || normalized == "" {
			return nil, false
		}
		if _, collision := seen[normalized]; collision {
			return nil, false
		}
		seen[normalized] = struct{}{}
		if value == nil {
			out.Fields[canonicalRuntimeAgentAIConfigSelectedParamKey(normalized)] = nil
			continue
		}
		out.Fields[canonicalRuntimeAgentAIConfigSelectedParamKey(normalized)] = proto.Clone(value).(*structpb.Value)
	}
	return out, true
}

func runtimeAgentAIConfigValueContainsForbiddenSelectedParamField(value *structpb.Value) bool {
	if value == nil {
		return false
	}
	if nested := value.GetStructValue(); nested != nil && runtimeAgentAIConfigStructContainsForbiddenSelectedParamField(nested.GetFields()) {
		return true
	}
	if list := value.GetListValue(); list != nil {
		for _, item := range list.GetValues() {
			if runtimeAgentAIConfigValueContainsForbiddenSelectedParamField(item) {
				return true
			}
		}
	}
	return false
}

func isAdmittedRuntimeAgentAIConfigCapability(capability string) bool {
	for _, admitted := range admittedRuntimeAgentAIConfigCapabilities {
		if capability == admitted {
			return true
		}
	}
	return false
}

func (s *Service) committedRuntimeAgentAIConfigForContext(ctx *runtimev1.AgentRequestContext) (*runtimev1.RuntimeAgentAIConfig, error) {
	identity, err := localAgentIdentityFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateRuntimeAgentAIConfigIdentity(identity); err != nil {
		return nil, err
	}
	return s.committedRuntimeAgentAIConfigByAgentInstanceID(identity.LocalAgentRef)
}

func (s *Service) validateRuntimeAgentAIConfigIdentity(identity localAgentIdentity) error {
	entry, err := s.agentByID(identity.LocalAgentRef)
	if err != nil {
		return err
	}
	return validateLocalAgentRecordIdentity(entry.Agent, identity)
}

func (s *Service) committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfig, error) {
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_instance_id is required")
	}
	if s == nil || s.agentAIConfigRepo == nil {
		return nil, status.Error(codes.Internal, "runtime agent ai config store unavailable")
	}
	config, exists, err := s.agentAIConfigRepo.load(trimmedAgentInstanceID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be loaded"},
		)
	}
	if !exists {
		return nil, status.Error(codes.Internal, "runtime agent ai config missing for initialized local agent")
	}
	return cloneRuntimeAgentAIConfig(config), nil
}

func seedRuntimeAgentAIConfig(agentInstanceID string) *runtimev1.RuntimeAgentAIConfig {
	return &runtimev1.RuntimeAgentAIConfig{
		AgentInstanceId: strings.TrimSpace(agentInstanceID),
		Revision:        1,
		Intents:         []*runtimev1.RuntimeAgentAIConfigIntent{},
		UpdatedAt:       timestamppb.New(time.Now().UTC()),
		UpdatedByAppId:  runtimeAgentAIConfigSeedAppID,
	}
}

func (s *Service) upsertRuntimeAgentAIConfig(
	ctx *runtimev1.AgentRequestContext,
	expectedRevision uint64,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
	profileOrigin *runtimev1.RuntimeAgentAIProfileOrigin,
) (*runtimev1.RuntimeAgentAIConfig, error) {
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	identity, err := localAgentIdentityFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateRuntimeAgentAIConfigIdentity(identity); err != nil {
		return nil, err
	}
	trimmedAppID := strings.TrimSpace(ctx.GetAppId())
	if trimmedAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required for runtime agent ai config mutation")
	}
	materialized, err := s.materializeBoundVoiceSynthesisTarget(identity, intents)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeRuntimeAgentAIConfigIntents(materialized)
	if err != nil {
		return nil, err
	}
	normalizedProfileOrigin, err := normalizeRuntimeAgentAIProfileOrigin(profileOrigin)
	if err != nil {
		return nil, err
	}

	s.agentAIConfigMu.Lock()
	current, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(identity.LocalAgentRef)
	if err != nil {
		s.agentAIConfigMu.Unlock()
		return nil, err
	}
	if current.GetRevision() != expectedRevision {
		s.agentAIConfigMu.Unlock()
		return nil, runtimeAgentAIConfigRevisionConflictError(expectedRevision, current.GetRevision())
	}
	normalized, err = s.materializeRuntimeAgentAIConfigImageTarget(context.Background(), current, normalized)
	if err != nil {
		s.agentAIConfigMu.Unlock()
		return nil, err
	}
	if err := s.validateRuntimeAgentAIConfigLocalTargets(context.Background(), current, normalized); err != nil {
		s.agentAIConfigMu.Unlock()
		return nil, err
	}
	next := &runtimev1.RuntimeAgentAIConfig{
		AgentInstanceId: identity.LocalAgentRef,
		Revision:        expectedRevision + 1,
		Intents:         normalized,
		UpdatedAt:       timestamppb.New(time.Now().UTC()),
		UpdatedByAppId:  trimmedAppID,
		ProfileOrigin:   normalizedProfileOrigin,
	}
	if err := s.agentAIConfigRepo.commitMutation(identity.LocalAgentRef, expectedRevision, next); err != nil {
		s.agentAIConfigMu.Unlock()
		if errors.Is(err, errAgentAIConfigRevisionConflict) {
			return nil, runtimeAgentAIConfigRevisionConflictError(expectedRevision, current.GetRevision())
		}
		if errors.Is(err, errAgentAIConfigMissing) {
			return nil, status.Error(codes.Internal, "runtime agent ai config missing after seed (K-AGCORE-150)")
		}
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be committed"},
		)
	}
	s.agentAIConfigMu.Unlock()

	s.recordRuntimeAgentAIConfigAudit(next, runtimeAgentAIConfigChangedEventType)
	if err := s.refreshRuntimeAgentAIConfigReadiness(identity.LocalAgentRef); err != nil && s.logger != nil {
		s.logger.Warn("recompute runtime agent ai config readiness after mutation failed", "agent_instance_id", identity.LocalAgentRef, "error", err)
	}
	return cloneRuntimeAgentAIConfig(next), nil
}

func (s *Service) validateRuntimeAgentAIConfigLocalTargets(
	ctx context.Context,
	current *runtimev1.RuntimeAgentAIConfig,
	next []*runtimev1.RuntimeAgentAIConfigIntent,
) error {
	currentByCapability := make(map[string]*runtimev1.RuntimeAgentAIConfigIntent, len(current.GetIntents()))
	for _, intent := range current.GetIntents() {
		currentByCapability[strings.TrimSpace(intent.GetCapability())] = intent
	}
	s.localAppRouteOptionsMu.RLock()
	resolver := s.localTargetResolver
	s.localAppRouteOptionsMu.RUnlock()
	for _, intent := range next {
		localTarget := intent.GetTargetRef().GetLocalRuntime()
		if localTarget == nil {
			continue
		}
		capability := strings.TrimSpace(intent.GetCapability())
		committed := currentByCapability[capability]
		unchanged := committed != nil &&
			strings.TrimSpace(committed.GetModelId()) == strings.TrimSpace(intent.GetModelId()) &&
			proto.Equal(committed.GetTargetRef(), intent.GetTargetRef())
		if resolver == nil {
			if unchanged {
				continue
			}
			return runtimeAgentAIConfigValidationError(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
				capability,
			)
		}
		binding, asset, err := resolver.ResolveDurableLocalTarget(ctx, localTarget, capability)
		if err != nil {
			reason, _ := grpcerr.ExtractReasonCode(err)
			if unchanged && reason == runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
				continue
			}
			switch reason {
			case runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID:
				return runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
					capability,
				)
			case runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED:
				return runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
					capability,
				)
			default:
				return runtimeAgentAIConfigValidationError(
					codes.FailedPrecondition,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
					capability,
				)
			}
		}
		if binding == nil || asset == nil ||
			strings.TrimSpace(binding.GetResolvedModelId()) == "" ||
			strings.TrimSpace(binding.GetResolvedModelId()) != strings.TrimSpace(intent.GetModelId()) {
			return runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH,
				capability,
			)
		}
		targetStatus := asset.GetDurableTargetStatus()
		if targetStatus == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED {
			targetStatus = asset.GetStatus()
		}
		if runtimeAgentAIConfigCapabilityRequiresActiveLocalTarget(capability) &&
			targetStatus != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			!unchanged {
			return runtimeAgentAIConfigValidationError(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
				capability,
			)
		}
		if capability == runtimeAgentAIConfigCapabilityImageGenerate &&
			targetStatus != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			targetStatus != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED &&
			!unchanged {
			return runtimeAgentAIConfigValidationError(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
				capability,
			)
		}
		if capability == runtimeAgentAIConfigCapabilityImageGenerate {
			materializer, ok := resolver.(runtimeAgentDurableLocalImageTargetMaterializer)
			if !ok {
				if unchanged {
					continue
				}
				return runtimeAgentAIConfigValidationError(
					codes.FailedPrecondition,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
					capability,
				)
			}
			components, componentErr := runtimeAgentAIConfigLocalComponentSelections(intent)
			if componentErr != nil {
				return runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
					capability,
				)
			}
			if componentErr = materializer.ValidateDurableLocalImageTargetComponents(
				ctx,
				localTarget,
				components,
			); componentErr != nil {
				if unchanged && status.Code(componentErr) == codes.FailedPrecondition {
					continue
				}
				return runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
					capability,
				)
			}
		}
	}
	return nil
}

func (s *Service) materializeRuntimeAgentAIConfigImageTarget(
	ctx context.Context,
	current *runtimev1.RuntimeAgentAIConfig,
	next []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	currentByCapability := make(map[string]*runtimev1.RuntimeAgentAIConfigIntent, len(current.GetIntents()))
	for _, intent := range current.GetIntents() {
		currentByCapability[strings.TrimSpace(intent.GetCapability())] = intent
	}
	s.localAppRouteOptionsMu.RLock()
	resolver := s.localTargetResolver
	s.localAppRouteOptionsMu.RUnlock()
	materializer, ok := resolver.(runtimeAgentDurableLocalImageTargetMaterializer)
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, len(next))
	for index, intent := range next {
		out[index] = intent
		if strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityImageGenerate {
			continue
		}
		if intent.GetTargetRef().GetLocalRuntime() == nil {
			continue
		}
		committed := currentByCapability[runtimeAgentAIConfigCapabilityImageGenerate]
		if committed != nil &&
			proto.Equal(committed.GetTargetRef(), intent.GetTargetRef()) &&
			runtimeAgentAIConfigComponentsEqual(
				committed.GetSelectedComponents(),
				intent.GetSelectedComponents(),
			) {
			continue
		}
		if !ok {
			return nil, runtimeAgentAIConfigValidationError(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
				runtimeAgentAIConfigCapabilityImageGenerate,
			)
		}
		components, err := runtimeAgentAIConfigLocalComponentSelections(intent)
		if err != nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				runtimeAgentAIConfigCapabilityImageGenerate,
			)
		}
		if err := materializer.ValidateDurableLocalImageTargetComponents(
			ctx,
			intent.GetTargetRef().GetLocalRuntime(),
			components,
		); err == nil {
			continue
		}
		var target *runtimev1.RuntimeDurableLocalTargetRef
		if committed != nil && committed.GetTargetRef().GetLocalRuntime() != nil {
			if rebinder, supportsRebind := materializer.(runtimeAgentDurableLocalImageTargetRebinder); supportsRebind {
				target, err = rebinder.MaterializeDurableLocalImageTargetFromCommitted(
					ctx,
					committed.GetTargetRef().GetLocalRuntime(),
					intent.GetTargetRef().GetLocalRuntime(),
					components,
				)
			} else {
				target, err = materializer.MaterializeDurableLocalImageTarget(
					ctx,
					intent.GetTargetRef().GetLocalRuntime(),
					components,
				)
			}
		} else {
			target, err = materializer.MaterializeDurableLocalImageTarget(
				ctx,
				intent.GetTargetRef().GetLocalRuntime(),
				components,
			)
		}
		if err != nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
				runtimeAgentAIConfigCapabilityImageGenerate,
			)
		}
		cloned := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		cloned.TargetRef = &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
				LocalRuntime: proto.Clone(target).(*runtimev1.RuntimeDurableLocalTargetRef),
			},
		}
		out[index] = cloned
	}
	return out, nil
}

func runtimeAgentAIConfigComponentsEqual(
	left []*runtimev1.RuntimeAgentAIConfigComponentSelection,
	right []*runtimev1.RuntimeAgentAIConfigComponentSelection,
) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if !proto.Equal(left[index], right[index]) {
			return false
		}
	}
	return true
}

func runtimeAgentAIConfigLocalComponentSelections(
	intent *runtimev1.RuntimeAgentAIConfigIntent,
) ([]localservice.DurableLocalComponentSelection, error) {
	if intent == nil {
		return nil, fmt.Errorf("runtime agent AIConfig intent is nil")
	}
	out := make([]localservice.DurableLocalComponentSelection, 0, len(intent.GetSelectedComponents()))
	for _, component := range intent.GetSelectedComponents() {
		if component == nil || component.GetTargetRef().GetLocalRuntime() == nil {
			return nil, fmt.Errorf("runtime agent AIConfig component target is not local")
		}
		options := map[string]any(nil)
		if component.GetOptions() != nil {
			options = component.GetOptions().AsMap()
		}
		out = append(out, localservice.DurableLocalComponentSelection{
			OccurrenceID:   strings.TrimSpace(component.GetOccurrenceId()),
			Order:          int(component.GetOrder()),
			Role:           strings.TrimSpace(component.GetRole()),
			ComponentKind:  strings.TrimSpace(component.GetComponentKind()),
			LogicalModelID: strings.TrimSpace(component.GetLogicalModelId()),
			TargetRef:      proto.Clone(component.GetTargetRef().GetLocalRuntime()).(*runtimev1.RuntimeDurableLocalTargetRef),
			Required:       component.GetRequired(),
			Weight:         strings.TrimSpace(component.GetWeight()),
			Options:        options,
		})
	}
	return out, nil
}

func runtimeAgentAIConfigCapabilityRequiresActiveLocalTarget(capability string) bool {
	switch capability {
	case runtimeAgentAIConfigCapabilityAudioSynthesize,
		runtimeAgentAIConfigCapabilityAudioTranscribe,
		runtimeAgentAIConfigCapabilityVoiceWorkflowClone,
		runtimeAgentAIConfigCapabilityVoiceWorkflowDesign:
		return true
	default:
		return false
	}
}

func normalizeRuntimeAgentAIProfileOrigin(
	origin *runtimev1.RuntimeAgentAIProfileOrigin,
) (*runtimev1.RuntimeAgentAIProfileOrigin, error) {
	if origin == nil {
		return nil, nil
	}
	profileID := strings.TrimSpace(origin.GetProfileId())
	title := strings.TrimSpace(origin.GetTitle())
	appliedAt := origin.GetAppliedAt()
	if profileID == "" || title == "" || appliedAt == nil {
		return nil, runtimeAgentAIConfigValidationError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
			"",
		)
	}
	if err := appliedAt.CheckValid(); err != nil {
		return nil, runtimeAgentAIConfigValidationError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
			"",
		)
	}
	return &runtimev1.RuntimeAgentAIProfileOrigin{
		ProfileId: profileID,
		Title:     title,
		AppliedAt: timestamppb.New(appliedAt.AsTime().UTC()),
	}, nil
}

func (s *Service) materializeBoundVoiceSynthesisTarget(
	identity localAgentIdentity,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	hasSynthesisIntent := false
	for _, intent := range intents {
		if strings.TrimSpace(intent.GetCapability()) == runtimeAgentAIConfigCapabilityAudioSynthesize {
			hasSynthesisIntent = true
			break
		}
	}
	if !hasSynthesisIntent {
		return intents, nil
	}
	entry, err := s.agentByID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	const voiceAssetPrefix = "voice_asset_id:"
	defaultVoiceReference := strings.TrimSpace(entry.Agent.GetPresentationProfile().GetDefaultVoiceReference())
	if !strings.HasPrefix(defaultVoiceReference, voiceAssetPrefix) {
		return intents, nil
	}
	voiceAssetID := strings.TrimSpace(strings.TrimPrefix(defaultVoiceReference, voiceAssetPrefix))
	asset, err := resolveRuntimeAgentBoundVoiceAsset(
		context.Background(),
		s.currentVoiceAssetResolver(),
		identity.OwnerUserID,
		voiceAssetID,
	)
	if err != nil {
		return nil, err
	}
	targetRef := asset.GetVoiceAssetTargetRef()
	cloud := targetRef.GetCloud()
	if cloud == nil {
		return nil, runtimeAgentVoiceTargetModelMismatchError()
	}
	targetProvider := strings.TrimSpace(cloud.GetProvider())
	targetModel := strings.TrimSpace(cloud.GetProviderModelId())
	targetConnectorID := strings.TrimSpace(cloud.GetConnectorId())
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, len(intents))
	for index, intent := range intents {
		out[index] = intent
		if strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityAudioSynthesize {
			continue
		}
		provider := strings.TrimSpace(intent.GetProvider())
		connectorID := strings.TrimSpace(intent.GetConnectorId())
		if intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD ||
			strings.TrimSpace(intent.GetModelId()) != targetModel ||
			(provider != "" && provider != targetProvider) ||
			(connectorID != "" && connectorID != targetConnectorID) ||
			(intent.GetTargetRef() != nil && !proto.Equal(intent.GetTargetRef(), targetRef)) {
			return nil, runtimeAgentVoiceTargetModelMismatchError()
		}
		materialized := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		materialized.Provider = targetProvider
		materialized.ConnectorId = targetConnectorID
		materialized.TargetRef = proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef)
		out[index] = materialized
	}
	return out, nil
}

func runtimeAgentVoiceTargetModelMismatchError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
}

func runtimeAgentAIConfigRevisionConflictError(expected uint64, committed uint64) error {
	return grpcerr.WithReasonCodeOptions(
		codes.Aborted,
		runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT,
		grpcerr.ReasonOptions{Metadata: map[string]string{
			"expected_revision":  fmt.Sprintf("%d", expected),
			"committed_revision": fmt.Sprintf("%d", committed),
		}},
	)
}

func runtimeAgentAIConfigValidationError(
	code codes.Code,
	reason runtimev1.ReasonCode,
	capability string,
) error {
	metadata := map[string]string{}
	if isAdmittedRuntimeAgentAIConfigCapability(capability) {
		metadata["capability"] = capability
	}
	return grpcerr.WithReasonCodeOptions(
		code,
		reason,
		grpcerr.ReasonOptions{Metadata: metadata},
	)
}

func normalizeRuntimeAgentAIConfigIntents(intents []*runtimev1.RuntimeAgentAIConfigIntent) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	if len(intents) == 0 {
		return nil, runtimeAgentAIConfigValidationError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
			"",
		)
	}
	seen := make(map[string]struct{}, len(intents))
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(intents))
	for _, intent := range intents {
		if intent == nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				"",
			)
		}
		capability := strings.TrimSpace(intent.GetCapability())
		if capability == "" {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				"",
			)
		}
		if !isAdmittedRuntimeAgentAIConfigCapability(capability) {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				"",
			)
		}
		if _, dup := seen[capability]; dup {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		seen[capability] = struct{}{}
		normalizedSelectedParams, paramsValid := normalizeRuntimeAgentAIConfigSelectedParams(capability, intent.GetSelectedParams())
		if !paramsValid {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		modelID := strings.TrimSpace(intent.GetModelId())
		if modelID == "" {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		routePolicy := intent.GetRoutePolicy()
		if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		targetRef := intent.GetTargetRef()
		if runtimeAgentAIConfigCapabilityRequiresTargetRef(capability) &&
			(targetRef == nil || targetRef.GetTarget() == nil) {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_REQUIRED,
				capability,
			)
		}
		if targetRef != nil {
			if err := runtimeidentity.ValidateDurableTargetRef(targetRef); err != nil {
				return nil, runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
					capability,
				)
			}
			switch target := targetRef.GetTarget().(type) {
			case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
					return nil, runtimeAgentAIConfigValidationError(
						codes.InvalidArgument,
						runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
						capability,
					)
				}
				_ = target
			case *runtimev1.RuntimeDurableTargetRef_Cloud:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
					return nil, runtimeAgentAIConfigValidationError(
						codes.InvalidArgument,
						runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
						capability,
					)
				}
			default:
				return nil, runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
					capability,
				)
			}
		}
		if capability == runtimeAgentAIConfigCapabilityImageGenerate &&
			routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD &&
			len(intent.GetSelectedComponents()) > 0 {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
				capability,
			)
		}
		cloned := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		cloned.Capability = capability
		cloned.ModelId = modelID
		cloned.ConnectorId = strings.TrimSpace(intent.GetConnectorId())
		cloned.VoiceReferenceRef = strings.TrimSpace(intent.GetVoiceReferenceRef())
		cloned.ImagePolicyRef = strings.TrimSpace(intent.GetImagePolicyRef())
		cloned.Provider = strings.TrimSpace(intent.GetProvider())
		components, componentErr := normalizeRuntimeAgentAIConfigComponentSelections(capability, intent.GetSelectedComponents())
		if componentErr != nil {
			return nil, componentErr
		}
		cloned.SelectedComponents = components
		cloned.SelectedParams = normalizedSelectedParams
		if cloud := cloned.GetTargetRef().GetCloud(); cloud != nil {
			targetProvider := strings.TrimSpace(cloud.GetProvider())
			if cloned.Provider != "" && targetProvider != "" && cloned.Provider != targetProvider {
				return nil, runtimeAgentAIConfigValidationError(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH,
					capability,
				)
			}
			if cloned.Provider == "" {
				cloned.Provider = targetProvider
			}
		}
		out = append(out, cloned)
	}
	return out, nil
}

func normalizeRuntimeAgentAIConfigComponentSelections(
	capability string,
	values []*runtimev1.RuntimeAgentAIConfigComponentSelection,
) ([]*runtimev1.RuntimeAgentAIConfigComponentSelection, error) {
	if len(values) == 0 {
		return nil, nil
	}
	if capability != runtimeAgentAIConfigCapabilityImageGenerate {
		return nil, runtimeAgentAIConfigValidationError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
			capability,
		)
	}
	out := make([]*runtimev1.RuntimeAgentAIConfigComponentSelection, 0, len(values))
	occurrenceIDs := make(map[string]struct{}, len(values))
	orders := make(map[uint32]struct{}, len(values))
	for _, value := range values {
		if value == nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		occurrenceID := strings.TrimSpace(value.GetOccurrenceId())
		role := strings.TrimSpace(value.GetRole())
		componentKind := strings.ToLower(strings.TrimSpace(value.GetComponentKind()))
		logicalModelID := strings.TrimSpace(value.GetLogicalModelId())
		if occurrenceID == "" || role == "" || componentKind == "" || logicalModelID == "" ||
			value.GetTargetRef() == nil || value.GetTargetRef().GetLocalRuntime() == nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		if _, duplicate := occurrenceIDs[occurrenceID]; duplicate {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		if _, duplicate := orders[value.GetOrder()]; duplicate {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		if err := runtimeidentity.ValidateDurableTargetRef(value.GetTargetRef()); err != nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
				capability,
			)
		}
		if value.GetOptions() != nil && runtimeAgentAIConfigStructContainsForbiddenSelectedParamField(value.GetOptions().GetFields()) {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
		options := map[string]any(nil)
		if value.GetOptions() != nil {
			options = value.GetOptions().AsMap()
		}
		if err := localservice.ValidateDurableLocalImageComponentMetadata(
			nil,
			componentKind,
			"",
			value.GetWeight(),
			options,
		); err != nil {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
				capability,
			)
		}
		occurrenceIDs[occurrenceID] = struct{}{}
		orders[value.GetOrder()] = struct{}{}
		cloned := proto.Clone(value).(*runtimev1.RuntimeAgentAIConfigComponentSelection)
		cloned.OccurrenceId = occurrenceID
		cloned.Role = role
		cloned.ComponentKind = componentKind
		cloned.LogicalModelId = logicalModelID
		cloned.Weight = strings.TrimSpace(value.GetWeight())
		if value.GetOptions() != nil {
			cloned.Options = proto.Clone(value.GetOptions()).(*structpb.Struct)
		}
		out = append(out, cloned)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].GetOrder() < out[j].GetOrder()
	})
	for index := 1; index < len(out); index++ {
		if out[index-1].GetOrder() >= out[index].GetOrder() {
			return nil, runtimeAgentAIConfigValidationError(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				capability,
			)
		}
	}
	return out, nil
}

func cloneRuntimeAgentAIConfig(config *runtimev1.RuntimeAgentAIConfig) *runtimev1.RuntimeAgentAIConfig {
	if config == nil {
		return nil
	}
	return proto.Clone(config).(*runtimev1.RuntimeAgentAIConfig)
}

func (s *Service) recordRuntimeAgentAIConfigAudit(config *runtimev1.RuntimeAgentAIConfig, operation string) {
	if s == nil || config == nil {
		return
	}
	capabilities := make([]any, 0, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		capabilities = append(capabilities, intent.GetCapability())
	}
	payload, err := structpb.NewStruct(map[string]any{
		"agent_instance_id": config.GetAgentInstanceId(),
		"revision":          config.GetRevision(),
		"updated_by_app_id": config.GetUpdatedByAppId(),
		"capabilities":      capabilities,
		"recorded_at":       timestampString(config.GetUpdatedAt()),
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("build runtime agent ai config audit payload failed", "error", err)
		}
		return
	}
	record := &runtimev1.AuditEventRecord{
		AuditId:     fmt.Sprintf("runtime-agent-ai-config-%s-rev-%d", config.GetAgentInstanceId(), config.GetRevision()),
		AppId:       "runtime",
		Domain:      "runtime.agent",
		Operation:   operation,
		ReasonCode:  runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:     fmt.Sprintf("runtime-agent-ai-config-%s-rev-%d", config.GetAgentInstanceId(), config.GetRevision()),
		Timestamp:   config.GetUpdatedAt(),
		Payload:     payload,
		CallerId:    "runtime.agent.service",
		SurfaceId:   "runtime.agent.ai_config",
		Capability:  "runtime.agent.ai_config.write",
		PrincipalId: config.GetUpdatedByAppId(),
	}
	s.execAuditMu.Lock()
	store := s.auditStore
	if store == nil {
		s.execPendingAIConfigAudits = append(s.execPendingAIConfigAudits, record)
		s.execAuditMu.Unlock()
		if s.logger != nil {
			s.logger.Info("runtime agent ai config audit recorded without audit store", "operation", operation, "revision", config.GetRevision())
		}
		return
	}
	s.execAuditMu.Unlock()
	store.AppendEvent(record)
}

func (s *Service) flushPendingAgentAIConfigAudit() {
	if s == nil {
		return
	}
	s.execAuditMu.Lock()
	records := append([]*runtimev1.AuditEventRecord(nil), s.execPendingAIConfigAudits...)
	store := s.auditStore
	if len(records) == 0 || store == nil {
		s.execAuditMu.Unlock()
		return
	}
	s.execPendingAIConfigAudits = nil
	s.execAuditMu.Unlock()
	for _, record := range records {
		store.AppendEvent(record)
	}
}
