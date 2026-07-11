package runtimeagent

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const sourceMaterializationChallengeSelect = `
	SELECT challenge_id, challenge_digest, intended_runtime_audience,
		runtime_instance_id, materializer_account_id, request_id,
		source_kind, world_id, source_id, source_content_hash,
		max_bundle_bytes, max_component_count, max_chunk_bytes, max_chunks,
		state, leased_upload_id, packet_hash, bundle_manifest_hash,
		issued_at, expires_at, updated_at
	FROM runtime_source_materialization_challenge`

const sourceMaterializationUploadSelect = `
	SELECT upload_id, challenge_id, materializer_account_id, begin_request_id,
		begin_control_digest, packet_hash, bundle_manifest_hash, state, control_bytes,
		commit_request_id, abort_request_id, committed_local_agent_ref, committed_source_context_status,
		terminal_reason_code, created_at, expires_at, updated_at
	FROM runtime_source_materialization_upload`

type sourceMaterializationRowScanner interface {
	Scan(dest ...any) error
}

func scanSourceMaterializationChallengeValues(row sourceMaterializationRowScanner) (sourceMaterializationChallengeRecord, bool, error) {
	var out sourceMaterializationChallengeRecord
	var kind, state int
	var maxComponents, maxChunks int64
	var maxBundle, maxChunk int64
	var worldID, sourceID, sourceHash string
	var leased, packetHash, manifestHash sql.NullString
	err := row.Scan(&out.ChallengeID, &out.ChallengeDigest, &out.IntendedRuntimeAudience,
		&out.RuntimeInstanceID, &out.MaterializerAccountID, &out.RequestID,
		&kind, &worldID, &sourceID, &sourceHash,
		&maxBundle, &maxComponents, &maxChunk, &maxChunks,
		&state, &leased, &packetHash, &manifestHash,
		newSourceMaterializationTimeScanner(&out.IssuedAt), newSourceMaterializationTimeScanner(&out.ExpiresAt), newSourceMaterializationTimeScanner(&out.UpdatedAt))
	if errors.Is(err, sql.ErrNoRows) {
		return sourceMaterializationChallengeRecord{}, false, nil
	}
	if err != nil {
		return sourceMaterializationChallengeRecord{}, false, fmt.Errorf("scan source materialization challenge: %w", err)
	}
	if maxBundle < 0 || maxComponents < 0 || maxChunk < 0 || maxChunks < 0 {
		return sourceMaterializationChallengeRecord{}, false, fmt.Errorf("persisted source materialization challenge has negative limits")
	}
	out.SourceRef = &runtimev1.SourceMaterializationSourceRef{Kind: runtimev1.AgentSourceMaterializationSourceKind(kind), WorldId: worldID, SourceId: sourceID, SourceContentHash: sourceHash}
	out.Limits = &runtimev1.SourceMaterializationChallengeLimits{MaxBundleBytes: uint64(maxBundle), MaxComponentCount: uint32(maxComponents), MaxChunkBytes: uint64(maxChunk), MaxChunks: uint32(maxChunks)}
	out.State = runtimev1.AgentSourceMaterializationChallengeState(state)
	out.LeasedUploadID = leased.String
	out.PacketHash = packetHash.String
	out.BundleManifestHash = manifestHash.String
	return out, true, nil
}

func scanSourceMaterializationUpload(row sourceMaterializationRowScanner) (sourceMaterializationUploadRecord, bool, error) {
	var out sourceMaterializationUploadRecord
	var state, reason int
	var control, statusBytes []byte
	var commitID, abortID, localRef sql.NullString
	err := row.Scan(&out.UploadID, &out.ChallengeID, &out.MaterializerAccountID, &out.BeginRequestID,
		&out.BeginControlDigest, &out.PacketHash, &out.BundleManifestHash, &state, &control,
		&commitID, &abortID, &localRef, &statusBytes, &reason,
		newSourceMaterializationTimeScanner(&out.CreatedAt), newSourceMaterializationTimeScanner(&out.ExpiresAt), newSourceMaterializationTimeScanner(&out.UpdatedAt))
	if errors.Is(err, sql.ErrNoRows) {
		return sourceMaterializationUploadRecord{}, false, nil
	}
	if err != nil {
		return sourceMaterializationUploadRecord{}, false, fmt.Errorf("scan source materialization upload: %w", err)
	}
	out.State = runtimev1.AgentSourceMaterializationUploadState(state)
	out.ControlBytes = append([]byte(nil), control...)
	out.CommitRequestID = commitID.String
	out.AbortRequestID = abortID.String
	out.CommittedLocalAgentRef = localRef.String
	out.CommittedSourceContextBytes = append([]byte(nil), statusBytes...)
	out.TerminalReasonCode = runtimev1.AgentSourceMaterializationReasonCode(reason)
	return out, true, nil
}

