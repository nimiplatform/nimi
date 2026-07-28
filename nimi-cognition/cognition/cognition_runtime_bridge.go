package cognition

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
)

type RuntimeAccessMode string

const (
	RuntimeAccessRead  RuntimeAccessMode = "read"
	RuntimeAccessWrite RuntimeAccessMode = "write"
)

var errRuntimeAuthorizationDenied = errors.New("runtime bridge authorization denied")

// RuntimeAuthorization is a call-scoped decision already evaluated by
// Runtime. Cognition validates that the decision is complete and bound to the
// exact adapter operation; it does not infer account, App, workspace, or
// permission truth.
type RuntimeAuthorization struct {
	Allowed   bool
	AccountID string
	AppID     string
	Mode      RuntimeAccessMode
	ScopeID   string
	Owner     KnowledgeScopeOwner
}

// RuntimeBridge is the typed adapter surface used by Runtime-owned Knowledge.
// It deliberately exposes no App permission, Realm grant, Skill, or LocalAgent
// product surface.
type RuntimeBridge struct {
	core *Cognition
}

func (s *RuntimeBridge) CreateKnowledgeScope(ctx context.Context, auth RuntimeAuthorization, desc KnowledgeScopeDescriptor) (KnowledgeScope, error) {
	if err := validateRuntimeAuthorization(auth, RuntimeAccessWrite, ""); err != nil {
		return KnowledgeScope{}, err
	}
	if !sameKnowledgeOwner(auth.Owner, desc.Owner) {
		return KnowledgeScope{}, errRuntimeAuthorizationDenied
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return KnowledgeScope{}, errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.createKnowledgeScopeInternal(ctx, desc)
}

func (s *RuntimeBridge) ListKnowledgeScopes(ctx context.Context, auth RuntimeAuthorization, filter KnowledgeScopeFilter) ([]KnowledgeScope, string, error) {
	if err := validateRuntimeAuthorization(auth, RuntimeAccessRead, ""); err != nil {
		return nil, "", err
	}
	if len(filter.Owners) != 1 || !sameKnowledgeOwner(auth.Owner, filter.Owners[0]) {
		return nil, "", errRuntimeAuthorizationDenied
	}
	for _, kind := range filter.OwnerKinds {
		if strings.TrimSpace(kind) != strings.TrimSpace(auth.Owner.Kind) {
			return nil, "", errRuntimeAuthorizationDenied
		}
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return nil, "", errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.listKnowledgeScopesInternal(ctx, filter)
}

func (s *RuntimeBridge) DeleteKnowledgeScope(ctx context.Context, auth RuntimeAuthorization, scopeID string) error {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, scopeID); err != nil {
		return err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.deleteKnowledgeScopeInternal(ctx, scopeID)
}

func (s *RuntimeBridge) SaveKnowledge(_ context.Context, auth RuntimeAuthorization, page knowledge.Page) error {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, page.ScopeID); err != nil {
		return err
	}
	return s.core.knowledgeSvc.saveInternal(page)
}

func (s *RuntimeBridge) LoadKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.loadInternal(scopeID, pageID)
}

func (s *RuntimeBridge) ListKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listInternal(scopeID)
}

func (s *RuntimeBridge) SearchKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchLexicalInternal(scopeID, query, limit)
}

func (s *RuntimeBridge) SearchKnowledgeHybrid(_ context.Context, auth RuntimeAuthorization, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchHybridInternal(scopeID, query, limit)
}

func (s *RuntimeBridge) DeleteKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) error {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, scopeID); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deleteInternal(scopeID, pageID)
}

func (s *RuntimeBridge) PutKnowledgeRelation(_ context.Context, auth RuntimeAuthorization, rel knowledge.Relation) error {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, rel.ScopeID); err != nil {
		return err
	}
	return s.core.knowledgeSvc.putRelationInternal(rel)
}

func (s *RuntimeBridge) DeleteKnowledgeRelation(_ context.Context, auth RuntimeAuthorization, scopeID string, fromPageID knowledge.PageID, toPageID knowledge.PageID, relationType string) error {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, scopeID); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deleteRelationInternal(scopeID, fromPageID, toPageID, relationType)
}

func (s *RuntimeBridge) ListKnowledgeRelations(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listRelationsInternal(scopeID, pageID)
}

