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
)

func (r *sourceMaterializationRepository) upload(ctx context.Context, uploadID string) (sourceMaterializationUploadRecord, bool, error) {
	row := r.backend.DB().QueryRowContext(ctx, sourceMaterializationUploadSelect+` WHERE upload_id = ?`, strings.TrimSpace(uploadID))
	return scanSourceMaterializationUpload(row)
}

func (r *sourceMaterializationRepository) preflightPutRequest(
	ctx context.Context,
	uploadID string,
	accountID string,
	putRequestID string,
	packetHash string,
	manifestHash string,
	chunk sourceMaterializationChunkRecord,
	now time.Time,
) (sourceMaterializationUploadRecord, bool, bool, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var upload sourceMaterializationUploadRecord
	var foundRequest bool
	var idempotent bool
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, uploadID)
		if err != nil {
			return err
		}
		if !found {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND
			return nil
		}
		upload = current
		if current.MaterializerAccountID != accountID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
			return nil
		}
		var ordinal, offset int64
		var componentID, digest string
		var raw []byte
		err = tx.QueryRow(`
			SELECT global_ordinal, component_id, component_offset, chunk_sha256, chunk_bytes
			FROM runtime_source_materialization_chunk WHERE upload_id = ? AND put_request_id = ?
		`, uploadID, putRequestID).Scan(&ordinal, &componentID, &offset, &digest, &raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("preflight source materialization put request: %w", err)
		}
		if err == nil {
			foundRequest = true
			if current.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
				reason = sourceMaterializationReasonForUploadState(current)
				return nil
			}
			if current.PacketHash == packetHash && current.BundleManifestHash == manifestHash && ordinal == int64(chunk.GlobalOrdinal) && componentID == chunk.ComponentID && offset == int64(chunk.ComponentOffset) && digest == chunk.ChunkSHA256 && bytes.Equal(raw, chunk.Bytes) {
				idempotent = true
				return nil
			}
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT
			if err := failSourceMaterializationUploadTx(tx, current, reason, now); err != nil {
				return err
			}
			upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED
			upload.TerminalReasonCode = reason
			upload.ControlBytes = nil
			return nil
		}

		err = tx.QueryRow(`
			SELECT global_ordinal, component_id, component_offset, chunk_sha256, chunk_bytes
			FROM runtime_source_materialization_chunk WHERE upload_id = ? AND global_ordinal = ?
		`, uploadID, chunk.GlobalOrdinal).Scan(&ordinal, &componentID, &offset, &digest, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("preflight source materialization chunk ordinal: %w", err)
		}
		foundRequest = true
		if current.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
			reason = sourceMaterializationReasonForUploadState(current)
			return nil
		}
		if current.PacketHash == packetHash && current.BundleManifestHash == manifestHash && ordinal == int64(chunk.GlobalOrdinal) && componentID == chunk.ComponentID && offset == int64(chunk.ComponentOffset) && digest == chunk.ChunkSHA256 && bytes.Equal(raw, chunk.Bytes) {
			idempotent = true
			return nil
		}
		reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT
		if err := failSourceMaterializationUploadTx(tx, current, reason, now); err != nil {
			return err
		}
		upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED
		upload.TerminalReasonCode = reason
		upload.ControlBytes = nil
		return nil
	})
	return upload, foundRequest, idempotent, reason, err
}

