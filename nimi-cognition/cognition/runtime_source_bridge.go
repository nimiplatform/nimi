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
)

type RuntimeAuthorizationDecision string

const RuntimeAuthorizationDecisionAllow RuntimeAuthorizationDecision = "allow"

type RuntimeAuthorizationAction string

const (
	RuntimeAuthorizationActionIngestAgentSource RuntimeAuthorizationAction = "ingest_agent_source"
	RuntimeAuthorizationActionSearchAgentSource RuntimeAuthorizationAction = "search_agent_source"
	RuntimeAuthorizationActionDeleteAgentSource RuntimeAuthorizationAction = "delete_agent_source"
)

type RuntimeBridgeOperation string

const (
	RuntimeBridgeOperationIngestAgentSource RuntimeBridgeOperation = "ingest_agent_source"
	RuntimeBridgeOperationSearchAgentSource RuntimeBridgeOperation = "search_agent_source"
	RuntimeBridgeOperationDeleteAgentSource RuntimeBridgeOperation = "delete_agent_source"
)

const runtimeSourceOwnerKind = "runtime_local_agent_source"

type RuntimeSourceOwner struct {
	Kind string
}

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

var errRuntimeAuthorizationDenied = errors.New("runtime source bridge authorization denied")

// Runtime's singular projector defines the provider-neutral semantic text
// envelope bound. Cognition validates it and never truncates or repartitions.
const runtimeSourceSemanticTextMaxBytes = 8 * 1024

