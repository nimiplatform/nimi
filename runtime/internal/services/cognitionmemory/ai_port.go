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
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

type ResolvedEmbeddingBinding struct {
	ConfigRevision    uint64
	EmbeddingSpaceRef string
	Profile           *runtimev1.MemoryEmbeddingProfile
}

type EmbeddingBindingResolver func(context.Context, string, string) (ResolvedEmbeddingBinding, error)
type EmbeddingExecutor func(context.Context, *runtimev1.MemoryEmbeddingProfile, []string) ([][]float64, error)

type RuntimeEmbeddingPort struct {
	backend          *runtimepersistence.Backend
	accountNamespace string
	localAgentRef    string
	resolve          EmbeddingBindingResolver
	execute          EmbeddingExecutor
	now              func() time.Time
}

func NewRuntimeEmbeddingPort(backend *runtimepersistence.Backend, accountNamespace, localAgentRef string, resolve EmbeddingBindingResolver, execute EmbeddingExecutor) *RuntimeEmbeddingPort {
	return &RuntimeEmbeddingPort{backend: backend, accountNamespace: accountNamespace, localAgentRef: localAgentRef, resolve: resolve, execute: execute, now: time.Now}
}

type persistedEmbeddingResult struct {
	Vectors   [][]float64 `json:"vectors"`
	Dimension int         `json:"dimension"`
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
		switch job.Status {
		case "ready":
			return decodeEmbeddingResult(job.ResultJSON)
		case "consumed":
			return memoryv1.AIEmbeddingResult{}, ErrConflict
		case "failed":
			return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: prior execution failed")
		case "pending", "running":
			return p.executeCaptured(ctx, request, job.Profile)
		default:
			return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid job state")
		}
	}
	resolved, err := p.resolve(ctx, p.accountNamespace, p.localAgentRef)
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: resolve binding: %w", err)
	}
	if resolved.ConfigRevision != request.ConfigRevision || resolved.EmbeddingSpaceRef != request.EmbeddingSpaceRef || !validEmbeddingProfile(resolved.Profile) {
		return memoryv1.AIEmbeddingResult{}, ErrConflict
	}
	profileRaw, err := proto.MarshalOptions{Deterministic: true}.Marshal(resolved.Profile)
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: encode binding: %w", err)
	}
	now := p.now().UTC().Format(time.RFC3339Nano)
	if err := p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, request.OperationID, p.localAgentRef, p.accountNamespace, request.ConfigRevision, requestKey, profileRaw, now, now)
		return err
	}); err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: persist binding: %w", err)
	}
	return p.executeCaptured(ctx, request, resolved.Profile)
}

func (p *RuntimeEmbeddingPort) executeCaptured(ctx context.Context, request memoryv1.AIEmbeddingRequest, profile *runtimev1.MemoryEmbeddingProfile) (memoryv1.AIEmbeddingResult, error) {
	if !validEmbeddingProfile(profile) {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: invalid captured binding")
	}
	now := p.now().UTC().Format(time.RFC3339Nano)
	if err := p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'running', updated_at = ? WHERE operation_id = ? AND status IN ('pending', 'running')`, now, request.OperationID)
		return err
	}); err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: mark running: %w", err)
	}
	vectors, err := p.execute(ctx, proto.Clone(profile).(*runtimev1.MemoryEmbeddingProfile), append([]string(nil), request.Inputs...))
	if err != nil {
		_ = p.markFailed(context.WithoutCancel(ctx), request.OperationID, "execution_failed")
		return memoryv1.AIEmbeddingResult{}, err
	}
	result := memoryv1.AIEmbeddingResult{Vectors: vectors, Dimension: int(profile.GetDimension())}
	if err := validateRuntimeEmbeddingResult(result, len(request.Inputs)); err != nil {
		_ = p.markFailed(context.WithoutCancel(ctx), request.OperationID, "result_invalid")
		return memoryv1.AIEmbeddingResult{}, err
	}
	resultRaw, err := json.Marshal(persistedEmbeddingResult{Vectors: result.Vectors, Dimension: result.Dimension})
	if err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: encode result: %w", err)
	}
	if err := p.backend.WriteTx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
		updated, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'ready', result_json = ?, failure_code = NULL, updated_at = ? WHERE operation_id = ? AND status = 'running'`, resultRaw, p.now().UTC().Format(time.RFC3339Nano), request.OperationID)
		if err != nil {
			return err
		}
		count, err := updated.RowsAffected()
		if err != nil || count != 1 {
			return ErrConflict
		}
		return nil
	}); err != nil {
		return memoryv1.AIEmbeddingResult{}, fmt.Errorf("runtime cognition memory AI port: persist result: %w", err)
	}
	return result, nil
}

func (p *RuntimeEmbeddingPort) AcknowledgeConsumed(ctx context.Context, operationID string) error {
	if p == nil || p.backend == nil || !validRef(operationID) {
		return fmt.Errorf("runtime cognition memory AI port: invalid consumption acknowledgement")
	}
	return p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var status string
		if err := tx.QueryRow(`SELECT status FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&status); err != nil {
			return err
		}
		if status == "consumed" {
			return nil
		}
		if status != "ready" {
			return ErrConflict
		}
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'consumed', result_json = NULL, updated_at = ? WHERE operation_id = ?`, p.now().UTC().Format(time.RFC3339Nano), operationID)
		return err
	})
}

type embeddingJob struct {
	LocalAgentRef    string
	AccountNamespace string
	ConfigRevision   uint64
	RequestKey       string
	Profile          *runtimev1.MemoryEmbeddingProfile
	Status           string
	ResultJSON       []byte
}

func (p *RuntimeEmbeddingPort) loadJob(ctx context.Context, operationID string) (embeddingJob, bool, error) {
	var job embeddingJob
	var profileRaw []byte
	err := p.backend.DB().QueryRowContext(ctx, `SELECT local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, result_json FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&job.LocalAgentRef, &job.AccountNamespace, &job.ConfigRevision, &job.RequestKey, &profileRaw, &job.Status, &job.ResultJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return embeddingJob{}, false, nil
	}
	if err != nil {
		return embeddingJob{}, false, fmt.Errorf("runtime cognition memory AI port: load job: %w", err)
	}
	job.Profile = &runtimev1.MemoryEmbeddingProfile{}
	if err := proto.Unmarshal(profileRaw, job.Profile); err != nil || !validEmbeddingProfile(job.Profile) {
		return embeddingJob{}, false, fmt.Errorf("runtime cognition memory AI port: invalid captured profile")
	}
	return job, true, nil
}

func (p *RuntimeEmbeddingPort) markFailed(ctx context.Context, operationID, code string) error {
	return p.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, failure_code = ?, updated_at = ? WHERE operation_id = ?`, code, p.now().UTC().Format(time.RFC3339Nano), operationID)
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

func validEmbeddingProfile(profile *runtimev1.MemoryEmbeddingProfile) bool {
	return profile != nil && strings.TrimSpace(profile.GetProvider()) != "" && strings.TrimSpace(profile.GetModelId()) != "" && profile.GetDimension() > 0
}

func validateRuntimeEmbeddingResult(result memoryv1.AIEmbeddingResult, count int) error {
	if result.Dimension <= 0 || len(result.Vectors) != count {
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
	result := memoryv1.AIEmbeddingResult{Vectors: stored.Vectors, Dimension: stored.Dimension}
	if err := validateRuntimeEmbeddingResult(result, len(result.Vectors)); err != nil {
		return memoryv1.AIEmbeddingResult{}, err
	}
	return result, nil
}
