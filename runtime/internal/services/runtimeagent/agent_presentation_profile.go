package runtimeagent

import (
	"net/url"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func invalidAgentPresentationProfile() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func validateAgentPresentationOpaqueRef(value string) error {
	if value == "" {
		return invalidAgentPresentationProfile()
	}
	for index := 0; index < len(value); index++ {
		if value[index] > 0x7f {
			return invalidAgentPresentationProfile()
		}
	}
	if len(value) >= 2 && isASCIIAlpha(value[0]) && value[1] == ':' {
		return invalidAgentPresentationProfile()
	}

	namespace, tail, qualified := strings.Cut(value, ":")
	if !qualified {
		if len(value) > 256 || !isAgentPresentationBareRefFirst(value[0]) {
			return invalidAgentPresentationProfile()
		}
		for index := 1; index < len(value); index++ {
			if !isAgentPresentationBareRefRest(value[index]) {
				return invalidAgentPresentationProfile()
			}
		}
		if !isSafeAgentPresentationRefPass(value) {
			return invalidAgentPresentationProfile()
		}
		return nil
	}

	if len(value) > 2048 || len(namespace) == 0 || len(namespace) > 64 || tail == "" ||
		!isLowerASCIIAlpha(namespace[0]) {
		return invalidAgentPresentationProfile()
	}
	for index := 1; index < len(namespace); index++ {
		if !isAgentPresentationNamespaceRest(namespace[index]) {
			return invalidAgentPresentationProfile()
		}
	}
	switch namespace {
	case "file", "data", "http", "https":
		return invalidAgentPresentationProfile()
	}
	for index := 0; index < len(tail); index++ {
		if tail[index] == '%' {
			if index+2 >= len(tail) || !isASCIIHex(tail[index+1]) || !isASCIIHex(tail[index+2]) {
				return invalidAgentPresentationProfile()
			}
			index += 2
			continue
		}
		if !isRFC3986URIByte(tail[index]) {
			return invalidAgentPresentationProfile()
		}
	}
	decodedTail, err := url.PathUnescape(tail)
	if err != nil || !isSafeAgentPresentationRefPass(tail) || !isSafeAgentPresentationRefPass(decodedTail) {
		return invalidAgentPresentationProfile()
	}
	if namespace == "profile_media_url" {
		parsed, err := url.Parse(tail)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" {
			return invalidAgentPresentationProfile()
		}
		return nil
	}
	if strings.Contains(tail, "://") || strings.Contains(decodedTail, "://") {
		return invalidAgentPresentationProfile()
	}
	return nil
}

func isLowerASCIIAlpha(value byte) bool {
	return value >= 'a' && value <= 'z'
}

func isASCIIAlphaNumeric(value byte) bool {
	return isASCIIAlpha(value) || (value >= '0' && value <= '9')
}

func isASCIIAlpha(value byte) bool {
	return isLowerASCIIAlpha(value) || (value >= 'A' && value <= 'Z')
}

func isAgentPresentationBareRefFirst(value byte) bool {
	return isASCIIAlphaNumeric(value)
}

func isAgentPresentationBareRefRest(value byte) bool {
	return isASCIIAlphaNumeric(value) || strings.ContainsRune("._@+~-", rune(value))
}

func isAgentPresentationNamespaceRest(value byte) bool {
	return isLowerASCIIAlpha(value) || (value >= '0' && value <= '9') || strings.ContainsRune("_.+-", rune(value))
}

func isASCIIHex(value byte) bool {
	return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f') || (value >= 'A' && value <= 'F')
}

func isRFC3986URIByte(value byte) bool {
	return isASCIIAlphaNumeric(value) || strings.ContainsRune("-._~:/?#[]@!$&'()*+,;=", rune(value))
}

