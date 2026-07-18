package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

const (
	realmSourceMaterializationEpochMetaKeyV3           = "realm_source_materialization_contract_epoch"
	realmSourceMaterializationRuntimeInstanceMetaKeyV3 = "realm_source_materialization_runtime_instance_id_v3"
	realmSourceMaterializationEpochV3                  = "v3"
)

type realmSourceMaterializationAttemptStateV3 string

const (
	realmSourceMaterializationAttemptRequestedV3  realmSourceMaterializationAttemptStateV3 = "requested"
	realmSourceMaterializationAttemptAcquiringV3  realmSourceMaterializationAttemptStateV3 = "acquiring"
	realmSourceMaterializationAttemptVerifyingV3  realmSourceMaterializationAttemptStateV3 = "verifying"
	realmSourceMaterializationAttemptCommittingV3 realmSourceMaterializationAttemptStateV3 = "committing"
	realmSourceMaterializationAttemptCommittedV3  realmSourceMaterializationAttemptStateV3 = "committed"
	realmSourceMaterializationAttemptFailedV3     realmSourceMaterializationAttemptStateV3 = "failed"
	realmSourceMaterializationAttemptAbortedV3    realmSourceMaterializationAttemptStateV3 = "aborted"
	realmSourceMaterializationAttemptExpiredV3    realmSourceMaterializationAttemptStateV3 = "expired"
)

