package memoryv1

import (
	"container/heap"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"
)

type RecallRequest struct {
	OperationID  string
	BindingRef   string
	BankRef      string
	LifecycleRef string
	Subject      TypedRef
	Query        string
	Limit        int
	Capabilities CapabilitySnapshot
}

type RecallResult struct {
	Outcome  Outcome
	Pipeline PipelineName
	Hits     []Memory
}

type recallRouteRequest struct {
	BindingRef   string
	LifecycleRef string
	Subject      TypedRef
	Query        string
	Limit        int
}

type AIEmbeddingRequest struct {
	BankRef           string
	LifecycleRef      string
	MemoryRefs        []string
	OperationID       string
	ConfigRevision    uint64
	EmbeddingSpaceRef string
	Inputs            []string
}

type AIEmbeddingResult struct {
	SpaceID   string
	Vectors   [][]float64
	Dimension int
}

type EmbeddingPort interface {
	Embed(context.Context, AIEmbeddingRequest) (AIEmbeddingResult, error)
}

type EmbeddingResultAcknowledger interface {
	AcknowledgeConsumed(context.Context, string) error
}

type StaleEmbeddingResultFinalizer interface {
	FinalizeStale(context.Context, string) error
}

type PendingEmbeddingRebuild struct {
	OperationID string
	Snapshot    CapabilitySnapshot
	Stale       bool
}

// @nimi-authority: rule.nimi.cognition.memory.r004
func (c *Core) RebuildFTS(ctx context.Context, bankRef string) error {
	if !validOpaqueRef(bankRef) {
		return contractError(OutcomeInvalid, "bank_ref")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("rebuild memory fts: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var version uint64
	var lifecycleRef string
	if err := tx.QueryRowContext(ctx, `SELECT canonical_version, lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, bankRef).Scan(&version, &lifecycleRef); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return contractError(OutcomeInvalid, "unknown_bank")
		}
		return fmt.Errorf("rebuild memory fts: inspect bank: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `SELECT memory_ref, content FROM memories WHERE bank_ref = ? AND lifecycle = ? ORDER BY memory_ref`, bankRef, LifecycleCurrent)
	if err != nil {
		return fmt.Errorf("rebuild memory fts: load canonical memories: %w", err)
	}
	type item struct{ ref, content string }
	var items []item
	for rows.Next() {
		var value item
		if err := rows.Scan(&value.ref, &value.content); err != nil {
			_ = rows.Close()
			return fmt.Errorf("rebuild memory fts: scan canonical memory: %w", err)
		}
		items = append(items, value)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("rebuild memory fts: close canonical memories: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_fts WHERE bank_ref = ?`, bankRef); err != nil {
		return fmt.Errorf("rebuild memory fts: clear prior index: %w", err)
	}
	for _, item := range items {
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_fts(memory_ref, bank_ref, content) VALUES(?, ?, ?)`, item.ref, bankRef, ftsIndexedContent(item.content)); err != nil {
			return fmt.Errorf("rebuild memory fts: index memory: %w", err)
		}
	}
	generationRef, err := c.newRef("ftsgen")
	if err != nil {
		return err
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_derived_generations WHERE bank_ref = ? AND kind = 'fts'`, bankRef); err != nil {
		return fmt.Errorf("rebuild memory fts: clear generation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_derived_generations(bank_ref, kind, generation_ref, canonical_version, lifecycle_ref, config_revision, embedding_space_ref, status, updated_at) VALUES(?, 'fts', ?, ?, ?, 0, '', 'ready', ?)`, bankRef, generationRef, version, lifecycleRef, now); err != nil {
		return fmt.Errorf("rebuild memory fts: publish generation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("rebuild memory fts: commit: %w", err)
	}
	return nil
}

func (c *Core) Recall(ctx context.Context, request RecallRequest, port EmbeddingPort) (RecallResult, error) {
	if !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.BankRef) || !validOpaqueRef(request.LifecycleRef) || !validTypedRef(request.Subject) || request.Subject.Kind != "account_subject" || !validContent(request.Query) || request.Limit <= 0 || request.Limit > 100 || !validCapabilitySnapshot(request.Capabilities) {
		return RecallResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "recall_request")
	}
	var currentLifecycle, bankState, bindingState string
	if err := c.db.QueryRowContext(ctx, `SELECT b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ?`, request.BindingRef, request.BankRef).Scan(&currentLifecycle, &bankState, &bindingState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RecallResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "unknown_bank")
		}
		return RecallResult{Outcome: OutcomeUnavailable}, fmt.Errorf("recall memory: inspect binding: %w", err)
	}
	if bankState != "active" || bindingState != "active" || currentLifecycle != request.LifecycleRef {
		return RecallResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "recall_binding")
	}
	router := NewV1Router()
	descriptor, outcome, err := router.SelectRecall(ctx, c, request.BankRef, request.Capabilities)
	if err != nil {
		return RecallResult{Outcome: outcome}, err
	}
	revision := "fts-2"
	if descriptor.Name == PipelineRecallEmbedding {
		revision = "embedding-1"
	}
	if _, err := c.bindRoute(ctx, routeBindingRequest{OperationID: request.OperationID, OperationKind: "recall", BankRef: request.BankRef, Pipeline: descriptor.Name, AlgorithmRevision: revision, Snapshot: request.Capabilities, OperationRequest: recallRouteRequest{BindingRef: request.BindingRef, LifecycleRef: request.LifecycleRef, Subject: request.Subject, Query: request.Query, Limit: request.Limit}}); err != nil {
		return RecallResult{Outcome: errorOutcome(err), Pipeline: descriptor.Name}, err
	}
	var result RecallResult
	switch descriptor.Name {
	case PipelineRecallFTS:
		result, err = c.recallFTS(ctx, request)
	case PipelineRecallEmbedding:
		result, err = c.recallEmbedding(ctx, request, port)
	default:
		err = contractError(OutcomeUnsupported, "recall_pipeline")
		result = RecallResult{Outcome: OutcomeUnsupported}
	}
	if descriptor.Name == PipelineRecallEmbedding {
		return result, err
	}
	if err != nil {
		_ = c.completeRoute(ctx, request.OperationID, result.Outcome)
		return result, err
	}
	if err := c.completeRoute(ctx, request.OperationID, result.Outcome); err != nil {
		return result, err
	}
	return result, nil
}

