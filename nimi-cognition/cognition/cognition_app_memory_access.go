package cognition

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

const (
	AppMemoryPolicyMemoryReadPersonaScopedBounded   = "memory.read.persona-scoped-bounded"
	AppMemoryPolicyMemoryReadSessionScopedBounded   = "memory.read.session-scoped-bounded"
	AppMemoryPolicyMemoryWriteSessionScopedAdmitted = "memory.write.session-scoped-admitted"
	AppMemoryPolicyKnowledgeReadBounded             = "knowledge.read.bounded"
	AppMemoryPolicyKnowledgeWriteAdmitted           = "knowledge.write.admitted"
	AppMemoryPolicySkillRunBounded                  = "skill.run.bounded"
	AppMemoryPolicyChatDerivedProjectionAdmitted    = "chat_derived.projection.admitted"
)

var errAppMemoryAccessDenied = errors.New("app memory access denied")

// AppMemoryGrantEvidence is the cognition-owned projection of an active Realm
// grant. Realm owns grant lifecycle; cognition owns the admitted policy shape
// and refuses incomplete projected evidence.
type AppMemoryGrantEvidence struct {
	GrantRef          string
	RealmAuditEventID string
	Active            bool
}

// AppMemoryAccess carries the admitted app access envelope for a single
// cognition operation.
type AppMemoryAccess struct {
	PolicyClass           string
	Grant                 AppMemoryGrantEvidence
	SourceAppID           string
	TargetPersonaID       string
	SessionRef            string
	ConversationAnchorRef string
	KnowledgeBaseID       string
	AuditReason           string
}

// AppMemoryAccessService is the sole C-APMEM app-facing facade in
// nimi-cognition. It stamps durable provenance before writes and denies missing
// policy/grant evidence before any substrate service is touched.
type AppMemoryAccessService struct {
	core *Cognition
}

func (s *AppMemoryAccessService) CreateKnowledgeScope(ctx context.Context, access AppMemoryAccess, desc KnowledgeScopeDescriptor) (KnowledgeScope, error) {
	if err := validateAppKnowledgeScopeWriteAccess(access); err != nil {
		return KnowledgeScope{}, err
	}
	if err := validateAppPrivateScopeDescriptorOwner(access, desc); err != nil {
		return KnowledgeScope{}, err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return KnowledgeScope{}, errors.New("app memory access: knowledge scope registry implementation is unavailable")
	}
	return registry.createKnowledgeScopeInternal(ctx, desc)
}

func (s *AppMemoryAccessService) ListKnowledgeScopes(ctx context.Context, access AppMemoryAccess, filter KnowledgeScopeFilter) ([]KnowledgeScope, string, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, "", err
	}
	filter, err := normalizeAppKnowledgeScopeFilter(access, filter)
	if err != nil {
		return nil, "", err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return nil, "", errors.New("app memory access: knowledge scope registry implementation is unavailable")
	}
	return registry.listKnowledgeScopesInternal(ctx, filter)
}

func (s *AppMemoryAccessService) SaveMemory(_ context.Context, access AppMemoryAccess, rec memory.Record) error {
	if err := validateAppMemoryWriteAccess(access); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, rec.ScopeID, "memory save"); err != nil {
		return err
	}
	rec.AppProjection = appMemoryProjection(access)
	return s.core.memorySvc.saveInternal(rec)
}

func (s *AppMemoryAccessService) LoadMemory(_ context.Context, access AppMemoryAccess, scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	if err := validateAppMemoryReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "memory load"); err != nil {
		return nil, err
	}
	return s.core.memorySvc.loadInternal(scopeID, recordID)
}

func (s *AppMemoryAccessService) ListMemory(_ context.Context, access AppMemoryAccess, scopeID string) ([]memory.Record, error) {
	if err := validateAppMemoryReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "memory list"); err != nil {
		return nil, err
	}
	return s.core.memorySvc.listInternal(scopeID)
}

func (s *AppMemoryAccessService) SearchMemory(_ context.Context, access AppMemoryAccess, scopeID string, query string, limit int) ([]memory.View, error) {
	if err := validateAppMemoryReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "memory search"); err != nil {
		return nil, err
	}
	return s.core.memorySvc.searchViewsInternal(scopeID, query, limit)
}

func (s *AppMemoryAccessService) DeleteMemory(_ context.Context, access AppMemoryAccess, scopeID string, recordID memory.RecordID) error {
	if err := validateAppMemoryWriteAccess(access); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "memory delete"); err != nil {
		return err
	}
	return s.core.memorySvc.deleteInternal(scopeID, recordID)
}

