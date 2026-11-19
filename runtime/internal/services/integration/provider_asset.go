package integration

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

const (
	assetToProvider = "to-provider"
	assetToConsumer = "to-consumer"
)

// @nimi-authority: rule.nimi.runtime.integration.app-provider-asset-transfer
func validateAssetEndpoint(mode string, endpoint *runtimev1.IntegrationAssetEndpoint, consumer bool) error {
	if mode == "" && endpoint == nil {
		return nil
	}
	if mode != assetToProvider && mode != assetToConsumer || endpoint == nil {
		return failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
	}
	path, err := appstorage.NormalizeAssetRelativePath(endpoint.RelativePath)
	if err != nil || path != endpoint.RelativePath {
		return failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
	}
	sending := (mode == assetToProvider) == consumer
	info := endpoint.Source
	if !sending && info == nil {
		return nil
	}
	if !sending || info == nil || info.SizeBytes == 0 || info.SizeBytes > maxMediaBytes ||
		strings.TrimSpace(info.MediaType) != info.MediaType || info.MediaType == "" || len(info.MediaType) > 255 {
		return failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
	}
	digest, ok := strings.CutPrefix(info.Sha256, "sha256:")
	if !ok || len(digest) != 64 || strings.ToLower(digest) != digest {
		return failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return failure(codes.InvalidArgument, "INTEGRATION_MEDIA_INVALID")
	}
	return nil
}

var errAssetCompletionEnded = errors.New("provider completion is no longer current")

// A provider can only send from or receive into its own partition. The peer's
// relative path comes from that peer's authenticated request, never from the sender.
func (s *Service) completeAsset(providerCtx context.Context, c *invocation, provider accountservice.LocalAppCallerDecision,
	consumerAsset, providerAsset *runtimev1.IntegrationAssetEndpoint, result string, record *operationAudit) (*runtimev1.CompleteIntegrationProviderResponse, error) {
	s.mu.Lock()
	if c.preparingAsset || c.fact.Status != "accepted" || c.ctx.Err() != nil {
		s.mu.Unlock()
		return record.notAccepted(), nil
	}
	c.preparingAsset = true
	s.mu.Unlock()

	consumerOwner := appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}
	providerOwner := appstorage.ManagedOwner{AccountID: provider.AccountID, RegisteredAppSubject: provider.RegisteredAppSubject}
	sender, receiver := consumerOwner, providerOwner
	source, destination := consumerAsset, providerAsset
	if c.op.GetAssetTransfer() == assetToConsumer {
		sender, receiver = providerOwner, consumerOwner
		source, destination = providerAsset, consumerAsset
	}
	ctx, cancel := context.WithCancel(c.ctx)
	unwatch := context.AfterFunc(providerCtx, cancel)
	defer func() { unwatch(); cancel() }()
	var accepted bool
	err := s.copyProviderAsset(ctx, sender, receiver, source, destination.RelativePath,
		func(_ appstorage.AssetRecord, publish func() error) error {
			var publicationError error
			published := false
			accepted = s.finishProviderGuarded(providerCtx, c, provider, "completed", result, "", record, func() error {
				publicationError = publish()
				published = publicationError == nil
				return publicationError
			})
			if publicationError != nil {
				return publicationError
			}
			if !published {
				return errAssetCompletionEnded
			}
			if !accepted {
				return adapterError("INTEGRATION_RESULT_RECORD_UNAVAILABLE")
			}
			return nil
		})
	if errors.Is(err, errAssetCompletionEnded) {
		return record.notAccepted(), nil
	}
	if err != nil {
		// The consumer must not see the provider's success JSON if its attachment did not commit.
		reason := "INTEGRATION_MEDIA_UNAVAILABLE"
		var ownerError adapterError
		if errors.As(err, &ownerError) {
			reason = string(ownerError)
		}
		s.finishProvider(providerCtx, c, provider, "failed", "", reason, record)
		return nil, failure(codes.FailedPrecondition, reason)
	}
	return record.completion(accepted), nil
}

func (s *Service) copyProviderAsset(ctx context.Context, sender, receiver appstorage.ManagedOwner,
	source *runtimev1.IntegrationAssetEndpoint, destination string, guard appstorage.AssetCommitGuard) error {
	if s.assets == nil {
		return adapterError("INTEGRATION_MEDIA_UNAVAILABLE")
	}
	owned, err := s.assets.OpenOwnedIntegrationAsset(ctx, sender, source.RelativePath)
	if err != nil {
		return adapterError("INTEGRATION_MEDIA_UNAVAILABLE")
	}
	info := source.Source
	if owned.Record.SizeBytes != int64(info.SizeBytes) || owned.Record.MediaType != info.MediaType || owned.Record.SHA256 != info.Sha256 {
		_ = owned.Body.Close()
		return adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	_, err = s.assets.AdoptOwnedIntegrationMedia(ctx, receiver, destination, appstorage.VerifiedAssetInput{
		MediaType: info.MediaType, SizeBytes: int64(info.SizeBytes), SHA256: info.Sha256, Body: owned.Body,
	}, guard)
	return err
}
