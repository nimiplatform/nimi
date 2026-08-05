package connector

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateConnectorGrant records an explicit account choice. Validation is
// deterministic Runtime state only; this RPC never invokes TestConnector or a
// provider endpoint.
func (s *Service) CreateConnectorGrant(ctx context.Context, req *runtimev1.CreateConnectorGrantRequest) (*runtimev1.CreateConnectorGrantResponse, error) {
	if req == nil || strings.TrimSpace(req.GetConnectorId()) == "" || req.GetConnectorId() != strings.TrimSpace(req.GetConnectorId()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	accountID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	grant, err := s.store.CreateGrant(accountID, req.GetConnectorId())
	if err != nil {
		if errors.Is(err, ErrConnectorGrantSelectionRequired) {
			return nil, connectorGrantSelectionRequiredError(err)
		}
		return nil, s.internalProviderError("create_connector_grant.persist", err)
	}
	s.emitAudit(ctx, "connector_grant.create", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"connector_grant_id": grant.GrantID,
		"connector_id":       grant.ConnectorID,
	})
	return &runtimev1.CreateConnectorGrantResponse{Grant: connectorGrantRecordToProto(grant)}, nil
}

func (s *Service) ListConnectorGrants(ctx context.Context, req *runtimev1.ListConnectorGrantsRequest) (*runtimev1.ListConnectorGrantsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	accountID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	filterDigest := pagination.FilterDigest(accountID, "connector-grants")
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	grants, err := s.store.ListGrants(accountID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_grants.load", err)
	}
	sort.Slice(grants, func(i, j int) bool {
		if grants[i].CreatedAt != grants[j].CreatedAt {
			return grants[i].CreatedAt > grants[j].CreatedAt
		}
		return grants[i].GrantID < grants[j].GrantID
	})
	start := 0
	if cursor != "" {
		parsed, parseErr := strconv.Atoi(cursor)
		if parseErr != nil || parsed < 0 || parsed > len(grants) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
		start = parsed
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	} else if pageSize > 200 {
		pageSize = 200
	}
	end := start + pageSize
	if end > len(grants) {
		end = len(grants)
	}
	items := make([]*runtimev1.ConnectorGrant, 0, end-start)
	for _, grant := range grants[start:end] {
		items = append(items, connectorGrantRecordToProto(grant))
	}
	next := ""
	if end < len(grants) {
		next = pagination.Encode(strconv.Itoa(end), filterDigest)
	}
	return &runtimev1.ListConnectorGrantsResponse{Grants: items, NextPageToken: next}, nil
}

func (s *Service) RevokeConnectorGrant(ctx context.Context, req *runtimev1.RevokeConnectorGrantRequest) (*runtimev1.RevokeConnectorGrantResponse, error) {
	if req == nil || strings.TrimSpace(req.GetGrantId()) == "" || req.GetGrantId() != strings.TrimSpace(req.GetGrantId()) {
		return nil, connectorGrantSelectionRequiredError(nil)
	}
	accountID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	grant, err := s.store.RevokeGrant(accountID, req.GetGrantId())
	if err != nil {
		if errors.Is(err, ErrConnectorGrantSelectionRequired) {
			return nil, connectorGrantSelectionRequiredError(err)
		}
		return nil, s.internalProviderError("revoke_connector_grant.persist", err)
	}
	s.emitAudit(ctx, "connector_grant.revoke", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"connector_grant_id": grant.GrantID,
		"connector_id":       grant.ConnectorID,
	})
	return &runtimev1.RevokeConnectorGrantResponse{Grant: connectorGrantRecordToProto(grant)}, nil
}

func connectorGrantSelectionRequiredError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONNECTOR_GRANT_SELECTION_REQUIRED,
		cause,
		grpcerr.ReasonOptions{Message: "an active connector grant must be selected"},
	)
}

func connectorGrantRevokedError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONNECTOR_GRANT_REVOKED,
		cause,
		grpcerr.ReasonOptions{Message: "the selected connector grant is revoked"},
	)
}

func connectorGrantRecordToProto(record ConnectorGrantRecord) *runtimev1.ConnectorGrant {
	grant := &runtimev1.ConnectorGrant{
		GrantId:     record.GrantID,
		ConnectorId: record.ConnectorID,
		AccountId:   record.AccountID,
		Status:      record.Status,
		CreatedAt:   timestamppb.New(time.UnixMilli(record.CreatedAt).UTC()),
	}
	if record.RevokedAt > 0 {
		grant.RevokedAt = timestamppb.New(time.UnixMilli(record.RevokedAt).UTC())
	}
	return grant
}
