package ai

import (
	"context"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

// ListLocalAppVoiceAssets returns the trimmed voice asset catalog owned by the
// calling App session owner. The App supplies page controls only; the owner
// scope (App id and account) is derived from the protected session, and the
// owner ListVoiceAssets surface enforces the exact owner match.
func (s *Service) ListLocalAppVoiceAssets(ctx context.Context, req *runtimev1.ListLocalAppVoiceAssetsRequest) (*runtimev1.ListLocalAppVoiceAssetsResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationVoiceAssetsList, localappop.AppOperationIDVoiceAssetsList)
	if err != nil {
		return nil, err
	}
	pageSize := int32(0)
	pageToken := ""
	if req != nil {
		pageSize = req.GetPageSize()
		pageToken = req.GetPageToken()
	}
	if pageSize < 0 || pageSize > maxListVoiceAssetsPageSize {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if pageToken != "" {
		if len(pageToken) > 10 || strings.TrimSpace(pageToken) != pageToken {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if _, err := strconv.Atoi(pageToken); err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	result, err := s.ListVoiceAssets(localAppOwnerCallContext(ctx, decision), &runtimev1.ListVoiceAssetsRequest{
		AppId:         decision.AppID,
		SubjectUserId: decision.AccountID,
		PageSize:      pageSize,
		PageToken:     pageToken,
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	assets := make([]*runtimev1.LocalAppVoiceAsset, 0, len(result.GetAssets()))
	for _, asset := range result.GetAssets() {
		projected, err := projectLocalAppVoiceAsset(asset)
		if err != nil {
			return nil, err
		}
		assets = append(assets, projected)
	}
	nextToken := result.GetNextPageToken()
	if nextToken != "" {
		if _, err := strconv.Atoi(nextToken); err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	return &runtimev1.ListLocalAppVoiceAssetsResponse{
		Assets:        assets,
		NextPageToken: nextToken,
	}, nil
}
