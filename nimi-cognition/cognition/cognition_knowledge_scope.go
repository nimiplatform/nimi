package cognition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/identity"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
)

// Public scope-kind / owner-kind constants. These are stable typed
// labels so callers do not depend on the storage-layer string literals.
const (
	KnowledgeScopeKindRuntimeKnowledgeBank = storage.KnowledgeScopeKindRuntimeKnowledgeBank
	KnowledgeScopeOwnerKindAppPrivate      = storage.KnowledgeScopeOwnerKindAppPrivate
	KnowledgeScopeOwnerKindWorkspace       = storage.KnowledgeScopeOwnerKindWorkspacePrivate
)

// Errors surfaced by the typed registry. The storage layer maps its
// internal sentinels to these public values via errors.Is.
var (
	ErrScopeNotFound      = errors.New("cognition knowledge scope: not found")
	ErrScopeOwnerConflict = errors.New("cognition knowledge scope: owner conflict")
	ErrScopeKindMismatch  = errors.New("cognition knowledge scope: scope kind mismatch")
)

// KnowledgeScopeOwner declares the typed owner of a runtime knowledge
// bank scope. Callers populate Kind + AppID/WorkspaceID; the registry
// derives Key/JSON.
type KnowledgeScopeOwner struct {
	Kind        string // KnowledgeScopeOwnerKindAppPrivate or KnowledgeScopeOwnerKindWorkspace
	AppID       string // required when Kind == KnowledgeScopeOwnerKindAppPrivate
	WorkspaceID string // required when Kind == KnowledgeScopeOwnerKindWorkspace
}

// KnowledgeScopeDescriptor is the input to CreateKnowledgeScope. The
// registry generates ScopeID and timestamps; callers must not pre-fill
// them.
type KnowledgeScopeDescriptor struct {
	Owner       KnowledgeScopeOwner
	DisplayName string
	Metadata    map[string]any
}

