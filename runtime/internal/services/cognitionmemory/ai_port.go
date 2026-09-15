package cognitionmemory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

type ResolvedEmbeddingBinding struct {
	ConfigRevision    uint64
	EmbeddingSpaceRef string
	Execution         []byte
	Discard           func() error
	Validate          func(*sql.Tx) error
}

type EmbeddingBindingResolver func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error)
type EmbeddingDisposer func(context.Context, string, string, []byte) error

type EmbeddingExecutor func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error)

type RuntimeEmbeddingPort struct {
	captureLock      sync.Locker
	checkCapture     func(context.Context, memoryv1.AIEmbeddingRequest) error
	backend          *runtimepersistence.Backend
	accountNamespace string
	localAgentRef    string
	resolve          EmbeddingBindingResolver
	execute          EmbeddingExecutor
	dispose          EmbeddingDisposer
	now              func() time.Time
}

func NewRuntimeEmbeddingPort(backend *runtimepersistence.Backend, accountNamespace, localAgentRef string, resolve EmbeddingBindingResolver, execute EmbeddingExecutor, disposer ...EmbeddingDisposer) *RuntimeEmbeddingPort {
	var dispose EmbeddingDisposer
	if len(disposer) > 0 {
		dispose = disposer[0]
	}
	return &RuntimeEmbeddingPort{backend: backend, accountNamespace: accountNamespace, localAgentRef: localAgentRef, resolve: resolve, execute: execute, dispose: dispose, now: time.Now}
}

type persistedEmbeddingResult struct {
	Vectors   [][]float64 `json:"vectors"`
	Dimension int         `json:"dimension"`
	SpaceID   string      `json:"space_id"`
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r022
func (p *RuntimeEmbeddingPort) Embed(ctx context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	if p == nil || p.backend == nil || p.resolve == nil || p.execute == nil || !validRef(p.accountNamespace) || !validRef(p.localAgentRef) || !validRef(request.OperationID) || request.ConfigRevision == 0 || !validRef(request.EmbeddingSpaceRef) || len(request.Inputs) == 0 {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid request")
	}
	for _, input := range request.Inputs {
		if strings.TrimSpace(input) == "" || len([]byte(input)) > 16*1024 {
			return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid bounded input")
		}
	}
	requestKey, err := embeddingRequestKey(p.accountNamespace, p.localAgentRef, request)
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, err
	}
	job, found, err := p.loadJob(ctx, request.OperationID)
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, err
	}
	if found {
		if job.AccountNamespace != p.accountNamespace || job.LocalAgentRef != p.localAgentRef || job.ConfigRevision != request.ConfigRevision || job.RequestKey != requestKey {
			return memoryv1.AIEmbeddingResult{}, ErrConflict
		}
		if job.PayloadDisposition != "retained" {
			return memoryv1.AIEmbeddingResult{}, ErrConflict
		}
		switch job.Status {
		case "ready":
			result, err := decodeEmbeddingResult(job.ResultJSON)
			if err == nil && result.SpaceID != request.EmbeddingSpaceRef {
				return memoryv1.AIEmbeddingResult{}, ErrConflict
			}
			return result, err
		case "consumed":
			return memoryv1.AIEmbeddingResult{}, ErrConflict
		case "failed":
			return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: prior execution failed")
		case "pending", "running":
			return p.executeCaptured(ctx, request, job.Execution)
		default:
			return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid job state")
		}
	}
	execution, err := p.captureBinding(ctx, request, requestKey)
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, err
	}
	return p.executeCaptured(ctx, request, execution)
}

func (p *RuntimeEmbeddingPort) SetCaptureGuard(lock sync.Locker, check func(context.Context, memoryv1.AIEmbeddingRequest) error) {
	p.captureLock, p.checkCapture = lock, check
}

func (p *RuntimeEmbeddingPort) captureBinding(ctx context.Context, request memoryv1.AIEmbeddingRequest, requestKey string) (_ []byte, resultErr error) {
	if p.captureLock != nil {
		p.captureLock.Lock()
		defer p.captureLock.Unlock()
	}
	if p.checkCapture != nil {
		if err := p.checkCapture(ctx, request); err != nil {
			return nil, err
		}
	}
	// External owners are read outside the serialized SQLite writer. Lifecycle
	// cleanup joins this exact-Agent capture lock after recording its fence.
	resolved, err := p.resolve(ctx, p.accountNamespace, p.localAgentRef, request)
	if err != nil {
		return nil, fmt.Errorf("resolve embedding binding: %w", err)
	}
	retained := false
	defer func() {
		if !retained && resolved.Discard != nil {
			if err := resolved.Discard(); err != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("discard unpublished embedding capture: %w", err))
			}
		}
	}()
	if resolved.EmbeddingSpaceRef != request.EmbeddingSpaceRef || !json.Valid(resolved.Execution) {
		return nil, ErrConflict
	}
	if err := p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if resolved.Validate != nil {
			if err := resolved.Validate(tx); err != nil {
				return err
			}
		}
		now := p.now().UTC().Format(time.RFC3339Nano)
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, request.OperationID, p.localAgentRef, p.accountNamespace, request.ConfigRevision, requestKey, resolved.Execution, now, now)
		return err
	}); err != nil {
		return nil, fmt.Errorf("persist embedding custody: %w", err)
	}
	retained = true
	return resolved.Execution, nil
}

