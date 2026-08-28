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
)

// VoiceAssetResolver is the Runtime-private owner boundary used by
// RuntimeAgent to resolve an admitted VoiceAsset or list bounded bindable
// options without reaching into AI storage. The production adapter delegates
// only to RuntimeAiService's in-process owner methods and preserves the
// account-plus-App VoiceAsset boundary.
type resolvedVoiceAsset struct {
	Asset  *runtimev1.VoiceAsset
	Target *runtimeidentity.Target
}

type VoiceAssetResolver interface {
	ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*resolvedVoiceAsset, error)
	ListBindableVoiceAssets(ctx context.Context, appID string, ownerUserID string, limit int) ([]string, bool, error)
}

type runtimeAIVoiceAssetService interface {
	ResolveRuntimeAgentVoiceAsset(context.Context, string, string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, error)
	ListRuntimeAgentVoiceAssets(context.Context, string, string, int) ([]*runtimev1.VoiceAsset, bool, error)
}

type aiBackedVoiceAssetResolver struct {
	ai runtimeAIVoiceAssetService
}

type runtimeAgentVoiceAssetOwnerContextKey struct{}

func withRuntimeAgentVoiceAssetOwner(ctx context.Context, ownerUserID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, runtimeAgentVoiceAssetOwnerContextKey{}, strings.TrimSpace(ownerUserID))
}

func runtimeAgentVoiceAssetOwnerFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	ownerUserID, _ := ctx.Value(runtimeAgentVoiceAssetOwnerContextKey{}).(string)
	return strings.TrimSpace(ownerUserID)
}

func NewAIBackedVoiceAssetResolver(ai runtimeAIVoiceAssetService) VoiceAssetResolver {
	if ai == nil {
		return rejectingVoiceAssetResolver{}
	}
	return aiBackedVoiceAssetResolver{ai: ai}
}

func (r aiBackedVoiceAssetResolver) ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*resolvedVoiceAsset, error) {
	ownerUserID := runtimeAgentVoiceAssetOwnerFromContext(ctx)
	if ownerUserID == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED)
	}
	asset, target, err := r.ai.ResolveRuntimeAgentVoiceAsset(ctx, strings.TrimSpace(voiceAssetID), ownerUserID)
	if err != nil {
		return nil, err
	}
	return &resolvedVoiceAsset{Asset: asset, Target: target}, nil
}

func (r aiBackedVoiceAssetResolver) ListBindableVoiceAssets(
	ctx context.Context,
	appID string,
	ownerUserID string,
	limit int,
) ([]string, bool, error) {
	appID = strings.TrimSpace(appID)
	ownerUserID = strings.TrimSpace(ownerUserID)
	if appID == "" || ownerUserID == "" || limit <= 0 {
		return nil, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	const candidateLimit = 200
	assets, sourceTruncated, err := r.ai.ListRuntimeAgentVoiceAssets(ctx, appID, ownerUserID, candidateLimit)
	if err != nil {
		return nil, false, err
	}
	options := make([]string, 0, min(limit, len(assets)))
	for _, asset := range assets {
		if asset == nil {
			continue
		}
		resolved, err := r.ResolveVoiceAsset(withRuntimeAgentVoiceAssetOwner(ctx, ownerUserID), asset.GetVoiceAssetId())
		if err != nil {
			return nil, false, err
		}
		if !voiceAssetBindableForOwner(resolved, asset.GetVoiceAssetId(), appID, ownerUserID) {
			continue
		}
		options = append(options, strings.TrimSpace(asset.GetVoiceAssetId()))
		if len(options) == limit {
			return options, sourceTruncated || len(assets) > len(options), nil
		}
	}
	return options, sourceTruncated, nil
}

type rejectingVoiceAssetResolver struct{}

func (rejectingVoiceAssetResolver) ResolveVoiceAsset(context.Context, string) (*resolvedVoiceAsset, error) {
	return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED)
}

func (rejectingVoiceAssetResolver) ListBindableVoiceAssets(context.Context, string, string, int) ([]string, bool, error) {
	return nil, false, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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
	currentProfile *runtimev1.AgentPresentationProfile,
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
	resolved, err := resolver.ResolveVoiceAsset(withRuntimeAgentVoiceAssetOwner(ctx, identity.OwnerUserID), voiceAssetID)
	if err != nil {
		return err
	}
	if resolved == nil || resolved.Asset == nil || resolved.Target == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	asset := resolved.Asset
	unchangedCommittedReference := currentProfile != nil &&
		strings.TrimSpace(currentProfile.GetDefaultVoiceReference()) == voiceReference
	if strings.TrimSpace(asset.GetVoiceAssetId()) != voiceAssetID {
		return invalidProfileVoiceAssetBinding()
	}
	if !unchangedCommittedReference && strings.TrimSpace(asset.GetAppId()) != appID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if strings.TrimSpace(asset.GetSubjectUserId()) != identity.OwnerUserID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	assetOwnerAppID := appID
	if unchangedCommittedReference {
		assetOwnerAppID = strings.TrimSpace(asset.GetAppId())
	}
	if !voiceAssetBindableForOwner(resolved, voiceAssetID, assetOwnerAppID, identity.OwnerUserID) {
		return invalidProfileVoiceAssetBinding()
	}
	return nil
}