func (r *sourceMaterializationRepository) putChunk(
	ctx context.Context,
	chunk sourceMaterializationChunkRecord,
	accountID string,
	packetHash string,
	manifestHash string,
	now time.Time,
) (sourceMaterializationUploadRecord, bool, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var upload sourceMaterializationUploadRecord
	var idempotent bool
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, chunk.UploadID)
		if err != nil {
			return err
		}
		if !found {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND
			return nil
		}
		upload = current
		if current.MaterializerAccountID != accountID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
			return nil
		}
		if current.PacketHash != packetHash || current.BundleManifestHash != manifestHash {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_STATE_CONFLICT
			return nil
		}
		if current.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
			reason = sourceMaterializationReasonForUploadState(current)
			return nil
		}
		var requestOrdinal int64
		var requestComponentID, requestDigest string
		var requestOffset int64
		var requestBytes []byte
		err = tx.QueryRow(`
			SELECT global_ordinal, component_id, component_offset, chunk_sha256, chunk_bytes
			FROM runtime_source_materialization_chunk WHERE upload_id = ? AND put_request_id = ?
		`, chunk.UploadID, chunk.PutRequestID).Scan(&requestOrdinal, &requestComponentID, &requestOffset, &requestDigest, &requestBytes)
		if err == nil {
			if requestOrdinal == int64(chunk.GlobalOrdinal) && requestComponentID == chunk.ComponentID && requestOffset == int64(chunk.ComponentOffset) && requestDigest == chunk.ChunkSHA256 && bytes.Equal(requestBytes, chunk.Bytes) {
				idempotent = true
				return nil
			}
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT
			if err := failSourceMaterializationUploadTx(tx, current, reason, now); err != nil {
				return err
			}
			upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED
			upload.TerminalReasonCode = reason
			upload.ControlBytes = nil
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read source materialization chunk request: %w", err)
		}

		var existing sourceMaterializationChunkRecord
		var ordinal int64
		var offset int64
		err = tx.QueryRow(`
			SELECT upload_id, global_ordinal, put_request_id, component_id, component_offset, chunk_sha256, chunk_bytes, created_at
			FROM runtime_source_materialization_chunk WHERE upload_id = ? AND global_ordinal = ?
		`, chunk.UploadID, chunk.GlobalOrdinal).Scan(&existing.UploadID, &ordinal, &existing.PutRequestID, &existing.ComponentID, &offset, &existing.ChunkSHA256, &existing.Bytes, newSourceMaterializationTimeScanner(&existing.CreatedAt))
		if err == nil {
			existing.GlobalOrdinal = uint32(ordinal)
			existing.ComponentOffset = uint64(offset)
			if existing.ComponentID == chunk.ComponentID && existing.ComponentOffset == chunk.ComponentOffset && existing.ChunkSHA256 == chunk.ChunkSHA256 && bytes.Equal(existing.Bytes, chunk.Bytes) {
				idempotent = true
				return nil
			}
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT
			if err := failSourceMaterializationUploadTx(tx, current, reason, now); err != nil {
				return err
			}
			upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED
			upload.TerminalReasonCode = reason
			upload.ControlBytes = nil
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read source materialization chunk: %w", err)
		}
		if _, err := tx.Exec(`
			INSERT INTO runtime_source_materialization_chunk(
				upload_id, global_ordinal, put_request_id, component_id,
				component_offset, chunk_sha256, chunk_bytes, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, chunk.UploadID, chunk.GlobalOrdinal, chunk.PutRequestID, chunk.ComponentID,
			chunk.ComponentOffset, chunk.ChunkSHA256, chunk.Bytes, formatSourceMaterializationTime(chunk.CreatedAt)); err != nil {
			return fmt.Errorf("insert source materialization chunk: %w", err)
		}
		return nil
	})
	return upload, idempotent, reason, err
}

func (r *sourceMaterializationRepository) failUpload(
	ctx context.Context,
	uploadID string,
	reason runtimev1.AgentSourceMaterializationReasonCode,
	now time.Time,
) (sourceMaterializationUploadRecord, runtimev1.AgentSourceMaterializationChallengeState, error) {
	var upload sourceMaterializationUploadRecord
	challengeState := runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, uploadID)
		if err != nil {
			return err
		}
		if !found {
			return sql.ErrNoRows
		}
		upload = current
		if current.State == runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN || current.State == runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING {
			if err := failSourceMaterializationUploadTx(tx, current, reason, now); err != nil {
				return err
			}
			upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED
			upload.TerminalReasonCode = reason
			upload.ControlBytes = nil
			challengeState = runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED
			return nil
		}
		challenge, found, err := loadSourceMaterializationChallengeTx(tx, current.ChallengeID)
		if err != nil {
			return err
		}
		if found {
			challengeState = challenge.State
		}
		return nil
	})
	return upload, challengeState, err
}

type sourceMaterializationCommitDisposition int

const (
	sourceMaterializationCommitDispositionProceed sourceMaterializationCommitDisposition = iota + 1
	sourceMaterializationCommitDispositionReplay
	sourceMaterializationCommitDispositionRejected
)

func (r *sourceMaterializationRepository) prepareCommit(
	ctx context.Context,
	uploadID string,
	accountID string,
	commitRequestID string,
	packetHash string,
	manifestHash string,
	now time.Time,
) (sourceMaterializationUploadRecord, sourceMaterializationChallengeRecord, sourceMaterializationCommitDisposition, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var upload sourceMaterializationUploadRecord
	var challenge sourceMaterializationChallengeRecord
	disposition := sourceMaterializationCommitDispositionRejected
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, uploadID)
		if err != nil {
			return err
		}
		if !found {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND
			return nil
		}
		upload = current
		challengeRecord, found, err := loadSourceMaterializationChallengeTx(tx, current.ChallengeID)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("source materialization upload references missing challenge")
		}
		challenge = challengeRecord
		if current.MaterializerAccountID != accountID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
			return nil
		}
		if current.PacketHash != packetHash || current.BundleManifestHash != manifestHash {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_CONFLICT
			return nil
		}
		switch current.State {
		case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN:
			result, err := tx.Exec(`
				UPDATE runtime_source_materialization_upload
				SET state = ?, commit_request_id = ?, updated_at = ?
				WHERE upload_id = ? AND state = ?
			`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING), commitRequestID, formatSourceMaterializationTime(now), uploadID, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN))
			if err != nil {
				return fmt.Errorf("begin source materialization commit: %w", err)
			}
			if affected, _ := result.RowsAffected(); affected != 1 {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_CONFLICT
				return nil
			}
			upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING
			upload.CommitRequestID = commitRequestID
			disposition = sourceMaterializationCommitDispositionProceed
			return nil
		case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING:
			if current.CommitRequestID == commitRequestID {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_IN_PROGRESS
			} else {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_CONFLICT
			}
			return nil
		case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED:
			if current.CommitRequestID == commitRequestID {
				disposition = sourceMaterializationCommitDispositionReplay
				return nil
			}
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ALREADY_COMMITTED
			return nil
		default:
			reason = sourceMaterializationReasonForUploadState(current)
			return nil
		}
	})
	return upload, challenge, disposition, reason, err
}

func (r *sourceMaterializationRepository) chunksByUpload(ctx context.Context, uploadID string) ([]sourceMaterializationChunkRecord, error) {
	rows, err := r.backend.DB().QueryContext(ctx, `
		SELECT upload_id, global_ordinal, put_request_id, component_id, component_offset, chunk_sha256, chunk_bytes, created_at
		FROM runtime_source_materialization_chunk WHERE upload_id = ? ORDER BY global_ordinal
	`, strings.TrimSpace(uploadID))
	if err != nil {
		return nil, fmt.Errorf("query source materialization chunks: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []sourceMaterializationChunkRecord
	for rows.Next() {
		var item sourceMaterializationChunkRecord
		var ordinal int64
		var offset int64
		if err := rows.Scan(&item.UploadID, &ordinal, &item.PutRequestID, &item.ComponentID, &offset, &item.ChunkSHA256, &item.Bytes, newSourceMaterializationTimeScanner(&item.CreatedAt)); err != nil {
			return nil, fmt.Errorf("scan source materialization chunk: %w", err)
		}
		if ordinal < 0 || offset < 0 {
			return nil, fmt.Errorf("persisted source materialization chunk has negative coordinates")
		}
		item.GlobalOrdinal = uint32(ordinal)
		item.ComponentOffset = uint64(offset)
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate source materialization chunks: %w", err)
	}
	return out, nil
}

type sourceMaterializationProductTxHook func(*sql.Tx, string, localAgentSourceSnapshotV1) error

func (r *sourceMaterializationRepository) finishCommit(
	ctx context.Context,
	upload sourceMaterializationUploadRecord,
	challenge sourceMaterializationChallengeRecord,
	commitRequestID string,
	snapshotCandidate localAgentSourceSnapshotCandidateV1,
	localAgentRef string,
	sourceContextStatusBytes []byte,
	now time.Time,
	productHook sourceMaterializationProductTxHook,
) error {
	if productHook == nil {
		return fmt.Errorf("source materialization product transaction hook is required")
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, upload.UploadID)
		if err != nil {
			return err
		}
		if !found || current.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING || current.CommitRequestID != commitRequestID {
			return errSourceMaterializationCommitLost
		}
		currentChallenge, found, err := loadSourceMaterializationChallengeTx(tx, challenge.ChallengeID)
		if err != nil {
			return err
		}
		if !found || currentChallenge.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED || currentChallenge.LeasedUploadID != upload.UploadID {
			return errSourceMaterializationCommitLost
		}

		snapshot, err := finalizeLocalAgentSourceSnapshotV1(snapshotCandidate, localAgentRef, now)
		if err != nil {
			return err
		}
		if err := productHook(tx, localAgentRef, snapshot); err != nil {
			return fmt.Errorf("commit source materialization product: %w", err)
		}
		if err := insertLocalAgentSourceSnapshotTx(tx, snapshot); err != nil {
			return err
		}
		challengeResult, err := tx.Exec(`
			UPDATE runtime_source_materialization_challenge
			SET state = ?, updated_at = ?
			WHERE challenge_id = ? AND state = ? AND leased_upload_id = ?
		`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED), formatSourceMaterializationTime(now), challenge.ChallengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED), upload.UploadID)
		if err != nil {
			return fmt.Errorf("consume source materialization challenge: %w", err)
		}
		if affected, _ := challengeResult.RowsAffected(); affected != 1 {
			return errSourceMaterializationCommitLost
		}
		result, err := tx.Exec(`
			UPDATE runtime_source_materialization_upload
			SET state = ?, committed_local_agent_ref = ?, committed_source_context_status = ?,
				control_bytes = NULL, terminal_reason_code = ?, updated_at = ?
			WHERE upload_id = ? AND state = ? AND commit_request_id = ?
		`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED), localAgentRef, sourceContextStatusBytes,
			int(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE), formatSourceMaterializationTime(now), upload.UploadID,
			int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING), commitRequestID)
		if err != nil {
			return fmt.Errorf("complete source materialization upload: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected != 1 {
			return errSourceMaterializationCommitLost
		}
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id = ?`, upload.UploadID); err != nil {
			return fmt.Errorf("clear committed source materialization chunks: %w", err)
		}
		return nil
	})
}