func IsRuntimeAuthorizationDenied(err error) bool {
	return errors.Is(err, errRuntimeAuthorizationDenied)
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r005
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r006
type RuntimeAuthorization struct {
	Decision    RuntimeAuthorizationDecision
	Action      RuntimeAuthorizationAction
	Operation   RuntimeBridgeOperation
	AccountID   string
	AppID       string
	ScopeID     string
	Owner       RuntimeSourceOwner
	EvaluatedAt time.Time
	ExpiresAt   time.Time
}

// RuntimeSourceBridge is the bounded V1 bridge for snapshot-bound Agent
// Source custody. Its method set contains no generic Knowledge, kernel, graph,
// digest, skill, working-state, or prompt operation family.
type RuntimeSourceBridge struct {
	store *storage.SQLiteBackend
	now   func() time.Time
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r012
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r013
func (s *RuntimeSourceBridge) IngestAgentSource(_ context.Context, auth RuntimeAuthorization, envelope RuntimeSourceIngestionEnvelope) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationIngestAgentSource, envelope.ScopeID, RuntimeAuthorizationActionIngestAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	if strings.TrimSpace(envelope.ScopeID) == "" || strings.TrimSpace(envelope.SnapshotIdentity) == "" || envelope.Units == nil {
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source envelope is invalid")
	}
	if !runtimeSourceSHA256(envelope.SnapshotIdentity) || !runtimeSourceSHA256(envelope.PartitionIdentity) || envelope.Omissions == nil {
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source envelope binding is invalid")
	}

	units := make([]storage.RuntimeSourceUnit, 0, len(envelope.Units))
	seenUnits := make(map[string]struct{}, len(envelope.Units))
	seenPaths := make(map[string]struct{}, len(envelope.Units)+len(envelope.Omissions))
	for _, unit := range envelope.Units {
		if !validRuntimeSourceUnit(unit) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source unit is invalid")
		}
		if !validRuntimeSourceRef(unit.SourceRef) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source unit ref is invalid")
		}
		if !runtimeSourceCategoryMatchesRefKind(unit.Category, unit.SourceRef.Kind) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source unit category/ref binding is invalid")
		}
		if !runtimeSourceProvenanceRefs(unit.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source unit provenance refs are invalid")
		}
		if _, duplicate := seenUnits[unit.UnitID]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate source unit")
		}
		seenUnits[unit.UnitID] = struct{}{}
		pathIdentity := runtimeSourcePathIdentity(unit.SourceRef, unit.SourcePath)
		if _, duplicate := seenPaths[pathIdentity]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate source path coverage")
		}
		seenPaths[pathIdentity] = struct{}{}
		var vector []float64
		if envelope.EmbeddingStatus == "ready" {
			if len(unit.Embedding) != envelope.EmbeddingDimension || !runtimeSourceFiniteVector(unit.Embedding) {
				return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source embedding is invalid")
			}
			vector = append([]float64(nil), unit.Embedding...)
		} else if len(unit.Embedding) != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: non-ready source carries embeddings")
		}
		units = append(units, storage.RuntimeSourceUnit{
			UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath,
			SourceRef: storage.RuntimeSourceRef{
				Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID,
				SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash,
			},
			Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Embedding: vector,
		})
	}

	seenOmissions := make(map[string]struct{}, len(envelope.Omissions))
	for _, omission := range envelope.Omissions {
		if !validRuntimeSourceOmission(omission) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source omission is invalid")
		}
		if !runtimeSourceCategoryMatchesRefKind(omission.Category, omission.SourceRef.Kind) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source omission category/ref binding is invalid")
		}
		if !runtimeSourceProvenanceRefs(omission.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source omission provenance refs are invalid")
		}
		if _, indexed := seenUnits[omission.UnitID]; indexed {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source coverage id is both indexed and omitted")
		}
		if _, duplicate := seenOmissions[omission.UnitID]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate source omission")
		}
		seenOmissions[omission.UnitID] = struct{}{}
		pathIdentity := runtimeSourcePathIdentity(omission.SourceRef, omission.SourcePath)
		if _, duplicate := seenPaths[pathIdentity]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate source path coverage")
		}
		seenPaths[pathIdentity] = struct{}{}
	}
	if envelope.CoverageCount == 0 || uint64(envelope.CoverageCount) != uint64(len(units))+uint64(len(envelope.Omissions)) {
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source coverage is incomplete")
	}
	status := strings.TrimSpace(envelope.EmbeddingStatus)
	switch status {
	case "building":
		if envelope.Generation != 0 || envelope.EmbeddingIdentity != "" || envelope.EmbeddingDimension != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: building source generation is invalid")
		}
	case "unconfigured", "unavailable", "failure":
		if envelope.Generation == 0 || envelope.EmbeddingIdentity != "" || envelope.EmbeddingDimension != 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: non-ready source embedding identity is invalid")
		}
	case "ready":
		if envelope.Generation == 0 || strings.TrimSpace(envelope.EmbeddingIdentity) == "" || envelope.EmbeddingDimension <= 0 || len(units) == 0 {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: ready source embedding identity is invalid")
		}
	default:
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: source embedding status is invalid")
	}

	omissions := make([]storage.RuntimeSourceOmission, 0, len(envelope.Omissions))
	for _, omission := range envelope.Omissions {
		omissions = append(omissions, storage.RuntimeSourceOmission{
			UnitID: omission.UnitID, Category: omission.Category, SourcePath: omission.SourcePath,
			SourceRef: storage.RuntimeSourceRef{
				Kind: omission.SourceRef.Kind, WorldID: omission.SourceRef.WorldID, RefID: omission.SourceRef.RefID,
				SchemaVersion: omission.SourceRef.SchemaVersion, ContentHash: omission.SourceRef.ContentHash,
			},
			OmissionReason: omission.OmissionReason, ProvenanceRefs: append([]string{}, omission.ProvenanceRefs...),
		})
	}
	state, err := s.store.ReplaceRuntimeSourceCorpus(
		envelope.ScopeID, envelope.SnapshotIdentity, envelope.PartitionIdentity,
		units, omissions, status, envelope.EmbeddingIdentity, envelope.EmbeddingDimension, envelope.Generation, s.now(),
	)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime source bridge: ingest agent source: %w", err)
	}
	return runtimeSourceOutcomeFromState(state), nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r014
func (s *RuntimeSourceBridge) SearchAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity, embeddingIdentity, query string, queryEmbedding []float64, limit int) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationSearchAgentSource, scopeID, RuntimeAuthorizationActionSearchAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	units, state, err := s.store.SearchRuntimeSource(scopeID, snapshotIdentity, embeddingIdentity, query, queryEmbedding, limit)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime source bridge: search agent source: %w", err)
	}
	outcome := runtimeSourceOutcomeFromState(state)
	if state.Status == "ready" && len(units) == 0 {
		outcome.Status = "no_hits"
	}
	for _, unit := range units {
		if !runtimeSourceProvenanceRefs(unit.ProvenanceRefs) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: stored source unit provenance refs are invalid")
		}
		outcome.Units = append(outcome.Units, RuntimeSourceUnit{
			UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath,
			SourceRef: RuntimeSourceRef{
				Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID,
				SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash,
			},
			Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: unit.Score,
		})
	}
	return outcome, nil
}

