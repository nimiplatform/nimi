package ai

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maxListVoiceAssetsPageSize = 200
const maxVoiceAssetReconciliationSweep = 8

func (s *Service) GetVoiceAsset(ctx context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetVoiceAssetId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	asset, ok := s.voiceAssets.getAsset(req.GetVoiceAssetId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if err := authorizeVoiceAssetOwner(ctx, asset); err != nil {
		return nil, err
	}
	return &runtimev1.GetVoiceAssetResponse{Asset: asset}, nil
}

// ResolveRuntimeAgentVoiceAsset is the Runtime-private orchestration lookup
// used after an owner-scoped VoiceAsset has been committed as a LocalAgent
// presentation reference. It does not widen the public Get/List/Delete
// contract: only the in-process RuntimeAgent adapter calls it, and the
// LocalAgent owner must still match the VoiceAsset subject.
func (s *Service) ResolveRuntimeAgentVoiceAsset(
	_ context.Context,
	voiceAssetID string,
	ownerUserID string,
) (*runtimev1.VoiceAsset, *runtimeidentity.Target, error) {
	voiceAssetID = strings.TrimSpace(voiceAssetID)
	ownerUserID = strings.TrimSpace(ownerUserID)
	if voiceAssetID == "" || ownerUserID == "" {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.voiceAssets == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	asset, target, ok := s.voiceAssets.getAssetBinding(voiceAssetID)
	if !ok || asset == nil || target == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if strings.TrimSpace(asset.GetSubjectUserId()) != ownerUserID {
		return nil, nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	return asset, target, nil
}

func (s *Service) ListVoiceAssets(ctx context.Context, req *runtimev1.ListVoiceAssetsRequest) (*runtimev1.ListVoiceAssetsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAppId()) == "" || strings.TrimSpace(req.GetSubjectUserId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := authorizeVoiceAssetScope(ctx, req.GetAppId(), req.GetSubjectUserId()); err != nil {
		return nil, err
	}
	s.reconcilePendingVoiceAssetDeletes(ctx, req.GetAppId(), req.GetSubjectUserId(), maxVoiceAssetReconciliationSweep)
	items := s.voiceAssets.listAssets(req)
	sort.Slice(items, func(i, j int) bool {
		return strings.Compare(items[i].GetVoiceAssetId(), items[j].GetVoiceAssetId()) < 0
	})

	offset, err := parseVoiceAssetPageToken(req.GetPageToken())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err, grpcerr.ReasonOptions{
			Message: "voice asset page token is invalid",
		})
	}
	if offset > len(items) {
		offset = len(items)
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 || pageSize > maxListVoiceAssetsPageSize {
		pageSize = maxListVoiceAssetsPageSize
	}
	end := offset + pageSize
	if end > len(items) {
		end = len(items)
	}

	nextToken := ""
	if end < len(items) {
		nextToken = strconv.Itoa(end)
	}
	return &runtimev1.ListVoiceAssetsResponse{
		Assets:        items[offset:end],
		NextPageToken: nextToken,
	}, nil
}

func (s *Service) reconcilePendingVoiceAssetDeletes(ctx context.Context, appID string, subjectUserID string, limit int) {
	if s == nil || s.voiceAssets == nil || limit <= 0 {
		return
	}
	assets := s.voiceAssets.listPendingDeleteReconciliationAssets(appID, subjectUserID, time.Now().UTC(), limit)
	for _, asset := range assets {
		if asset == nil {
			continue
		}
		_, target, binding, _ := s.voiceAssets.getAssetCloudBinding(asset.GetVoiceAssetId())
		result := s.deleteProviderPersistentVoiceAsset(ctx, asset, target, binding)
		if !result.Attempted {
			continue
		}
		s.voiceAssets.updateDeletedAssetReconciliationResult(asset.GetVoiceAssetId(), result)
		s.recordVoiceAssetDeleteAudit(asset, "voice_asset.delete_reconcile_retry", result)
	}
}

func (s *Service) DeleteVoiceAsset(ctx context.Context, req *runtimev1.DeleteVoiceAssetRequest) (*runtimev1.DeleteVoiceAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetVoiceAssetId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	asset, ok := s.voiceAssets.getAsset(req.GetVoiceAssetId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if err := authorizeVoiceAssetOwner(ctx, asset); err != nil {
		return nil, err
	}
	_, target, binding, _ := s.voiceAssets.getAssetCloudBinding(req.GetVoiceAssetId())
	deleteResult := s.deleteProviderPersistentVoiceAsset(ctx, asset, target, binding)
	if deleteResult.Attempted && !deleteResult.Succeeded {
		s.voiceAssets.updateAssetDeleteResult(req.GetVoiceAssetId(), deleteResult)
		s.recordVoiceAssetDeleteAudit(asset, "voice_asset.delete_failed", deleteResult)
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if strings.TrimSpace(asset.GetProvider()) == "local" && strings.HasPrefix(strings.TrimSpace(asset.GetProviderVoiceRef()), capabilitydriver.AudioCppReferenceVoicePrefix) {
		if err := s.deleteAudioCppReferenceVoice(asset.GetProviderVoiceRef()); err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
		}
	}
	if ok := s.voiceAssets.deleteAssetWithResult(req.GetVoiceAssetId(), deleteResult); !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	s.recordVoiceAssetDeleteAudit(asset, "voice_asset.delete", deleteResult)
	return &runtimev1.DeleteVoiceAssetResponse{
		Ack: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}, nil
}

func authorizeVoiceAssetOwner(ctx context.Context, asset *runtimev1.VoiceAsset) error {
	if asset == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	return authorizeVoiceAssetScope(ctx, asset.GetAppId(), asset.GetSubjectUserId())
}

func authorizeVoiceAssetScope(ctx context.Context, appID string, subjectUserID string) error {
	callerAppID := voiceAssetCallerAppID(ctx)
	identity := authn.IdentityFromContext(ctx)
	callerSubjectID := ""
	if identity != nil {
		callerSubjectID = strings.TrimSpace(identity.SubjectUserID)
	}
	if callerAppID == "" || callerSubjectID == "" {
		if callerAppID != "" && strings.TrimSpace(subjectUserID) == anonymousScenarioJobOwner {
			if callerAppID != strings.TrimSpace(appID) {
				return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
			}
			return nil
		}
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if callerAppID != strings.TrimSpace(appID) || callerSubjectID != strings.TrimSpace(subjectUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	return nil
}

func voiceAssetCallerAppID(ctx context.Context) string {
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if values := md.Get("x-nimi-app-id"); len(values) > 0 {
			return strings.TrimSpace(values[0])
		}
	}
	return ""
}

func (s *Service) recordVoiceAssetDeleteAudit(asset *runtimev1.VoiceAsset, operation string, result voiceAssetDeleteResult) {
	if s == nil || s.audit == nil || asset == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"voice_asset_id":                           strings.TrimSpace(asset.GetVoiceAssetId()),
		"provider":                                 strings.TrimSpace(asset.GetProvider()),
		"delete_semantics":                         strings.TrimSpace(result.DeleteSemantics),
		"provider_delete_attempted":                result.Attempted,
		"provider_delete_succeeded":                result.Succeeded,
		"provider_delete_reconciliation_pending":   result.PendingReconciliation,
		"provider_delete_reconciliation_exhausted": result.Exhausted,
		"provider_delete_retry_attempt_count":      result.RetryAttemptCount,
	})
	if !result.LastAttemptAt.IsZero() {
		payload.Fields["provider_delete_last_attempt_at"], _ = structpb.NewValue(result.LastAttemptAt.UTC().Format(time.RFC3339Nano))
	}
	if !result.NextRetryAfter.IsZero() {
		payload.Fields["provider_delete_next_retry_at"], _ = structpb.NewValue(result.NextRetryAfter.UTC().Format(time.RFC3339Nano))
	}
	if strings.TrimSpace(result.LastError) != "" {
		payload.Fields["provider_delete_last_error"], _ = structpb.NewValue(strings.TrimSpace(result.LastError))
	}
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(asset.GetAppId()),
		SubjectUserId: strings.TrimSpace(asset.GetSubjectUserId()),
		Domain:        "runtime.ai",
		Operation:     strings.TrimSpace(operation),
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}

func (s *Service) deleteProviderPersistentVoiceAsset(ctx context.Context, asset *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding) voiceAssetDeleteResult {
	result := voiceAssetDeleteResult{}
	if asset != nil && asset.GetMetadata() != nil {
		result.DeleteSemantics = strings.TrimSpace(asset.GetMetadata().GetFields()["voice_handle_policy_delete_semantics"].GetStringValue())
		if asset.GetMetadata().GetFields()["voice_handle_policy_runtime_reconciliation_required"].GetBoolValue() {
			result.ReconciliationRequired = true
		}
	}
	if s == nil || asset == nil {
		return result
	}
	if asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT {
		if result.DeleteSemantics == "" {
			result.DeleteSemantics = "runtime_authoritative_delete"
		}
		return result
	}
	assetProvider := strings.TrimSpace(asset.GetProvider())
	providerVoiceRef := strings.TrimSpace(asset.GetProviderVoiceRef())
	if providerVoiceRef == "" {
		if result.DeleteSemantics == "" {
			result.DeleteSemantics = "best_effort_provider_delete"
		}
		return result
	}
	if result.DeleteSemantics == "" {
		result.DeleteSemantics = "best_effort_provider_delete"
	}
	if target == nil || target.Cloud == nil || !target.Cloud.Valid() || assetProvider != target.Cloud.Provider {
		result.Attempted = true
		result.RetryAttemptCount = nextVoiceAssetDeleteRetryAttempt(asset)
		result.LastAttemptAt = time.Now().UTC()
		return voiceAssetDeleteFailure(result, fmt.Errorf("voice asset private cloud target is unavailable or inconsistent"))
	}
	provider := target.Cloud.Provider
	if !capabilitydriver.CloudVoiceDeleteSupported(provider) {
		return result
	}
	result.RetryAttemptCount = nextVoiceAssetDeleteRetryAttempt(asset)
	result.Attempted = true
	result.LastAttemptAt = time.Now().UTC()
	fail := func(err error) voiceAssetDeleteResult { return voiceAssetDeleteFailure(result, err) }
	if binding == nil || !binding.Valid() || s.cloudMediaDrivers == nil || s.connStore == nil || s.remoteMediaHost == nil {
		return fail(fmt.Errorf("voice asset AIConfig execution binding is unavailable"))
	}
	privateIntent := executionintent.Intent{
		CapabilityContract:  binding.CapabilityContract,
		Route:               runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorRef:        binding.ConnectorID,
		CloudImplementation: binding.Implementation,
		ProviderModelTarget: binding.ProviderModelTarget,
	}
	if !privateIntent.IsAIConfigCloud() || binding.ConnectorID != target.Cloud.ConnectorID {
		return fail(fmt.Errorf("voice asset AIConfig execution binding is invalid"))
	}
	driver, driverTarget, err := s.cloudMediaDrivers.Resolve(
		capabilitydriver.IdentityFromProto(privateIntent.CloudImplementation), privateIntent.ProviderModelTarget, privateIntent.CapabilityContract,
	)
	if err != nil {
		return fail(cloudMediaDriverError(privateIntent.CapabilityContract, err))
	}
	if driverTarget.Provider() != target.Cloud.Provider || driverTarget.ProviderModelID() != target.Cloud.ProviderModelID ||
		driverTarget.RemoteModelCatalogID() != target.Cloud.RemoteModelCatalogID {
		return fail(fmt.Errorf("voice asset Driver target does not match its captured execution target"))
	}
	connectorRecord, found, err := s.connStore.Get(binding.ConnectorID)
	if err != nil {
		return fail(err)
	}
	if !found || connectorRecord.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		connectorRecord.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER ||
		strings.TrimSpace(connectorRecord.OwnerID) != strings.TrimSpace(asset.GetSubjectUserId()) ||
		connectorRecord.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE ||
		!connectorRecord.HasCredential || strings.TrimSpace(connectorRecord.Provider) != driverTarget.Provider() {
		return fail(fmt.Errorf("voice asset connector provider no longer matches its private target"))
	}
	mapped, err := driver.MapVoiceDeleteRequest(driverTarget, providerVoiceRef)
	if err != nil {
		return fail(cloudMediaDriverError(privateIntent.CapabilityContract, err))
	}
	traceID := ulid.Make().String()
	dispatchAudit := remoteexecution.MediaDispatchAudit{
		AppID: asset.GetAppId(), AccountID: asset.GetSubjectUserId(), TraceID: traceID,
		CapabilityContract: "voice_asset.delete",
		ImplementationID:   privateIntent.CloudImplementation.GetImplementationId(),
		DriverID:           privateIntent.CloudImplementation.GetDriverId(), DriverDialect: privateIntent.CloudImplementation.GetDriverDialect(),
		ConnectorID: connectorRecord.ConnectorID, Provider: driverTarget.Provider(), ProviderModelID: driverTarget.ProviderModelID(),
		RemoteModelCatalogID: driverTarget.RemoteModelCatalogID(), Region: driverTarget.Region(),
	}
	if err := s.auditCloudVoiceDeleteCapture(asset, privateIntent, connectorRecord, driverTarget, mapped, traceID); err != nil {
		return fail(err)
	}
	if err := s.remoteMediaHost.DeleteVoiceAsset(ctx, connectorRecord, driverTarget, mapped, dispatchAudit); err != nil {
		normalized := driver.NormalizeVoiceDeleteReason(driverTarget, err)
		result = fail(normalized)
		if s.logger != nil {
			s.logger.Warn("provider voice delete failed; local asset delete continues",
				"provider", provider,
				"voice_asset_id", strings.TrimSpace(asset.GetVoiceAssetId()),
				"error", normalized,
			)
		}
		return result
	}
	result.Succeeded = true
	result.PendingReconciliation = false
	result.Exhausted = false
	return result
}

func voiceAssetDeleteFailure(result voiceAssetDeleteResult, err error) voiceAssetDeleteResult {
	result.Succeeded = false
	if result.ReconciliationRequired || result.DeleteSemantics == "best_effort_provider_delete" {
		result.PendingReconciliation = true
	}
	if result.RetryAttemptCount >= maxVoiceAssetDeleteRetryAttempts {
		result.PendingReconciliation = false
		result.Exhausted = true
	} else if result.PendingReconciliation {
		result.NextRetryAfter = nextVoiceAssetDeleteRetryAt(result.LastAttemptAt, result.RetryAttemptCount)
	}
	result.LastError = summarizeVoiceDeleteError(err)
	return result
}

func (s *Service) auditCloudVoiceDeleteCapture(
	asset *runtimev1.VoiceAsset,
	intent executionintent.Intent,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudMediaTarget,
	mapped *capabilitydriver.CloudVoiceDeleteMappedRequest,
	traceID string,
) error {
	if s == nil || s.audit == nil || asset == nil || mapped == nil {
		return nil
	}
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route": "cloud", "capability_contract": "voice_asset.delete",
		"ai_config_source_capability_contract": intent.CapabilityContract,
		"implementation_id":                    intent.CloudImplementation.GetImplementationId(), "driver_id": intent.CloudImplementation.GetDriverId(),
		"driver_dialect": intent.CloudImplementation.GetDriverDialect(), "provider_model_target": intent.ProviderModelTarget.AsMap(),
		"connector_id": connectorRecord.ConnectorID, "provider": target.Provider(), "provider_model_id": target.ProviderModelID(),
		"remote_model_catalog_id": target.RemoteModelCatalogID(), "provider_region": target.Region(), "transport_adapter": mapped.Adapter(),
		"voice_asset_id": strings.TrimSpace(asset.GetVoiceAssetId()), "remote_execution_host": remoteexecution.ProviderHTTPMediaHostID,
		"remote_dispatch_state": "captured", "provider_voice_ref": "private", "secret_material": "absent",
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	if err := s.audit.AppendEventChecked(&runtimev1.AuditEventRecord{
		AppId: asset.GetAppId(), SubjectUserId: asset.GetSubjectUserId(), Domain: "runtime.ai",
		Operation: "cloud.voice_asset.delete.composition.capture", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId: traceID, Timestamp: timestamppb.New(time.Now().UTC()), Payload: payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud voice delete composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func nextVoiceAssetDeleteRetryAttempt(asset *runtimev1.VoiceAsset) int {
	if asset == nil || asset.GetMetadata() == nil {
		return 1
	}
	previous := int(asset.GetMetadata().GetFields()["provider_delete_retry_attempt_count"].GetNumberValue())
	if previous < 0 {
		previous = 0
	}
	return previous + 1
}

func nextVoiceAssetDeleteRetryAt(lastAttempt time.Time, attempt int) time.Time {
	if lastAttempt.IsZero() {
		lastAttempt = time.Now().UTC()
	}
	if attempt < 1 {
		attempt = 1
	}
	backoff := voiceAssetDeleteRetryCooldown
	for i := 1; i < attempt; i++ {
		backoff *= 2
		if backoff > 5*time.Minute {
			backoff = 5 * time.Minute
			break
		}
	}
	return lastAttempt.UTC().Add(backoff)
}

func summarizeVoiceDeleteError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return ""
	}
	const maxLen = 240
	if len(message) > maxLen {
		return fmt.Sprintf("%s...", message[:maxLen])
	}
	return message
}

func (s *Service) ListPresetVoices(ctx context.Context, req *runtimev1.ListPresetVoicesRequest) (*runtimev1.ListPresetVoicesResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if appID == "" || subjectUserID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	head := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: subjectUserID}
	caller, err := scenarioAppAIConfigCaller(ctx, head)
	if err != nil {
		return nil, err
	}
	if caller.accountNamespace != subjectUserID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	capturedCtx, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.AudioSynthesizeContract)
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return s.listSelectedLocalPresetVoices(capturedCtx, appID, subjectUserID)
	}
	if !intent.IsAIConfigCloud() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return s.listCommittedCloudPresetVoices(capturedCtx, head)
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r046
func (s *Service) listCommittedCloudPresetVoices(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (*runtimev1.ListPresetVoicesResponse, error) {
	composition, err := s.resolveCloudMediaRouteComposition(ctx, head, capabilitydriver.AudioSynthesizeContract)
	if err != nil {
		return nil, err
	}
	modelResolved := composition.target.ProviderModelID()
	providerType := composition.target.Provider()
	voices, source, catalogVersion, err := resolveCatalogVoicesForSubject(ctx, modelResolved, providerType, s.speechCatalog)
	if err != nil {
		return nil, err
	}
	if catalogVersion == "" {
		catalogVersion = "n/a"
	}
	_ = grpc.SetHeader(ctx, metadata.Pairs(
		"x-nimi-voice-catalog-source", string(source),
		"x-nimi-voice-catalog-version", catalogVersion,
		"x-nimi-voice-count", strconv.Itoa(len(voices)),
	))

	if s.logger != nil {
		s.logger.Debug(
			"voice-list-resolved",
			"source", string(source),
			"catalog_source", string(source),
			"catalog_version", catalogVersion,
			"voice_count", len(voices),
			"model_resolved", strings.TrimSpace(modelResolved),
			"provider_type", providerType,
			"connector_id", composition.connector.ConnectorID,
		)
	}

	return &runtimev1.ListPresetVoicesResponse{
		Voices:        voices,
		ModelResolved: modelResolved,
		TraceId:       ulid.Make().String(),
	}, nil
}

func (s *Service) listSelectedLocalPresetVoices(
	ctx context.Context,
	appID string,
	subjectUserID string,
) (*runtimev1.ListPresetVoicesResponse, error) {
	selected, ok := localexecution.SelectedLocalExecutionFromContext(ctx, capabilitydriver.AudioSynthesizeContract)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if !validSelectedSpeechExecution(selected, capabilitydriver.AudioSynthesizeContract) || len(selected.ExactBindings) != 1 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(
		capabilitydriver.AudioSynthesizeContract,
		capabilitydriver.IdentityFromProto(selected.DriverIdentity),
	)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	speechDriver, ok := driver.(capabilitydriver.SpeechPresetVoiceDriver)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     binding.RequirementID,
			ModelAssetID:      binding.ModelAssetID,
			AbsolutePath:      binding.AbsolutePath,
			BundleDir:         binding.BundleDir,
			DeclaredFiles:     append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: binding.VerifiedContentID,
			EntrySHA256:       binding.EntrySHA256,
		})
	}
	voices, err := speechDriver.ListPresetVoices(bindings)
	if err != nil {
		return nil, localSpeechInvocationError(err)
	}
	projected := make([]*runtimev1.VoicePresetDescriptor, 0, len(voices))
	for _, voice := range voices {
		projected = append(projected, &runtimev1.VoicePresetDescriptor{
			VoiceId:        voice.VoiceID,
			Name:           voice.Name,
			SupportedLangs: append([]string(nil), voice.SupportedLangs...),
			Labels: map[string]string{
				"route":      "local",
				"loadout_id": selected.LoadoutID,
			},
			Category: "local-preset",
		})
	}
	modelResolved := selected.ExactBindings[0].ModelAssetID
	_ = grpc.SetHeader(ctx, metadata.Pairs(
		"x-nimi-voice-catalog-source", "selected_local_loadout",
		"x-nimi-voice-count", strconv.Itoa(len(projected)),
		"x-nimi-app-id", appID,
		"x-nimi-subject-user-id", subjectUserID,
	))
	return &runtimev1.ListPresetVoicesResponse{
		Voices:        projected,
		ModelResolved: modelResolved,
		TraceId:       ulid.Make().String(),
	}, nil
}

func parseVoiceAssetPageToken(token string) (int, error) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(trimmed)
	if err != nil || offset < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return offset, nil
}
