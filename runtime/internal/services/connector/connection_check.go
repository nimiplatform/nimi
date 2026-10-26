package connector

import (
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ConnectionCheck is historical diagnosis, not connector authorization.
type ConnectionCheck struct {
	OK        bool                 `json:"ok"`
	Reason    runtimev1.ReasonCode `json:"reason"`
	CheckedAt int64                `json:"checked_at"`
	StartedAt int64                `json:"started_at"`
}

// ObserveCredentialFailure only accepts definitive credential rejection. In
// particular a forbidden model, quota failure or timeout cannot revoke a check.
func (s *ConnectorStore) ObserveCredentialFailure(captured ConnectorRecord, started time.Time, cause error) error {
	if s == nil || cause == nil {
		return nil
	}
	reason, ok := grpcerr.ExtractReasonCode(cause)
	metadata, _ := grpcerr.ExtractReasonMetadata(cause)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED ||
		(metadata["provider_http_status"] != "401" &&
			!((metadata["provider_http_status"] == "400" || metadata["provider_http_status"] == "422") && metadata["action_hint"] == "refresh_provider_api_key_or_reconnect_connector")) {
		return nil
	}
	_, _, err := s.saveConnectionCheck(captured, ConnectionCheck{Reason: reason, CheckedAt: s.now().UnixMilli(), StartedAt: started.UnixNano()})
	return err
}

func (c *ConnectionCheck) projection() *runtimev1.ConnectorCheck {
	if c == nil {
		return nil
	}
	return &runtimev1.ConnectorCheck{Ok: c.OK, ReasonCode: c.Reason, CheckedAt: timestamppb.New(time.UnixMilli(c.CheckedAt))}
}

// captureCheck keeps the record and credential in the same configuration.
func (s *ConnectorStore) captureCheck(id string) (ConnectorRecord, string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, found, err := s.getRecordLocked(id)
	if err != nil || !found || IsChatGPTPlanRecord(record) {
		return record, "", found, err
	}
	payload, err := s.readSecretPayloadLocked(id)
	return record, payload, found, err
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
// Configuration changes and newer observations win over in-flight checks.
func (s *ConnectorStore) saveConnectionCheck(captured ConnectorRecord, check ConnectionCheck) (ConnectorRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.loadRegistryLocked()
	if err != nil {
		return ConnectorRecord{}, false, fmt.Errorf("load connector check: %w", err)
	}
	for i := range records {
		current := &records[i]
		if current.ConnectorID != captured.ConnectorID || current.DeletePending {
			continue
		}
		if current.CredentialRevision != captured.CredentialRevision || current.Endpoint != captured.Endpoint ||
			current.Provider != captured.Provider || current.AuthKind != captured.AuthKind ||
			current.ProviderAuthProfile != captured.ProviderAuthProfile || current.Status != captured.Status ||
			current.OwnerID != captured.OwnerID || current.OwnerType != captured.OwnerType ||
			(current.LastCheck != nil && current.LastCheck.StartedAt > check.StartedAt) {
			return *current, false, nil
		}
		current.LastCheck = &check
		if err := s.persistRegistryLocked(records); err != nil {
			return ConnectorRecord{}, false, fmt.Errorf("persist connector check: %w", err)
		}
		return *current, true, nil
	}
	return ConnectorRecord{}, false, nil
}