func isSafeAgentPresentationRefPass(value string) bool {
	if value == "" || strings.HasPrefix(value, "/") || strings.Contains(value, `\`) ||
		strings.Contains(strings.ToLower(value), ";base64,") {
		return false
	}
	if len(value) >= 2 && isASCIIAlpha(value[0]) && value[1] == ':' {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 0x20 || value[index] == 0x7f {
			return false
		}
	}
	for _, character := range value {
		if unicode.IsSpace(character) || unicode.IsControl(character) {
			return false
		}
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func validateAgentPresentationProfileRefs(profile *runtimev1.AgentPresentationProfile) error {
	if profile == nil {
		return nil
	}
	for _, value := range []string{
		profile.GetAvatarAssetRef(),
		profile.GetExpressionProfileRef(),
		profile.GetIdlePreset(),
		profile.GetInteractionPolicyRef(),
		profile.GetBackgroundAssetRef(),
	} {
		if value != "" {
			if err := validateAgentPresentationOpaqueRef(value); err != nil {
				return err
			}
		}
	}
	return nil
}

func normalizeAgentPresentationProfile(input *runtimev1.AgentPresentationProfile) (*runtimev1.AgentPresentationProfile, error) {
	if input == nil {
		return nil, invalidAgentPresentationProfile()
	}
	backendKind := input.GetBackendKind()
	if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
		return nil, invalidAgentPresentationProfile()
	}
	avatarAssetRef := input.GetAvatarAssetRef()
	if avatarAssetRef == "" {
		return nil, invalidAgentPresentationProfile()
	}
	if err := validateAgentPresentationProfileRefs(input); err != nil {
		return nil, err
	}
	defaultVoiceReference, err := normalizeDefaultVoiceReference(input.GetDefaultVoiceReference())
	if err != nil {
		return nil, err
	}
	return &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        avatarAssetRef,
		ExpressionProfileRef:  input.GetExpressionProfileRef(),
		IdlePreset:            input.GetIdlePreset(),
		InteractionPolicyRef:  input.GetInteractionPolicyRef(),
		DefaultVoiceReference: defaultVoiceReference,
		AvatarAutoplay:        input.GetAvatarAutoplay(),
		BackgroundAssetRef:    input.GetBackgroundAssetRef(),
	}, nil
}

func normalizeAgentPresentationProfilePatch(existing *runtimev1.AgentPresentationProfile, patch *runtimev1.AgentPresentationProfilePatch) (*runtimev1.AgentPresentationProfile, error) {
	if patch == nil {
		return nil, invalidAgentPresentationProfile()
	}
	next := &runtimev1.AgentPresentationProfile{}
	if existing != nil {
		next = proto.Clone(existing).(*runtimev1.AgentPresentationProfile)
	}
	changed := false
	if patch.BackendKind != nil {
		backendKind := patch.GetBackendKind()
		if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
			return nil, invalidAgentPresentationProfile()
		}
		next.BackendKind = backendKind
		changed = true
	}
	if patch.AvatarAssetRef != nil {
		next.AvatarAssetRef = patch.GetAvatarAssetRef()
		changed = true
	}
	if patch.ExpressionProfileRef != nil {
		next.ExpressionProfileRef = patch.GetExpressionProfileRef()
		changed = true
	}
	if patch.IdlePreset != nil {
		next.IdlePreset = patch.GetIdlePreset()
		changed = true
	}
	if patch.InteractionPolicyRef != nil {
		next.InteractionPolicyRef = patch.GetInteractionPolicyRef()
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
		next.BackgroundAssetRef = patch.GetBackgroundAssetRef()
		changed = true
	}
	if !changed {
		return nil, invalidAgentPresentationProfile()
	}
	return normalizeMergedAgentPresentationProfile(next)
}

func normalizeMergedAgentPresentationProfile(input *runtimev1.AgentPresentationProfile) (*runtimev1.AgentPresentationProfile, error) {
	if input == nil {
		return nil, nil
	}
	if err := validateAgentPresentationProfileRefs(input); err != nil {
		return nil, err
	}
	avatarAssetRef := input.GetAvatarAssetRef()
	backendKind := input.GetBackendKind()
	if avatarAssetRef == "" {
		backendKind = runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED
	} else if _, ok := agentPresentationBackendKindLabel(backendKind); !ok {
		return nil, invalidAgentPresentationProfile()
	}
	defaultVoiceReference, err := normalizeDefaultVoiceReference(input.GetDefaultVoiceReference())
	if err != nil {
		return nil, err
	}
	normalized := &runtimev1.AgentPresentationProfile{
		BackendKind:           backendKind,
		AvatarAssetRef:        avatarAssetRef,
		ExpressionProfileRef:  input.GetExpressionProfileRef(),
		IdlePreset:            input.GetIdlePreset(),
		InteractionPolicyRef:  input.GetInteractionPolicyRef(),
		DefaultVoiceReference: defaultVoiceReference,
		AvatarAutoplay:        input.GetAvatarAutoplay(),
		BackgroundAssetRef:    input.GetBackgroundAssetRef(),
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

func validatePersistedAgentPresentationProfile(agent *runtimev1.LocalAgentRecord) error {
	if agent == nil {
		return nil
	}
	if metadata := agent.GetMetadata(); metadata != nil {
		for _, key := range []string{"presentationProfile", "presentationProfileRevision", "previousPresentationProfile"} {
			if _, exists := metadata.GetFields()[key]; exists {
				return invalidAgentPresentationProfile()
			}
		}
	}
	if previous := agent.GetPreviousPresentationProfile(); previous != nil {
		if previous.GetRevision() == 0 {
			return invalidAgentPresentationProfile()
		}
		normalized, err := normalizeMergedAgentPresentationProfile(previous)
		if err != nil || normalized == nil {
			return invalidAgentPresentationProfile()
		}
		normalized.Revision = previous.GetRevision()
		if !proto.Equal(normalized, previous) {
			return invalidAgentPresentationProfile()
		}
	}
	if agent.GetPresentationProfile() == nil {
		return nil
	}
	profile := agent.GetPresentationProfile()
	if profile.GetRevision() == 0 || profile.GetRevision() != agent.GetPresentationProfileRevision() {
		return invalidAgentPresentationProfile()
	}
	normalized, err := normalizeMergedAgentPresentationProfile(profile)
	if err != nil || normalized == nil {
		return invalidAgentPresentationProfile()
	}
	normalized.Revision = profile.GetRevision()
	if !proto.Equal(normalized, profile) {
		return invalidAgentPresentationProfile()
	}
	return nil
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

func agentPresentationProfileHasFields(profile *runtimev1.AgentPresentationProfile) bool {
	return profile != nil && (profile.GetAvatarAssetRef() != "" ||
		profile.GetDefaultVoiceReference() != "" ||
		profile.GetBackgroundAssetRef() != "" ||
		profile.GetAvatarAutoplay())
}
