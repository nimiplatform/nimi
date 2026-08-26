package cognition

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

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
	RuntimeAuthorizationActionCreateBank        RuntimeAuthorizationAction = "create_bank"
	RuntimeAuthorizationActionReadBank          RuntimeAuthorizationAction = "read_bank"
	RuntimeAuthorizationActionDeleteBank        RuntimeAuthorizationAction = "delete_bank"
	RuntimeAuthorizationActionWritePage         RuntimeAuthorizationAction = "write_page"
	RuntimeAuthorizationActionReadPage          RuntimeAuthorizationAction = "read_page"
	RuntimeAuthorizationActionDeletePage        RuntimeAuthorizationAction = "delete_page"
	RuntimeAuthorizationActionSearch            RuntimeAuthorizationAction = "search"
	RuntimeAuthorizationActionWriteLink         RuntimeAuthorizationAction = "write_link"
	RuntimeAuthorizationActionReadLink          RuntimeAuthorizationAction = "read_link"
	RuntimeAuthorizationActionIngest            RuntimeAuthorizationAction = "ingest"
	RuntimeAuthorizationActionIngestAgentSource RuntimeAuthorizationAction = "ingest_agent_source"
	RuntimeAuthorizationActionSearchAgentSource RuntimeAuthorizationAction = "search_agent_source"
	RuntimeAuthorizationActionDeleteAgentSource RuntimeAuthorizationAction = "delete_agent_source"
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
	RuntimeBridgeOperationIngestAgentSource       RuntimeBridgeOperation = "ingest_agent_source"
	RuntimeBridgeOperationSearchAgentSource       RuntimeBridgeOperation = "search_agent_source"
	RuntimeBridgeOperationDeleteAgentSource       RuntimeBridgeOperation = "delete_agent_source"
)

type RuntimeSourceUnit struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      RuntimeSourceRef
	Text           string
	ProvenanceRefs []string
	Priority       int64
	Embedding      []float64
	Score          float64
}

type RuntimeSourceOmission struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      RuntimeSourceRef
	OmissionReason string
	ProvenanceRefs []string
}

type RuntimeSourceRef struct {
	Kind          string
	WorldID       string
	RefID         string
	SchemaVersion string
	ContentHash   string
}

type RuntimeSourceIngestionEnvelope struct {
	ScopeID            string
	SnapshotIdentity   string
	PartitionIdentity  string
	Units              []RuntimeSourceUnit
	Omissions          []RuntimeSourceOmission
	CoverageCount      uint32
	Generation         uint64
	EmbeddingStatus    string
	EmbeddingIdentity  string
	EmbeddingDimension int
}

type RuntimeSourceOutcome struct {
	Status            string
	ScopeID           string
	SnapshotIdentity  string
	PartitionIdentity string
	Generation        uint64
	UnitCount         uint32
	OmissionCount     uint32
	Units             []RuntimeSourceUnit
}

var errRuntimeAuthorizationDenied = errors.New("runtime bridge authorization denied")

