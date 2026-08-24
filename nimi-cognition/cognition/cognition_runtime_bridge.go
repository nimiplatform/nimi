package cognition

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
)

type RuntimeAuthorizationDecision string

const RuntimeAuthorizationDecisionAllow RuntimeAuthorizationDecision = "allow"

type RuntimeAuthorizationAction string

// RuntimeAuthorizationAction mirrors the closed Runtime KnowledgeAction
// identity carried by an evaluated decision. It is not a Cognition-owned
// permission vocabulary.
const (
	RuntimeAuthorizationActionCreateBank RuntimeAuthorizationAction = "create_bank"
	RuntimeAuthorizationActionReadBank   RuntimeAuthorizationAction = "read_bank"
	RuntimeAuthorizationActionDeleteBank RuntimeAuthorizationAction = "delete_bank"
	RuntimeAuthorizationActionWritePage  RuntimeAuthorizationAction = "write_page"
	RuntimeAuthorizationActionReadPage   RuntimeAuthorizationAction = "read_page"
	RuntimeAuthorizationActionDeletePage RuntimeAuthorizationAction = "delete_page"
	RuntimeAuthorizationActionSearch     RuntimeAuthorizationAction = "search"
	RuntimeAuthorizationActionWriteLink  RuntimeAuthorizationAction = "write_link"
	RuntimeAuthorizationActionReadLink   RuntimeAuthorizationAction = "read_link"
	RuntimeAuthorizationActionIngest     RuntimeAuthorizationAction = "ingest"
)

type RuntimeBridgeOperation string

const (
	RuntimeBridgeOperationCreateKnowledgeScope    RuntimeBridgeOperation = "create_knowledge_scope"
	RuntimeBridgeOperationGetKnowledgeScope       RuntimeBridgeOperation = "get_knowledge_scope"
	RuntimeBridgeOperationListKnowledgeScopes     RuntimeBridgeOperation = "list_knowledge_scopes"
	RuntimeBridgeOperationDeleteKnowledgeScope    RuntimeBridgeOperation = "delete_knowledge_scope"
	RuntimeBridgeOperationSaveKnowledge           RuntimeBridgeOperation = "save_knowledge"
	RuntimeBridgeOperationLoadKnowledge           RuntimeBridgeOperation = "load_knowledge"
	RuntimeBridgeOperationListKnowledge           RuntimeBridgeOperation = "list_knowledge"
	RuntimeBridgeOperationSearchKnowledge         RuntimeBridgeOperation = "search_knowledge"
	RuntimeBridgeOperationSearchKnowledgeHybrid   RuntimeBridgeOperation = "search_knowledge_hybrid"
	RuntimeBridgeOperationDeleteKnowledgePage     RuntimeBridgeOperation = "delete_knowledge_page"
	RuntimeBridgeOperationPutKnowledgeRelation    RuntimeBridgeOperation = "put_knowledge_relation"
	RuntimeBridgeOperationDeleteKnowledgeRelation RuntimeBridgeOperation = "delete_knowledge_relation"
	RuntimeBridgeOperationListKnowledgeRelations  RuntimeBridgeOperation = "list_knowledge_relations"
	RuntimeBridgeOperationListKnowledgeBacklinks  RuntimeBridgeOperation = "list_knowledge_backlinks"
	RuntimeBridgeOperationTraverseKnowledge       RuntimeBridgeOperation = "traverse_knowledge"
	RuntimeBridgeOperationIngestKnowledge         RuntimeBridgeOperation = "ingest_knowledge"
	RuntimeBridgeOperationGetKnowledgeIngestTask  RuntimeBridgeOperation = "get_knowledge_ingest_task"
)

var errRuntimeAuthorizationDenied = errors.New("runtime bridge authorization denied")

