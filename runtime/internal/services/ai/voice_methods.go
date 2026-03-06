package ai

import (
	"context"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const maxListVoiceAssetsPageSize = 200

func (s *Service) GetVoiceAsset(_ context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetVoiceAssetId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	asset, ok := s.voiceAssets.getAsset(req.GetVoiceAssetId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	return &runtimev1.GetVoiceAssetResponse{Asset: asset}, nil
}

func (s *Service) ListVoiceAssets(_ context.Context, req *runtimev1.ListVoiceAssetsRequest) (*runtimev1.ListVoiceAssetsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAppId()) == "" || strings.TrimSpace(req.GetSubjectUserId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	items := s.voiceAssets.listAssets(req)
	sort.Slice(items, func(i, j int) bool {
		return strings.Compare(items[i].GetVoiceAssetId(), items[j].GetVoiceAssetId()) < 0
	})

	offset, err := parseVoiceAssetPageToken(req.GetPageToken())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
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

func (s *Service) DeleteVoiceAsset(_ context.Context, req *runtimev1.DeleteVoiceAssetRequest) (*runtimev1.DeleteVoiceAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetVoiceAssetId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if ok := s.voiceAssets.deleteAsset(req.GetVoiceAssetId()); !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	return &runtimev1.DeleteVoiceAssetResponse{
		Ack: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}, nil
}

func (s *Service) ListPresetVoices(ctx context.Context, req *runtimev1.ListPresetVoicesRequest) (*runtimev1.ListPresetVoicesResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	modelID := strings.TrimSpace(req.GetModelId())
	targetModelID := strings.TrimSpace(req.GetTargetModelId())
	if appID == "" || subjectUserID == "" || (modelID == "" && targetModelID == "") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	effectiveModelID := modelID
	if targetModelID != "" {
		effectiveModelID = targetModelID
	}

	parsed := parseKeySource(ctx, req.GetConnectorId())
	if err := validateKeySource(parsed, appID); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(ctx, parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	routePolicy := inferVoiceListRoutePolicy(effectiveModelID, remoteTarget)
	if err := s.validateLocalModelRequest(ctx, effectiveModelID, remoteTarget); err != nil {
		return nil, err
	}

	selectedProvider, _, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		ctx,
		routePolicy,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		effectiveModelID,
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(appID, subjectUserID, effectiveModelID, modelResolved, routeInfo)

	providerType := ""
	if remoteTarget != nil {
		providerType = strings.TrimSpace(remoteTarget.ProviderType)
	}
	_ = selectedProvider
	voices, source, catalogVersion, err := resolveSpeechVoicesForModelWithProviderType(modelResolved, providerType, s.speechCatalog)
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
			"connector_id", strings.TrimSpace(req.GetConnectorId()),
		)
	}

	return &runtimev1.ListPresetVoicesResponse{
		Voices:        voices,
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

func inferVoiceListRoutePolicy(modelID string, remoteTarget *nimillm.RemoteTarget) runtimev1.RoutePolicy {
	if remoteTarget != nil {
		return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
	}
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	if normalized == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
	}
	switch {
	case strings.HasPrefix(normalized, "local/"),
		strings.HasPrefix(normalized, "localai/"),
		strings.HasPrefix(normalized, "nexa/"):
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
	default:
		if strings.Contains(normalized, "/") {
			return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
		}
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
	}
}