// Runtime's singular projector defines the provider-neutral semantic text
// envelope bound. Cognition validates it and never truncates or repartitions.
const runtimeSourceSemanticTextMaxBytes = 8 * 1024

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

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r012
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r013
func (s *RuntimeBridge) IngestAgentSource(_ context.Context, auth RuntimeAuthorization, envelope RuntimeSourceIngestionEnvelope) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationIngestAgentSource, envelope.ScopeID, RuntimeAuthorizationActionIngestAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	if strings.TrimSpace(envelope.ScopeID) == "" || strings.TrimSpace(envelope.SnapshotIdentity) == "" || envelope.Units == nil {
		return RuntimeSourceOutcome{}, errors.New("runtime bridge: source envelope is invalid")
	}
	if !runtimeSourceSHA256(envelope.SnapshotIdentity) || !runtimeSourceSHA256(envelope.PartitionIdentity) || envelope.Omissions == nil {
		return RuntimeSourceOutcome{}, errors.New("runtime bridge: source envelope binding is invalid")
	}
	units := make([]storage.RuntimeSourceUnit, 0, len(envelope.Units))
	seen := map[string]struct{}{}
	seenPaths := map[string]struct{}{}
	for index, unit := range envelope.Units {
		if strings.TrimSpace(unit.UnitID) == "" || strings.TrimSpace(unit.UnitID) != unit.UnitID || !runtimeSourceSemanticCategory(unit.Category) ||
			strings.TrimSpace(unit.SourcePath) == "" || strings.TrimSpace(unit.SourcePath) != unit.SourcePath || !runtimeSourceSemanticText(unit.Text) || unit.Priority < 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source unit is invalid")
		}
		if strings.TrimSpace(unit.SourceRef.Kind) == "" || strings.TrimSpace(unit.SourceRef.Kind) != unit.SourceRef.Kind ||
			strings.TrimSpace(unit.SourceRef.WorldID) == "" || strings.TrimSpace(unit.SourceRef.WorldID) != unit.SourceRef.WorldID ||
			strings.TrimSpace(unit.SourceRef.RefID) == "" || strings.TrimSpace(unit.SourceRef.RefID) != unit.SourceRef.RefID ||
			strings.TrimSpace(unit.SourceRef.SchemaVersion) == "" || strings.TrimSpace(unit.SourceRef.SchemaVersion) != unit.SourceRef.SchemaVersion || !runtimeSourceSHA256(unit.SourceRef.ContentHash) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source unit ref is invalid")
		}
		if !runtimeSourceCategoryMatchesRefKind(unit.Category, unit.SourceRef.Kind) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source unit category/ref binding is invalid")
		}
		if !runtimeSourceProvenanceRefs(unit.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source unit provenance refs are invalid")
		}
		if _, ok := seen[unit.UnitID]; ok {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: duplicate source unit")
		}
		seen[unit.UnitID] = struct{}{}
		pathKey := runtimeSourcePathIdentity(unit.SourceRef, unit.SourcePath)
		if _, duplicate := seenPaths[pathKey]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: duplicate source path coverage")
		}
		seenPaths[pathKey] = struct{}{}
		var vector []float64
		if envelope.EmbeddingStatus == "ready" {
			if index >= len(envelope.Units) || len(unit.Embedding) != envelope.EmbeddingDimension || !runtimeSourceFiniteVector(unit.Embedding) {
				return RuntimeSourceOutcome{}, errors.New("runtime bridge: source embedding is invalid")
			}
			vector = append([]float64(nil), unit.Embedding...)
		} else if len(unit.Embedding) != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: non-ready source carries embeddings")
		}
		units = append(units, storage.RuntimeSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: storage.RuntimeSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Embedding: vector})
	}
	seenOmissions := make(map[string]struct{}, len(envelope.Omissions))
	for _, omission := range envelope.Omissions {
		if strings.TrimSpace(omission.UnitID) == "" || strings.TrimSpace(omission.UnitID) != omission.UnitID || !runtimeSourceSemanticCategory(omission.Category) ||
			strings.TrimSpace(omission.SourcePath) == "" || strings.TrimSpace(omission.SourcePath) != omission.SourcePath ||
			strings.TrimSpace(omission.OmissionReason) == "" || strings.TrimSpace(omission.OmissionReason) != omission.OmissionReason ||
			strings.TrimSpace(omission.SourceRef.Kind) == "" || strings.TrimSpace(omission.SourceRef.Kind) != omission.SourceRef.Kind ||
			strings.TrimSpace(omission.SourceRef.WorldID) == "" || strings.TrimSpace(omission.SourceRef.WorldID) != omission.SourceRef.WorldID ||
			strings.TrimSpace(omission.SourceRef.RefID) == "" || strings.TrimSpace(omission.SourceRef.RefID) != omission.SourceRef.RefID ||
			strings.TrimSpace(omission.SourceRef.SchemaVersion) == "" || strings.TrimSpace(omission.SourceRef.SchemaVersion) != omission.SourceRef.SchemaVersion || !runtimeSourceSHA256(omission.SourceRef.ContentHash) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source omission is invalid")
		}
		if !runtimeSourceCategoryMatchesRefKind(omission.Category, omission.SourceRef.Kind) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source omission category/ref binding is invalid")
		}
		if !runtimeSourceProvenanceRefs(omission.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source omission provenance refs are invalid")
		}
		if _, indexed := seen[omission.UnitID]; indexed {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: source coverage id is both indexed and omitted")
		}
		if _, duplicate := seenOmissions[omission.UnitID]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: duplicate source omission")
		}
		seenOmissions[omission.UnitID] = struct{}{}
		pathKey := runtimeSourcePathIdentity(omission.SourceRef, omission.SourcePath)
		if _, duplicate := seenPaths[pathKey]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: duplicate source path coverage")
		}
		seenPaths[pathKey] = struct{}{}
	}
	if envelope.CoverageCount == 0 || uint64(envelope.CoverageCount) != uint64(len(units))+uint64(len(envelope.Omissions)) {
		return RuntimeSourceOutcome{}, errors.New("runtime bridge: source coverage is incomplete")
	}
	status := strings.TrimSpace(envelope.EmbeddingStatus)
	switch status {
	case "building":
		if envelope.Generation != 0 || envelope.EmbeddingIdentity != "" || envelope.EmbeddingDimension != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: building source generation is invalid")
		}
	case "unconfigured", "unavailable", "failure":
		if envelope.Generation == 0 || envelope.EmbeddingIdentity != "" || envelope.EmbeddingDimension != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: non-ready source embedding identity is invalid")
		}
	case "ready":
		if envelope.Generation == 0 || strings.TrimSpace(envelope.EmbeddingIdentity) == "" || envelope.EmbeddingDimension <= 0 || len(units) == 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: ready source embedding identity is invalid")
		}
	default:
		return RuntimeSourceOutcome{}, errors.New("runtime bridge: source embedding status is invalid")
	}
	omissions := make([]storage.RuntimeSourceOmission, 0, len(envelope.Omissions))
	for _, omission := range envelope.Omissions {
		omissions = append(omissions, storage.RuntimeSourceOmission{
			UnitID: omission.UnitID, Category: omission.Category, SourcePath: omission.SourcePath,
			SourceRef:      storage.RuntimeSourceRef{Kind: omission.SourceRef.Kind, WorldID: omission.SourceRef.WorldID, RefID: omission.SourceRef.RefID, SchemaVersion: omission.SourceRef.SchemaVersion, ContentHash: omission.SourceRef.ContentHash},
			OmissionReason: omission.OmissionReason,
			ProvenanceRefs: append([]string{}, omission.ProvenanceRefs...),
		})
	}
	state, err := s.core.store.ReplaceRuntimeSourceCorpus(envelope.ScopeID, envelope.SnapshotIdentity, envelope.PartitionIdentity, units, omissions, status, envelope.EmbeddingIdentity, envelope.EmbeddingDimension, envelope.Generation, s.core.clock.Now())
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime bridge: ingest agent source: %w", err)
	}
	return runtimeSourceOutcomeFromState(state), nil
}