// IsRuntimeAuthorizationDenied reports whether a RuntimeBridge call rejected
// an authorization carrier or owner/filter binding before touching storage.
func IsRuntimeAuthorizationDenied(err error) bool {
	return errors.Is(err, errRuntimeAuthorizationDenied)
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r005
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r006
// RuntimeAuthorization is a call-scoped decision already evaluated by
// Runtime. Cognition validates that the decision is complete and bound to the
// exact adapter operation; it does not infer account, App, workspace, or
// permission truth.
type RuntimeAuthorization struct {
	Decision    RuntimeAuthorizationDecision
	Action      RuntimeAuthorizationAction
	Operation   RuntimeBridgeOperation
	AccountID   string
	AppID       string
	ScopeID     string
	Owner       KnowledgeScopeOwner
	EvaluatedAt time.Time
	ExpiresAt   time.Time
}

// @nimi-authority: definition.nimi.cognition.runtime-bridge.domain
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r002
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r003
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r009
// RuntimeBridge is the typed adapter surface used by Runtime-owned Knowledge.
// It deliberately exposes no App permission, Realm grant, Skill, or LocalAgent
// product surface.
type RuntimeBridge struct {
	core *Cognition
}

func (s *RuntimeBridge) CreateKnowledgeScope(ctx context.Context, auth RuntimeAuthorization, desc KnowledgeScopeDescriptor) (KnowledgeScope, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationCreateKnowledgeScope, "", RuntimeAuthorizationActionCreateBank); err != nil {
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

func (s *RuntimeBridge) GetKnowledgeScope(ctx context.Context, auth RuntimeAuthorization, scopeID string) (KnowledgeScope, error) {
	if err := s.validateScopeAuthorization(
		auth,
		RuntimeBridgeOperationGetKnowledgeScope,
		scopeID,
		RuntimeAuthorizationActionCreateBank,
		RuntimeAuthorizationActionReadBank,
		RuntimeAuthorizationActionDeleteBank,
		RuntimeAuthorizationActionWritePage,
		RuntimeAuthorizationActionReadPage,
		RuntimeAuthorizationActionDeletePage,
		RuntimeAuthorizationActionSearch,
		RuntimeAuthorizationActionWriteLink,
		RuntimeAuthorizationActionReadLink,
		RuntimeAuthorizationActionIngest,
	); err != nil {
		return KnowledgeScope{}, err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return KnowledgeScope{}, errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.GetKnowledgeScope(ctx, scopeID)
}

func (s *RuntimeBridge) ListKnowledgeScopes(ctx context.Context, auth RuntimeAuthorization, filter KnowledgeScopeFilter) ([]KnowledgeScope, int, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationListKnowledgeScopes, "", RuntimeAuthorizationActionReadBank); err != nil {
		return nil, 0, err
	}
	if len(filter.Owners) != 1 || !sameKnowledgeOwner(auth.Owner, filter.Owners[0]) {
		return nil, 0, errRuntimeAuthorizationDenied
	}
	for _, kind := range filter.OwnerKinds {
		if strings.TrimSpace(kind) != strings.TrimSpace(auth.Owner.Kind) {
			return nil, 0, errRuntimeAuthorizationDenied
		}
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return nil, 0, errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.listKnowledgeScopesInternal(ctx, filter)
}

func (s *RuntimeBridge) DeleteKnowledgeScope(ctx context.Context, auth RuntimeAuthorization, scopeID string) error {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationDeleteKnowledgeScope, scopeID, RuntimeAuthorizationActionDeleteBank); err != nil {
		return err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return errors.New("runtime bridge: knowledge scope registry implementation is unavailable")
	}
	return registry.deleteKnowledgeScopeInternal(ctx, scopeID)
}

func (s *RuntimeBridge) SaveKnowledge(_ context.Context, auth RuntimeAuthorization, page knowledge.Page) error {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationSaveKnowledge, page.ScopeID, RuntimeAuthorizationActionWritePage); err != nil {
		return err
	}
	return s.core.knowledgeSvc.saveInternal(page)
}

func (s *RuntimeBridge) LoadKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationLoadKnowledge, scopeID, RuntimeAuthorizationActionReadPage, RuntimeAuthorizationActionWritePage, RuntimeAuthorizationActionDeletePage, RuntimeAuthorizationActionReadLink, RuntimeAuthorizationActionReadBank); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.loadInternal(scopeID, pageID)
}

func (s *RuntimeBridge) ListKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationListKnowledge, scopeID, RuntimeAuthorizationActionReadPage, RuntimeAuthorizationActionWritePage, RuntimeAuthorizationActionDeletePage, RuntimeAuthorizationActionReadLink, RuntimeAuthorizationActionWriteLink); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listInternal(scopeID)
}

func (s *RuntimeBridge) SearchKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationSearchKnowledge, scopeID, RuntimeAuthorizationActionSearch); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchLexicalInternal(scopeID, query, limit)
}

func (s *RuntimeBridge) SearchKnowledgeHybrid(_ context.Context, auth RuntimeAuthorization, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationSearchKnowledgeHybrid, scopeID, RuntimeAuthorizationActionSearch); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchHybridInternal(scopeID, query, limit)
}

// DeleteKnowledgePage performs the complete page-owned delete as one storage
// transaction after one fresh, scope-bound Runtime authorization validation.
func (s *RuntimeBridge) DeleteKnowledgePage(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) error {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationDeleteKnowledgePage, scopeID, RuntimeAuthorizationActionDeletePage); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deletePageWithRelationsInternal(scopeID, pageID)
}

