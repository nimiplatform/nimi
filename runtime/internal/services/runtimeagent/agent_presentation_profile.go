package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func normalizeAgentPresentationProfile(input *runtimev1.AgentPresentationProfile) (*runtimev1.AgentPresentationProfile, error) {
	if input == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	backendKind := input.GetBackendKind()
	if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	avatarAssetRef := strings.TrimSpace(input.GetAvatarAssetRef())
	if avatarAssetRef == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	defaultVoiceReference, err := normalizeDefaultVoiceReference(input.GetDefaultVoiceReference())
	if err != nil {
		return nil, err
	}
	return &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        avatarAssetRef,
		ExpressionProfileRef:  strings.TrimSpace(input.GetExpressionProfileRef()),
		IdlePreset:            strings.TrimSpace(input.GetIdlePreset()),
		InteractionPolicyRef:  strings.TrimSpace(input.GetInteractionPolicyRef()),
		DefaultVoiceReference: defaultVoiceReference,
		AvatarAutoplay:        input.GetAvatarAutoplay(),
		BackgroundAssetRef:    strings.TrimSpace(input.GetBackgroundAssetRef()),
	}, nil
}

func normalizeAgentPresentationProfilePatch(existing *runtimev1.AgentPresentationProfile, patch *runtimev1.AgentPresentationProfilePatch) (*runtimev1.AgentPresentationProfile, error) {
	if patch == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	next := &runtimev1.AgentPresentationProfile{}
	if existing != nil {
		*next = *existing
	}
	changed := false
	if patch.BackendKind != nil {
		backendKind := patch.GetBackendKind()
		if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		next.BackendKind = backendKind
		changed = true
	}
	if patch.AvatarAssetRef != nil {
		next.AvatarAssetRef = strings.TrimSpace(patch.GetAvatarAssetRef())
		changed = true
	}
	if patch.ExpressionProfileRef != nil {
		next.ExpressionProfileRef = strings.TrimSpace(patch.GetExpressionProfileRef())
		changed = true
	}
	if patch.IdlePreset != nil {
		next.IdlePreset = strings.TrimSpace(patch.GetIdlePreset())
		changed = true
	}
	if patch.InteractionPolicyRef != nil {
		next.InteractionPolicyRef = strings.TrimSpace(patch.GetInteractionPolicyRef())
		changed = true
	}
	if patch.DefaultVoiceReference != nil {
		defaultVoiceReference, err := normalizeDefaultVoiceReference(patch.GetDefaultVoiceReference())
		if err != nil {
			return nil, err
		}
		next.DefaultVoiceReference = defaultVoiceReference
		changed = true
	}
	if patch.AvatarAutoplay != nil {
		next.AvatarAutoplay = patch.GetAvatarAutoplay()
		changed = true
	}
	if patch.BackgroundAssetRef != nil {
		next.BackgroundAssetRef = strings.TrimSpace(patch.GetBackgroundAssetRef())
		changed = true
	}
	if !changed {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return normalizeMergedAgentPresentationProfile(next)
}

func normalizeMergedAgentPresentationProfile(input *runtimev1.AgentPresentationProfile) (*runtimev1.AgentPresentationProfile, error) {
	if input == nil {
		return nil, nil
	}
	avatarAssetRef := strings.TrimSpace(input.GetAvatarAssetRef())
	backendKind := input.GetBackendKind()
	if avatarAssetRef == "" {
		backendKind = runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED
	} else if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	defaultVoiceReference, err := normalizeDefaultVoiceReference(input.GetDefaultVoiceReference())
	if err != nil {
		return nil, err
	}
	normalized := &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        avatarAssetRef,
		ExpressionProfileRef:  strings.TrimSpace(input.GetExpressionProfileRef()),
		IdlePreset:            strings.TrimSpace(input.GetIdlePreset()),
		InteractionPolicyRef:  strings.TrimSpace(input.GetInteractionPolicyRef()),
		DefaultVoiceReference: defaultVoiceReference,
		AvatarAutoplay:        input.GetAvatarAutoplay(),
		BackgroundAssetRef:    strings.TrimSpace(input.GetBackgroundAssetRef()),
	}
	if normalized.AvatarAssetRef == "" {
		normalized.ExpressionProfileRef = ""
		normalized.IdlePreset = ""
		normalized.InteractionPolicyRef = ""
	}
	if !agentPresentationProfileHasFields(normalized) {
		return nil, nil
	}
	return normalized, nil
}