func loadSourceMaterializationChallengeTx(tx *sql.Tx, challengeID string) (sourceMaterializationChallengeRecord, bool, error) {
	return scanSourceMaterializationChallengeValues(tx.QueryRow(sourceMaterializationChallengeSelect+` WHERE challenge_id = ?`, challengeID))
}

func loadSourceMaterializationChallengeByRequestTx(tx *sql.Tx, runtimeInstanceID, accountID, requestID string) (sourceMaterializationChallengeRecord, bool, error) {
	return scanSourceMaterializationChallengeValues(tx.QueryRow(sourceMaterializationChallengeSelect+` WHERE runtime_instance_id = ? AND materializer_account_id = ? AND request_id = ?`, runtimeInstanceID, accountID, requestID))
}

func loadSourceMaterializationUploadTx(tx *sql.Tx, uploadID string) (sourceMaterializationUploadRecord, bool, error) {
	return scanSourceMaterializationUpload(tx.QueryRow(sourceMaterializationUploadSelect+` WHERE upload_id = ?`, uploadID))
}

func loadSourceMaterializationUploadByBeginRequestTx(tx *sql.Tx, accountID, beginRequestID string) (sourceMaterializationUploadRecord, bool, error) {
	return scanSourceMaterializationUpload(tx.QueryRow(sourceMaterializationUploadSelect+` WHERE materializer_account_id = ? AND begin_request_id = ?`, accountID, beginRequestID))
}

func cloneSourceMaterializationChallengeRecord(in sourceMaterializationChallengeRecord) sourceMaterializationChallengeRecord {
	out := in
	if in.SourceRef != nil {
		out.SourceRef = &runtimev1.SourceMaterializationSourceRef{Kind: in.SourceRef.GetKind(), WorldId: in.SourceRef.GetWorldId(), SourceId: in.SourceRef.GetSourceId(), SourceContentHash: in.SourceRef.GetSourceContentHash()}
	}
	if in.Limits != nil {
		out.Limits = &runtimev1.SourceMaterializationChallengeLimits{MaxBundleBytes: in.Limits.GetMaxBundleBytes(), MaxComponentCount: in.Limits.GetMaxComponentCount(), MaxChunkBytes: in.Limits.GetMaxChunkBytes(), MaxChunks: in.Limits.GetMaxChunks()}
	}
	return out
}

func cloneSourceMaterializationUploadRecord(in sourceMaterializationUploadRecord) sourceMaterializationUploadRecord {
	out := in
	out.ControlBytes = append([]byte(nil), in.ControlBytes...)
	out.CommittedSourceContextBytes = append([]byte(nil), in.CommittedSourceContextBytes...)
	return out
}

func sameSourceMaterializationSourceRef(a, b *runtimev1.SourceMaterializationSourceRef) bool {
	return a != nil && b != nil && a.GetKind() == b.GetKind() && a.GetWorldId() == b.GetWorldId() && a.GetSourceId() == b.GetSourceId() && a.GetSourceContentHash() == b.GetSourceContentHash()
}

func sourceMaterializationReasonForUploadState(upload sourceMaterializationUploadRecord) runtimev1.AgentSourceMaterializationReasonCode {
	switch upload.State {
	case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_IN_PROGRESS
	case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ALREADY_COMMITTED
	case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ABORTED
	case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_EXPIRED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_EXPIRED
	case runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED:
		if upload.TerminalReasonCode != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE && upload.TerminalReasonCode != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UNSPECIFIED {
			return upload.TerminalReasonCode
		}
	}
	return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_STATE_CONFLICT
}

func sourceMaterializationReasonForChallengeState(state runtimev1.AgentSourceMaterializationChallengeState) runtimev1.AgentSourceMaterializationReasonCode {
	switch state {
	case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_ALREADY_LEASED
	case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_ALREADY_CONSUMED
	case runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_EXPIRED
	default:
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
	}
}

func formatSourceMaterializationTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

type sourceMaterializationTimeScanner struct{ target *time.Time }

func newSourceMaterializationTimeScanner(target *time.Time) *sourceMaterializationTimeScanner {
	return &sourceMaterializationTimeScanner{target: target}
}

func (s *sourceMaterializationTimeScanner) Scan(src any) error {
	if s == nil || s.target == nil {
		return fmt.Errorf("source materialization time target is nil")
	}
	var raw string
	switch value := src.(type) {
	case string:
		raw = value
	case []byte:
		raw = string(value)
	default:
		return fmt.Errorf("source materialization time has unsupported type %T", src)
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return fmt.Errorf("parse source materialization time: %w", err)
	}
	*s.target = parsed.UTC()
	return nil
}

var errSourceMaterializationCommitLost = errors.New("source materialization commit ownership lost")