func (s *AppMemoryAccessService) SaveKnowledge(_ context.Context, access AppMemoryAccess, page knowledge.Page) error {
	if err := validateAppKnowledgeWriteAccess(access, page.ScopeID); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, page.ScopeID, "knowledge save"); err != nil {
		return err
	}
	page.AppWrite = appKnowledgeWrite(access, page.ScopeID)
	return s.core.knowledgeSvc.saveInternal(page)
}

func (s *AppMemoryAccessService) IngestKnowledge(_ context.Context, access AppMemoryAccess, scopeID string, env knowledge.IngestEnvelope) (*knowledge.IngestTask, error) {
	if err := validateAppKnowledgeWriteAccess(access, scopeID); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge ingest"); err != nil {
		return nil, err
	}
	env.AppWrite = appKnowledgeWrite(access, scopeID)
	return s.core.knowledgeSvc.ingestDocumentInternal(scopeID, env)
}

func (s *AppMemoryAccessService) GetKnowledgeIngestTask(_ context.Context, access AppMemoryAccess, scopeID string, taskID string) (*knowledge.IngestTask, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge ingest task"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.getIngestTaskInternal(scopeID, taskID)
}

func (s *AppMemoryAccessService) LoadKnowledge(_ context.Context, access AppMemoryAccess, scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge load"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.loadInternal(scopeID, pageID)
}

func (s *AppMemoryAccessService) ListKnowledge(_ context.Context, access AppMemoryAccess, scopeID string) ([]knowledge.Page, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge list"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listInternal(scopeID)
}

func (s *AppMemoryAccessService) SearchKnowledge(_ context.Context, access AppMemoryAccess, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge search"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchLexicalInternal(scopeID, query, limit)
}

func (s *AppMemoryAccessService) SearchKnowledgeHybrid(_ context.Context, access AppMemoryAccess, scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge hybrid search"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.searchHybridInternal(scopeID, query, limit)
}

func (s *AppMemoryAccessService) DeleteKnowledge(_ context.Context, access AppMemoryAccess, scopeID string, pageID knowledge.PageID) error {
	if err := validateAppKnowledgeWriteAccess(access, scopeID); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge delete"); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deleteInternal(scopeID, pageID)
}

func (s *AppMemoryAccessService) PutKnowledgeRelation(_ context.Context, access AppMemoryAccess, rel knowledge.Relation) error {
	if err := validateAppKnowledgeWriteAccess(access, rel.ScopeID); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, rel.ScopeID, "knowledge relation put"); err != nil {
		return err
	}
	return s.core.knowledgeSvc.putRelationInternal(rel)
}

func (s *AppMemoryAccessService) DeleteKnowledgeRelation(_ context.Context, access AppMemoryAccess, scopeID string, fromPageID knowledge.PageID, toPageID knowledge.PageID, relationType string) error {
	if err := validateAppKnowledgeWriteAccess(access, scopeID); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge relation delete"); err != nil {
		return err
	}
	return s.core.knowledgeSvc.deleteRelationInternal(scopeID, fromPageID, toPageID, relationType)
}

func (s *AppMemoryAccessService) ListKnowledgeRelations(_ context.Context, access AppMemoryAccess, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge relation list"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listRelationsInternal(scopeID, pageID)
}

func (s *AppMemoryAccessService) ListKnowledgeBacklinks(_ context.Context, access AppMemoryAccess, scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge backlink list"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.listBacklinksInternal(scopeID, pageID)
}

func (s *AppMemoryAccessService) TraverseKnowledge(_ context.Context, access AppMemoryAccess, scopeID string, rootPageID knowledge.PageID, depth int) ([]knowledge.TraversalHit, error) {
	if err := validateAppKnowledgeReadAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge traverse"); err != nil {
		return nil, err
	}
	return s.core.knowledgeSvc.traverseInternal(scopeID, rootPageID, depth)
}

func (s *AppMemoryAccessService) ListSkills(_ context.Context, access AppMemoryAccess, scopeID string) ([]skill.Bundle, error) {
	if err := validateAppSkillRunAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "skill list"); err != nil {
		return nil, err
	}
	return s.core.skillSvc.listInternal(scopeID)
}

func (s *AppMemoryAccessService) SearchSkills(_ context.Context, access AppMemoryAccess, scopeID string, query string, limit int) ([]skill.Bundle, error) {
	if err := validateAppSkillRunAccess(access); err != nil {
		return nil, err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "skill search"); err != nil {
		return nil, err
	}
	return s.core.skillSvc.searchInternal(scopeID, query, limit)
}