func normalizeDefaultVoiceReference(input string) (string, error) {
	value := strings.TrimSpace(input)
	if value == "" {
		return "", nil
	}
	kind, ref, ok := strings.Cut(value, ":")
	if !ok || strings.TrimSpace(kind) != kind || strings.TrimSpace(ref) == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch kind {
	case "preset_voice_id", "voice_asset_id":
		return kind + ":" + strings.TrimSpace(ref), nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func agentPresentationBackendKindFromLabel(label string) (runtimev1.AgentPresentationBackendKind, bool) {
	switch strings.TrimSpace(strings.ToLower(label)) {
	case "":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED, true
	case "vrm":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM, true
	case "live2d":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D, true
	case "sprite2d":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_SPRITE2D, true
	case "canvas2d":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_CANVAS2D, true
	case "video":
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VIDEO, true
	default:
		return runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED, false
	}
}

func agentPresentationBackendKindLabel(kind runtimev1.AgentPresentationBackendKind) (string, bool) {
	switch kind {
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM:
		return "vrm", true
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D:
		return "live2d", true
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_SPRITE2D:
		return "sprite2d", true
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_CANVAS2D:
		return "canvas2d", true
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VIDEO:
		return "video", true
	default:
		return "", false
	}
}

func structValueString(value string) *structpb.Value {
	if value == "" {
		return nil
	}
	return structpb.NewStringValue(value)
}

func agentPresentationProfileHasFields(profile *runtimev1.AgentPresentationProfile) bool {
	return profile != nil && (profile.GetAvatarAssetRef() != "" ||
		profile.GetDefaultVoiceReference() != "" ||
		profile.GetBackgroundAssetRef() != "" ||
		profile.GetAvatarAutoplay())
}

func agentPresentationProfileMetadataValue(profile *runtimev1.AgentPresentationProfile) (*structpb.Value, error) {
	if profile == nil {
		return nil, nil
	}
	fields := map[string]*structpb.Value{
		"expressionProfileRef":  structValueString(profile.GetExpressionProfileRef()),
		"idlePreset":            structValueString(profile.GetIdlePreset()),
		"interactionPolicyRef":  structValueString(profile.GetInteractionPolicyRef()),
		"defaultVoiceReference": structValueString(profile.GetDefaultVoiceReference()),
		"backgroundAssetRef":    structValueString(profile.GetBackgroundAssetRef()),
	}
	if profile.GetAvatarAssetRef() != "" {
		backendLabel, ok := agentPresentationBackendKindLabel(profile.GetBackendKind())
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		fields["backendKind"] = structpb.NewStringValue(backendLabel)
		fields["avatarAssetRef"] = structpb.NewStringValue(profile.GetAvatarAssetRef())
	}
	if profile.GetAvatarAutoplay() {
		fields["avatarAutoplay"] = structpb.NewBoolValue(true)
	}
	for key, value := range fields {
		if value == nil {
			delete(fields, key)
		}
	}
	return structpb.NewStructValue(&structpb.Struct{Fields: fields}), nil
}

func stringField(fields map[string]*structpb.Value, key string) string {
	if value := fields[key]; value != nil {
		return strings.TrimSpace(value.GetStringValue())
	}
	return ""
}

func agentPresentationProfileFromMetadata(metadata *structpb.Struct) (*runtimev1.AgentPresentationProfile, error) {
	if metadata == nil {
		return nil, nil
	}
	value := metadata.GetFields()["presentationProfile"]
	if value == nil || value.GetStructValue() == nil {
		return nil, nil
	}
	fields := value.GetStructValue().GetFields()
	backendKind, ok := agentPresentationBackendKindFromLabel(stringField(fields, "backendKind"))
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	profile := &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        stringField(fields, "avatarAssetRef"),
		ExpressionProfileRef:  stringField(fields, "expressionProfileRef"),
		IdlePreset:            stringField(fields, "idlePreset"),
		InteractionPolicyRef:  stringField(fields, "interactionPolicyRef"),
		DefaultVoiceReference: stringField(fields, "defaultVoiceReference"),
		BackgroundAssetRef:    stringField(fields, "backgroundAssetRef"),
	}
	if value := fields["avatarAutoplay"]; value != nil {
		profile.AvatarAutoplay = value.GetBoolValue()
	}
	return normalizeMergedAgentPresentationProfile(profile)
}

func agentRoutePolicyLabel(policy runtimev1.RoutePolicy) string {
	switch policy {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return "local"
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return "cloud"
	default:
		return ""
	}
}

func mergeAgentPresentationProfileMetadata(metadata *structpb.Struct, profile *runtimev1.AgentPresentationProfile) (*structpb.Struct, error) {
	next := cloneStruct(metadata)
	if next == nil {
		next = &structpb.Struct{Fields: map[string]*structpb.Value{}}
	}
	if next.Fields == nil {
		next.Fields = map[string]*structpb.Value{}
	}
	if profile == nil {
		delete(next.Fields, "presentationProfile")
		if len(next.Fields) == 0 {
			return nil, nil
		}
		return next, nil
	}
	value, err := agentPresentationProfileMetadataValue(profile)
	if err != nil {
		return nil, err
	}
	next.Fields["presentationProfile"] = value
	return next, nil
}
