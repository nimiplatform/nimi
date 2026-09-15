package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func (s *Store) SetEmbeddingDisposer(dispose EmbeddingDisposer) { s.disposeEmbedding = dispose }

func (s *Store) SetAgentEmbeddingDisposer(dispose func(context.Context, string) error) {
	s.disposeAgentEmbedding = dispose
}

// DisposeAgentEmbeddingPayloads works from persisted custody, including after
// the Agent/session is fenced. It never authorizes a new execution or a read.
func (s *Store) DisposeAgentEmbeddingPayloads(ctx context.Context, localAgentRef string, abandon bool) error {
	if abandon {
		if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error { return fenceAgentEmbeddingPayloadsTx(tx, localAgentRef) }); err != nil {
			return err
		}
	}
	// Captures revalidate the fence before publication and release this lock
	// before inference. Joining it covers unpublished cross-store captures too.
	if abandon {
		lock := s.EmbeddingCaptureMutex(localAgentRef)
		lock.Lock()
		defer lock.Unlock()
	}
	if abandon && s.disposeAgentEmbedding != nil {
		if err := s.disposeAgentEmbedding(ctx, localAgentRef); err != nil {
			return err
		}
	}
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT operation_id, account_namespace FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ? AND payload_disposition <> 'disposed' AND (payload_disposition = 'pending' OR status IN ('failed', 'consumed')) ORDER BY created_at, operation_id`, localAgentRef)
	if err != nil {
		return err
	}
	type item struct{ operation, account string }
	var items []item
	for rows.Next() {
		var row item
		if err := rows.Scan(&row.operation, &row.account); err != nil {
			return errors.Join(err, rows.Close())
		}
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return errors.Join(err, rows.Close())
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var result error
	for _, row := range items {
		port := NewRuntimeEmbeddingPort(s.backend, row.account, localAgentRef, nil, nil, s.disposeEmbedding)
		result = errors.Join(result, port.FinalizeStale(ctx, row.operation))
	}
	if result == nil && abandon {
		result = s.backend.RewriteRecoverySnapshots(ctx, func(tx *sql.Tx) error {
			if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'consumed', result_json = NULL, profile_json = '{}', payload_disposition = 'disposed' WHERE local_agent_ref = ?`, localAgentRef); err != nil {
				return err
			}
			return nil
		})
	}
	return result
}

func fenceAgentEmbeddingPayloadsTx(tx *sql.Tx, localAgentRef string) error {
	_, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = CASE WHEN status IN ('ready', 'consumed') THEN 'consumed' ELSE 'failed' END, result_json = NULL, payload_disposition = 'pending' WHERE local_agent_ref = ? AND payload_disposition <> 'disposed'`, localAgentRef)
	return err
}

func ValidateEmbeddingCaptureTx(tx *sql.Tx, binding Binding, request memoryv1.AIEmbeddingRequest) error {
	if request.BankRef != binding.BankRef || request.LifecycleRef != binding.LifecycleRef {
		return ErrConflict
	}
	current, err := loadBindingForAgentTx(tx, binding.LocalAgentRef)
	if err != nil {
		return err
	}
	if current.BankRef != binding.BankRef || current.LifecycleRef != binding.LifecycleRef || current.BindingRef != binding.BindingRef || !current.Enabled || current.State != "active" || current.StreamState != "active" {
		return ErrConflict
	}
	var pending int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed'`, binding.LocalAgentRef).Scan(&pending); err != nil {
		return err
	}
	if pending != 0 {
		return fmt.Errorf("embedding capture is fenced by Memory lifecycle")
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_forget WHERE local_agent_ref = ? AND phase <> 'completed'`, binding.LocalAgentRef).Scan(&pending); err != nil {
		return err
	}
	if pending != 0 {
		return ErrConflict
	}
	for _, ref := range request.MemoryRefs {
		var forgotten int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_forget f, json_each(json_extract(f.result_json, '$.AffectedMemoryRefs')) m WHERE f.local_agent_ref = ? AND f.bank_ref = ? AND f.phase = 'completed' AND f.result_json IS NOT NULL AND m.value = ?`, binding.LocalAgentRef, binding.BankRef, ref).Scan(&forgotten); err != nil {
			return err
		}
		if forgotten != 0 {
			return ErrConflict
		}
	}
	return nil
}

func (s *Store) EmbeddingCaptureMutex(agent string) *sync.Mutex {
	lock, _ := s.embeddingCaptures.LoadOrStore(agent, &sync.Mutex{})
	return lock.(*sync.Mutex)
}
func (s *Store) ValidateEmbeddingCapture(ctx context.Context, binding Binding, request memoryv1.AIEmbeddingRequest) error {
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error { return ValidateEmbeddingCaptureTx(tx, binding, request) })
}

// The lifecycle coordinator can finish already-owned copies after the current
// Agent or configuration has become unavailable. This port cannot execute AI.
func (s *Store) EmbeddingDispositionPort(agent string) *storedEmbeddingDispositionPort {
	return &storedEmbeddingDispositionPort{store: s, agent: agent}
}

type storedEmbeddingDispositionPort struct {
	store *Store
	agent string
}

func (p *storedEmbeddingDispositionPort) Embed(context.Context, memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	return memoryv1.AIEmbeddingResult{}, fmt.Errorf("disposition port cannot execute embeddings")
}
func (p *storedEmbeddingDispositionPort) AcknowledgeConsumed(ctx context.Context, operation string) error {
	return p.FinalizeStale(ctx, operation)
}
func (p *storedEmbeddingDispositionPort) FinalizeStale(ctx context.Context, operation string) error {
	var account, agent string
	err := p.store.backend.DB().QueryRowContext(ctx, `SELECT account_namespace, local_agent_ref FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operation).Scan(&account, &agent)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if agent != p.agent {
		return ErrConflict
	}
	return NewRuntimeEmbeddingPort(p.store.backend, account, agent, nil, nil, p.store.disposeEmbedding).FinalizeStale(ctx, operation)
}

func requireDisposedEmbeddingRowsTx(tx *sql.Tx, agent string) error {
	var pending int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ? AND payload_disposition <> 'disposed'`, agent).Scan(&pending); err != nil {
		return err
	}
	if pending != 0 {
		return fmt.Errorf("unbound Memory execution copies lack completed disposition")
	}
	return nil
}