func (s *RuntimeBridge) ListKnowledgeBacklinks(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listBacklinksInternal(scopeID, pageID)
}

func (s *RuntimeBridge) TraverseKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, rootPageID knowledge.PageID, depth int) ([]knowledge.TraversalHit, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.traverseInternal(scopeID, rootPageID, depth)
}

func (s *RuntimeBridge) IngestKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, env knowledge.IngestEnvelope) (*knowledge.IngestTask, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessWrite, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.ingestDocumentInternal(scopeID, env)
}

func (s *RuntimeBridge) GetKnowledgeIngestTask(_ context.Context, auth RuntimeAuthorization, scopeID string, taskID string) (*knowledge.IngestTask, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeAccessRead, scopeID); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.getIngestTaskInternal(scopeID, taskID)
}

func (s *RuntimeBridge) validateScopeAuthorization(auth RuntimeAuthorization, mode RuntimeAccessMode, scopeID string) error {
	if err := validateRuntimeAuthorization(auth, mode, scopeID); err != nil {
		return err
	}
	row, err := s.core.store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		if errors.Is(err, storage.ErrScopeRegistryNotFound) {
			return ErrScopeNotFound
		}
		return fmt.Errorf("runtime bridge: inspect knowledge scope: %w", err)
	}
	if row.ScopeKind != storage.KnowledgeScopeKindRuntimeKnowledgeBank {
		return errRuntimeAuthorizationDenied
	}
	ownerKey, err := canonicalOwnerKey(auth.Owner)
	if err != nil || ownerKey != row.OwnerKey {
		return errRuntimeAuthorizationDenied
	}
	return nil
}

func validateRuntimeAuthorization(auth RuntimeAuthorization, mode RuntimeAccessMode, scopeID string) error {
	if !auth.Allowed ||
		strings.TrimSpace(auth.AccountID) == "" ||
		strings.TrimSpace(auth.AppID) == "" ||
		auth.Mode != mode ||
		strings.TrimSpace(auth.Owner.Kind) == "" {
		return errRuntimeAuthorizationDenied
	}
	expectedScopeID := strings.TrimSpace(scopeID)
	if expectedScopeID != "" && strings.TrimSpace(auth.ScopeID) != expectedScopeID {
		return errRuntimeAuthorizationDenied
	}
	if expectedScopeID == "" && strings.TrimSpace(auth.ScopeID) != "" {
		return errRuntimeAuthorizationDenied
	}
	if auth.Owner.Kind == KnowledgeScopeOwnerKindAppPrivate && strings.TrimSpace(auth.Owner.AppID) != strings.TrimSpace(auth.AppID) {
		return errRuntimeAuthorizationDenied
	}
	return nil
}

func sameKnowledgeOwner(left KnowledgeScopeOwner, right KnowledgeScopeOwner) bool {
	leftKey, leftErr := canonicalOwnerKey(left)
	rightKey, rightErr := canonicalOwnerKey(right)
	return leftErr == nil && rightErr == nil && leftKey == rightKey
}

func rejectDirectRuntimePrivateScope(store *storage.SQLiteBackend, scopeID string, operation string) error {
	if store == nil {
		return nil
	}
	row, err := store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		if errors.Is(err, storage.ErrScopeRegistryNotFound) {
			return nil
		}
		return fmt.Errorf("%s: inspect runtime private scope: %w", operation, err)
	}
	if row.OwnerKind != storage.KnowledgeScopeOwnerKindAppPrivate {
		return nil
	}
	return fmt.Errorf("%s: app_private scope %s requires RuntimeBridge", operation, scopeID)
}

func rejectDirectRuntimeKnowledgeBankScope(store *storage.SQLiteBackend, scopeID string, operation string) error {
	if store == nil {
		return nil
	}
	row, err := store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		if errors.Is(err, storage.ErrScopeRegistryNotFound) {
			return nil
		}
		return fmt.Errorf("%s: inspect runtime knowledge bank scope: %w", operation, err)
	}
	if row.ScopeKind != storage.KnowledgeScopeKindRuntimeKnowledgeBank {
		return nil
	}
	return fmt.Errorf("%s: runtime_knowledge_bank scope %s requires RuntimeBridge", operation, scopeID)
}
