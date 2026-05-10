package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// KnowledgeScopeKind enumerates admitted scope_kind values for the
// cognition_scope_registry table. Only runtime_knowledge_bank is
// admitted by this storage release.
const KnowledgeScopeKindRuntimeKnowledgeBank = "runtime_knowledge_bank"

// KnowledgeScopeOwnerKind enumerates admitted owner_kind values.
const (
	KnowledgeScopeOwnerKindAppPrivate       = "app_private"
	KnowledgeScopeOwnerKindWorkspacePrivate = "workspace_private"
)

// Storage-layer typed errors. The cognition facade maps these to public
// errors in cognition/cognition_knowledge_scope.go.
var (
	ErrScopeRegistryNotFound      = errors.New("storage scope registry: scope not found")
	ErrScopeRegistryOwnerConflict = errors.New("storage scope registry: owner conflict")
	ErrScopeRegistryKindMismatch  = errors.New("storage scope registry: scope kind mismatch")
)

// KnowledgeScopeRow is the row shape of the cognition_scope_registry
// table. Callers must canonicalize OwnerKey before insertion.
type KnowledgeScopeRow struct {
	ScopeID      string
	ScopeKind    string
	OwnerKind    string
	OwnerKey     string
	OwnerJSON    []byte
	DisplayName  string
	MetadataJSON []byte
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// KnowledgeScopeFilter narrows ListKnowledgeScopeRows results. Empty
// slices match any value for that axis.
type KnowledgeScopeFilter struct {
	OwnerKinds []string
	OwnerKeys  []string
	PageSize   int
	PageToken  string
}

// CreateKnowledgeScopeRow registers a new runtime_knowledge_bank scope
// and the matching `scope` row in one transaction. Returns
// ErrScopeRegistryOwnerConflict if (scope_kind, owner_kind, owner_key,
// display_name) already exists.
func (b *SQLiteBackend) CreateKnowledgeScopeRow(row KnowledgeScopeRow) error {
	if err := validateKnowledgeScopeRow(row); err != nil {
		return err
	}
	if err := validateScopeID(row.ScopeID); err != nil {
		return err
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage create knowledge scope: begin tx: %w", err)
	}
	defer rollback(tx)

	now := row.UpdatedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if err := b.ensureScopeTx(tx, row.ScopeID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO cognition_scope_registry
		(scope_id, scope_kind, owner_kind, owner_key, owner_json, display_name, metadata_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ScopeID, row.ScopeKind, row.OwnerKind, row.OwnerKey, string(row.OwnerJSON),
		row.DisplayName, string(row.MetadataJSON),
		encodeTime(row.CreatedAt), encodeTime(row.UpdatedAt)); err != nil {
		if isUniqueConstraintErr(err) {
			return fmt.Errorf("storage create knowledge scope: %w", ErrScopeRegistryOwnerConflict)
		}
		return fmt.Errorf("storage create knowledge scope: %w", err)
	}
	return tx.Commit()
}

// GetKnowledgeScopeRow loads one scope by id. Returns
// ErrScopeRegistryNotFound when no row exists.
func (b *SQLiteBackend) GetKnowledgeScopeRow(scopeID string) (KnowledgeScopeRow, error) {
	if err := validateScopeID(scopeID); err != nil {
		return KnowledgeScopeRow{}, err
	}
	row := b.db.QueryRow(`SELECT scope_id, scope_kind, owner_kind, owner_key, owner_json, display_name, metadata_json, created_at, updated_at
		FROM cognition_scope_registry WHERE scope_id = ?`, scopeID)
	out, err := scanKnowledgeScopeRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return KnowledgeScopeRow{}, fmt.Errorf("storage get knowledge scope %s: %w", scopeID, ErrScopeRegistryNotFound)
	}
	if err != nil {
		return KnowledgeScopeRow{}, fmt.Errorf("storage get knowledge scope %s: %w", scopeID, err)
	}
	return out, nil
}

// ListKnowledgeScopeRows returns scopes matching the filter. Pagination
// is offset-based and encoded as decimal string in PageToken; empty
// PageToken means start at offset 0. PageSize <= 0 means no limit.
func (b *SQLiteBackend) ListKnowledgeScopeRows(filter KnowledgeScopeFilter) ([]KnowledgeScopeRow, string, error) {
	for _, kind := range filter.OwnerKinds {
		if !isAdmittedOwnerKind(kind) {
			return nil, "", fmt.Errorf("storage list knowledge scopes: invalid owner_kind %q", kind)
		}
	}
	var (
		clauses []string
		args    []any
	)
	clauses = append(clauses, "scope_kind = ?")
	args = append(args, KnowledgeScopeKindRuntimeKnowledgeBank)
	if len(filter.OwnerKinds) > 0 {
		clauses = append(clauses, "owner_kind IN ("+placeholders(len(filter.OwnerKinds))+")")
		for _, k := range filter.OwnerKinds {
			args = append(args, k)
		}
	}
	if len(filter.OwnerKeys) > 0 {
		clauses = append(clauses, "owner_key IN ("+placeholders(len(filter.OwnerKeys))+")")
		for _, k := range filter.OwnerKeys {
			args = append(args, k)
		}
	}
	offset, err := decodeScopeRegistryPageToken(filter.PageToken)
	if err != nil {
		return nil, "", err
	}
	limit := filter.PageSize
	if limit < 0 {
		limit = 0
	}
	query := "SELECT scope_id, scope_kind, owner_kind, owner_key, owner_json, display_name, metadata_json, created_at, updated_at FROM cognition_scope_registry WHERE " +
		strings.Join(clauses, " AND ") + " ORDER BY scope_id ASC"
	if limit > 0 {
		// Fetch one extra to detect a continuation page.
		query += fmt.Sprintf(" LIMIT %d OFFSET %d", limit+1, offset)
	} else if offset > 0 {
		// Without a limit, OFFSET still applies via a sentinel large LIMIT.
		query += fmt.Sprintf(" LIMIT -1 OFFSET %d", offset)
	}
	rows, err := b.db.Query(query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("storage list knowledge scopes: %w", err)
	}
	defer rows.Close()
	var results []KnowledgeScopeRow
	for rows.Next() {
		out, err := scanKnowledgeScopeRow(rows)
		if err != nil {
			return nil, "", fmt.Errorf("storage list knowledge scopes: %w", err)
		}
		results = append(results, out)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("storage list knowledge scopes: %w", err)
	}
	nextToken := ""
	if limit > 0 && len(results) > limit {
		results = results[:limit]
		nextToken = fmt.Sprintf("%d", offset+limit)
	}
	return results, nextToken, nil
}

// deleteKnowledgeScopeRowTx removes the registry row inside an existing
// transaction. Safe no-op when the row does not exist (DeleteScope may
// be called for non-runtime_knowledge_bank scopes too).
func (b *SQLiteBackend) deleteKnowledgeScopeRowTx(tx *sql.Tx, scopeID string) error {
	if _, err := tx.Exec(`DELETE FROM cognition_scope_registry WHERE scope_id = ?`, scopeID); err != nil {
		return fmt.Errorf("storage delete knowledge scope row: %w", err)
	}
	return nil
}

func validateKnowledgeScopeRow(row KnowledgeScopeRow) error {
	if row.ScopeKind != KnowledgeScopeKindRuntimeKnowledgeBank {
		return fmt.Errorf("storage knowledge scope: %w: %q", ErrScopeRegistryKindMismatch, row.ScopeKind)
	}
	if !isAdmittedOwnerKind(row.OwnerKind) {
		return fmt.Errorf("storage knowledge scope: invalid owner_kind %q", row.OwnerKind)
	}
	if strings.TrimSpace(row.OwnerKey) == "" {
		return fmt.Errorf("storage knowledge scope: owner_key is required")
	}
	if len(row.OwnerJSON) == 0 {
		return fmt.Errorf("storage knowledge scope: owner_json is required")
	}
	if strings.TrimSpace(row.DisplayName) == "" {
		return fmt.Errorf("storage knowledge scope: display_name is required")
	}
	if len(row.MetadataJSON) == 0 {
		row.MetadataJSON = []byte("{}")
	}
	if row.CreatedAt.IsZero() || row.UpdatedAt.IsZero() {
		return fmt.Errorf("storage knowledge scope: created_at and updated_at are required")
	}
	return nil
}

func isAdmittedOwnerKind(kind string) bool {
	return kind == KnowledgeScopeOwnerKindAppPrivate || kind == KnowledgeScopeOwnerKindWorkspacePrivate
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("?,", n-1) + "?"
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanKnowledgeScopeRow(s rowScanner) (KnowledgeScopeRow, error) {
	var (
		out          KnowledgeScopeRow
		ownerJSON    string
		metadataJSON string
		createdAt    string
		updatedAt    string
	)
	if err := s.Scan(&out.ScopeID, &out.ScopeKind, &out.OwnerKind, &out.OwnerKey,
		&ownerJSON, &out.DisplayName, &metadataJSON, &createdAt, &updatedAt); err != nil {
		return KnowledgeScopeRow{}, err
	}
	out.OwnerJSON = []byte(ownerJSON)
	out.MetadataJSON = []byte(metadataJSON)
	parsedCreated, err := decodeTime(createdAt)
	if err != nil {
		return KnowledgeScopeRow{}, fmt.Errorf("decode created_at: %w", err)
	}
	parsedUpdated, err := decodeTime(updatedAt)
	if err != nil {
		return KnowledgeScopeRow{}, fmt.Errorf("decode updated_at: %w", err)
	}
	out.CreatedAt = parsedCreated
	out.UpdatedAt = parsedUpdated
	return out, nil
}

func decodeScopeRegistryPageToken(token string) (int, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, nil
	}
	var v int
	if _, err := fmt.Sscanf(token, "%d", &v); err != nil || v < 0 {
		return 0, fmt.Errorf("storage list knowledge scopes: invalid page token %q", token)
	}
	return v, nil
}

func isUniqueConstraintErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "constraint failed: unique") || strings.Contains(msg, "constraint unique")
}
