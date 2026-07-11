package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

const sourceMaterializationRuntimeInstanceMetaKey = "source_materialization_runtime_instance_id"

type sourceMaterializationChallengeRecord struct {
	ChallengeID             string
	ChallengeDigest         string
	IntendedRuntimeAudience string
	RuntimeInstanceID       string
	MaterializerAccountID   string
	RequestID               string
	SourceRef               *runtimev1.SourceMaterializationSourceRef
	Limits                  *runtimev1.SourceMaterializationChallengeLimits
	State                   runtimev1.AgentSourceMaterializationChallengeState
	LeasedUploadID          string
	PacketHash              string
	BundleManifestHash      string
	IssuedAt                time.Time
	ExpiresAt               time.Time
	UpdatedAt               time.Time
}

type sourceMaterializationUploadRecord struct {
	UploadID                    string
	ChallengeID                 string
	MaterializerAccountID       string
	BeginRequestID              string
	BeginControlDigest          string
	PacketHash                  string
	BundleManifestHash          string
	State                       runtimev1.AgentSourceMaterializationUploadState
	ControlBytes                []byte
	CommitRequestID             string
	AbortRequestID              string
	CommittedLocalAgentRef      string
	CommittedSourceContextBytes []byte
	TerminalReasonCode          runtimev1.AgentSourceMaterializationReasonCode
	CreatedAt                   time.Time
	ExpiresAt                   time.Time
	UpdatedAt                   time.Time
}

// sourceMaterializationNonceReplayRecord is a digest-only admission ledger.
// It intentionally retains neither the packet nor the raw nonce and remains
// separate from the immutable source snapshot/product lifecycle.
type sourceMaterializationNonceReplayRecord struct {
	RuntimeInstanceID string
	Issuer            string
	NonceDigest       string
	PacketHash        string
	ChallengeID       string
	FirstSeenAt       time.Time
	ExpiresAt         time.Time
}

type sourceMaterializationChunkRecord struct {
	UploadID        string
	GlobalOrdinal   uint32
	PutRequestID    string
	ComponentID     string
	ComponentOffset uint64
	ChunkSHA256     string
	Bytes           []byte
	CreatedAt       time.Time
}

type sourceMaterializationRepository struct {
	backend *runtimepersistence.Backend
}

func newSourceMaterializationRepository(backend *runtimepersistence.Backend) *sourceMaterializationRepository {
	return &sourceMaterializationRepository{backend: backend}
}

func (r *sourceMaterializationRepository) bindRuntimeInstance(ctx context.Context, runtimeInstanceID string, now time.Time) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("source materialization repository is unavailable")
	}
	if runtimeInstanceID == "" || runtimeInstanceID != strings.TrimSpace(runtimeInstanceID) {
		return fmt.Errorf("runtime instance id is required")
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var current string
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, sourceMaterializationRuntimeInstanceMetaKey).Scan(&current)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read source materialization runtime instance: %w", err)
		}
		if err == nil && strings.TrimSpace(current) == runtimeInstanceID {
			return nil
		}
		// A configured Runtime identity change is a data-root authority change.
		// No challenge or unfinished upload from the previous identity survives.
		if err == nil {
			if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_nonce_replay`); err != nil {
				return fmt.Errorf("clear source materialization nonce replay ledger on runtime identity change: %w", err)
			}
			if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk`); err != nil {
				return fmt.Errorf("clear source materialization chunks on runtime identity change: %w", err)
			}
			if _, err := tx.Exec(`
				UPDATE runtime_source_materialization_upload
				SET state = ?, control_bytes = NULL, terminal_reason_code = ?, updated_at = ?
				WHERE state IN (?, ?)
			`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED), int(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_STATE_CONFLICT), formatSourceMaterializationTime(now), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING)); err != nil {
				return fmt.Errorf("invalidate source materialization uploads on runtime identity change: %w", err)
			}
			if _, err := tx.Exec(`
				UPDATE runtime_source_materialization_challenge
				SET state = ?, updated_at = ?
				WHERE state IN (?, ?)
			`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED), formatSourceMaterializationTime(now), int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED), int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED)); err != nil {
				return fmt.Errorf("invalidate source materialization challenges on runtime identity change: %w", err)
			}
		}
		if _, err := tx.Exec(`
			INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value
		`, sourceMaterializationRuntimeInstanceMetaKey, runtimeInstanceID); err != nil {
			return fmt.Errorf("persist source materialization runtime instance: %w", err)
		}
		return nil
	})
}

