package aiconfig

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const maxReferenceOwners = 10000

// ConnectorReferenceReader exposes only safe current configuration references.
// It does not grant access to the complete configuration or admit an owner write.
type ConnectorReferenceReader interface {
	ConnectorReferences(context.Context, string, string) (*ConnectorReferenceSnapshot, error)
}

type ConnectorReferenceSnapshot struct {
	Revision   string
	References []*runtimev1.DesktopConnectorReference
}

type referenceOwnerRow struct {
	Kind     int32
	ID       string
	Revision uint64
	Config   *runtimev1.AIConfig
}

// @nimi-authority: rule.nimi.runtime.security-core.home-connector-reference-index
func (s *MemoryStore) ConnectorReferences(ctx context.Context, account, connector string) (*ConnectorReferenceSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows := make([]referenceOwnerRow, 0)
	for key, value := range s.rows {
		if key.accountNamespace != account {
			continue
		}
		rows = append(rows, referenceOwnerRow{key.ownerKind, key.ownerID, value.revision, value.config})
		if len(rows) > maxReferenceOwners {
			return nil, fmt.Errorf("configuration reference index exceeds its read bound")
		}
	}
	return referenceSnapshot(account, connector, rows)
}

func (s *SQLiteStore) ConnectorReferences(ctx context.Context, account, connector string) (*ConnectorReferenceSnapshot, error) {
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin reference read: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.QueryContext(ctx, `SELECT owner_kind,owner_id,revision,config_blob FROM runtime_ai_config WHERE account_namespace=? ORDER BY owner_kind,owner_id LIMIT ?`, account, maxReferenceOwners+1)
	if err != nil {
		return nil, fmt.Errorf("read configuration references: %w", err)
	}
	rows := make([]referenceOwnerRow, 0)
	for result.Next() {
		var row referenceOwnerRow
		var raw []byte
		if err := result.Scan(&row.Kind, &row.ID, &row.Revision, &raw); err != nil {
			_ = result.Close()
			return nil, err
		}
		row.Config = &runtimev1.AIConfig{}
		if err := proto.Unmarshal(raw, row.Config); err != nil {
			_ = result.Close()
			return nil, invalidPersistedConfig("reference owner decode")
		}
		rows = append(rows, row)
	}
	err = result.Err()
	_ = result.Close()
	if err != nil {
		return nil, err
	}
	if len(rows) > maxReferenceOwners {
		return nil, fmt.Errorf("configuration reference index exceeds its read bound")
	}
	snapshot, err := referenceSnapshot(account, connector, rows)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func referenceSnapshot(account, connector string, rows []referenceOwnerRow) (*ConnectorReferenceSnapshot, error) {
	if err := requireExactNonEmpty("account namespace", account); err != nil {
		return nil, err
	}
	if err := requireExactNonEmpty("connector reference", connector); err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].ID < rows[j].ID
	})
	// The entire ordered owner/revision set is read under one transaction/lock.
	// Its digest changes for inserts, removals and updates without a second store.
	identity := make([]struct {
		Kind     int32
		ID       string
		Revision uint64
	}, 0, len(rows))
	refs := make([]*runtimev1.DesktopConnectorReference, 0)
	for _, row := range rows {
		config, err := Canonicalize(row.Config)
		if err != nil || row.Revision == 0 {
			return nil, invalidPersistedConfig("invalid reference owner")
		}
		key, err := canonicalStoreKey(account, config.GetOwner())
		if err != nil || key.ownerKind != row.Kind || key.ownerID != row.ID {
			return nil, invalidPersistedConfig("reference owner identity mismatch")
		}
		identity = append(identity, struct {
			Kind     int32
			ID       string
			Revision uint64
		}{row.Kind, row.ID, row.Revision})
		capabilities := append([]*runtimev1.AIConfigCapabilityIntent(nil), config.GetCapabilities()...)
		sort.Slice(capabilities, func(i, j int) bool {
			return capabilities[i].GetCapabilityContract() < capabilities[j].GetCapabilityContract()
		})
		for _, capability := range capabilities {
			cloud := capability.GetCloud()
			if cloud == nil || cloud.GetConnectorRef() != connector {
				continue
			}
			refs = append(refs, &runtimev1.DesktopConnectorReference{Owner: proto.Clone(config.GetOwner()).(*runtimev1.AIConfigOwner),
				CapabilityContract: capability.GetCapabilityContract(), ImplementationId: cloud.GetImplementation().GetImplementationId(), ConfigRevision: encodeRevision(row.Revision)})
		}
	}
	encoded, err := json.Marshal(struct {
		Account, Connector string
		Owners             any
	}{account, connector, identity})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return &ConnectorReferenceSnapshot{Revision: hex.EncodeToString(digest[:]), References: refs}, nil
}