func (c *Core) NeedsEmbeddingRebuild(ctx context.Context, bankRef string, snapshot CapabilitySnapshot) (bool, error) {
	available := capabilitySet(snapshot.Available)
	if !available[CapabilityTextEmbed] || !available[CapabilityVectorIndex] {
		return false, nil
	}
	if !validOpaqueRef(bankRef) || !validCapabilitySnapshot(snapshot) {
		return false, contractError(OutcomeInvalid, "embedding_rebuild_readiness")
	}
	_, readiness, err := c.derivedReadiness(ctx, bankRef, snapshot)
	if err != nil {
		return false, err
	}
	return readiness["embedding"] != "ready", nil
}

// PendingEmbeddingRebuilds returns interrupted builds and marks generations
// made stale by later canonical work. The generation ref is the build operation
// id, so Runtime can finish or discard the same Job after a process restart.
func (c *Core) PendingEmbeddingRebuilds(ctx context.Context, bankRef string) ([]PendingEmbeddingRebuild, error) {
	if !validOpaqueRef(bankRef) {
		return nil, contractError(OutcomeInvalid, "embedding_rebuild_recovery")
	}
	rows, err := c.db.QueryContext(ctx, `SELECT r.operation_id, r.capabilities_json,
			CASE WHEN g.generation_ref IS NULL THEN 0 WHEN g.canonical_version <> b.canonical_version OR g.lifecycle_ref <> b.lifecycle_ref THEN 1 ELSE 0 END
		FROM memory_operation_routes r
		LEFT JOIN memory_derived_generations g ON g.bank_ref = r.bank_ref AND g.kind = 'embedding' AND g.generation_ref = r.operation_id
		JOIN memory_banks b ON b.bank_ref = r.bank_ref
		WHERE r.bank_ref = ? AND r.operation_kind = 'embedding_build' AND r.pipeline = ? AND r.algorithm_revision = 'embedding-1' AND r.outcome = 'pending'
			AND b.state = 'active' AND (g.generation_ref IS NULL OR g.status IN ('building', 'ready'))
 AND r.ai_disposition IN ('none', 'retained')
		ORDER BY r.created_at, r.operation_id`, bankRef, PipelineRecallEmbedding)
	if err != nil {
		return nil, fmt.Errorf("inspect pending memory embedding builds: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var result []PendingEmbeddingRebuild
	for rows.Next() {
		var item PendingEmbeddingRebuild
		var capabilitiesJSON []byte
		var stale int
		if err := rows.Scan(&item.OperationID, &capabilitiesJSON, &stale); err != nil {
			return nil, fmt.Errorf("inspect pending memory embedding builds: scan: %w", err)
		}
		if err := json.Unmarshal(capabilitiesJSON, &item.Snapshot); err != nil || !validCapabilitySnapshot(item.Snapshot) {
			return nil, contractError(OutcomeFailed, "embedding_rebuild_recovery_state")
		}
		item.Stale = stale != 0
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect pending memory embedding builds: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close pending memory embedding builds: %w", err)
	}
	return result, nil
}

func (c *Core) recallFTS(ctx context.Context, request RecallRequest) (RecallResult, error) {
	query := ftsQuery(request.Query)
	if query == "" {
		return RecallResult{Outcome: OutcomeNoHits, Pipeline: PipelineRecallFTS}, nil
	}
	tx, err := c.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallFTS}, fmt.Errorf("recall memory fts: begin snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := validateRecallSnapshotTx(ctx, tx, request); err != nil {
		return RecallResult{Outcome: errorOutcome(err), Pipeline: PipelineRecallFTS}, err
	}
	version, err := compatibleGenerationTx(ctx, tx, request.BankRef, "fts")
	if err != nil {
		return RecallResult{Outcome: errorOutcome(err), Pipeline: PipelineRecallFTS}, err
	}
	_ = version
	rows, err := tx.QueryContext(ctx, `SELECT m.memory_ref, m.bank_ref, m.content, m.epistemic_status, m.lifecycle, m.occurred_at, m.updated_at, m.source_explanation, m.event_ref FROM memory_fts JOIN memories m ON m.memory_ref = memory_fts.memory_ref WHERE memory_fts.bank_ref = ? AND memory_fts MATCH ? AND m.bank_ref = ? AND m.lifecycle = ? ORDER BY bm25(memory_fts), m.updated_at DESC LIMIT ?`, request.BankRef, query, request.BankRef, LifecycleCurrent, request.Limit)
	if err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallFTS}, fmt.Errorf("recall memory fts: query: %w", err)
	}
	hits, err := scanMemories(rows)
	if err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallFTS}, err
	}
	if err := populateLineageTx(ctx, tx, hits); err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallFTS}, err
	}
	if err := tx.Commit(); err != nil {
		return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallFTS}, fmt.Errorf("recall memory fts: close snapshot: %w", err)
	}
	if len(hits) == 0 {
		return RecallResult{Outcome: OutcomeNoHits, Pipeline: PipelineRecallFTS}, nil
	}
	return RecallResult{Outcome: OutcomeReady, Pipeline: PipelineRecallFTS, Hits: hits}, nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r022