func (r *sourceMaterializationRepository) abortUpload(
	ctx context.Context,
	uploadID string,
	accountID string,
	abortRequestID string,
	packetHash string,
	manifestHash string,
	now time.Time,
) (sourceMaterializationUploadRecord, runtimev1.AgentSourceMaterializationChallengeState, bool, runtimev1.AgentSourceMaterializationReasonCode, error) {
	var upload sourceMaterializationUploadRecord
	challengeState := runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED
	var idempotent bool
	reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	err := r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		current, found, err := loadSourceMaterializationUploadTx(tx, uploadID)
		if err != nil {
			return err
		}
		if !found {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND
			return nil
		}
		upload = current
		challenge, found, err := loadSourceMaterializationChallengeTx(tx, current.ChallengeID)
		if err != nil {
			return err
		}
		if found {
			challengeState = challenge.State
		}
		if current.MaterializerAccountID != accountID {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
			return nil
		}
		if current.PacketHash != packetHash || current.BundleManifestHash != manifestHash {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_STATE_CONFLICT
			return nil
		}
		if current.State == runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED {
			if current.AbortRequestID == abortRequestID {
				idempotent = true
				challengeState = runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED
			} else {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT
			}
			return nil
		}
		if current.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
			reason = sourceMaterializationReasonForUploadState(current)
			return nil
		}
		if strings.TrimSpace(abortRequestID) == "" {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST
			return nil
		}
		if _, err := tx.Exec(`
			UPDATE runtime_source_materialization_upload
			SET state = ?, abort_request_id = ?, control_bytes = NULL, terminal_reason_code = ?, updated_at = ?
			WHERE upload_id = ? AND state = ?
		`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED), abortRequestID, int(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ABORTED), formatSourceMaterializationTime(now), uploadID, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN)); err != nil {
			return fmt.Errorf("abort source materialization upload: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id = ?`, uploadID); err != nil {
			return fmt.Errorf("clear aborted source materialization chunks: %w", err)
		}
		if _, err := tx.Exec(`
			UPDATE runtime_source_materialization_challenge SET state = ?, updated_at = ?
			WHERE challenge_id = ? AND state = ? AND leased_upload_id = ?
		`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED), formatSourceMaterializationTime(now), current.ChallengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED), uploadID); err != nil {
			return fmt.Errorf("invalidate aborted source materialization challenge: %w", err)
		}
		upload.State = runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED
		upload.AbortRequestID = abortRequestID
		upload.ControlBytes = nil
		upload.TerminalReasonCode = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ABORTED
		challengeState = runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED
		return nil
	})
	return upload, challengeState, idempotent, reason, err
}