// KnowledgeScope is the typed projection of a registry row.
type KnowledgeScope struct {
	ScopeID     string
	ScopeKind   string
	Owner       KnowledgeScopeOwner
	OwnerKey    string
	DisplayName string
	Metadata    map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// KnowledgeScopeFilter narrows ListKnowledgeScopes. Empty fields match
// everything in their dimension.
type KnowledgeScopeFilter struct {
	OwnerKinds []string
	Owners     []KnowledgeScopeOwner
	PageSize   int
	PageToken  string
}

// KnowledgeScopeRegistry is the typed Go API for the
// cognition_scope_registry. Production paths must consume this surface
// rather than constructing scope ids by ad-hoc string concatenation.
type KnowledgeScopeRegistry interface {
	CreateKnowledgeScope(ctx context.Context, desc KnowledgeScopeDescriptor) (KnowledgeScope, error)
	GetKnowledgeScope(ctx context.Context, scopeID string) (KnowledgeScope, error)
	ListKnowledgeScopes(ctx context.Context, filter KnowledgeScopeFilter) ([]KnowledgeScope, string, error)
	DeleteKnowledgeScope(ctx context.Context, scopeID string) error
}

// newKnowledgeScopeRegistry constructs the typed registry against the
// shared SQLite-backed cognition store. Constructor injection only —
// no global state.
func newKnowledgeScopeRegistry(store *storage.SQLiteBackend, clk clock.Clock) KnowledgeScopeRegistry {
	return &knowledgeScopeRegistry{store: store, clock: clk}
}

type knowledgeScopeRegistry struct {
	store *storage.SQLiteBackend
	clock clock.Clock
}

// CreateKnowledgeScope registers a new runtime_knowledge_bank scope.
func (r *knowledgeScopeRegistry) CreateKnowledgeScope(_ context.Context, desc KnowledgeScopeDescriptor) (KnowledgeScope, error) {
	if err := validateKnowledgeScopeDescriptor(desc); err != nil {
		return KnowledgeScope{}, err
	}
	if desc.Owner.Kind == storage.KnowledgeScopeOwnerKindAppPrivate {
		return KnowledgeScope{}, fmt.Errorf("cognition knowledge scope: app_private create requires AppMemoryAccessService with admitted C-APMEM policy")
	}
	return r.createKnowledgeScopeInternal(context.Background(), desc)
}

func (r *knowledgeScopeRegistry) createKnowledgeScopeInternal(_ context.Context, desc KnowledgeScopeDescriptor) (KnowledgeScope, error) {
	if err := validateKnowledgeScopeDescriptor(desc); err != nil {
		return KnowledgeScope{}, err
	}
	ownerKey, err := canonicalOwnerKey(desc.Owner)
	if err != nil {
		return KnowledgeScope{}, err
	}
	ownerJSON, err := encodeOwnerJSON(desc.Owner)
	if err != nil {
		return KnowledgeScope{}, err
	}
	metadataJSON, err := encodeMetadata(desc.Metadata)
	if err != nil {
		return KnowledgeScope{}, err
	}
	scopeID, err := identity.NewID()
	if err != nil {
		return KnowledgeScope{}, fmt.Errorf("cognition knowledge scope: generate id: %w", err)
	}
	now := r.now()
	row := storage.KnowledgeScopeRow{
		ScopeID:      scopeID,
		ScopeKind:    storage.KnowledgeScopeKindRuntimeKnowledgeBank,
		OwnerKind:    desc.Owner.Kind,
		OwnerKey:     ownerKey,
		OwnerJSON:    ownerJSON,
		DisplayName:  strings.TrimSpace(desc.DisplayName),
		MetadataJSON: metadataJSON,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := r.store.CreateKnowledgeScopeRow(row); err != nil {
		return KnowledgeScope{}, mapStorageScopeErr(err)
	}
	return projectKnowledgeScope(row)
}

// GetKnowledgeScope loads a scope by id.
func (r *knowledgeScopeRegistry) GetKnowledgeScope(_ context.Context, scopeID string) (KnowledgeScope, error) {
	row, err := r.store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		return KnowledgeScope{}, mapStorageScopeErr(err)
	}
	return projectKnowledgeScope(row)
}

// ListKnowledgeScopes filters and paginates registry rows.
func (r *knowledgeScopeRegistry) ListKnowledgeScopes(_ context.Context, filter KnowledgeScopeFilter) ([]KnowledgeScope, string, error) {
	if filterIncludesAppPrivate(filter) {
		return nil, "", fmt.Errorf("cognition knowledge scope: app_private list requires AppMemoryAccessService with admitted C-APMEM policy")
	}
	return r.listKnowledgeScopesInternal(context.Background(), filter)
}

func (r *knowledgeScopeRegistry) listKnowledgeScopesInternal(_ context.Context, filter KnowledgeScopeFilter) ([]KnowledgeScope, string, error) {
	for _, kind := range filter.OwnerKinds {
		if !isPublicOwnerKind(kind) {
			return nil, "", fmt.Errorf("cognition knowledge scope: invalid owner kind %q", kind)
		}
	}
	storageFilter := storage.KnowledgeScopeFilter{
		OwnerKinds: append([]string(nil), filter.OwnerKinds...),
		PageSize:   filter.PageSize,
		PageToken:  filter.PageToken,
	}
	for _, owner := range filter.Owners {
		key, err := canonicalOwnerKey(owner)
		if err != nil {
			return nil, "", err
		}
		storageFilter.OwnerKeys = append(storageFilter.OwnerKeys, key)
	}
	rows, nextToken, err := r.store.ListKnowledgeScopeRows(storageFilter)
	if err != nil {
		return nil, "", mapStorageScopeErr(err)
	}
	out := make([]KnowledgeScope, 0, len(rows))
	for _, row := range rows {
		scope, err := projectKnowledgeScope(row)
		if err != nil {
			return nil, "", err
		}
		out = append(out, scope)
	}
	return out, nextToken, nil
}

// DeleteKnowledgeScope removes a scope and all scope-anchored rows in
// the cognition store via SQLiteBackend.DeleteScope.
func (r *knowledgeScopeRegistry) DeleteKnowledgeScope(_ context.Context, scopeID string) error {
	if err := rejectDirectAppPrivateScope(r.store, scopeID, "knowledge scope delete"); err != nil {
		return err
	}
	return r.deleteKnowledgeScopeInternal(context.Background(), scopeID)
}

func (r *knowledgeScopeRegistry) deleteKnowledgeScopeInternal(_ context.Context, scopeID string) error {
	// Confirm the scope exists as a registered runtime_knowledge_bank
	// before cascading; this is what makes the call idempotent and
	// distinguishes a "registered scope delete" from a stray scope
	// drop on the underlying scope table.
	if _, err := r.store.GetKnowledgeScopeRow(scopeID); err != nil {
		return mapStorageScopeErr(err)
	}
	if err := r.store.DeleteScope(scopeID); err != nil {
		return fmt.Errorf("cognition knowledge scope: cascade delete: %w", err)
	}
	return nil
}

func (r *knowledgeScopeRegistry) now() time.Time {
	if r.clock != nil {
		return r.clock.Now().UTC()
	}
	return time.Now().UTC()
}

func filterIncludesAppPrivate(filter KnowledgeScopeFilter) bool {
	for _, kind := range filter.OwnerKinds {
		if kind == storage.KnowledgeScopeOwnerKindAppPrivate {
			return true
		}
	}
	for _, owner := range filter.Owners {
		if owner.Kind == storage.KnowledgeScopeOwnerKindAppPrivate {
			return true
		}
	}
	return len(filter.OwnerKinds) == 0 && len(filter.Owners) == 0
}

func validateKnowledgeScopeDescriptor(desc KnowledgeScopeDescriptor) error {
	if !isPublicOwnerKind(desc.Owner.Kind) {
		return fmt.Errorf("cognition knowledge scope: invalid owner kind %q", desc.Owner.Kind)
	}
	switch desc.Owner.Kind {
	case storage.KnowledgeScopeOwnerKindAppPrivate:
		if strings.TrimSpace(desc.Owner.AppID) == "" {
			return fmt.Errorf("cognition knowledge scope: app_id is required for app_private owner")
		}
		if strings.TrimSpace(desc.Owner.WorkspaceID) != "" {
			return fmt.Errorf("cognition knowledge scope: app_private owner must not set workspace_id")
		}
	case storage.KnowledgeScopeOwnerKindWorkspacePrivate:
		if strings.TrimSpace(desc.Owner.WorkspaceID) == "" {
			return fmt.Errorf("cognition knowledge scope: workspace_id is required for workspace_private owner")
		}
		if strings.TrimSpace(desc.Owner.AppID) != "" {
			return fmt.Errorf("cognition knowledge scope: workspace_private owner must not set app_id")
		}
	}
	if strings.TrimSpace(desc.DisplayName) == "" {
		return fmt.Errorf("cognition knowledge scope: display_name is required")
	}
	return nil
}

func canonicalOwnerKey(owner KnowledgeScopeOwner) (string, error) {
	switch owner.Kind {
	case storage.KnowledgeScopeOwnerKindAppPrivate:
		appID := strings.TrimSpace(owner.AppID)
		if appID == "" {
			return "", fmt.Errorf("cognition knowledge scope: app_id is required for app_private owner")
		}
		return "app:" + appID, nil
	case storage.KnowledgeScopeOwnerKindWorkspacePrivate:
		workspaceID := strings.TrimSpace(owner.WorkspaceID)
		if workspaceID == "" {
			return "", fmt.Errorf("cognition knowledge scope: workspace_id is required for workspace_private owner")
		}
		return "workspace:" + workspaceID, nil
	default:
		return "", fmt.Errorf("cognition knowledge scope: invalid owner kind %q", owner.Kind)
	}
}

func encodeOwnerJSON(owner KnowledgeScopeOwner) ([]byte, error) {
	switch owner.Kind {
	case storage.KnowledgeScopeOwnerKindAppPrivate:
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			AppID string `json:"app_id"`
		}{Kind: owner.Kind, AppID: strings.TrimSpace(owner.AppID)})
	case storage.KnowledgeScopeOwnerKindWorkspacePrivate:
		return json.Marshal(struct {
			Kind        string `json:"kind"`
			WorkspaceID string `json:"workspace_id"`
		}{Kind: owner.Kind, WorkspaceID: strings.TrimSpace(owner.WorkspaceID)})
	default:
		return nil, fmt.Errorf("cognition knowledge scope: invalid owner kind %q", owner.Kind)
	}
}

