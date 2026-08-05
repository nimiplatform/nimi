package connector

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

var (
	// ErrConnectorGrantSelectionRequired deliberately covers absent, foreign,
	// dangling, and owner-inconsistent grants. Callers must not use those
	// distinctions as routing or account-discovery truth.
	ErrConnectorGrantSelectionRequired = errors.New("connector grant selection required")
	ErrConnectorGrantRevoked           = errors.New("connector grant revoked")
)

// ConnectorGrantRecord is the non-secret persistent account authorization
// binding. Provider and model target data are deliberately not representable.
type ConnectorGrantRecord struct {
	GrantID     string                         `json:"grant_id"`
	ConnectorID string                         `json:"connector_id"`
	AccountID   string                         `json:"account_id"`
	Status      runtimev1.ConnectorGrantStatus `json:"status"`
	CreatedAt   int64                          `json:"created_at"`
	RevokedAt   int64                          `json:"revoked_at,omitempty"`
}

// ConnectorGrantSnapshot is the immutable, non-secret authorization capture
// passed to an execution host. It is safe to retain in a job snapshot.
type ConnectorGrantSnapshot struct {
	Grant     ConnectorGrantRecord
	Connector ConnectorRecord
}

// CreateGrant creates, or returns the existing active, account authorization
// for one account-owned managed connector. Regrant after revocation creates a
// new identity and preserves the revoked record as lifecycle evidence.
func (s *ConnectorStore) CreateGrant(accountID string, connectorID string) (ConnectorGrantRecord, error) {
	rawAccountID, rawConnectorID := accountID, connectorID
	accountID = strings.TrimSpace(accountID)
	connectorID = strings.TrimSpace(connectorID)
	if accountID == "" || connectorID == "" || rawAccountID != accountID || rawConnectorID != connectorID {
		return ConnectorGrantRecord{}, ErrConnectorGrantSelectionRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	connectorRecord, found, err := s.getRecordLocked(connectorID)
	if err != nil {
		return ConnectorGrantRecord{}, err
	}
	if !found || !grantConnectorUsableByAccount(connectorRecord, accountID) ||
		connectorRecord.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return ConnectorGrantRecord{}, ErrConnectorGrantSelectionRequired
	}

	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return ConnectorGrantRecord{}, err
	}
	for _, grant := range grants {
		if grant.AccountID == accountID && grant.ConnectorID == connectorID &&
			grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_ACTIVE {
			return grant, nil
		}
	}

	now := time.Now().UnixMilli()
	created := ConnectorGrantRecord{
		GrantID:     ulid.Make().String(),
		ConnectorID: connectorID,
		AccountID:   accountID,
		Status:      runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_ACTIVE,
		CreatedAt:   now,
	}
	grants = append(grants, created)
	if err := s.persistGrantRegistryLocked(grants); err != nil {
		return ConnectorGrantRecord{}, err
	}
	return created, nil
}

// GetGrant returns one grant without applying caller visibility. Service and
// execution owners must use ValidateGrantBinding for account-scoped access.
func (s *ConnectorStore) GetGrant(grantID string) (ConnectorGrantRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getGrantLocked(grantID)
}

// ListGrants returns only records owned by one exact account.
func (s *ConnectorStore) ListGrants(accountID string) ([]ConnectorGrantRecord, error) {
	rawAccountID := accountID
	accountID = strings.TrimSpace(accountID)
	if accountID == "" || rawAccountID != accountID {
		return nil, ErrConnectorGrantSelectionRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return nil, err
	}
	result := make([]ConnectorGrantRecord, 0, len(grants))
	for _, grant := range grants {
		if grant.AccountID == accountID {
			result = append(result, grant)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt != result[j].CreatedAt {
			return result[i].CreatedAt > result[j].CreatedAt
		}
		return result[i].GrantID < result[j].GrantID
	})
	return result, nil
}

// RevokeGrant idempotently revokes an account-owned grant.
func (s *ConnectorStore) RevokeGrant(accountID string, grantID string) (ConnectorGrantRecord, error) {
	rawAccountID, rawGrantID := accountID, grantID
	accountID = strings.TrimSpace(accountID)
	grantID = strings.TrimSpace(grantID)
	if accountID == "" || grantID == "" || rawAccountID != accountID || rawGrantID != grantID {
		return ConnectorGrantRecord{}, ErrConnectorGrantSelectionRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return ConnectorGrantRecord{}, err
	}
	for index := range grants {
		grant := &grants[index]
		if grant.GrantID != grantID || grant.AccountID != accountID {
			continue
		}
		if grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED {
			return *grant, nil
		}
		grant.Status = runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED
		grant.RevokedAt = time.Now().UnixMilli()
		if err := s.persistGrantRegistryLocked(grants); err != nil {
			return ConnectorGrantRecord{}, err
		}
		return *grant, nil
	}
	return ConnectorGrantRecord{}, ErrConnectorGrantSelectionRequired
}

