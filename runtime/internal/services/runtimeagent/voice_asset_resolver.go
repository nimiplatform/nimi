package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

// VoiceAssetResolver is the Runtime-private owner boundary used by
// RuntimeAgent to resolve an admitted VoiceAsset without reaching into AI
// storage. The production adapter delegates to RuntimeAiService.GetVoiceAsset,
// preserving its app/subject isolation checks.
type VoiceAssetResolver interface {
	ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*runtimev1.VoiceAsset, error)
}

type runtimeAIVoiceAssetService interface {
	GetVoiceAsset(context.Context, *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error)
}

type aiBackedVoiceAssetResolver struct {
	ai runtimeAIVoiceAssetService
}

func NewAIBackedVoiceAssetResolver(ai runtimeAIVoiceAssetService) VoiceAssetResolver {
	if ai == nil {
		return rejectingVoiceAssetResolver{}
	}
	return aiBackedVoiceAssetResolver{ai: ai}
}

func (r aiBackedVoiceAssetResolver) ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*runtimev1.VoiceAsset, error) {
	response, err := r.ai.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: strings.TrimSpace(voiceAssetID)})
	if err != nil {
		return nil, err
	}
	if response == nil || response.GetAsset() == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	return response.GetAsset(), nil
}

type rejectingVoiceAssetResolver struct{}

func (rejectingVoiceAssetResolver) ResolveVoiceAsset(context.Context, string) (*runtimev1.VoiceAsset, error) {
	return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED)
}

func (s *Service) SetVoiceAssetResolver(resolver VoiceAssetResolver) {
	if s == nil || s.isClosed() {
		return
	}
	s.voiceAssetResolverMu.Lock()
	defer s.voiceAssetResolverMu.Unlock()
	if resolver == nil {
		s.voiceAssetResolver = rejectingVoiceAssetResolver{}
		return
	}
	s.voiceAssetResolver = resolver
}

func (s *Service) currentVoiceAssetResolver() VoiceAssetResolver {
	if s == nil {
		return rejectingVoiceAssetResolver{}
	}
	s.voiceAssetResolverMu.RLock()
	defer s.voiceAssetResolverMu.RUnlock()
	if s.voiceAssetResolver == nil {
		return rejectingVoiceAssetResolver{}
	}
	return s.voiceAssetResolver
}

func validateAgentPresentationVoiceAssetBinding(
	ctx context.Context,
	resolver VoiceAssetResolver,
	identity localAgentIdentity,
	expectedAppID string,
	profile *runtimev1.AgentPresentationProfile,
) error {
	if profile == nil {
		return nil
	}
	voiceReference := strings.TrimSpace(profile.GetDefaultVoiceReference())
	if voiceReference == "" || strings.HasPrefix(voiceReference, "preset_voice_id:") {
		return nil
	}
	const voiceAssetPrefix = "voice_asset_id:"
	if !strings.HasPrefix(voiceReference, voiceAssetPrefix) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	voiceAssetID := strings.TrimSpace(strings.TrimPrefix(voiceReference, voiceAssetPrefix))
	if voiceAssetID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID, err := effectiveVoiceAssetBindingAppID(ctx, expectedAppID)
	if err != nil {
		return err
	}
	if resolver == nil {
		resolver = rejectingVoiceAssetResolver{}
	}
	asset, err := resolver.ResolveVoiceAsset(ctx, voiceAssetID)
	if err != nil {
		return err
	}
	if asset == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if strings.TrimSpace(asset.GetVoiceAssetId()) != voiceAssetID {
		return invalidProfileVoiceAssetBinding()
	}
	if strings.TrimSpace(asset.GetAppId()) != appID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if strings.TrimSpace(asset.GetSubjectUserId()) != identity.OwnerUserID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT ||
		!validProfileVoiceAssetWorkflowType(asset.GetWorkflowType()) ||
		strings.TrimSpace(asset.GetProvider()) == "" ||
		strings.TrimSpace(asset.GetProviderVoiceRef()) == "" ||
		voiceAssetExpiryElapsed(asset, time.Now().UTC()) ||
		runtimeidentity.ValidateDurableTargetRef(asset.GetTargetRef()) != nil ||
		runtimeidentity.ValidateDurableTargetRef(asset.GetVoiceAssetTargetRef()) != nil ||
		!proto.Equal(asset.GetTargetRef(), asset.GetVoiceAssetTargetRef()) ||
		!voiceAssetProviderMatchesDurableTarget(asset.GetProvider(), asset.GetTargetRef()) {
		return invalidProfileVoiceAssetBinding()
	}
	return nil
}

func voiceAssetProviderMatchesDurableTarget(provider string, targetRef *runtimev1.RuntimeDurableTargetRef) bool {
	if provider == "" || strings.TrimSpace(provider) != provider {
		return false
	}
	cloud := targetRef.GetCloud()
	return cloud == nil || provider == cloud.GetProvider()
}

func validProfileVoiceAssetWorkflowType(workflowType runtimev1.VoiceWorkflowType) bool {
	switch workflowType {
	case runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
		runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_DESIGN:
		return true
	default:
		return false
	}
}

func effectiveVoiceAssetBindingAppID(ctx context.Context, requestAppID string) (string, error) {
	requestAppID = strings.TrimSpace(requestAppID)
	headerAppID := ""
	if incoming, ok := metadata.FromIncomingContext(ctx); ok {
		for _, value := range incoming.Get("x-nimi-app-id") {
			value = strings.TrimSpace(value)
			if value == "" || (headerAppID != "" && headerAppID != value) {
				return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
			}
			headerAppID = value
		}
	}
	if requestAppID != "" && headerAppID != "" && requestAppID != headerAppID {
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if headerAppID != "" {
		return headerAppID, nil
	}
	if requestAppID != "" {
		return requestAppID, nil
	}
	return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
}

func voiceAssetExpiryElapsed(asset *runtimev1.VoiceAsset, now time.Time) bool {
	if asset == nil || asset.GetExpiresAt() == nil {
		return false
	}
	if err := asset.GetExpiresAt().CheckValid(); err != nil {
		return true
	}
	return !asset.GetExpiresAt().AsTime().After(now)
}

func invalidProfileVoiceAssetBinding() error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED)
}