func (c *Core) RebuildEmbedding(ctx context.Context, operationID, bankRef string, snapshot CapabilitySnapshot, port EmbeddingPort) (outcome Outcome, resultErr error) {
	if !c.claimEmbeddingOperation(operationID) {
		return OutcomeConflict, contractError(OutcomeConflict, "embedding_operation_running")
	}
	defer c.releaseEmbeddingOperation(operationID)
	if port == nil || !validOpaqueRef(operationID) || !validOpaqueRef(bankRef) || !validCapabilitySnapshot(snapshot) || !capabilitySet(snapshot.Available)[CapabilityTextEmbed] || !capabilitySet(snapshot.Available)[CapabilityVectorIndex] {
		return OutcomeInvalid, contractError(OutcomeInvalid, "embedding_build_request")
	}
	if _, err := c.bindRoute(ctx, routeBindingRequest{OperationID: operationID, OperationKind: "embedding_build", BankRef: bankRef, Pipeline: PipelineRecallEmbedding, AlgorithmRevision: "embedding-1", Snapshot: snapshot}); err != nil {
		return errorOutcome(err), err
	}
	if prior, found, err := c.resumeEmbeddingOperation(ctx, operationID, port); found || err != nil {
		if err != nil {
			return OutcomeUnavailable, err
		}
		if prior == OutcomeReady {
			return prior, nil
		}
		return prior, contractError(prior, "embedding_operation_disposed")
	}
	version, lifecycleRef, generationStatus, refs, texts, err := c.prepareEmbeddingDelta(ctx, operationID, bankRef, snapshot)
	if err != nil {
		if IsOutcome(err, OutcomeConflict) {
			_ = c.completeStaleEmbeddingGeneration(ctx, bankRef, operationID)
		}
		return errorOutcome(err), err
	}
	var retained bool
	if err := c.db.QueryRowContext(ctx, `SELECT ai_disposition='retained' FROM memory_operation_routes WHERE operation_id=?`, operationID).Scan(&retained); err != nil {
		return OutcomeUnavailable, err
	}
	if len(texts) > 0 || retained {
		if err := c.retainEmbeddingOperation(ctx, operationID, bankRef, lifecycleRef); err != nil {
			return OutcomeUnavailable, err
		}
		defer func() {
			if value := recover(); value != nil {
				panic(value)
			}
			if err := c.finishEmbeddingOperation(context.WithoutCancel(ctx), operationID, outcome, port); err != nil {
				outcome = OutcomeUnavailable
				if IsOutcome(err, OutcomeConflict) {
					outcome = OutcomeConflict
				}
				resultErr = errors.Join(resultErr, err)
			}
		}()
	} else {
		defer func() {
			if err := c.completeRoute(context.WithoutCancel(ctx), operationID, outcome); err != nil {
				outcome = OutcomeUnavailable
				resultErr = errors.Join(resultErr, err)
			}
		}()
	}
	// The build operation is the durable cross-store correlation key. Reusing it
	// as the generation ref lets a retry find both the Core generation and the
	// Runtime Job without a second registry or migration path.
	generationRef := operationID
	if generationStatus == "ready" {
		return OutcomeReady, nil
	}
	if generationStatus == "failed" {
		return OutcomeFailed, contractError(OutcomeFailed, "embedding_generation_failed")
	}
	var result AIEmbeddingResult
	if len(texts) > 0 {
		result, err = port.Embed(ctx, AIEmbeddingRequest{BankRef: bankRef, LifecycleRef: lifecycleRef, MemoryRefs: refs, OperationID: operationID, ConfigRevision: snapshot.ConfigRevision, EmbeddingSpaceRef: snapshot.EmbeddingSpaceRef, Inputs: texts})
		if err == nil {
			err = validateEmbeddingResult(result, len(texts), snapshot.EmbeddingSpaceRef)
		}
		if err != nil {
			_, _ = c.db.ExecContext(ctx, `UPDATE memory_derived_generations SET status='failed',updated_at=? WHERE generation_ref=?`, formatTime(c.now()), generationRef)
			return OutcomeFailed, fmt.Errorf("build memory embedding: runtime AI port: %w", err)
		}
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: begin publish: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var currentVersion uint64
	var currentLifecycleRef string
	if err := tx.QueryRowContext(ctx, `SELECT canonical_version, lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, bankRef).Scan(&currentVersion, &currentLifecycleRef); err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: revalidate bank: %w", err)
	}
	if currentVersion != version || currentLifecycleRef != lifecycleRef {
		if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'failed', updated_at = ? WHERE generation_ref = ?`, formatTime(c.now()), generationRef); err != nil {
			return OutcomeUnavailable, err
		}
		if err := tx.Commit(); err != nil {
			return OutcomeUnavailable, err
		}
		return OutcomeConflict, contractError(OutcomeConflict, "embedding_generation_stale")
	}
	if len(texts) > 0 {
		var minimum, maximum int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MIN(dimension),0),COALESCE(MAX(dimension),0) FROM memory_vector_items WHERE generation_ref=?`, generationRef).Scan(&minimum, &maximum); err != nil {
			return OutcomeUnavailable, err
		}
		if maximum != 0 && (minimum != result.Dimension || maximum != result.Dimension) {
			return OutcomeFailed, contractError(OutcomeFailed, "stored_vector_dimension")
		}
	}
	for index, ref := range refs {
		raw, err := json.Marshal(result.Vectors[index])
		if err != nil {
			return OutcomeFailed, fmt.Errorf("build memory embedding: encode vector: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_vector_items(generation_ref, memory_ref, dimension, vector_json) VALUES(?, ?, ?, ?)`, generationRef, ref, result.Dimension, raw); err != nil {
			return OutcomeUnavailable, fmt.Errorf("build memory embedding: insert vector: %w", err)
		}
	}
	published, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'ready', updated_at = ? WHERE generation_ref = ? AND bank_ref = ? AND canonical_version = ? AND lifecycle_ref = ? AND config_revision = ? AND embedding_space_ref = ? AND status = 'building'`, formatTime(c.now()), generationRef, bankRef, version, lifecycleRef, snapshot.ConfigRevision, snapshot.EmbeddingSpaceRef)
	if err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: publish generation: %w", err)
	}
	count, err := published.RowsAffected()
	if err != nil || count != 1 {
		return OutcomeConflict, contractError(OutcomeConflict, "embedding_generation_publish")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_vector_items WHERE generation_ref IN (SELECT generation_ref FROM memory_derived_generations WHERE bank_ref = ? AND kind = 'embedding' AND generation_ref <> ? AND lifecycle_ref = ? AND embedding_space_ref = ? AND status <> 'building')`, bankRef, generationRef, lifecycleRef, snapshot.EmbeddingSpaceRef); err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: clear prior vectors: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_derived_generations WHERE bank_ref = ? AND kind = 'embedding' AND generation_ref <> ? AND lifecycle_ref = ? AND embedding_space_ref = ? AND status <> 'building'`, bankRef, generationRef, lifecycleRef, snapshot.EmbeddingSpaceRef); err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: clear prior generations: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return OutcomeUnavailable, fmt.Errorf("build memory embedding: commit publish: %w", err)
	}
	return OutcomeReady, nil
}

func (c *Core) completeStaleEmbeddingGeneration(ctx context.Context, bankRef, generationRef string) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("finalize stale memory embedding: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	updated, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'failed', updated_at = ?
		WHERE bank_ref = ? AND kind = 'embedding' AND generation_ref = ? AND status IN ('building', 'ready')`, formatTime(c.now()), bankRef, generationRef)
	if err != nil {
		return fmt.Errorf("finalize stale memory embedding: close generation: %w", err)
	}
	if count, rowsErr := updated.RowsAffected(); rowsErr != nil || count != 1 {
		return contractError(OutcomeConflict, "embedding_generation_stale_completion")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("finalize stale memory embedding: commit: %w", err)
	}
	return nil
}