func runtimeSourcePathIdentity(ref RuntimeSourceRef, sourcePath string) string {
	return strings.Join([]string{ref.Kind, ref.WorldID, ref.RefID, ref.SchemaVersion, ref.ContentHash, sourcePath}, "\x00")
}

func runtimeSourceOutcomeFromState(state storage.RuntimeSourceState) RuntimeSourceOutcome {
	return RuntimeSourceOutcome{
		Status: state.Status, ScopeID: state.ScopeID, SnapshotIdentity: state.SnapshotIdentity,
		PartitionIdentity: state.PartitionIdentity, Generation: state.Generation,
		UnitCount: uint32(state.UnitCount), OmissionCount: uint32(state.OmissionCount),
	}
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r014
func (s *RuntimeBridge) SearchAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity, embeddingIdentity, query string, queryEmbedding []float64, limit int) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationSearchAgentSource, scopeID, RuntimeAuthorizationActionSearchAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	units, state, err := s.core.store.SearchRuntimeSource(scopeID, snapshotIdentity, embeddingIdentity, query, queryEmbedding, limit)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime bridge: search agent source: %w", err)
	}
	out := runtimeSourceOutcomeFromState(state)
	if state.Status == "ready" && len(units) == 0 {
		out.Status = "no_hits"
	}
	for _, unit := range units {
		if !runtimeSourceProvenanceRefs(unit.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime bridge: stored source unit provenance refs are invalid")
		}
		out.Units = append(out.Units, RuntimeSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: RuntimeSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: unit.Score})
	}
	return out, nil
}