func (s *RuntimeBridge) PutKnowledgeRelation(_ context.Context, auth RuntimeAuthorization, rel knowledge.Relation) error {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationPutKnowledgeRelation, rel.ScopeID, RuntimeAuthorizationActionWriteLink); err != nil {
		return err
	}
	return s.core.knowledgeSvc.putRelationInternal(rel)
}

func (s *RuntimeBridge) DeleteKnowledgeRelation(_ context.Context, auth RuntimeAuthorization, scopeID string, fromPageID knowledge.PageID, toPageID knowledge.PageID, relationType string) error {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationDeleteKnowledgeRelation, scopeID, RuntimeAuthorizationActionWriteLink, RuntimeAuthorizationActionDeletePage); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deleteRelationInternal(scopeID, fromPageID, toPageID, relationType)
}

func (s *RuntimeBridge) ListKnowledgeRelations(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationListKnowledgeRelations, scopeID, RuntimeAuthorizationActionReadLink, RuntimeAuthorizationActionWriteLink, RuntimeAuthorizationActionDeletePage); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listRelationsInternal(scopeID, pageID)
}

func (s *RuntimeBridge) ListKnowledgeBacklinks(_ context.Context, auth RuntimeAuthorization, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationListKnowledgeBacklinks, scopeID, RuntimeAuthorizationActionReadLink); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listBacklinksInternal(scopeID, pageID)
}

func (s *RuntimeBridge) TraverseKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, rootPageID knowledge.PageID, depth int) ([]knowledge.TraversalHit, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationTraverseKnowledge, scopeID, RuntimeAuthorizationActionReadLink); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.traverseInternal(scopeID, rootPageID, depth)
}

func (s *RuntimeBridge) IngestKnowledge(_ context.Context, auth RuntimeAuthorization, scopeID string, env knowledge.IngestEnvelope) (*knowledge.IngestTask, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationIngestKnowledge, scopeID, RuntimeAuthorizationActionIngest); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.ingestDocumentInternal(scopeID, env)
}

func (s *RuntimeBridge) GetKnowledgeIngestTask(_ context.Context, auth RuntimeAuthorization, scopeID string, taskID string) (*knowledge.IngestTask, error) {
	if err := s.validateScopeAuthorization(auth, RuntimeBridgeOperationGetKnowledgeIngestTask, scopeID, RuntimeAuthorizationActionReadBank); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.getIngestTaskInternal(scopeID, taskID)
}

func (s *RuntimeBridge) validateScopeAuthorization(auth RuntimeAuthorization, operation RuntimeBridgeOperation, scopeID string, actions ...RuntimeAuthorizationAction) error {
	if err := s.validateRuntimeAuthorizationShape(auth, operation, scopeID, actions...); err != nil {
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
	// Freshness is checked once, after immutable operation/scope/owner binding
	// and immediately before the bridge invokes its storage owner.
	return s.validateRuntimeAuthorizationFreshness(auth)
}

func (s *RuntimeBridge) validateRuntimeAuthorization(auth RuntimeAuthorization, operation RuntimeBridgeOperation, scopeID string, actions ...RuntimeAuthorizationAction) error {
	if err := s.validateRuntimeAuthorizationShape(auth, operation, scopeID, actions...); err != nil {
		return err
	}
	return s.validateRuntimeAuthorizationFreshness(auth)
}

func (s *RuntimeBridge) validateRuntimeAuthorizationShape(auth RuntimeAuthorization, operation RuntimeBridgeOperation, scopeID string, actions ...RuntimeAuthorizationAction) error {
	if s == nil || s.core == nil ||
		auth.Decision != RuntimeAuthorizationDecisionAllow ||
		auth.Operation != operation ||
		!runtimeAuthorizationActionAllowed(auth.Action, actions) ||
		strings.TrimSpace(auth.AccountID) == "" ||
		strings.TrimSpace(auth.AppID) == "" ||
		strings.TrimSpace(auth.Owner.Kind) == "" ||
		auth.EvaluatedAt.IsZero() ||
		auth.ExpiresAt.IsZero() {
		return errRuntimeAuthorizationDenied
	}
	evaluatedAt := auth.EvaluatedAt.UTC()
	expiresAt := auth.ExpiresAt.UTC()
	if !evaluatedAt.Before(expiresAt) {
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

func (s *RuntimeBridge) validateRuntimeAuthorizationFreshness(auth RuntimeAuthorization) error {
	now := s.core.clock.Now().UTC()
	if auth.EvaluatedAt.UTC().After(now) || !now.Before(auth.ExpiresAt.UTC()) {
		return errRuntimeAuthorizationDenied
	}
	return nil
}

func runtimeAuthorizationActionAllowed(action RuntimeAuthorizationAction, allowed []RuntimeAuthorizationAction) bool {
	for _, candidate := range allowed {
		if action == candidate {
			return true
		}
	}
	return false
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