func voiceAssetBindableForOwner(
	resolved *resolvedVoiceAsset,
	voiceAssetID string,
	appID string,
	ownerUserID string,
) bool {
	if resolved == nil || resolved.Asset == nil || resolved.Target == nil {
		return false
	}
	asset := resolved.Asset
	return strings.TrimSpace(voiceAssetID) != "" && strings.TrimSpace(asset.GetVoiceAssetId()) == strings.TrimSpace(voiceAssetID) &&
		strings.TrimSpace(appID) != "" && strings.TrimSpace(asset.GetAppId()) == strings.TrimSpace(appID) &&
		strings.TrimSpace(ownerUserID) != "" && strings.TrimSpace(asset.GetSubjectUserId()) == strings.TrimSpace(ownerUserID) &&
		asset.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE &&
		asset.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT &&
		validProfileVoiceAssetCreationSource(asset.GetCreationSource()) &&
		strings.TrimSpace(asset.GetProvider()) != "" &&
		strings.TrimSpace(asset.GetProviderVoiceRef()) != "" &&
		!voiceAssetExpiryElapsed(asset, time.Now().UTC()) &&
		resolved.Target.Valid() &&
		voiceAssetProviderMatchesDurableTarget(asset.GetProvider(), resolved.Target)
}

func voiceAssetProviderMatchesDurableTarget(provider string, targetRef *runtimeidentity.Target) bool {
	if provider == "" || strings.TrimSpace(provider) != provider {
		return false
	}
	cloud := targetRef.GetCloud()
	return cloud == nil || provider == cloud.Provider
}

func validProfileVoiceAssetCreationSource(source runtimev1.VoiceCreationSource) bool {
	switch source {
	case runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO,
		runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION:
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

func resolveRuntimeAgentBoundVoiceAsset(
	ctx context.Context,
	resolver VoiceAssetResolver,
	ownerUserID string,
	voiceAssetID string,
) (*resolvedVoiceAsset, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	voiceAssetID = strings.TrimSpace(voiceAssetID)
	if ownerUserID == "" || voiceAssetID == "" || resolver == nil {
		return nil, invalidProfileVoiceAssetBinding()
	}
	resolved, err := resolver.ResolveVoiceAsset(
		withRuntimeAgentVoiceAssetOwner(ctx, ownerUserID),
		voiceAssetID,
	)
	if err != nil {
		return nil, err
	}
	if resolved == nil || resolved.Asset == nil || resolved.Target == nil {
		return nil, invalidProfileVoiceAssetBinding()
	}
	asset := resolved.Asset
	if strings.TrimSpace(asset.GetVoiceAssetId()) != voiceAssetID {
		return nil, invalidProfileVoiceAssetBinding()
	}
	if strings.TrimSpace(asset.GetAppId()) == "" || strings.TrimSpace(asset.GetSubjectUserId()) != ownerUserID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT ||
		!validProfileVoiceAssetCreationSource(asset.GetCreationSource()) ||
		strings.TrimSpace(asset.GetProvider()) == "" ||
		strings.TrimSpace(asset.GetProviderVoiceRef()) == "" ||
		voiceAssetExpiryElapsed(asset, time.Now().UTC()) ||
		!resolved.Target.Valid() ||
		!voiceAssetProviderMatchesDurableTarget(asset.GetProvider(), resolved.Target) {
		return nil, invalidProfileVoiceAssetBinding()
	}
	return resolved, nil
}

func resolveRuntimeAgentVoiceAssetExecutionApp(
	ctx context.Context,
	resolver VoiceAssetResolver,
	ownerUserID string,
	defaultVoiceReference string,
	speechTargetRef *runtimeidentity.Target,
) (string, error) {
	kind, voiceAssetID, ok := strings.Cut(strings.TrimSpace(defaultVoiceReference), ":")
	kind = strings.TrimSpace(kind)
	voiceAssetID = strings.TrimSpace(voiceAssetID)
	if !ok || kind == "" || voiceAssetID == "" {
		return "", invalidProfileVoiceAssetBinding()
	}
	if kind != "voice_asset_id" {
		return runtimeAgentVoiceSynthesisAppID, nil
	}
	resolved, err := resolveRuntimeAgentBoundVoiceAsset(ctx, resolver, ownerUserID, voiceAssetID)
	if err != nil {
		return "", err
	}
	appID := strings.TrimSpace(resolved.Asset.GetAppId())
	if speechTargetRef == nil || !runtimeidentity.Equal(speechTargetRef, resolved.Target) {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	return appID, nil
}