type realmSourceMaterializationAttemptV3 struct {
	MaterializerAccountID    string
	RequestID                string
	IntentDigest             string
	SourceRefJSON            []byte
	RuntimeInstanceID        string
	Challenge                sourceMaterializationChallengeV3
	State                    realmSourceMaterializationAttemptStateV3
	FailureCode              sourceMaterializationFailureCodeV3
	PacketHash               string
	LocalAgentRef            string
	SourceContextStatusBytes []byte
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

type realmSourceMaterializationBeginDispositionV3 int

const (
	realmSourceMaterializationBeginCreatedV3 realmSourceMaterializationBeginDispositionV3 = iota + 1
	realmSourceMaterializationBeginCommittedReplayV3
	realmSourceMaterializationBeginTerminalReplayV3
	realmSourceMaterializationBeginConflictV3
)

type realmSourceMaterializationReplayV3 struct {
	RuntimeInstanceID     string
	Issuer                string
	ReplayBindingHash     string
	NonceDigest           string
	PacketHash            string
	MaterializerAccountID string
	RequestID             string
	FirstSeenAt           time.Time
	ExpiresAt             time.Time
}

type realmSourceMaterializationRepositoryV3 struct {
	backend *runtimepersistence.Backend
}

func newRealmSourceMaterializationRepositoryV3(backend *runtimepersistence.Backend) *realmSourceMaterializationRepositoryV3 {
	return &realmSourceMaterializationRepositoryV3{backend: backend}
}

func (r *realmSourceMaterializationRepositoryV3) recoverStartup(ctx context.Context, now time.Time) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("Realm source materialization repository is unavailable")
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			UPDATE runtime_realm_source_materialization_attempt_v3
			SET state = 'failed', failure_code = ?, updated_at = ?
			WHERE state IN ('requested','acquiring','verifying','committing')
		`, string(sourceMaterializationFailurePersistenceV3), formatRealmSourceMaterializationTimeV3(now))
		if err != nil {
			return fmt.Errorf("invalidate unfinished Realm source materialization attempts: %w", err)
		}
		return nil
	})
}

func (r *realmSourceMaterializationRepositoryV3) bindRuntimeInstance(ctx context.Context, runtimeInstanceID string, now time.Time) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("Realm source materialization repository is unavailable")
	}
	if runtimeInstanceID == "" || runtimeInstanceID != strings.TrimSpace(runtimeInstanceID) {
		return fmt.Errorf("Realm source materialization runtime instance is required")
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var current string
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationRuntimeInstanceMetaKeyV3).Scan(&current)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read Realm source materialization runtime identity: %w", err)
		}
		if err == nil && current == runtimeInstanceID {
			return nil
		}
		if err == nil {
			if _, err := tx.Exec(`
				UPDATE runtime_realm_source_materialization_attempt_v3
				SET state = 'failed', failure_code = ?, updated_at = ?
				WHERE state IN ('requested','acquiring','verifying','committing')
			`, string(sourceMaterializationFailurePersistenceV3), formatRealmSourceMaterializationTimeV3(now)); err != nil {
				return fmt.Errorf("invalidate Realm source attempts after runtime identity change: %w", err)
			}
			if _, err := tx.Exec(`DELETE FROM runtime_realm_source_materialization_replay_v3`); err != nil {
				return fmt.Errorf("clear Realm source replay bindings after runtime identity change: %w", err)
			}
		}
		if _, err := tx.Exec(`
			INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value
		`, realmSourceMaterializationRuntimeInstanceMetaKeyV3, runtimeInstanceID); err != nil {
			return fmt.Errorf("persist Realm source materialization runtime identity: %w", err)
		}
		return nil
	})
}

func (r *realmSourceMaterializationRepositoryV3) beginAttempt(
	ctx context.Context,
	attempt realmSourceMaterializationAttemptV3,
) (realmSourceMaterializationAttemptV3, realmSourceMaterializationBeginDispositionV3, error) {
	if r == nil || r.backend == nil {
		return realmSourceMaterializationAttemptV3{}, 0, fmt.Errorf("Realm source materialization repository is unavailable")
	}
	var result realmSourceMaterializationAttemptV3
	disposition := realmSourceMaterializationBeginCreatedV3
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadRealmSourceMaterializationAttemptTxV3(tx, attempt.MaterializerAccountID, attempt.RequestID)
		if err != nil {
			return err
		}
		if found {
			result = current
			if current.IntentDigest != attempt.IntentDigest || !bytes.Equal(current.SourceRefJSON, attempt.SourceRefJSON) {
				disposition = realmSourceMaterializationBeginConflictV3
				return nil
			}
			if current.State == realmSourceMaterializationAttemptCommittedV3 {
				if err := validateRealmSourceMaterializationCommittedProductTxV3(tx, current); err != nil {
					return err
				}
				disposition = realmSourceMaterializationBeginCommittedReplayV3
			} else {
				disposition = realmSourceMaterializationBeginTerminalReplayV3
			}
			return nil
		}
		_, err = tx.Exec(`
			INSERT INTO runtime_realm_source_materialization_attempt_v3(
				materializer_account_id, request_id, intent_digest, source_ref_json,
				runtime_instance_id, challenge_id, challenge_digest, intended_runtime_audience,
				challenge_issued_at, challenge_expires_at, state, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
		`, attempt.MaterializerAccountID, attempt.RequestID, attempt.IntentDigest, string(attempt.SourceRefJSON),
			attempt.RuntimeInstanceID, attempt.Challenge.ChallengeID, attempt.Challenge.ChallengeDigest,
			attempt.Challenge.IntendedRuntimeAudience, formatRealmSourceMaterializationTimeV3(attempt.Challenge.IssuedAt),
			formatRealmSourceMaterializationTimeV3(attempt.Challenge.ExpiresAt),
			formatRealmSourceMaterializationTimeV3(attempt.CreatedAt), formatRealmSourceMaterializationTimeV3(attempt.UpdatedAt))
		if err != nil {
			return fmt.Errorf("create Realm source materialization attempt: %w", err)
		}
		result = attempt
		result.State = realmSourceMaterializationAttemptRequestedV3
		return nil
	})
	return result, disposition, err
}

func validateRealmSourceMaterializationCommittedProductTxV3(tx *sql.Tx, attempt realmSourceMaterializationAttemptV3) error {
	var count int
	if err := tx.QueryRow(`
		SELECT COUNT(*)
		FROM runtime_local_agent AS agent
		JOIN runtime_local_agent_source_snapshot_v2 AS snapshot
		  ON snapshot.local_agent_ref = agent.local_agent_ref
		JOIN runtime_local_agent_source_provenance_v3 AS provenance
		  ON provenance.local_agent_ref = agent.local_agent_ref
		WHERE agent.local_agent_ref = ? AND snapshot.snapshot_hash = provenance.snapshot_hash
	`, attempt.LocalAgentRef).Scan(&count); err != nil {
		return fmt.Errorf("validate committed Realm source materialization product: %w", err)
	}
	if count != 1 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePersistenceV3, "committed Realm source materialization product is absent or corrupt")
	}
	return nil
}

func (r *realmSourceMaterializationRepositoryV3) transitionAttempt(
	ctx context.Context,
	accountID string,
	requestID string,
	from realmSourceMaterializationAttemptStateV3,
	to realmSourceMaterializationAttemptStateV3,
	packetHash string,
	now time.Time,
) error {
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.Exec(`
			UPDATE runtime_realm_source_materialization_attempt_v3
			SET state = ?, packet_hash = CASE WHEN ? = '' THEN packet_hash ELSE ? END, updated_at = ?
			WHERE materializer_account_id = ? AND request_id = ? AND state = ?
		`, string(to), packetHash, packetHash, formatRealmSourceMaterializationTimeV3(now), accountID, requestID, string(from))
		if err != nil {
			return fmt.Errorf("transition Realm source materialization attempt: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected != 1 {
			return sourceMaterializationV3Error(sourceMaterializationFailureCommitInProgressV3, "Realm source materialization attempt transition lost")
		}
		return nil
	})
}

func (r *realmSourceMaterializationRepositoryV3) failAttempt(
	ctx context.Context,
	accountID string,
	requestID string,
	code sourceMaterializationFailureCodeV3,
	now time.Time,
) error {
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			UPDATE runtime_realm_source_materialization_attempt_v3
			SET state = 'failed', failure_code = ?, packet_hash = NULL, updated_at = ?
			WHERE materializer_account_id = ? AND request_id = ?
			  AND state IN ('requested','acquiring','verifying','committing')
		`, string(code), formatRealmSourceMaterializationTimeV3(now), accountID, requestID)
		if err != nil {
			return fmt.Errorf("fail Realm source materialization attempt: %w", err)
		}
		return nil
	})
}