func (c *Core) recallEmbedding(ctx context.Context, request RecallRequest, port EmbeddingPort) (result RecallResult, resultErr error) {
	if !c.claimEmbeddingOperation(request.OperationID) {
		return RecallResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "embedding_operation_running")
	}
	defer c.releaseEmbeddingOperation(request.OperationID)
	if port == nil {
		return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallEmbedding}, contractError(OutcomeUnavailable, "embedding_port")
	}
	if _, found, err := c.resumeEmbeddingOperation(ctx, request.OperationID, port); found || err != nil {
		if err != nil {
			return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallEmbedding}, err
		}
		return RecallResult{Outcome: OutcomeConflict, Pipeline: PipelineRecallEmbedding}, contractError(OutcomeConflict, "recall_result_disposed")
	}
	var lifecycleRef string
	if err := c.db.QueryRowContext(ctx, `SELECT lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, request.BankRef).Scan(&lifecycleRef); err != nil {
		return RecallResult{Outcome: OutcomeUnavailable}, err
	}
	if err := c.retainEmbeddingOperation(ctx, request.OperationID, request.BankRef, lifecycleRef); err != nil {
		return RecallResult{Outcome: OutcomeUnavailable}, err
	}
	defer func() {
		if value := recover(); value != nil {
			panic(value)
		}
		if err := c.finishEmbeddingOperation(context.WithoutCancel(ctx), request.OperationID, result.Outcome, port); err != nil {
			result = RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallEmbedding}
			if IsOutcome(err, OutcomeConflict) {
				result.Outcome = OutcomeConflict
			}
			resultErr = errors.Join(resultErr, err)
		}
	}()
	queryEmbedding, err := port.Embed(ctx, AIEmbeddingRequest{BankRef: request.BankRef, LifecycleRef: lifecycleRef, OperationID: request.OperationID, ConfigRevision: request.Capabilities.ConfigRevision, EmbeddingSpaceRef: request.Capabilities.EmbeddingSpaceRef, Inputs: []string{request.Query}})
	if err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, fmt.Errorf("recall memory embedding: runtime AI port: %w", err)
	}
	if err := validateEmbeddingResult(queryEmbedding, 1, request.Capabilities.EmbeddingSpaceRef); err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
	}
	tx, err := c.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallEmbedding}, fmt.Errorf("recall memory embedding: begin snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := validateRecallSnapshotTx(ctx, tx, request); err != nil {
		return RecallResult{Outcome: errorOutcome(err), Pipeline: PipelineRecallEmbedding}, err
	}
	version, generationRef, err := compatibleEmbeddingGenerationTx(ctx, tx, request.BankRef, request.Capabilities, queryEmbedding.Dimension)
	if err != nil {
		return RecallResult{Outcome: errorOutcome(err), Pipeline: PipelineRecallEmbedding}, err
	}
	_ = version
	rows, err := tx.QueryContext(ctx, `SELECT m.memory_ref, m.bank_ref, m.content, m.epistemic_status, m.lifecycle, m.occurred_at, m.updated_at, m.source_explanation, m.event_ref, v.vector_json FROM memory_vector_items v JOIN memories m ON m.memory_ref = v.memory_ref WHERE v.generation_ref = ? AND m.bank_ref = ? AND m.lifecycle = ?`, generationRef, request.BankRef, LifecycleCurrent)
	if err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, fmt.Errorf("recall memory embedding: load vectors: %w", err)
	}
	candidates := make(memoryTopK, 0, request.Limit)
	vector := make([]float64, 0, queryEmbedding.Dimension)
	queryNorm := vectorNorm(queryEmbedding.Vectors[0])
	for rows.Next() {
		var item scoredMemory
		var occurredAt, updatedAt string
		var vectorRaw []byte
		if err := rows.Scan(&item.memory.MemoryRef, &item.memory.BankRef, &item.memory.Content, &item.memory.EpistemicStatus, &item.memory.Lifecycle, &occurredAt, &updatedAt, &item.memory.SourceExplanation, &item.memory.EventRef, &vectorRaw); err != nil {
			_ = rows.Close()
			return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, fmt.Errorf("recall memory embedding: scan vector: %w", err)
		}
		item.memory.OccurredAt, err = parseTime(occurredAt)
		if err != nil {
			_ = rows.Close()
			return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
		}
		item.memory.UpdatedAt, err = parseTime(updatedAt)
		if err != nil {
			_ = rows.Close()
			return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
		}
		var valid bool
		vector, valid = decodeMemoryVector(vectorRaw, vector, queryEmbedding.Dimension)
		if !valid {
			_ = rows.Close()
			return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, contractError(OutcomeFailed, "stored_vector")
		}
		item.score = cosineWithNorm(queryEmbedding.Vectors[0], vector, queryNorm)
		if item.score >= 0.35 {
			if len(candidates) < request.Limit {
				heap.Push(&candidates, item)
			} else if betterMemory(item, candidates[0]) {
				candidates[0] = item
				heap.Fix(&candidates, 0)
			}
		}
	}
	if err := rows.Close(); err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
	}
	if err := rows.Err(); err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
	}
	sort.Slice(candidates, func(i, j int) bool { return betterMemory(candidates[i], candidates[j]) })
	hits := make([]Memory, len(candidates))
	for index := range candidates {
		hits[index] = candidates[index].memory
	}
	if err := populateLineageTx(ctx, tx, hits); err != nil {
		return RecallResult{Outcome: OutcomeFailed, Pipeline: PipelineRecallEmbedding}, err
	}
	if err := tx.Commit(); err != nil {
		return RecallResult{Outcome: OutcomeUnavailable, Pipeline: PipelineRecallEmbedding}, err
	}
	if len(hits) == 0 {
		return RecallResult{Outcome: OutcomeNoHits, Pipeline: PipelineRecallEmbedding}, nil
	}
	return RecallResult{Outcome: OutcomeReady, Pipeline: PipelineRecallEmbedding, Hits: hits}, nil
}

func acknowledgeEmbeddingResult(ctx context.Context, port EmbeddingPort, operationID string) error {
	acknowledger, ok := port.(EmbeddingResultAcknowledger)
	if !ok {
		return contractError(OutcomeUnavailable, "embedding_result_acknowledger")
	}
	if err := acknowledger.AcknowledgeConsumed(ctx, operationID); err != nil {
		return fmt.Errorf("acknowledge Runtime embedding result: %w", err)
	}
	return nil
}

func finalizeStaleEmbeddingResult(ctx context.Context, port EmbeddingPort, operationID string) error {
	finalizer, ok := port.(StaleEmbeddingResultFinalizer)
	if !ok {
		return contractError(OutcomeUnavailable, "stale_embedding_result_finalizer")
	}
	if err := finalizer.FinalizeStale(ctx, operationID); err != nil {
		return fmt.Errorf("finalize stale Runtime embedding result: %w", err)
	}
	return nil
}

func (c *Core) derivedReadiness(ctx context.Context, bankRef string, snapshot CapabilitySnapshot) (uint64, map[string]string, error) {
	var version uint64
	var lifecycleRef string
	if err := c.db.QueryRowContext(ctx, `SELECT canonical_version, lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, bankRef).Scan(&version, &lifecycleRef); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil, contractError(OutcomeInvalid, "unknown_bank")
		}
		return 0, nil, fmt.Errorf("inspect memory derived readiness: %w", err)
	}
	rows, err := c.db.QueryContext(ctx, `SELECT kind, status, config_revision, embedding_space_ref FROM memory_derived_generations WHERE bank_ref = ? AND canonical_version = ? AND lifecycle_ref = ? ORDER BY updated_at DESC`, bankRef, version, lifecycleRef)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = rows.Close() }()
	result := map[string]string{}
	for rows.Next() {
		var kind, status, embeddingSpaceRef string
		var configRevision uint64
		if err := rows.Scan(&kind, &status, &configRevision, &embeddingSpaceRef); err != nil {
			return 0, nil, err
		}
		if kind == "embedding" && embeddingSpaceRef != snapshot.EmbeddingSpaceRef {
			continue
		}
		if _, exists := result[kind]; !exists {
			result[kind] = status
		}
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	if err := rows.Close(); err != nil {
		return 0, nil, fmt.Errorf("close memory derived readiness: %w", err)
	}
	return version, result, nil
}