func (p *RuntimeEmbeddingPort) executeCaptured(ctx context.Context, request memoryv1.AIEmbeddingRequest, execution []byte) (memoryv1.AIEmbeddingResult, error) {
	if !json.Valid(execution) {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid captured binding")
	}
	now := p.now().UTC().Format(time.RFC3339Nano)
	if err := p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		claimed, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'running', updated_at = ? WHERE operation_id = ? AND status = 'pending' AND payload_disposition = 'retained' AND account_namespace = ? AND local_agent_ref = ?`, now, request.OperationID, p.accountNamespace, p.localAgentRef)
		if err != nil {
			return err
		}
		count, err := claimed.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrConflict
		}
		return nil
	}); err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: mark running: %w", err)
	}
	result, err := p.execute(ctx, append([]byte(nil), execution...))
	if err != nil {
		cleanupErr := p.failAndDispose(context.WithoutCancel(ctx), request.OperationID, "execution_failed")
		return memoryv1.AIEmbeddingResult{}, errors.Join(err, cleanupErr)
	}
	if result.SpaceID != request.EmbeddingSpaceRef {
		cleanupErr := p.failAndDispose(context.WithoutCancel(ctx), request.OperationID, "embedding_space_mismatch")
		return memoryv1.AIEmbeddingResult{}, errors.Join(ErrConflict, cleanupErr)
	}
	if err := validateRuntimeEmbeddingResult(result, len(request.Inputs)); err != nil {
		cleanupErr := p.failAndDispose(context.WithoutCancel(ctx), request.OperationID, "result_invalid")
		return memoryv1.AIEmbeddingResult{}, errors.Join(err, cleanupErr)
	}
	resultRaw, err := json.Marshal(persistedEmbeddingResult{Vectors: result.Vectors, Dimension: result.Dimension, SpaceID: result.SpaceID})
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: encode result: %w", err)
	}
	if err := p.backend.WriteTx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
		updated, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'ready', result_json = ?, failure_code = NULL, updated_at = ? WHERE operation_id = ? AND status = 'running' AND payload_disposition = 'retained' AND account_namespace = ? AND local_agent_ref = ?`, resultRaw, p.now().UTC().Format(time.RFC3339Nano), request.OperationID, p.accountNamespace, p.localAgentRef)
		if err != nil {
			return err
		}
		count, err := updated.RowsAffected()
		if err != nil || count != 1 {
			return ErrConflict
		}
		return nil
	}); err != nil {
		return memoryv1.AIEmbeddingResult{}, errors.Join(fmt.Errorf("runtime cognition memory AI port: persist result: %w", err), p.failAndDispose(context.WithoutCancel(ctx), request.OperationID, "result_persistence_failed"))
	}
	return result, nil
}

func (p *RuntimeEmbeddingPort) AcknowledgeConsumed(ctx context.Context, operationID string) error {
	return p.disposeOperation(ctx, operationID, false)
}