func (r *sourceMaterializationRepository) sweepExpired(ctx context.Context, now time.Time) error {
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		nowText := formatSourceMaterializationTime(now)
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_nonce_replay WHERE expires_at <= ?`, nowText); err != nil {
			return fmt.Errorf("expire source materialization nonce replay ledger: %w", err)
		}
		if _, err := tx.Exec(`
			UPDATE runtime_source_materialization_challenge
			SET state = ?, updated_at = ?
			WHERE state = ? AND expires_at <= ?
		`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED), nowText, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED), nowText); err != nil {
			return fmt.Errorf("expire source materialization challenges: %w", err)
		}
		rows, err := tx.Query(`SELECT upload_id, challenge_id FROM runtime_source_materialization_upload WHERE state = ? AND expires_at <= ?`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN), nowText)
		if err != nil {
			return fmt.Errorf("select expired source materialization uploads: %w", err)
		}
		type expiredUpload struct{ uploadID, challengeID string }
		var expired []expiredUpload
		for rows.Next() {
			var item expiredUpload
			if err := rows.Scan(&item.uploadID, &item.challengeID); err != nil {
				_ = rows.Close()
				return err
			}
			expired = append(expired, item)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range expired {
			if _, err := tx.Exec(`UPDATE runtime_source_materialization_upload SET state = ?, control_bytes = NULL, terminal_reason_code = ?, updated_at = ? WHERE upload_id = ? AND state = ?`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_EXPIRED), int(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_EXPIRED), nowText, item.uploadID, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN)); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id = ?`, item.uploadID); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE runtime_source_materialization_challenge SET state = ?, updated_at = ? WHERE challenge_id = ? AND state = ?`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED), nowText, item.challengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *sourceMaterializationRepository) recoverStartup(ctx context.Context, now time.Time) error {
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		nowText := formatSourceMaterializationTime(now)
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_nonce_replay WHERE expires_at <= ?`, nowText); err != nil {
			return fmt.Errorf("recover source materialization nonce replay ledger: %w", err)
		}
		rows, err := tx.Query(`SELECT upload_id, challenge_id FROM runtime_source_materialization_upload WHERE state IN (?, ?)`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING))
		if err != nil {
			return fmt.Errorf("select unfinished source materialization uploads: %w", err)
		}
		type unfinishedUpload struct{ uploadID, challengeID string }
		var unfinished []unfinishedUpload
		for rows.Next() {
			var item unfinishedUpload
			if err := rows.Scan(&item.uploadID, &item.challengeID); err != nil {
				_ = rows.Close()
				return err
			}
			unfinished = append(unfinished, item)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range unfinished {
			if _, err := tx.Exec(`UPDATE runtime_source_materialization_upload SET state = ?, control_bytes = NULL, terminal_reason_code = ?, updated_at = ? WHERE upload_id = ?`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED), int(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_STATE_CONFLICT), nowText, item.uploadID); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id = ?`, item.uploadID); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE runtime_source_materialization_challenge SET state = ?, updated_at = ? WHERE challenge_id = ? AND state = ?`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED), nowText, item.challengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED)); err != nil {
				return err
			}
		}
		// A committed row contains only the bounded result ledger; this cleanup
		// is the crash-safe final guard against residual upload bytes.
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id IN (SELECT upload_id FROM runtime_source_materialization_upload WHERE state = ?)`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED)); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runtime_source_materialization_upload SET control_bytes = NULL WHERE state IN (?, ?, ?, ?, ?)`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_EXPIRED), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING)); err != nil {
			return err
		}
		return nil
	})
}

func failSourceMaterializationUploadTx(tx *sql.Tx, upload sourceMaterializationUploadRecord, reason runtimev1.AgentSourceMaterializationReasonCode, now time.Time) error {
	if _, err := tx.Exec(`UPDATE runtime_source_materialization_upload SET state = ?, control_bytes = NULL, terminal_reason_code = ?, updated_at = ? WHERE upload_id = ? AND state IN (?, ?)`, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED), int(reason), formatSourceMaterializationTime(now), upload.UploadID, int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN), int(runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING)); err != nil {
		return fmt.Errorf("fail source materialization upload: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_chunk WHERE upload_id = ?`, upload.UploadID); err != nil {
		return fmt.Errorf("clear failed source materialization chunks: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_source_materialization_challenge SET state = ?, updated_at = ? WHERE challenge_id = ? AND state = ? AND leased_upload_id = ?`, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED), formatSourceMaterializationTime(now), upload.ChallengeID, int(runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED), upload.UploadID); err != nil {
		return fmt.Errorf("invalidate failed source materialization challenge: %w", err)
	}
	return nil
}