// ValidateGrantBinding deterministically checks only Runtime-owned records. It
// never reads secret payloads and never probes a provider endpoint.
func (s *ConnectorStore) ValidateGrantBinding(accountID string, grantID string) (ConnectorGrantSnapshot, error) {
	rawAccountID, rawGrantID := accountID, grantID
	accountID = strings.TrimSpace(accountID)
	grantID = strings.TrimSpace(grantID)
	if accountID == "" || grantID == "" || rawAccountID != accountID || rawGrantID != grantID {
		return ConnectorGrantSnapshot{}, ErrConnectorGrantSelectionRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	grant, found, err := s.getGrantLocked(grantID)
	if err != nil {
		return ConnectorGrantSnapshot{}, err
	}
	if !found || grant.AccountID != accountID {
		return ConnectorGrantSnapshot{}, ErrConnectorGrantSelectionRequired
	}
	if grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED {
		return ConnectorGrantSnapshot{}, ErrConnectorGrantRevoked
	}
	if grant.Status != runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_ACTIVE {
		return ConnectorGrantSnapshot{}, ErrConnectorGrantSelectionRequired
	}
	connectorRecord, found, err := s.getRecordLocked(grant.ConnectorID)
	if err != nil {
		return ConnectorGrantSnapshot{}, err
	}
	if !found || !grantConnectorUsableByAccount(connectorRecord, accountID) ||
		connectorRecord.ConnectorID != grant.ConnectorID ||
		connectorRecord.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return ConnectorGrantSnapshot{}, ErrConnectorGrantSelectionRequired
	}
	return ConnectorGrantSnapshot{Grant: grant, Connector: connectorRecord}, nil
}

func grantConnectorUsableByAccount(record ConnectorRecord, accountID string) bool {
	return record.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		record.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER &&
		record.OwnerID == accountID && accountID != ""
}

func (s *ConnectorStore) getGrantLocked(grantID string) (ConnectorGrantRecord, bool, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return ConnectorGrantRecord{}, false, nil
	}
	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return ConnectorGrantRecord{}, false, err
	}
	for _, grant := range grants {
		if grant.GrantID == grantID {
			return grant, true, nil
		}
	}
	return ConnectorGrantRecord{}, false, nil
}

func (s *ConnectorStore) revokeGrantsForConnectorLocked(connectorID string, revokedAt int64) error {
	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return err
	}
	dirty := false
	for index := range grants {
		grant := &grants[index]
		if grant.ConnectorID != connectorID || grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED {
			continue
		}
		grant.Status = runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED
		grant.RevokedAt = revokedAt
		dirty = true
	}
	if !dirty {
		return nil
	}
	return s.persistGrantRegistryLocked(grants)
}

func (s *ConnectorStore) reconcileGrantRegistryLocked(connectors []ConnectorRecord, revokedAt int64) error {
	grants, err := s.loadGrantRegistryLocked()
	if err != nil {
		return err
	}
	if len(grants) == 0 {
		return nil
	}
	byID := make(map[string]ConnectorRecord, len(connectors))
	for _, record := range connectors {
		if !record.DeletePending {
			byID[record.ConnectorID] = record
		}
	}
	dirty := false
	for index := range grants {
		grant := &grants[index]
		if grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED {
			continue
		}
		record, found := byID[grant.ConnectorID]
		if found && grantConnectorUsableByAccount(record, grant.AccountID) {
			continue
		}
		grant.Status = runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED
		grant.RevokedAt = revokedAt
		dirty = true
	}
	if !dirty {
		return nil
	}
	return s.persistGrantRegistryLocked(grants)
}

func (s *ConnectorStore) loadGrantRegistryLocked() ([]ConnectorGrantRecord, error) {
	data, err := os.ReadFile(s.grantRegistryPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read connector grant registry: %w", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		slog.Warn("connector grant registry file is whitespace-only; treating as empty store", "path", s.grantRegistryPath)
		return nil, nil
	}
	var grants []ConnectorGrantRecord
	if err := json.Unmarshal(data, &grants); err != nil {
		return nil, fmt.Errorf("parse connector grant registry: %w", err)
	}
	for _, grant := range grants {
		if grant.GrantID == "" || grant.GrantID != strings.TrimSpace(grant.GrantID) ||
			grant.ConnectorID == "" || grant.ConnectorID != strings.TrimSpace(grant.ConnectorID) ||
			grant.AccountID == "" || grant.AccountID != strings.TrimSpace(grant.AccountID) ||
			(grant.Status != runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_ACTIVE &&
				grant.Status != runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED) ||
			grant.CreatedAt <= 0 ||
			(grant.Status == runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED && grant.RevokedAt <= 0) {
			return nil, fmt.Errorf("connector grant registry contains an invalid record")
		}
	}
	return grants, nil
}

func (s *ConnectorStore) persistGrantRegistryLocked(grants []ConnectorGrantRecord) error {
	data, err := json.MarshalIndent(grants, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal connector grant registry: %w", err)
	}
	data = append(data, '\n')
	if err := atomicWriteFile(s.grantRegistryPath, data, 0o600); err != nil {
		return fmt.Errorf("persist connector grant registry: %w", err)
	}
	return nil
}