func compatibleGenerationTx(ctx context.Context, tx *sql.Tx, bankRef, kind string) (uint64, error) {
	var version uint64
	var lifecycleRef string
	if err := tx.QueryRowContext(ctx, `SELECT canonical_version, lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, bankRef).Scan(&version, &lifecycleRef); err != nil {
		return 0, contractError(OutcomeInvalid, "unknown_bank")
	}
	var status string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM memory_derived_generations WHERE bank_ref = ? AND kind = ? AND canonical_version = ? AND lifecycle_ref = ? ORDER BY updated_at DESC LIMIT 1`, bankRef, kind, version, lifecycleRef).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, contractError(OutcomeUnavailable, "compatible_generation")
		}
		return 0, err
	}
	if status != "ready" {
		return 0, contractError(OutcomeUnavailable, "generation_not_ready")
	}
	return version, nil
}

func compatibleEmbeddingGenerationTx(ctx context.Context, tx *sql.Tx, bankRef string, snapshot CapabilitySnapshot, dimension int) (uint64, string, error) {
	var version uint64
	var lifecycleRef string
	if err := tx.QueryRowContext(ctx, `SELECT canonical_version, lifecycle_ref FROM memory_banks WHERE bank_ref = ? AND state = 'active'`, bankRef).Scan(&version, &lifecycleRef); err != nil {
		return 0, "", contractError(OutcomeInvalid, "unknown_bank")
	}
	var generationRef string
	var storedDimension int
	if err := tx.QueryRowContext(ctx, `SELECT g.generation_ref, COALESCE(MIN(v.dimension), 0) FROM memory_derived_generations g LEFT JOIN memory_vector_items v ON v.generation_ref = g.generation_ref WHERE g.bank_ref = ? AND g.kind = 'embedding' AND g.canonical_version = ? AND g.lifecycle_ref = ? AND g.embedding_space_ref = ? AND g.status = 'ready' GROUP BY g.generation_ref ORDER BY g.updated_at DESC LIMIT 1`, bankRef, version, lifecycleRef, snapshot.EmbeddingSpaceRef).Scan(&generationRef, &storedDimension); err != nil {
		return 0, "", contractError(OutcomeUnavailable, "embedding_generation")
	}
	if storedDimension != 0 && storedDimension != dimension {
		return 0, "", contractError(OutcomeUnavailable, "embedding_dimension")
	}
	return version, generationRef, nil
}

