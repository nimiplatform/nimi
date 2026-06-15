package app

import (
	"context"
	"os"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) AdoptLocalApp(ctx context.Context, req *runtimev1.AdoptLocalAppRequest) (*runtimev1.AdoptLocalAppResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.localAdoptions == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}
	candidate, err := resolveLocalAppAdoptionCandidate(req.GetRootPath(), req.GetExpectedAppId())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	if err := s.requireAppLifecycleSession(ctx, candidate.AppID); err != nil {
		return nil, err
	}
	accountID, accountErr := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if accountErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if err := s.requireAccountAppLifecycleLaunchable(accountID, candidate.AppID); err != nil {
		return nil, appLifecycleAccountInventoryError(err)
	}
	adoption, err := s.localAdoptions.commitAdoption(candidate)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	if err := s.materializeLocalAdoptionRoots(adoption); err != nil {
		removed, removeErr := s.localAdoptions.remove(adoption.AppID)
		if removeErr == nil {
			adoption = removed
		}
		return &runtimev1.AdoptLocalAppResponse{
			Adoption:   localAppAdoptionToProto(adoption, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION, err.Error()),
			ReasonCode: runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			Detail:     err.Error(),
		}, nil
	}
	if err := s.applyAccountAppInventoryLifecycleMutation(accountID, adoption.AppID, accountAppInventoryMutationAdoptedLocal); err != nil {
		if removed, removeErr := s.localAdoptions.remove(adoption.AppID); removeErr == nil {
			adoption = removed
		}
		return nil, appLifecycleAccountInventoryError(err)
	}
	return &runtimev1.AdoptLocalAppResponse{
		Adoption:   localAppAdoptionToProto(adoption, runtimev1.ReasonCode_ACTION_EXECUTED, ""),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) ListLocalAppAdoptions(ctx context.Context, req *runtimev1.ListLocalAppAdoptionsRequest) (*runtimev1.ListLocalAppAdoptionsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if !isDesktopCoreLifecycleController(ctx) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if s.localAdoptions == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}
	rows, err := s.localAdoptions.list()
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	out := make([]*runtimev1.LocalAppAdoption, 0, len(rows))
	for _, row := range rows {
		out = append(out, localAppAdoptionToProto(row, runtimev1.ReasonCode_ACTION_EXECUTED, ""))
	}
	return &runtimev1.ListLocalAppAdoptionsResponse{
		Adoptions:  out,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RemoveLocalAppAdoption(ctx context.Context, req *runtimev1.RemoveLocalAppAdoptionRequest) (*runtimev1.RemoveLocalAppAdoptionResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := s.requireAppLifecycleSession(ctx, appID); err != nil {
		return nil, err
	}
	accountID, accountErr := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if accountErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if err := s.requireAccountAppLifecycleLaunchable(accountID, appID); err != nil {
		return nil, appLifecycleAccountInventoryError(err)
	}
	if s.localAdoptions == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}
	adoption, err := s.localAdoptions.remove(appID)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	if req.GetDeleteDurableDataConfirmed() {
		if err := s.removeLocalAdoptionDurableData(adoption); err != nil {
			return &runtimev1.RemoveLocalAppAdoptionResponse{
				Adoption:   localAppAdoptionToProto(adoption, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION, err.Error()),
				ReasonCode: runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
				Detail:     err.Error(),
			}, nil
		}
	}
	mutation := accountAppInventoryMutationUninstalled
	if req.GetDeleteDurableDataConfirmed() {
		mutation = accountAppInventoryMutationRemoved
	}
	if err := s.applyAccountAppInventoryLifecycleMutation(accountID, appID, mutation); err != nil {
		return nil, appLifecycleAccountInventoryError(err)
	}
	return &runtimev1.RemoveLocalAppAdoptionResponse{
		Adoption:   localAppAdoptionToProto(adoption, runtimev1.ReasonCode_ACTION_EXECUTED, ""),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) materializeLocalAdoptionRoots(adoption localAppAdoptionRecord) error {
	dataRootRef := strings.TrimSpace(s.appStorageDataRoot)
	if dataRootRef == "" && s.installRuntime != nil {
		dataRootRef = strings.TrimSpace(s.installRuntime.dataRootRef)
	}
	roots, err := appstorage.ResolveAppRoots(dataRootRef, adoption.AppID, adoption.StoragePolicyRef)
	if err != nil {
		return err
	}
	return appstorage.MaterializeAppRoots(roots)
}

func (s *Service) removeLocalAdoptionDurableData(adoption localAppAdoptionRecord) error {
	dataRootRef := strings.TrimSpace(s.appStorageDataRoot)
	if dataRootRef == "" && s.installRuntime != nil {
		dataRootRef = strings.TrimSpace(s.installRuntime.dataRootRef)
	}
	roots, err := appstorage.ResolveAppRoots(dataRootRef, adoption.AppID, adoption.StoragePolicyRef)
	if err != nil {
		return err
	}
	return os.RemoveAll(roots.DurableDataRoot)
}

func localAppAdoptionToProto(row localAppAdoptionRecord, reason runtimev1.ReasonCode, detail string) *runtimev1.LocalAppAdoption {
	if detail == "" {
		detail = row.Detail
	}
	return &runtimev1.LocalAppAdoption{
		AppId:              row.AppID,
		RootPath:           row.RootPath,
		ManifestPath:       row.ManifestPath,
		DisplayName:        row.DisplayName,
		Version:            row.Version,
		EntryRef:           row.EntryRef,
		PermissionScopeRef: row.PermissionScopeRef,
		StoragePolicyRef:   row.StoragePolicyRef,
		State:              localAppAdoptionStateToProto(row.State),
		Trust:              localAppAdoptionTrustToProto(row.Trust),
		AdoptedAt:          row.AdoptedAt,
		UpdatedAt:          row.UpdatedAt,
		ReasonCode:         reason,
		Detail:             detail,
	}
}

func localAppAdoptionStateToProto(state string) runtimev1.LocalAppAdoptionState {
	switch strings.TrimSpace(state) {
	case "adopted":
		return runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_ADOPTED
	case "repair-required":
		return runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_REPAIR_REQUIRED
	case "removed":
		return runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_REMOVED
	default:
		return runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_UNSPECIFIED
	}
}

func localAppAdoptionTrustToProto(trust string) runtimev1.LocalAppAdoptionTrust {
	switch strings.TrimSpace(trust) {
	case "explicit-local":
		return runtimev1.LocalAppAdoptionTrust_LOCAL_APP_ADOPTION_TRUST_EXPLICIT_LOCAL
	case "developer-local":
		return runtimev1.LocalAppAdoptionTrust_LOCAL_APP_ADOPTION_TRUST_DEVELOPER_LOCAL
	default:
		return runtimev1.LocalAppAdoptionTrust_LOCAL_APP_ADOPTION_TRUST_UNSPECIFIED
	}
}
