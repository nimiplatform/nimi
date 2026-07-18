package account

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

const localAppOwnerPolicyRevision uint64 = 1

type localAppOperationBinding struct {
	operationID string
	resourceRef string
	capability  string
	fingerprint string
}

func (s *Service) localAppBaseEntitlementCallerBinding(ctx context.Context, operationID, resourceRef string) (LocalAppCallerDecision, localAppOperationBinding, error) {
	if s == nil || s.localAppKernel == nil {
		return LocalAppCallerDecision{}, localAppOperationBinding{}, localappkernel.ErrNotFound
	}
	binding, err := localAppBaseEntitlementOperation(operationID, resourceRef)
	if err != nil {
		return LocalAppCallerDecision{}, localAppOperationBinding{}, err
	}
	decision, err := s.localAppCallerIdentityBinding(ctx)
	if err != nil {
		return LocalAppCallerDecision{}, localAppOperationBinding{}, err
	}
	return decision, binding, nil
}

func (s *Service) localAppCallerIdentityBinding(ctx context.Context) (LocalAppCallerDecision, error) {
	decision, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, decision.LocalAppPrincipalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive || principal.AppID != decision.AppID {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, decision.LocalAppPrincipalID)
	if err != nil || record.LocalAppRecordID != decision.LocalAppRecordID || record.ProvenanceRevision != decision.ProvenanceRevision ||
		record.InstallOrProjectGeneration != decision.ProjectGeneration || record.PayloadRootDigest != decision.PayloadDigest ||
		record.TrustClass != localappkernel.TrustClassLocalDevelopment || record.LifecycleState != localappkernel.LifecycleStateActive {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	return decision, nil
}

func localAppBaseEntitlementOperation(operationID, resourceRef string) (localAppOperationBinding, error) {
	if operationID == "" || operationID != strings.TrimSpace(operationID) || resourceRef == "" || resourceRef != strings.TrimSpace(resourceRef) {
		return localAppOperationBinding{}, localappkernel.ErrInvalidArgument
	}
	switch operationID {
	case appstorage.LocalAppJSONReadOperationID, appstorage.LocalAppJSONWriteOperationID, appstorage.LocalAppJSONRemoveOperationID:
		if _, err := appstorage.ParseLocalAppJSONResourceRef(resourceRef); err != nil {
			return localAppOperationBinding{}, localappkernel.ErrInvalidArgument
		}
	default:
		return localAppOperationBinding{}, ErrLocalAppOperationNotAdmitted
	}
	fingerprintInput := operationID + "\x00" + appstorage.LocalAppPrivateStorageEntitlement + "\x00" + resourceRef
	digest := sha256.Sum256([]byte("nimi.local-app-base-entitlement-resource.v1\x00" + fingerprintInput))
	return localAppOperationBinding{
		operationID: operationID,
		resourceRef: resourceRef,
		capability:  appstorage.LocalAppPrivateStorageEntitlement,
		fingerprint: "laberf_v1_" + base64.RawURLEncoding.EncodeToString(digest[:]),
	}, nil
}

func localAppAuthorityErrorReason(err error) runtimev1.ReasonCode {
	switch {
	case errors.Is(err, ErrLocalAppAccountChanged):
		return runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED
	case errors.Is(err, ErrLocalAppProcessMismatch):
		return runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	case errors.Is(err, ErrLocalAppCallerUnauthorized), errors.Is(err, localappkernel.ErrPrincipalTombstoned):
		return runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
	case errors.Is(err, ErrLocalAppOperationNotAdmitted):
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	case errors.Is(err, localappkernel.ErrInvalidArgument):
		return runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	default:
		return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
	}
}