func (p *RuntimeEmbeddingPort) FinalizeStale(ctx context.Context, operationID string) error {
	return p.disposeOperation(ctx, operationID, true)
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.memory-ai-result-disposition
func (p *RuntimeEmbeddingPort) disposeOperation(ctx context.Context, operationID string, abandon bool) error {
	if p == nil || p.backend == nil || !validRef(operationID) {
		return fmt.Errorf("invalid embedding disposition")
	}
	var execution []byte
	if err := p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var state, account, agent, disposition string
		if err := tx.QueryRow(`SELECT status, account_namespace, local_agent_ref, profile_json, payload_disposition FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&state, &account, &agent, &execution, &disposition); err != nil {
			if abandon && errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		if account != p.accountNamespace || agent != p.localAgentRef {
			return ErrConflict
		}
		if disposition == "disposed" {
			execution = nil
			return nil
		}
		if !abandon && state != "ready" && state != "consumed" {
			return ErrConflict
		}
		if state == "ready" || state == "consumed" {
			state = "consumed"
		} else {
			state = "failed"
		}
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = ?, result_json = NULL, payload_disposition = 'pending', updated_at = ? WHERE operation_id = ?`, state, p.now().UTC().Format(time.RFC3339Nano), operationID)
		return err
	}); err != nil {
		return err
	}
	if len(execution) == 0 {
		return nil
	}
	if p.dispose == nil {
		return fmt.Errorf("embedding payload owner is unavailable")
	}
	if err := p.dispose(ctx, p.accountNamespace, p.localAgentRef, execution); err != nil {
		return err
	}
	if err := p.backend.RewriteRecoverySnapshots(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'consumed', result_json = NULL, profile_json = '{}', payload_disposition = 'disposed' WHERE operation_id = ? AND account_namespace = ? AND local_agent_ref = ?`, operationID, p.accountNamespace, p.localAgentRef)
		return err
	}); err != nil {
		return err
	}
	return p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET profile_json = '{}', result_json = NULL, payload_disposition = 'disposed', updated_at = ? WHERE operation_id = ? AND account_namespace = ? AND local_agent_ref = ? AND payload_disposition = 'pending'`, p.now().UTC().Format(time.RFC3339Nano), operationID, p.accountNamespace, p.localAgentRef)
		return err
	})
}

type embeddingJob struct {
	LocalAgentRef      string
	AccountNamespace   string
	ConfigRevision     uint64
	RequestKey         string
	Execution          []byte
	Status             string
	PayloadDisposition string
	ResultJSON         []byte
}

func (p *RuntimeEmbeddingPort) loadJob(ctx context.Context, operationID string) (embeddingJob, bool, error) {
	var job embeddingJob

	err := p.backend.DB().QueryRowContext(ctx, `SELECT local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, result_json, payload_disposition FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&job.LocalAgentRef, &job.AccountNamespace, &job.ConfigRevision, &job.RequestKey, &job.Execution, &job.Status, &job.ResultJSON, &job.PayloadDisposition)
	if errors.Is(err, sql.ErrNoRows) {
		return embeddingJob{}, false, nil
	}
	if err != nil {
		return embeddingJob{}, false, fmt.Errorf("runtime cognition memory AI port: load job: %w", err)
	}
	if !json.Valid(job.Execution) {
		return embeddingJob{}, false, fmt.Errorf("runtime cognition memory AI port: invalid captured execution")
	}
	return job, true, nil
}

func (p *RuntimeEmbeddingPort) markFailed(ctx context.Context, operationID, code string) error {
	return p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, payload_disposition = 'pending', failure_code = ?, updated_at = ? WHERE operation_id = ? AND account_namespace = ? AND local_agent_ref = ? AND payload_disposition <> 'disposed'`, code, p.now().UTC().Format(time.RFC3339Nano), operationID, p.accountNamespace, p.localAgentRef)
		return err
	})
}

func embeddingRequestKey(accountNamespace, localAgentRef string, request memoryv1.AIEmbeddingRequest) (string, error) {
	raw, err := json.Marshal(struct {
		AccountNamespace string
		LocalAgentRef    string
		Request          memoryv1.AIEmbeddingRequest
	}{accountNamespace, localAgentRef, request})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func validateRuntimeEmbeddingResult(result memoryv1.AIEmbeddingResult, count int) error {
	if !validRef(result.SpaceID) || result.Dimension <= 0 || len(result.Vectors) != count {
		return fmt.Errorf("runtime cognition memory AI port: invalid embedding result")
	}
	for _, vector := range result.Vectors {
		if len(vector) != result.Dimension {
			return fmt.Errorf("runtime cognition memory AI port: invalid embedding dimension")
		}
		for _, value := range vector {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return fmt.Errorf("runtime cognition memory AI port: non-finite embedding")
			}
		}
	}
	return nil
}

func decodeEmbeddingResult(raw []byte) (memoryv1.AIEmbeddingResult, error) {
	var stored persistedEmbeddingResult
	if len(raw) == 0 || json.Unmarshal(raw, &stored) != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid stored result")
	}
	result := memoryv1.AIEmbeddingResult{Vectors: stored.Vectors, Dimension: stored.Dimension, SpaceID: stored.SpaceID}
	if err := validateRuntimeEmbeddingResult(result, len(result.Vectors)); err != nil {
		return memoryv1.AIEmbeddingResult{}, err
	}
	return result, nil
}

func (p *RuntimeEmbeddingPort) failAndDispose(ctx context.Context, operationID, code string) error {
	if err := p.markFailed(ctx, operationID, code); err != nil {
		return err
	}
	return p.FinalizeStale(ctx, operationID)
}
