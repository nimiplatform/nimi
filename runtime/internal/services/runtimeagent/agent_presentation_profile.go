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
	speechModelID := strings.TrimSpace(input.GetSpeechModelId())
	speechRoutePolicy := input.GetSpeechRoutePolicy()
	if speechRoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED && agentRoutePolicyLabel(speechRoutePolicy) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        avatarAssetRef,
		ExpressionProfileRef:  strings.TrimSpace(input.GetExpressionProfileRef()),
		IdlePreset:            strings.TrimSpace(input.GetIdlePreset()),
		InteractionPolicyRef:  strings.TrimSpace(input.GetInteractionPolicyRef()),
		DefaultVoiceReference: defaultVoiceReference,
		AvatarAutoplay:        input.GetAvatarAutoplay(),
		SpeechModelId:         speechModelID,
		SpeechRoutePolicy:     speechRoutePolicy,
	}, nil
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

func agentPresentationProfileMetadataValue(profile *runtimev1.AgentPresentationProfile) (*structpb.Value, error) {
	if profile == nil {
		return nil, nil
	}
	backendLabel, ok := agentPresentationBackendKindLabel(profile.GetBackendKind())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	fields := map[string]*structpb.Value{
		"backendKind":           structpb.NewStringValue(backendLabel),
		"avatarAssetRef":        structpb.NewStringValue(profile.GetAvatarAssetRef()),
		"expressionProfileRef":  structValueString(profile.GetExpressionProfileRef()),
		"idlePreset":            structValueString(profile.GetIdlePreset()),
		"interactionPolicyRef":  structValueString(profile.GetInteractionPolicyRef()),
		"defaultVoiceReference": structValueString(profile.GetDefaultVoiceReference()),
		"speechModelId":         structValueString(profile.GetSpeechModelId()),
		"speechRoutePolicy":     structValueString(agentRoutePolicyLabel(profile.GetSpeechRoutePolicy())),
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