func (r *sourceMaterializationRepository) createChallenge(
	ctx context.Context,
	record sourceMaterializationChallengeRecord,
) (sourceMaterializationChallengeRecord, bool, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var committed sourceMaterializationChallengeRecord
	var idempotent bool
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var boundRuntimeInstanceID string
		if err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, sourceMaterializationRuntimeInstanceMetaKey).Scan(&boundRuntimeInstanceID); err != nil {
			return fmt.Errorf("read bound source materialization runtime instance: %w", err)
		}
		if strings.TrimSpace(boundRuntimeInstanceID) != record.RuntimeInstanceID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
			return nil
		}
		existing, found, err := loadSourceMaterializationChallengeByRequestTx(tx, record.RuntimeInstanceID, record.MaterializerAccountID, record.RequestID)
		if err != nil {
			return err
		}
		if found {
			if !sameSourceMaterializationSourceRef(existing.SourceRef, record.SourceRef) {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT
				return nil
			}
			committed = existing
			idempotent = true
			return nil
		}
		_, err = tx.Exec(`
			INSERT INTO runtime_source_materialization_challenge(
				challenge_id, challenge_digest, intended_runtime_audience,
				runtime_instance_id, materializer_account_id, request_id,
				source_kind, world_id, source_id, source_content_hash,
				max_bundle_bytes, max_component_count, max_chunk_bytes, max_chunks,
				state, issued_at, expires_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, record.ChallengeID, record.ChallengeDigest, record.IntendedRuntimeAudience,
			record.RuntimeInstanceID, record.MaterializerAccountID, record.RequestID,
			int(record.SourceRef.GetKind()), record.SourceRef.GetWorldId(), record.SourceRef.GetSourceId(), record.SourceRef.GetSourceContentHash(),
			record.Limits.GetMaxBundleBytes(), record.Limits.GetMaxComponentCount(), record.Limits.GetMaxChunkBytes(), record.Limits.GetMaxChunks(),
			int(record.State), formatSourceMaterializationTime(record.IssuedAt), formatSourceMaterializationTime(record.ExpiresAt), formatSourceMaterializationTime(record.UpdatedAt))
		if err != nil {
			return fmt.Errorf("insert source materialization challenge: %w", err)
		}
		committed = cloneSourceMaterializationChallengeRecord(record)
		return nil
	})
	return committed, idempotent, reason, err
}

func (r *sourceMaterializationRepository) challenge(ctx context.Context, challengeID string) (sourceMaterializationChallengeRecord, bool, error) {
	row := r.backend.DB().QueryRowContext(ctx, sourceMaterializationChallengeSelect+` WHERE challenge_id = ?`, strings.TrimSpace(challengeID))
	return scanSourceMaterializationChallengeValues(row)
}

func (r *sourceMaterializationRepository) beginUpload(
	ctx context.Context,
	record sourceMaterializationUploadRecord,
	nonceReplay sourceMaterializationNonceReplayRecord,
	now time.Time,
) (sourceMaterializationUploadRecord, sourceMaterializationChallengeRecord, bool, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var committedUpload sourceMaterializationUploadRecord
	var committedChallenge sourceMaterializationChallengeRecord
	var idempotent bool
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		existing, found, err := loadSourceMaterializationUploadByBeginRequestTx(tx, record.MaterializerAccountID, record.BeginRequestID)
		if err != nil {
			return err
		}
		if found {
			challenge, challengeFound, err := loadSourceMaterializationChallengeTx(tx, existing.ChallengeID)
			if err != nil {
				return err
			}
			if !challengeFound {
				return fmt.Errorf("source materialization upload references missing challenge")
			}
			if existing.ChallengeID != record.ChallengeID || existing.BeginControlDigest != record.BeginControlDigest || existing.PacketHash != record.PacketHash || existing.BundleManifestHash != record.BundleManifestHash {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT
				return nil
			}
			committedUpload = existing
			committedChallenge = challenge
			idempotent = true
			return nil
		}

		challenge, found, err := loadSourceMaterializationChallengeTx(tx, record.ChallengeID)
		if err != nil {
			return err
		}
		if !found {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_NOT_FOUND
			return nil
		}
		committedChallenge = challenge
		if challenge.MaterializerAccountID != record.MaterializerAccountID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
			return nil
		}
		if !now.Before(challenge.ExpiresAt) {
			if _, err := tx.Exec(`UPDATE runtime_source_materialization_challenge SET state = ?, updated_at = ? WHERE challenge_id = ? AND state = ?`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED), formatSourceMaterializationTime(now), challenge.ChallengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED)); err != nil {
				return err
			}
			committedChallenge.State = runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_EXPIRED
			return nil
		}
		if challenge.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED {
			switch challenge.State {
			case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED:
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_ALREADY_LEASED
			case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED:
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_ALREADY_CONSUMED
			case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED:
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_EXPIRED
			default:
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
			}
			return nil
		}
		if nonceReplay.RuntimeInstanceID != challenge.RuntimeInstanceID ||
			nonceReplay.ChallengeID != challenge.ChallengeID ||
			nonceReplay.PacketHash != record.PacketHash ||
			nonceReplay.ExpiresAt.IsZero() || !nonceReplay.ExpiresAt.Equal(challenge.ExpiresAt) ||
			strings.TrimSpace(nonceReplay.Issuer) == "" || !validSHA256Hex(nonceReplay.NonceDigest) {
			return fmt.Errorf("source materialization nonce replay binding is invalid")
		}
		var replayChallengeID string
		err = tx.QueryRow(`
			SELECT challenge_id FROM runtime_source_materialization_nonce_replay
			WHERE runtime_instance_id = ? AND issuer = ? AND nonce_digest = ?
		`, nonceReplay.RuntimeInstanceID, nonceReplay.Issuer, nonceReplay.NonceDigest).Scan(&replayChallengeID)
		if err == nil {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read source materialization nonce replay ledger: %w", err)
		}

		result, err := tx.Exec(`
			UPDATE runtime_source_materialization_challenge
			SET state = ?, leased_upload_id = ?, packet_hash = ?, bundle_manifest_hash = ?, updated_at = ?
			WHERE challenge_id = ? AND state = ?
		`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED), record.UploadID, record.PacketHash, record.BundleManifestHash, formatSourceMaterializationTime(now), record.ChallengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED))
		if err != nil {
			return fmt.Errorf("lease source materialization challenge: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected != 1 {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
			return nil
		}
		if _, err := tx.Exec(`
			INSERT INTO runtime_source_materialization_nonce_replay(
				runtime_instance_id, issuer, nonce_digest, packet_hash,
				challenge_id, first_seen_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`, nonceReplay.RuntimeInstanceID, nonceReplay.Issuer, nonceReplay.NonceDigest,
			nonceReplay.PacketHash, nonceReplay.ChallengeID,
			formatSourceMaterializationTime(nonceReplay.FirstSeenAt),
			formatSourceMaterializationTime(nonceReplay.ExpiresAt)); err != nil {
			return fmt.Errorf("insert source materialization nonce replay ledger: %w", err)
		}
		_, err = tx.Exec(`
			INSERT INTO runtime_source_materialization_upload(
				upload_id, challenge_id, materializer_account_id, begin_request_id,
				begin_control_digest, packet_hash, bundle_manifest_hash, state,
				control_bytes, terminal_reason_code, created_at, expires_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, record.UploadID, record.ChallengeID, record.MaterializerAccountID, record.BeginRequestID,
			record.BeginControlDigest, record.PacketHash, record.BundleManifestHash, int(record.State),
			record.ControlBytes, int(record.TerminalReasonCode), formatSourceMaterializationTime(record.CreatedAt), formatSourceMaterializationTime(record.ExpiresAt), formatSourceMaterializationTime(record.UpdatedAt))
		if err != nil {
			return fmt.Errorf("insert source materialization upload: %w", err)
		}
		committedUpload = cloneSourceMaterializationUploadRecord(record)
		committedChallenge.State = runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED
		committedChallenge.LeasedUploadID = record.UploadID
		committedChallenge.PacketHash = record.PacketHash
		committedChallenge.BundleManifestHash = record.BundleManifestHash
		return nil
	})
	return committedUpload, committedChallenge, idempotent, reason, err
}

func (r *sourceMaterializationRepository) uploadByBeginRequest(ctx context.Context, accountID, beginRequestID string) (sourceMaterializationUploadRecord, bool, error) {
	row := r.backend.DB().QueryRowContext(ctx, sourceMaterializationUploadSelect+` WHERE materializer_account_id = ? AND begin_request_id = ?`, strings.TrimSpace(accountID), strings.TrimSpace(beginRequestID))
	return scanSourceMaterializationUpload(row)
}
