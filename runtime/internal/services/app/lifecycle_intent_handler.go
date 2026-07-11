package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type runtimeAccountSecurityContextProvider interface {
	AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
}

func (s *Service) PrepareAppLifecycleIntent(ctx context.Context, req *runtimev1.PrepareAppLifecycleIntentRequest) (*runtimev1.PrepareAppLifecycleIntentResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	action, ok := protectedLifecycleAction(req.GetAction())
	appID := strings.TrimSpace(req.GetAppId())
	if !ok || appID == "" || appID != req.GetAppId() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if options := req.GetDestructiveOptions(); options != nil && options.GetTargetJobId() != strings.TrimSpace(options.GetTargetJobId()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.lifecycleIntents == nil {
		return nil, protectedLifecycleUnavailable()
	}
	_, accountGeneration, ok := s.authenticatedLifecycleAccount(ctx)
	if !ok {
		return nil, lifecycleTargetMismatch("refresh_account")
	}
	target, err := s.resolveLifecycleIntentTarget(req, action, appID)
	if err != nil {
		return nil, err
	}
	destructive := lifecycleDestructiveOptions(target.destructiveOptions)
	impact := &runtimev1.AppLifecycleCanonicalImpact{
		SchemaVersion:          lifecycleCanonicalImpactSchemaVersion,
		Action:                 req.GetAction(),
		AppId:                  appID,
		AccountGeneration:      accountGeneration,
		ReleaseRef:             target.releaseRef,
		ArtifactDigest:         target.artifactDigestText,
		AdoptionGeneration:     target.adoptionGeneration,
		DestructiveOptions:     target.destructiveOptions,
		ImpactFlags:            []string{},
		DisplayContractVersion: lifecycleDisplayContractVersion,
	}
	canonical, err := canonicalLifecycleImpactJSON(impact)
	if err != nil {
		return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
	}
	displayedDigest := sha256.Sum256([]byte(canonical))
	prepared, err := s.lifecycleIntents.Prepare(ctx, protectedlocal.LifecycleChallengeInput{
		AccountGeneration:          accountGeneration,
		Action:                     action,
		AppID:                      appID,
		ReleaseRef:                 target.releaseRef,
		ArtifactDigest:             target.artifactDigest,
		DisplayedImpactDigest:      displayedDigest,
		ExpectedAdoptionGeneration: target.adoptionGeneration,
		DestructiveOptions:         destructive,
	})
	if err != nil {
		return nil, protectedLifecycleIntentError(err)
	}
	return &runtimev1.PrepareAppLifecycleIntentResponse{
		IntentId:              hex.EncodeToString(prepared.IntentID[:]),
		CanonicalImpact:       impact,
		CanonicalImpactDigest: hex.EncodeToString(displayedDigest[:]),
		Deadline:              timestamppb.New(prepared.Deadline),
		ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetAppLifecycleIntentStatus(ctx context.Context, req *runtimev1.GetAppLifecycleIntentStatusRequest) (*runtimev1.GetAppLifecycleIntentStatusResponse, error) {
	if req == nil || strings.TrimSpace(req.GetIntentId()) == "" || strings.TrimSpace(req.GetIntentId()) != req.GetIntentId() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.lifecycleIntents == nil {
		return nil, protectedLifecycleUnavailable()
	}
	_, accountGeneration, ok := s.authenticatedLifecycleAccount(ctx)
	if !ok {
		return nil, lifecycleTargetMismatch("refresh_account")
	}
	intentID, err := parseLifecycleIdentifier(req.GetIntentId())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	projection, err := s.lifecycleIntents.Status(ctx, protectedlocal.LifecycleIntentStatusQuery{
		IntentID:          intentID,
		AccountGeneration: accountGeneration,
	})
	if err != nil {
		return nil, protectedLifecycleIntentError(err)
	}
	statusValue, ok := runtimev1.AppLifecycleIntentStatus_value["APP_LIFECYCLE_INTENT_STATUS_"+string(projection.Status)]
	if !ok {
		return nil, protectedLifecycleUnavailable()
	}
	return &runtimev1.GetAppLifecycleIntentStatusResponse{
		IntentId:   hex.EncodeToString(projection.IntentID[:]),
		Status:     runtimev1.AppLifecycleIntentStatus(statusValue),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) authenticatedLifecycleAccount(ctx context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	if s == nil || s.accountSecurity == nil {
		return nil, 0, false
	}
	projection, generation, ok := s.accountSecurity.AuthenticatedRuntimeSecurityContext(ctx)
	if !ok || projection == nil || generation == 0 || strings.TrimSpace(projection.GetAccountId()) == "" || strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		return nil, generation, false
	}
	return projection, generation, true
}