func (s *RuntimeBridge) InspectAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity string) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationSearchAgentSource, scopeID, RuntimeAuthorizationActionSearchAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	state, err := s.core.store.InspectRuntimeSourceState(scopeID)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime bridge: inspect agent source: %w", err)
	}
	if state.SnapshotIdentity != snapshotIdentity {
		return RuntimeSourceOutcome{}, storage.ErrRuntimeSourceSnapshotMismatch
	}
	return runtimeSourceOutcomeFromState(state), nil
}

func runtimeSourceFiniteVector(vector []float64) bool {
	for _, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func runtimeSourceSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func runtimeSourceSemanticCategory(category string) bool {
	switch category {
	case "character_identity_detail", "behavior_detail", "speaking_interaction_detail",
		"biography_event", "relationship_detail", "work", "preference",
		"source_knowledge_detail", "source_constraint_detail", "source_asset_detail",
		"dialogue_exemplar", "world_setting_detail", "world_fact", "world_entity",
		"world_system", "world_scene", "source_evidence":
		return true
	default:
		return false
	}
}

func runtimeSourceSemanticText(text string) bool {
	return strings.TrimSpace(text) != "" && strings.TrimSpace(text) == text && utf8.ValidString(text) && len([]byte(text)) <= runtimeSourceSemanticTextMaxBytes
}

func runtimeSourceProvenanceRefs(refs []string) bool {
	if refs == nil {
		return false
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" || strings.TrimSpace(ref) != ref || !utf8.ValidString(ref) {
			return false
		}
		if _, duplicate := seen[ref]; duplicate {
			return false
		}
		seen[ref] = struct{}{}
	}
	return true
}

func runtimeSourceCategoryMatchesRefKind(category, refKind string) bool {
	switch refKind {
	case "worldCharacter", "personaCharacter":
		switch category {
		case "character_identity_detail", "behavior_detail", "speaking_interaction_detail", "biography_event",
			"relationship_detail", "source_knowledge_detail", "source_constraint_detail", "source_asset_detail", "dialogue_exemplar":
			return true
		}
	case "worldCore":
		switch category {
		case "world_setting_detail", "world_fact", "world_entity", "world_system", "world_scene", "relationship_detail", "source_asset_detail":
			return true
		}
	case "worldEntity":
		switch category {
		case "world_entity", "world_fact", "work", "preference", "source_asset_detail", "source_evidence":
			return true
		}
	case "worldRelationship":
		return category == "relationship_detail" || category == "source_evidence"
	}
	return false
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r017
func (s *RuntimeBridge) DeleteAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity string) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationDeleteAgentSource, scopeID, RuntimeAuthorizationActionDeleteAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	deleted, err := s.core.store.DeleteRuntimeSourceScope(scopeID, snapshotIdentity)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime bridge: delete agent source: %w", err)
	}
	status := "already_absent"
	if deleted {
		status = "deleted"
	}
	return RuntimeSourceOutcome{Status: status, ScopeID: scopeID, SnapshotIdentity: snapshotIdentity}, nil
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