func (s *RuntimeSourceBridge) InspectAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity string) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationSearchAgentSource, scopeID, RuntimeAuthorizationActionSearchAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	state, err := s.store.InspectRuntimeSourceState(scopeID)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime source bridge: inspect agent source: %w", err)
	}
	if state.SnapshotIdentity != snapshotIdentity {
		return RuntimeSourceOutcome{}, storage.ErrRuntimeSourceSnapshotMismatch
	}
	return runtimeSourceOutcomeFromState(state), nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r017
func (s *RuntimeSourceBridge) DeleteAgentSource(_ context.Context, auth RuntimeAuthorization, scopeID, snapshotIdentity string) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationDeleteAgentSource, scopeID, RuntimeAuthorizationActionDeleteAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	deleted, err := s.store.DeleteRuntimeSourceScope(scopeID, snapshotIdentity)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime source bridge: delete agent source: %w", err)
	}
	status := "already_absent"
	if deleted {
		status = "deleted"
	}
	return RuntimeSourceOutcome{Status: status, ScopeID: scopeID, SnapshotIdentity: snapshotIdentity}, nil
}

func (s *RuntimeSourceBridge) validateRuntimeAuthorization(auth RuntimeAuthorization, operation RuntimeBridgeOperation, scopeID string, actions ...RuntimeAuthorizationAction) error {
	if s == nil || s.store == nil || s.now == nil ||
		auth.Decision != RuntimeAuthorizationDecisionAllow || auth.Operation != operation ||
		!runtimeAuthorizationActionAllowed(auth.Action, actions) ||
		strings.TrimSpace(auth.AccountID) == "" || strings.TrimSpace(auth.AppID) == "" ||
		auth.Owner.Kind != runtimeSourceOwnerKind || auth.EvaluatedAt.IsZero() || auth.ExpiresAt.IsZero() {
		return errRuntimeAuthorizationDenied
	}
	evaluatedAt := auth.EvaluatedAt.UTC()
	expiresAt := auth.ExpiresAt.UTC()
	if !evaluatedAt.Before(expiresAt) || strings.TrimSpace(auth.ScopeID) != strings.TrimSpace(scopeID) {
		return errRuntimeAuthorizationDenied
	}
	now := s.now().UTC()
	if evaluatedAt.After(now) || !now.Before(expiresAt) {
		return errRuntimeAuthorizationDenied
	}
	return nil
}

func validRuntimeSourceUnit(unit RuntimeSourceUnit) bool {
	return strings.TrimSpace(unit.UnitID) != "" && strings.TrimSpace(unit.UnitID) == unit.UnitID &&
		runtimeSourceSemanticCategory(unit.Category) && strings.TrimSpace(unit.SourcePath) != "" && strings.TrimSpace(unit.SourcePath) == unit.SourcePath &&
		runtimeSourceSemanticText(unit.Text) && unit.Priority >= 0
}

func validRuntimeSourceOmission(omission RuntimeSourceOmission) bool {
	return strings.TrimSpace(omission.UnitID) != "" && strings.TrimSpace(omission.UnitID) == omission.UnitID &&
		runtimeSourceSemanticCategory(omission.Category) && strings.TrimSpace(omission.SourcePath) != "" && strings.TrimSpace(omission.SourcePath) == omission.SourcePath &&
		strings.TrimSpace(omission.OmissionReason) != "" && strings.TrimSpace(omission.OmissionReason) == omission.OmissionReason && utf8.ValidString(omission.OmissionReason) &&
		validRuntimeSourceRef(omission.SourceRef)
}

func validRuntimeSourceRef(ref RuntimeSourceRef) bool {
	return strings.TrimSpace(ref.Kind) != "" && strings.TrimSpace(ref.Kind) == ref.Kind &&
		strings.TrimSpace(ref.WorldID) != "" && strings.TrimSpace(ref.WorldID) == ref.WorldID &&
		strings.TrimSpace(ref.RefID) != "" && strings.TrimSpace(ref.RefID) == ref.RefID &&
		strings.TrimSpace(ref.SchemaVersion) != "" && strings.TrimSpace(ref.SchemaVersion) == ref.SchemaVersion &&
		runtimeSourceSHA256(ref.ContentHash)
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

func runtimeAuthorizationActionAllowed(action RuntimeAuthorizationAction, allowed []RuntimeAuthorizationAction) bool {
	for _, candidate := range allowed {
		if action == candidate {
			return true
		}
	}
	return false
}