func scanMemories(rows *sql.Rows) ([]Memory, error) {
	defer func() { _ = rows.Close() }()
	var result []Memory
	for rows.Next() {
		var item Memory
		var occurredAt, updatedAt string
		if err := rows.Scan(&item.MemoryRef, &item.BankRef, &item.Content, &item.EpistemicStatus, &item.Lifecycle, &occurredAt, &updatedAt, &item.SourceExplanation, &item.EventRef); err != nil {
			return nil, err
		}
		var err error
		item.OccurredAt, err = parseTime(occurredAt)
		if err != nil {
			return nil, err
		}
		item.UpdatedAt, err = parseTime(updatedAt)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close memory rows: %w", err)
	}
	return result, nil
}

func populateLineageTx(ctx context.Context, tx *sql.Tx, memories []Memory) error {
	for index := range memories {
		for _, refType := range []string{"subject", "source"} {
			rows, err := tx.QueryContext(ctx, `SELECT ref_kind, ref_value FROM memory_lineage WHERE memory_ref = ? AND ref_type = ? ORDER BY ref_kind, ref_value`, memories[index].MemoryRef, refType)
			if err != nil {
				return err
			}
			var refs []TypedRef
			for rows.Next() {
				var ref TypedRef
				if err := rows.Scan(&ref.Kind, &ref.Value); err != nil {
					_ = rows.Close()
					return err
				}
				refs = append(refs, ref)
			}
			if err := rows.Close(); err != nil {
				return err
			}
			if refType == "subject" {
				memories[index].Subjects = refs
			} else {
				memories[index].Sources = refs
			}
		}
	}
	return nil
}

