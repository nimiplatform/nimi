package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) GetAccountAppInventory(ctx context.Context, req *runtimev1.GetAccountAppInventoryRequest) (*runtimev1.GetAccountAppInventoryResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	accountID, err := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if s.accountInventory == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID)
	}
	record, exists, err := s.accountInventory.readOptional(accountID)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID)
	}
	if !exists {
		return &runtimev1.GetAccountAppInventoryResponse{
			Exists:     false,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}, nil
	}
	return &runtimev1.GetAccountAppInventoryResponse{
		Exists:     true,
		Record:     accountAppInventoryRecordToProto(record),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func accountAppInventoryRecordToProto(record accountAppInventoryRecord) *runtimev1.AccountAppInventoryRecord {
	rows := make([]*runtimev1.AccountAppInventoryRow, 0, len(record.Apps))
	for _, row := range record.Apps {
		lastOpenedAt := ""
		if row.LastOpenedAt != nil {
			lastOpenedAt = *row.LastOpenedAt
		}
		rows = append(rows, &runtimev1.AccountAppInventoryRow{
			AppId:        row.AppID,
			AccountState: accountAppInventoryStateToProto(row.AccountState),
			InstallState: accountAppInstallStateToProto(row.InstallState),
			LastOpenedAt: lastOpenedAt,
			DataPolicy:   row.DataPolicy,
			VerifiedAt:   row.VerifiedAt,
			Source:       row.Source,
			Detail:       row.Detail,
		})
	}
	return &runtimev1.AccountAppInventoryRecord{
		SchemaVersion: record.SchemaVersion,
		AccountId:     record.AccountID,
		UpdatedAt:     record.UpdatedAt,
		Apps:          rows,
	}
}

func accountAppInventoryStateToProto(state string) runtimev1.AccountAppInventoryState {
	switch strings.TrimSpace(state) {
	case accountAppInventoryStateVerified:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_VERIFIED
	case accountAppInventoryStateEntitled:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_ENTITLED
	case accountAppInventoryStateDisabled:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_DISABLED
	case accountAppInventoryStateRemoved:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_REMOVED
	case accountAppInventoryStateRevoked:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_REVOKED
	default:
		return runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_UNSPECIFIED
	}
}

func accountAppInstallStateToProto(state string) runtimev1.AccountAppInstallState {
	switch strings.TrimSpace(state) {
	case accountAppInstallStateNotInstalled:
		return runtimev1.AccountAppInstallState_ACCOUNT_APP_INSTALL_STATE_NOT_INSTALLED
	case accountAppInstallStateInstalled:
		return runtimev1.AccountAppInstallState_ACCOUNT_APP_INSTALL_STATE_INSTALLED
	case accountAppInstallStateRemoved:
		return runtimev1.AccountAppInstallState_ACCOUNT_APP_INSTALL_STATE_REMOVED
	default:
		return runtimev1.AccountAppInstallState_ACCOUNT_APP_INSTALL_STATE_UNSPECIFIED
	}
}