func encodeMetadata(meta map[string]any) ([]byte, error) {
	if meta == nil {
		return []byte("{}"), nil
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("cognition knowledge scope: encode metadata: %w", err)
	}
	if len(raw) == 0 {
		return []byte("{}"), nil
	}
	return raw, nil
}

func projectKnowledgeScope(row storage.KnowledgeScopeRow) (KnowledgeScope, error) {
	owner, err := decodeOwnerJSON(row.OwnerKind, row.OwnerJSON)
	if err != nil {
		return KnowledgeScope{}, err
	}
	metadata, err := decodeMetadata(row.MetadataJSON)
	if err != nil {
		return KnowledgeScope{}, err
	}
	return KnowledgeScope{
		ScopeID:     row.ScopeID,
		ScopeKind:   row.ScopeKind,
		Owner:       owner,
		OwnerKey:    row.OwnerKey,
		DisplayName: row.DisplayName,
		Metadata:    metadata,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

func decodeOwnerJSON(kind string, raw []byte) (KnowledgeScopeOwner, error) {
	owner := KnowledgeScopeOwner{Kind: kind}
	if len(raw) == 0 {
		return owner, nil
	}
	switch kind {
	case storage.KnowledgeScopeOwnerKindAppPrivate:
		var payload struct {
			AppID string `json:"app_id"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return KnowledgeScopeOwner{}, fmt.Errorf("cognition knowledge scope: decode app owner: %w", err)
		}
		owner.AppID = payload.AppID
	case storage.KnowledgeScopeOwnerKindWorkspacePrivate:
		var payload struct {
			WorkspaceID string `json:"workspace_id"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return KnowledgeScopeOwner{}, fmt.Errorf("cognition knowledge scope: decode workspace owner: %w", err)
		}
		owner.WorkspaceID = payload.WorkspaceID
	default:
		return KnowledgeScopeOwner{}, fmt.Errorf("cognition knowledge scope: unknown owner kind %q", kind)
	}
	return owner, nil
}

func decodeMetadata(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("cognition knowledge scope: decode metadata: %w", err)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func isPublicOwnerKind(kind string) bool {
	return kind == storage.KnowledgeScopeOwnerKindAppPrivate || kind == storage.KnowledgeScopeOwnerKindWorkspacePrivate
}

func mapStorageScopeErr(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, storage.ErrScopeRegistryNotFound):
		return fmt.Errorf("%w: %s", ErrScopeNotFound, err.Error())
	case errors.Is(err, storage.ErrScopeRegistryOwnerConflict):
		return fmt.Errorf("%w: %s", ErrScopeOwnerConflict, err.Error())
	case errors.Is(err, storage.ErrScopeRegistryKindMismatch):
		return fmt.Errorf("%w: %s", ErrScopeKindMismatch, err.Error())
	default:
		return err
	}
}
