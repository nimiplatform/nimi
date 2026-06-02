package app

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) GetAccountAppLibrary(ctx context.Context, req *runtimev1.GetAccountAppLibraryRequest) (*runtimev1.GetAccountAppLibraryResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	accountID, err := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if s.accountLibrary == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID)
	}
	record, exists, err := s.accountLibrary.readOptional(accountID)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID)
	}
	if !exists {
		return &runtimev1.GetAccountAppLibraryResponse{
			Exists:     false,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}, nil
	}
	return &runtimev1.GetAccountAppLibraryResponse{
		Exists:     true,
		Record:     accountAppLibraryRecordToProto(record),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func accountAppLibraryRecordToProto(record accountAppLibraryRecord) *runtimev1.AccountAppLibraryRecord {
	rows := make([]*runtimev1.AccountAppLibraryRow, 0, len(record.Apps))
	for _, row := range record.Apps {
		lastOpenedAt := ""
		if row.LastOpenedAt != nil {
			lastOpenedAt = *row.LastOpenedAt
		}
		rows = append(rows, &runtimev1.AccountAppLibraryRow{
			AppId:        row.AppID,
			LibraryState: row.LibraryState,
			Installed:    row.Installed,
			LastOpenedAt: lastOpenedAt,
			DataPolicy:   row.DataPolicy,
		})
	}
	return &runtimev1.AccountAppLibraryRecord{
		SchemaVersion: record.SchemaVersion,
		AccountId:     record.AccountID,
		UpdatedAt:     record.UpdatedAt,
		Apps:          rows,
	}
}