func validateEmbeddingResult(result AIEmbeddingResult, inputCount int, expectedSpaceID string) error {
	if !validOpaqueRef(result.SpaceID) || result.SpaceID != expectedSpaceID {
		return contractError(OutcomeFailed, "embedding_space_mismatch")
	}
	if result.Dimension <= 0 || len(result.Vectors) != inputCount {
		return contractError(OutcomeFailed, "embedding_shape")
	}
	for _, vector := range result.Vectors {
		if len(vector) != result.Dimension || !finiteVector(vector) {
			return contractError(OutcomeFailed, "embedding_vector")
		}
	}
	return nil
}

func finiteVector(vector []float64) bool {
	for _, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

// @nimi-authority: rule.nimi.cognition.memory.r009
func ftsQuery(value string) string {
	var tokens []string
	seen := make(map[string]struct{})
	var wordRun []rune
	var hanRun []rune
	quote := func(value string) string {
		return `"` + strings.ReplaceAll(strings.ToLower(value), `"`, `""`) + `"`
	}
	appendToken := func(value string) {
		token := quote(value)
		if _, found := seen[token]; found {
			return
		}
		seen[token] = struct{}{}
		tokens = append(tokens, token)
	}
	flushWord := func() {
		if len(wordRun) == 0 {
			return
		}
		token := string(wordRun)
		wordRun = wordRun[:0]
		if len([]rune(token)) < 2 {
			return
		}
		appendToken(token)
	}
	flushHan := func() {
		if len(hanRun) == 0 {
			return
		}
		switch len(hanRun) {
		case 1:
			appendToken(string(hanRun))
		default:
			// Match the indexed lexical bigrams as independent terms, like
			// word tokens in other scripts. A natural-language question is
			// not a demand that its entire Han sentence occur verbatim.
			for index := 0; index+1 < len(hanRun); index++ {
				appendToken(string(hanRun[index : index+2]))
			}
		}
		hanRun = hanRun[:0]
	}
	for _, char := range value {
		switch {
		case unicode.Is(unicode.Han, char):
			flushWord()
			hanRun = append(hanRun, char)
		case unicode.IsLetter(char) || unicode.IsNumber(char):
			flushHan()
			wordRun = append(wordRun, char)
		default:
			flushWord()
			flushHan()
		}
	}
	flushWord()
	flushHan()
	return strings.Join(tokens, " OR ")
}

// ftsIndexedContent keeps the original lexical stream and adds deterministic
// Han character and overlapping-bigram streams. SQLite's unicode61 tokenizer
// otherwise treats a whole Han sentence as one token, making ordinary topic
// substrings and one-character queries unreachable.
func ftsIndexedContent(value string) string {
	var singles []string
	var bigrams []string
	var run []rune
	flush := func() {
		for _, char := range run {
			singles = append(singles, string(char))
		}
		for index := 0; index+1 < len(run); index++ {
			bigrams = append(bigrams, string(run[index:index+2]))
		}
		run = run[:0]
	}
	for _, char := range value {
		if unicode.Is(unicode.Han, char) {
			run = append(run, char)
			continue
		}
		flush()
	}
	flush()
	if len(singles) == 0 {
		return value
	}
	return value + "\n" + strings.Join(singles, " ") + "\n" + strings.Join(bigrams, " ")
}

func validateRecallSnapshotTx(ctx context.Context, tx *sql.Tx, request RecallRequest) error {
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ? AND x.state = 'active' AND b.state = 'active' AND b.lifecycle_ref = ?`, request.BindingRef, request.BankRef, request.LifecycleRef).Scan(&active); err != nil {
		return fmt.Errorf("revalidate recall binding: %w", err)
	}
	if active != 1 {
		return contractError(OutcomeConflict, "recall_lifecycle_changed")
	}
	return nil
}
