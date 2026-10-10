package connector

import (
	"context"
	"crypto/subtle"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r041
// The callback transfers one immutable request to its transport. It must not
// wait for a provider response/body or re-enter the Connector owner. Mutation
// uses this same lock; a captured record alone never grants a later action.
func (s *ConnectorStore) BeginJobOutbound(ctx context.Context, jobID, accountID string, captured ConnectorRecord, handoff func() error) error {
	if s == nil || handoff == nil {
		return jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.currentJobCredentialLocked(ctx, jobID, accountID, captured); err != nil {
		return err
	}
	return handoff()
}

// OpenJobCredential opens the original sealed reference after current owner
// admission. The caller still performs BeginJobOutbound for each later IO.
func (s *ConnectorStore) OpenJobCredential(ctx context.Context, jobID, accountID string, captured ConnectorRecord) (string, error) {
	if s == nil {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentJobCredentialLocked(ctx, jobID, accountID, captured)
}

func (s *ConnectorStore) currentJobCredentialLocked(ctx context.Context, jobID, accountID string, captured ConnectorRecord) (string, error) {
	if ctx == nil {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if accountID == "" || captured.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED || captured.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE || captured.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER || captured.OwnerID != accountID || ValidateCredentialCustodyRefForJob(captured.CredentialCustodyRef, jobID) != nil {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	current, found, err := s.getRecordLocked(captured.ConnectorID)
	if err != nil || !found || current.DeletePending || current.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED || current.OwnerID != accountID || current.OwnerType != captured.OwnerType || current.Provider != captured.Provider {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if current.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	if current.Endpoint != captured.Endpoint || current.AuthKind != captured.AuthKind || current.ProviderAuthProfile != captured.ProviderAuthProfile || current.UpdatedAt != captured.UpdatedAt {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if !current.HasCredential {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	original, err := s.readStoredSecretPayloadLocked(captured.CredentialCustodyRef)
	if err != nil || strings.TrimSpace(original) == "" {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	// Comparison is admission only. The current secret never replaces the
	// original Job credential, including when its custody is missing.
	currentPayload, err := s.readStoredSecretPayloadLocked(current.ConnectorID)
	if err != nil {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	originalIdentity, currentIdentity := original, currentPayload
	if IsChatGPTPlanRecord(current) {
		credential, err := decodeChatGPTPlanCredential(currentPayload)
		if err != nil {
			return "", err
		}
		originalIdentity, err = ChatGPTPlanRequestAccessToken(original, s.now().UTC())
		if err != nil {
			return "", err
		}
		currentIdentity = credential.AccessToken
	}
	if currentIdentity == "" || subtle.ConstantTimeCompare([]byte(originalIdentity), []byte(currentIdentity)) != 1 {
		return "", jobConnectorDenied(runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	return original, nil
}

func jobConnectorDenied(reason runtimev1.ReasonCode) error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
}

// JobIDForCredentialCustodyRef extracts only a validated private selector. It
// grants no permission; every opening separately verifies owner and admission.
func JobIDForCredentialCustodyRef(ref string) (string, error) {
	validated, err := validateScenarioJobCredentialCustodyRef(ref)
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(validated, scenarioJobCredentialCustodyPrefix), nil
}