func (s *AppMemoryAccessService) DeleteKnowledgeScope(ctx context.Context, access AppMemoryAccess, scopeID string) error {
	if err := validateAppKnowledgeWriteAccess(access, scopeID); err != nil {
		return err
	}
	if err := ensureAppPrivateScopeOwner(s.core.store, access, scopeID, "knowledge scope delete"); err != nil {
		return err
	}
	registry, ok := s.core.knowledgeScopes.(*knowledgeScopeRegistry)
	if !ok {
		return errors.New("app memory access: knowledge scope registry implementation is unavailable")
	}
	return registry.deleteKnowledgeScopeInternal(ctx, scopeID)
}

func appMemoryProjection(access AppMemoryAccess) *memory.AppProjectionProvenance {
	return &memory.AppProjectionProvenance{
		PolicyClass:           strings.TrimSpace(access.PolicyClass),
		GrantRef:              strings.TrimSpace(access.Grant.GrantRef),
		RealmAuditEventID:     strings.TrimSpace(access.Grant.RealmAuditEventID),
		ConversationAnchorRef: strings.TrimSpace(access.ConversationAnchorRef),
		SourceAppID:           strings.TrimSpace(access.SourceAppID),
		TargetPersonaID:       strings.TrimSpace(access.TargetPersonaID),
		SessionRef:            strings.TrimSpace(access.SessionRef),
		AuditReason:           strings.TrimSpace(access.AuditReason),
	}
}

func appKnowledgeWrite(access AppMemoryAccess, scopeID string) *knowledge.AppWriteProvenance {
	return &knowledge.AppWriteProvenance{
		PolicyClass:       strings.TrimSpace(access.PolicyClass),
		GrantRef:          strings.TrimSpace(access.Grant.GrantRef),
		RealmAuditEventID: strings.TrimSpace(access.Grant.RealmAuditEventID),
		KnowledgeBaseID:   strings.TrimSpace(access.KnowledgeBaseID),
		TargetScopeID:     strings.TrimSpace(scopeID),
		SourceAppID:       strings.TrimSpace(access.SourceAppID),
		AuditReason:       strings.TrimSpace(access.AuditReason),
	}
}

func validateAppMemoryWriteAccess(access AppMemoryAccess) error {
	if err := validateAppGrant(access, AppMemoryPolicyMemoryWriteSessionScopedAdmitted); err != nil {
		return err
	}
	if strings.TrimSpace(access.SessionRef) == "" || strings.TrimSpace(access.TargetPersonaID) == "" {
		return fmt.Errorf("%w: memory write requires session and persona binding", errAppMemoryAccessDenied)
	}
	provenance := appMemoryProjection(access)
	if err := memory.ValidateAppProjectionProvenance(*provenance); err != nil {
		return fmt.Errorf("%w: %w", errAppMemoryAccessDenied, err)
	}
	return nil
}

func validateAppMemoryReadAccess(access AppMemoryAccess) error {
	switch strings.TrimSpace(access.PolicyClass) {
	case AppMemoryPolicyMemoryReadPersonaScopedBounded:
		if strings.TrimSpace(access.TargetPersonaID) == "" {
			return fmt.Errorf("%w: persona-scoped read requires persona binding", errAppMemoryAccessDenied)
		}
	case AppMemoryPolicyMemoryReadSessionScopedBounded:
		if strings.TrimSpace(access.SessionRef) == "" {
			return fmt.Errorf("%w: session-scoped read requires session binding", errAppMemoryAccessDenied)
		}
	default:
		return fmt.Errorf("%w: missing admitted memory read policy", errAppMemoryAccessDenied)
	}
	return validateAppGrant(access, strings.TrimSpace(access.PolicyClass))
}

func validateAppKnowledgeWriteAccess(access AppMemoryAccess, scopeID string) error {
	if err := validateAppGrant(access, AppMemoryPolicyKnowledgeWriteAdmitted); err != nil {
		return err
	}
	provenance := appKnowledgeWrite(access, scopeID)
	if err := knowledge.ValidateAppWriteProvenance(*provenance, scopeID); err != nil {
		return fmt.Errorf("%w: %w", errAppMemoryAccessDenied, err)
	}
	return nil
}

func validateAppKnowledgeScopeWriteAccess(access AppMemoryAccess) error {
	if err := validateAppGrant(access, AppMemoryPolicyKnowledgeWriteAdmitted); err != nil {
		return err
	}
	if strings.TrimSpace(access.KnowledgeBaseID) == "" {
		return fmt.Errorf("%w: knowledge_base_id is required", errAppMemoryAccessDenied)
	}
	if strings.TrimSpace(access.AuditReason) == "" {
		return fmt.Errorf("%w: audit_reason is required", errAppMemoryAccessDenied)
	}
	return nil
}

func validateAppKnowledgeReadAccess(access AppMemoryAccess) error {
	return validateAppGrant(access, AppMemoryPolicyKnowledgeReadBounded)
}

