package audit

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-observation-access
func (s *Service) desktopAIAccount(ctx context.Context) (string, error) {
	principal, ok := protectedprincipal.FromContext(ctx)
	if !ok {
		return "", grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if !principal.IsDesktopAccountProduct() {
		return "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if s.aiObservation == nil {
		return "", status.Error(codes.Unavailable, "AI observation owner is unavailable")
	}
	return principal.AccountID, nil
}

func validateDesktopAIActivityLimit(limit int32) error {
	if limit < 0 || limit > 100 {
		return status.Error(codes.InvalidArgument, "AI activity limit must be between zero and one hundred")
	}
	return nil
}

func (s *Service) GetDesktopAIActivitySnapshot(ctx context.Context, req *runtimev1.GetDesktopAIActivitySnapshotRequest) (*runtimev1.GetDesktopAIActivitySnapshotResponse, error) {
	accountID, err := s.desktopAIAccount(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateDesktopAIActivityLimit(req.GetLimit()); err != nil {
		return nil, err
	}
	return &runtimev1.GetDesktopAIActivitySnapshotResponse{Snapshot: s.aiObservation.Snapshot(accountID, int(req.GetLimit()))}, nil
}

func (s *Service) SubscribeDesktopAIActivity(req *runtimev1.SubscribeDesktopAIActivityRequest, stream grpc.ServerStreamingServer[runtimev1.DesktopAIActivitySnapshot]) error {
	ctx := stream.Context()
	accountID, err := s.desktopAIAccount(ctx)
	if err != nil {
		return err
	}
	if err := validateDesktopAIActivityLimit(req.GetLimit()); err != nil {
		return err
	}
	updates, cancel, err := s.aiObservation.Subscribe()
	if err != nil {
		return status.Error(codes.ResourceExhausted, "AI activity subscription is unavailable")
	}
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return status.FromContextError(ctx.Err()).Err()
		case _, ok := <-updates:
			if !ok {
				return status.Error(codes.Unavailable, "AI activity owner closed")
			}
			if _, err := s.desktopAIAccount(ctx); err != nil {
				return err
			}
			snapshot := s.aiObservation.Snapshot(accountID, int(req.GetLimit()))
			if err := ctx.Err(); err != nil {
				return status.FromContextError(err).Err()
			}
			if err := stream.Send(snapshot); err != nil {
				return err
			}
		}
	}
}

func (s *Service) GetDesktopAIUsageSummary(ctx context.Context, req *runtimev1.GetDesktopAIUsageSummaryRequest) (*runtimev1.GetDesktopAIUsageSummaryResponse, error) {
	accountID, err := s.desktopAIAccount(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetFromTime() == nil || req.GetToTime() == nil || req.GetFromTime().CheckValid() != nil || req.GetToTime().CheckValid() != nil {
		return nil, status.Error(codes.InvalidArgument, "AI usage requires valid from_time and to_time")
	}
	from, to := req.GetFromTime().AsTime(), req.GetToTime().AsTime()
	if !from.Before(to) || to.Sub(from) > aitelemetry.Retention {
		return nil, status.Error(codes.InvalidArgument, "AI usage interval must be ordered and at most seven days")
	}
	if len(req.GetConnectorRef()) > 512 || strings.TrimSpace(req.GetConnectorRef()) != req.GetConnectorRef() {
		return nil, status.Error(codes.InvalidArgument, "invalid connection filter")
	}
	var summary *runtimev1.DesktopAIUsageSummary
	if req.GetConnectorRef() == "" {
		summary, err = s.aiObservation.Summary(ctx, accountID, from, to)
	} else {
		summary, err = s.aiObservation.ConnectorSummary(ctx, accountID, req.GetConnectorRef(), from, to)
	}
	if err != nil {
		return nil, status.Error(codes.Unavailable, "AI accounting is unavailable")
	}
	if _, err := s.desktopAIAccount(ctx); err != nil {
		return nil, err
	}
	return &runtimev1.GetDesktopAIUsageSummaryResponse{Summary: summary}, nil
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-cloud-connection-observation
func (s *Service) ListDesktopAICloudHistory(ctx context.Context, req *runtimev1.ListDesktopAICloudHistoryRequest) (*runtimev1.ListDesktopAICloudHistoryResponse, error) {
	accountID, err := s.desktopAIAccount(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetFromTime() == nil || req.GetToTime() == nil || req.GetFromTime().CheckValid() != nil || req.GetToTime().CheckValid() != nil || req.GetPageSize() < 0 || req.GetPageSize() > 100 || len(req.GetConnectorRef()) > 512 || strings.TrimSpace(req.GetConnectorRef()) != req.GetConnectorRef() {
		return nil, status.Error(codes.InvalidArgument, "invalid bounded cloud history query")
	}
	from, to := req.GetFromTime().AsTime(), req.GetToTime().AsTime()
	if !from.Before(to) || to.Sub(from) > aitelemetry.Retention {
		return nil, status.Error(codes.InvalidArgument, "cloud history requires at most seven days")
	}
	result, err := s.aiObservation.CloudHistory(ctx, accountID, req.GetConnectorRef(), from, to, int(req.GetPageSize()), req.GetPageToken())
	if errors.Is(err, aitelemetry.ErrCloudHistoryCursor) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	if err != nil {
		return nil, status.Error(codes.Unavailable, "cloud history unavailable")
	}
	if _, err := s.desktopAIAccount(ctx); err != nil {
		return nil, err
	}
	return result, nil
}