type realmSourceMaterializationProductTxV3 func(*sql.Tx) error

func (r *realmSourceMaterializationRepositoryV3) finishCommit(
	ctx context.Context,
	attempt realmSourceMaterializationAttemptV3,
	replay realmSourceMaterializationReplayV3,
	localAgentRef string,
	status *runtimev1.LocalAgentSourceContextStatus,
	now time.Time,
	productTx realmSourceMaterializationProductTxV3,
) error {
	if productTx == nil || status == nil {
		return fmt.Errorf("Realm source materialization product transaction is required")
	}
	statusBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(status)
	if err != nil {
		return fmt.Errorf("marshal Realm source materialization safe result: %w", err)
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadRealmSourceMaterializationAttemptTxV3(tx, attempt.MaterializerAccountID, attempt.RequestID)
		if err != nil {
			return err
		}
		if !found || current.IntentDigest != attempt.IntentDigest || current.State != realmSourceMaterializationAttemptCommittingV3 {
			return sourceMaterializationV3Error(sourceMaterializationFailureCommitInProgressV3, "Realm source materialization commit lease was lost")
		}
		if _, err := tx.Exec(`
			INSERT INTO runtime_realm_source_materialization_replay_v3(
				runtime_instance_id, issuer, replay_binding_hash, nonce_digest, packet_hash,
				materializer_account_id, request_id, first_seen_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, replay.RuntimeInstanceID, replay.Issuer, replay.ReplayBindingHash, replay.NonceDigest, replay.PacketHash,
			replay.MaterializerAccountID, replay.RequestID, formatRealmSourceMaterializationTimeV3(replay.FirstSeenAt),
			formatRealmSourceMaterializationTimeV3(replay.ExpiresAt)); err != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailureReplayV3, "persist replay binding: %v", err)
		}
		if err := productTx(tx); err != nil {
			return fmt.Errorf("commit Realm source materialization product: %w", err)
		}
		result, err := tx.Exec(`
			UPDATE runtime_realm_source_materialization_attempt_v3
			SET state = 'committed', failure_code = NULL, packet_hash = ?, local_agent_ref = ?,
				source_context_status = ?, updated_at = ?
			WHERE materializer_account_id = ? AND request_id = ? AND state = 'committing'
		`, replay.PacketHash, localAgentRef, statusBytes, formatRealmSourceMaterializationTimeV3(now),
			attempt.MaterializerAccountID, attempt.RequestID)
		if err != nil {
			return fmt.Errorf("complete Realm source materialization attempt: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected != 1 {
			return sourceMaterializationV3Error(sourceMaterializationFailureCommitInProgressV3, "Realm source materialization commit CAS was lost")
		}
		return nil
	})
}

func (a realmSourceMaterializationAttemptV3) sourceContextStatus() (*runtimev1.LocalAgentSourceContextStatus, error) {
	if len(a.SourceContextStatusBytes) == 0 {
		return nil, fmt.Errorf("committed Realm source materialization result is missing status")
	}
	status := &runtimev1.LocalAgentSourceContextStatus{}
	if err := proto.Unmarshal(a.SourceContextStatusBytes, status); err != nil {
		return nil, fmt.Errorf("decode committed Realm source materialization result: %w", err)
	}
	return status, nil
}

func loadRealmSourceMaterializationAttemptTxV3(tx *sql.Tx, accountID, requestID string) (realmSourceMaterializationAttemptV3, bool, error) {
	var result realmSourceMaterializationAttemptV3
	var sourceRefJSON string
	var state string
	var failureCode sql.NullString
	var packetHash sql.NullString
	var localAgentRef sql.NullString
	var statusBytes []byte
	var challengeIssuedAt, challengeExpiresAt, createdAt, updatedAt string
	err := tx.QueryRow(`
		SELECT materializer_account_id, request_id, intent_digest, source_ref_json,
			runtime_instance_id, challenge_id, challenge_digest, intended_runtime_audience,
			challenge_issued_at, challenge_expires_at, state, failure_code, packet_hash,
			local_agent_ref, source_context_status, created_at, updated_at
		FROM runtime_realm_source_materialization_attempt_v3
		WHERE materializer_account_id = ? AND request_id = ?
	`, accountID, requestID).Scan(
		&result.MaterializerAccountID, &result.RequestID, &result.IntentDigest, &sourceRefJSON,
		&result.RuntimeInstanceID, &result.Challenge.ChallengeID, &result.Challenge.ChallengeDigest,
		&result.Challenge.IntendedRuntimeAudience, &challengeIssuedAt, &challengeExpiresAt,
		&state, &failureCode, &packetHash, &localAgentRef, &statusBytes, &createdAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return realmSourceMaterializationAttemptV3{}, false, nil
	}
	if err != nil {
		return realmSourceMaterializationAttemptV3{}, false, fmt.Errorf("load Realm source materialization attempt: %w", err)
	}
	var parseErr error
	if result.Challenge.IssuedAt, parseErr = time.Parse(time.RFC3339Nano, challengeIssuedAt); parseErr != nil {
		return realmSourceMaterializationAttemptV3{}, false, fmt.Errorf("parse Realm source challenge issued_at: %w", parseErr)
	}
	if result.Challenge.ExpiresAt, parseErr = time.Parse(time.RFC3339Nano, challengeExpiresAt); parseErr != nil {
		return realmSourceMaterializationAttemptV3{}, false, fmt.Errorf("parse Realm source challenge expires_at: %w", parseErr)
	}
	if result.CreatedAt, parseErr = time.Parse(time.RFC3339Nano, createdAt); parseErr != nil {
		return realmSourceMaterializationAttemptV3{}, false, fmt.Errorf("parse Realm source attempt created_at: %w", parseErr)
	}
	if result.UpdatedAt, parseErr = time.Parse(time.RFC3339Nano, updatedAt); parseErr != nil {
		return realmSourceMaterializationAttemptV3{}, false, fmt.Errorf("parse Realm source attempt updated_at: %w", parseErr)
	}
	result.State = realmSourceMaterializationAttemptStateV3(state)
	result.FailureCode = sourceMaterializationFailureCodeV3(failureCode.String)
	result.PacketHash = packetHash.String
	result.LocalAgentRef = localAgentRef.String
	result.SourceRefJSON = []byte(sourceRefJSON)
	result.SourceContextStatusBytes = append([]byte(nil), statusBytes...)
	result.Challenge.MaterializerAccountID = result.MaterializerAccountID
	result.Challenge.RequestID = result.RequestID
	result.Challenge.IntentDigest = result.IntentDigest
	result.Challenge.RuntimeInstanceID = result.RuntimeInstanceID
	return result, true, nil
}

func formatRealmSourceMaterializationTimeV3(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}