func validateAppSkillRunAccess(access AppMemoryAccess) error {
	return validateAppGrant(access, AppMemoryPolicySkillRunBounded)
}

func validateAppGrant(access AppMemoryAccess, expectedPolicy string) error {
	policy := strings.TrimSpace(access.PolicyClass)
	if policy == "" {
		return fmt.Errorf("%w: policy is required", errAppMemoryAccessDenied)
	}
	if policy != expectedPolicy {
		return fmt.Errorf("%w: policy %s does not admit %s", errAppMemoryAccessDenied, policy, expectedPolicy)
	}
	if strings.TrimSpace(access.SourceAppID) == "" {
		return fmt.Errorf("%w: source_app_id is required", errAppMemoryAccessDenied)
	}
	if !access.Grant.Active {
		return fmt.Errorf("%w: active grant is required", errAppMemoryAccessDenied)
	}
	if strings.TrimSpace(access.Grant.GrantRef) == "" || strings.TrimSpace(access.Grant.RealmAuditEventID) == "" {
		return fmt.Errorf("%w: grant_ref and realm_audit_event_id are required", errAppMemoryAccessDenied)
	}
	return nil
}

func validateAppPrivateScopeDescriptorOwner(access AppMemoryAccess, desc KnowledgeScopeDescriptor) error {
	if desc.Owner.Kind != storage.KnowledgeScopeOwnerKindAppPrivate {
		return nil
	}
	if strings.TrimSpace(desc.Owner.AppID) != strings.TrimSpace(access.SourceAppID) {
		return fmt.Errorf("%w: app_private scope owner must match source_app_id", errAppMemoryAccessDenied)
	}
	return nil
}

func normalizeAppKnowledgeScopeFilter(access AppMemoryAccess, filter KnowledgeScopeFilter) (KnowledgeScopeFilter, error) {
	sourceAppID := strings.TrimSpace(access.SourceAppID)
	if len(filter.Owners) == 0 && len(filter.OwnerKinds) == 0 {
		filter.Owners = []KnowledgeScopeOwner{{Kind: storage.KnowledgeScopeOwnerKindAppPrivate, AppID: sourceAppID}}
		return filter, nil
	}
	for _, owner := range filter.Owners {
		if owner.Kind != storage.KnowledgeScopeOwnerKindAppPrivate {
			continue
		}
		if strings.TrimSpace(owner.AppID) != sourceAppID {
			return KnowledgeScopeFilter{}, fmt.Errorf("%w: app_private scope owner must match source_app_id", errAppMemoryAccessDenied)
		}
	}
	if len(filter.Owners) == 0 {
		for _, ownerKind := range filter.OwnerKinds {
			if strings.TrimSpace(ownerKind) == storage.KnowledgeScopeOwnerKindAppPrivate {
				filter.Owners = []KnowledgeScopeOwner{{Kind: storage.KnowledgeScopeOwnerKindAppPrivate, AppID: sourceAppID}}
				break
			}
		}
	}
	return filter, nil
}

func ensureAppPrivateScopeOwner(store *storage.SQLiteBackend, access AppMemoryAccess, scopeID string, operation string) error {
	if store == nil {
		return nil
	}
	row, err := store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		if errors.Is(err, storage.ErrScopeRegistryNotFound) {
			return fmt.Errorf("%w: %s scope is not registered", errAppMemoryAccessDenied, operation)
		}
		return fmt.Errorf("%s: inspect app_private scope owner: %w", operation, err)
	}
	if row.OwnerKind != storage.KnowledgeScopeOwnerKindAppPrivate {
		return nil
	}
	expectedOwnerKey := "app:" + strings.TrimSpace(access.SourceAppID)
	if row.OwnerKey != expectedOwnerKey {
		return fmt.Errorf("%w: %s app_private scope owner mismatch", errAppMemoryAccessDenied, operation)
	}
	return nil
}

func rejectDirectAppPrivateScope(store *storage.SQLiteBackend, scopeID string, operation string) error {
	if store == nil {
		return nil
	}
	row, err := store.GetKnowledgeScopeRow(scopeID)
	if err != nil {
		if errors.Is(err, storage.ErrScopeRegistryNotFound) {
			return nil
		}
		return fmt.Errorf("%s: inspect app access scope: %w", operation, err)
	}
	if row.OwnerKind != storage.KnowledgeScopeOwnerKindAppPrivate {
		return nil
	}
	return fmt.Errorf("%s: app_private scope %s requires AppMemoryAccessService with admitted C-APMEM policy", operation, scopeID)
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
	return fmt.Errorf("%s: runtime_knowledge_bank scope %s requires AppMemoryAccessService with admitted C-APMEM policy", operation, scopeID)
}
