// @nimi-authority: rule.nimi.runtime.local-compute.r028

package aiprofile

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrBackendRequired = errors.New("AIProfile persistence backend is required")

// Store owns the account-scoped portable Profile catalog. Import replaces one
// document by profile_id and does not project or invoke any other product
// action.
type Store interface {
	Import(context.Context, string, *runtimev1.PortableAIProfileRecord) (*runtimev1.PortableAIProfileRecord, error)
	List(context.Context, string) ([]*runtimev1.PortableAIProfileRecord, error)
}

type MemoryStore struct {
	mu   sync.RWMutex
	rows map[string]map[string]*runtimev1.PortableAIProfileRecord
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{rows: make(map[string]map[string]*runtimev1.PortableAIProfileRecord)}
}

func (s *MemoryStore) Import(_ context.Context, accountNamespace string, record *runtimev1.PortableAIProfileRecord) (*runtimev1.PortableAIProfileRecord, error) {
	if err := validateRecord(accountNamespace, record); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := timestamppb.New(time.Now().UTC())
	if !now.IsValid() {
		return nil, fmt.Errorf("construct AIProfile timestamp")
	}
	stored := cloneRecord(record)
	if current := s.rows[accountNamespace][record.GetProfileId()]; current != nil {
		stored.ImportedAt = cloneTimestamp(current.GetImportedAt())
	} else {
		stored.ImportedAt = cloneTimestamp(now)
	}
	stored.UpdatedAt = cloneTimestamp(now)
	if s.rows[accountNamespace] == nil {
		s.rows[accountNamespace] = make(map[string]*runtimev1.PortableAIProfileRecord)
	}
	s.rows[accountNamespace][stored.GetProfileId()] = cloneRecord(stored)
	return stored, nil
}

func (s *MemoryStore) List(_ context.Context, accountNamespace string) ([]*runtimev1.PortableAIProfileRecord, error) {
	if accountNamespace == "" {
		return nil, fmt.Errorf("account namespace is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows := make([]*runtimev1.PortableAIProfileRecord, 0, len(s.rows[accountNamespace]))
	for _, record := range s.rows[accountNamespace] {
		if !storedRecordStructurallyValid(accountNamespace, record) {
			continue
		}
		rows = append(rows, cloneRecord(record))
	}
	sortRecords(rows)
	return rows, nil
}

type SQLiteStore struct {
	backend *runtimepersistence.Backend
}

func NewSQLiteStore(backend *runtimepersistence.Backend) (*SQLiteStore, error) {
	if backend == nil {
		return nil, ErrBackendRequired
	}
	return &SQLiteStore{backend: backend}, nil
}

func (s *SQLiteStore) Import(ctx context.Context, accountNamespace string, record *runtimev1.PortableAIProfileRecord) (*runtimev1.PortableAIProfileRecord, error) {
	if err := validateRecord(accountNamespace, record); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var importedAt string
	if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `
			SELECT imported_at FROM runtime_ai_profile
			WHERE account_namespace = ? AND profile_id = ?
		`, accountNamespace, record.GetProfileId()).Scan(&importedAt)
		if errors.Is(err, sql.ErrNoRows) {
			importedAt = now
		} else if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO runtime_ai_profile(account_namespace, profile_id, title, profile_json, imported_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_namespace, profile_id)
			DO UPDATE SET title = excluded.title, profile_json = excluded.profile_json, updated_at = excluded.updated_at
		`, accountNamespace, record.GetProfileId(), record.GetTitle(), record.GetProfileJson(), importedAt, now)
		return err
	}); err != nil {
		return nil, fmt.Errorf("import AIProfile: %w", err)
	}
	return recordFromStorage(record.GetProfileId(), record.GetTitle(), record.GetProfileJson(), importedAt, now)
}

func (s *SQLiteStore) List(ctx context.Context, accountNamespace string) ([]*runtimev1.PortableAIProfileRecord, error) {
	if accountNamespace == "" {
		return nil, fmt.Errorf("account namespace is required")
	}
	rows, err := s.backend.DB().QueryContext(ctx, `
		SELECT profile_id, title, profile_json, imported_at, updated_at
		FROM runtime_ai_profile
		WHERE account_namespace = ?
		ORDER BY profile_id ASC
	`, accountNamespace)
	if err != nil {
		return nil, fmt.Errorf("list AIProfiles: %w", err)
	}
	defer rows.Close()
	out := make([]*runtimev1.PortableAIProfileRecord, 0)
	for rows.Next() {
		var profileID, title, importedAt, updatedAt string
		var raw []byte
		if err := rows.Scan(&profileID, &title, &raw, &importedAt, &updatedAt); err != nil {
			continue
		}
		record, err := recordFromStorage(profileID, title, raw, importedAt, updatedAt)
		if err != nil || !storedRecordStructurallyValid(accountNamespace, record) {
			continue
		}
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate AIProfiles: %w", err)
	}
	return out, nil
}

func recordFromStorage(profileID, title string, raw []byte, importedAt, updatedAt string) (*runtimev1.PortableAIProfileRecord, error) {
	imported, err := time.Parse(time.RFC3339Nano, importedAt)
	if err != nil {
		return nil, fmt.Errorf("decode AIProfile imported_at: %w", err)
	}
	updated, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return nil, fmt.Errorf("decode AIProfile updated_at: %w", err)
	}
	return &runtimev1.PortableAIProfileRecord{
		ProfileId:   profileID,
		Title:       title,
		ProfileJson: append([]byte(nil), raw...),
		ImportedAt:  timestamppb.New(imported),
		UpdatedAt:   timestamppb.New(updated),
	}, nil
}

func validateRecord(accountNamespace string, record *runtimev1.PortableAIProfileRecord) error {
	if accountNamespace == "" || record == nil || record.GetProfileId() == "" || record.GetTitle() == "" || len(record.GetProfileJson()) == 0 {
		return fmt.Errorf("account namespace and complete AIProfile record are required")
	}
	return nil
}

func storedRecordStructurallyValid(accountNamespace string, record *runtimev1.PortableAIProfileRecord) bool {
	return validateRecord(accountNamespace, record) == nil &&
		record.GetImportedAt() != nil && record.GetImportedAt().CheckValid() == nil &&
		record.GetUpdatedAt() != nil && record.GetUpdatedAt().CheckValid() == nil
}

func sortRecords(records []*runtimev1.PortableAIProfileRecord) {
	sort.Slice(records, func(i, j int) bool { return records[i].GetProfileId() < records[j].GetProfileId() })
}

func cloneRecord(record *runtimev1.PortableAIProfileRecord) *runtimev1.PortableAIProfileRecord {
	if record == nil {
		return nil
	}
	cloned, _ := proto.Clone(record).(*runtimev1.PortableAIProfileRecord)
	return cloned
}

func cloneTimestamp(value *timestamppb.Timestamp) *timestamppb.Timestamp {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*timestamppb.Timestamp)
	return cloned
}
