package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	defaultSourceMaterializationChallengeTTL             = 10 * time.Minute
	defaultSourceMaterializationSweepPeriod              = 30 * time.Second
	defaultSourceMaterializationMaxBundleBytes    uint64 = 8 * 1024 * 1024
	defaultSourceMaterializationMaxComponentCount uint32 = 256
	defaultSourceMaterializationMaxChunkBytes     uint64 = 256 * 1024
	defaultSourceMaterializationMaxChunks         uint32 = 4096
	maxSourceMaterializationRequestIDBytes               = 128
	maxSourceMaterializationIdentifierBytes              = 512
	maxSourceMaterializationControlBytes                 = 2 * 1024 * 1024
)

var sourceMaterializationChallengeDigestDomain = []byte("nimi.runtime.source-materialization-challenge/v1\x00")

type sourceMaterializationChallengeBindingV2 struct {
	RuntimeInstanceID       string
	MaterializerAccountID   string
	ChallengeID             string
	IntendedRuntimeAudience string
	ChallengeDigest         string
	SourceRef               *runtimev1.SourceMaterializationSourceRef
	Limits                  *runtimev1.SourceMaterializationChallengeLimits
	IssuedAt                time.Time
	ExpiresAt               time.Time
}

// sourceMaterializationAdmission is the fail-closed codec/crypto seam. A
// production implementation must perform strict packet-v2 RS256/JWKS checks
// at Begin and repeat the full hash/closure/normalization admission at Commit.
// The transport never treats structural protobuf validation as source proof.
type sourceMaterializationAdmission interface {
	VerifySourceMaterializationBegin(context.Context, *runtimev1.SourceMaterializationBeginControl, sourceMaterializationChallengeBindingV2, time.Time) error
	AdmitSourceMaterializationCommit(context.Context, *runtimev1.SourceMaterializationBeginControl, sourceMaterializationChallengeBindingV2, map[string][]byte, time.Time) (localAgentSourceSnapshotCandidateV1, error)
}

// sourceMaterializationProductCommitter writes the Runtime-owned Agent and
// every other creation-time product row through the supplied SQLite tx. The
// repository adds snapshot/provenance and terminal ledger rows in that same
// tx. The callback must not open a nested Backend.WriteTx.
type sourceMaterializationProductCommitter interface {
	PrepareSourceMaterializationProduct(context.Context, string, string, *runtimev1.SourceMaterializationSourceRef, localAgentSourceSnapshotV1) (sourceMaterializationPreparedProduct, error)
}

type sourceMaterializationPreparedProduct interface {
	CommitSourceMaterializationProductTx(*sql.Tx) error
	SourceMaterializationProductCommitted()
	SourceMaterializationProductRolledBack()
}

type sourceMaterializationReasonError interface {
	error
	SourceMaterializationReasonCode() runtimev1.AgentSourceMaterializationReasonCode
}

type sourceMaterializationExpectedChunk struct {
	ComponentID string
	Offset      uint64
	Length      uint64
	SHA256      string
}

func (s *Service) CreateSourceMaterializationChallenge(ctx context.Context, req *runtimev1.CreateSourceMaterializationChallengeRequest) (*runtimev1.CreateSourceMaterializationChallengeResponse, error) {
	accountID, requestContext, err := authenticateSourceMaterializationRequest(ctx, req.GetContext(), true)
	if err != nil {
		return nil, err
	}
	runtimeInstanceID, _, _, nowFn, err := s.sourceMaterializationDependencies()
	if err != nil {
		return nil, err
	}
	requestID := req.GetRequestId()
	if !validSourceMaterializationRequestID(requestID) {
		return sourceMaterializationChallengeFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	sourceRef, err := validateSourceMaterializationSourceRef(req.GetSourceRef())
	if err != nil {
		return sourceMaterializationChallengeFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(sourceRef) {
		return sourceMaterializationChallengeFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH), nil
	}
	now := nowFn().UTC().Truncate(time.Millisecond)
	if err := s.sourceMaterializationRepo.sweepExpired(ctx, now); err != nil {
		return nil, status.Errorf(codes.Internal, "sweep source materialization state: %v", err)
	}
	challengeID, err := newSourceMaterializationOpaqueID("smc_")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "generate source materialization challenge: %v", err)
	}
	audience, err := newSourceMaterializationOpaqueID("sma_")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "generate source materialization audience: %v", err)
	}
	limits := defaultSourceMaterializationLimits()
	expiresAt := now.Add(defaultSourceMaterializationChallengeTTL)
	digest := computeSourceMaterializationChallengeDigest(runtimeInstanceID, accountID, challengeID, audience, sourceRef, limits, expiresAt)
	record := sourceMaterializationChallengeRecord{
		ChallengeID:             challengeID,
		ChallengeDigest:         digest,
		IntendedRuntimeAudience: audience,
		RuntimeInstanceID:       runtimeInstanceID,
		MaterializerAccountID:   accountID,
		RequestID:               requestID,
		SourceRef:               sourceRef,
		Limits:                  limits,
		State:                   runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED,
		IssuedAt:                now,
		ExpiresAt:               expiresAt,
		UpdatedAt:               now,
	}
	committed, _, reason, err := s.sourceMaterializationRepo.createChallenge(ctx, record)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "persist source materialization challenge: %v", err)
	}
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationChallengeFailure(reason), nil
	}
	response := sourceMaterializationChallengeResponse(committed)
	response.ReasonCode = sourceMaterializationReasonForChallengeState(committed.State)
	return response, nil
}

func (s *Service) BeginSourceMaterializationUpload(ctx context.Context, req *runtimev1.BeginSourceMaterializationUploadRequest) (*runtimev1.BeginSourceMaterializationUploadResponse, error) {
	accountID, requestContext, err := authenticateSourceMaterializationRequest(ctx, req.GetContext(), true)
	if err != nil {
		return nil, err
	}
	runtimeInstanceID, admission, _, nowFn, err := s.sourceMaterializationDependencies()
	if err != nil {
		return nil, err
	}
	beginRequestID := req.GetBeginRequestId()
	if !validSourceMaterializationRequestID(beginRequestID) {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	now := nowFn().UTC()
	if err := s.sourceMaterializationRepo.sweepExpired(ctx, now); err != nil {
		return nil, status.Errorf(codes.Internal, "sweep source materialization state: %v", err)
	}
	controlBytes, controlMarshalErr := deterministicSourceMaterializationControlBytes(req.GetControl())
	existing, foundExisting, err := s.sourceMaterializationRepo.uploadByBeginRequest(ctx, accountID, beginRequestID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load source materialization begin replay: %v", err)
	}
	if foundExisting {
		if controlMarshalErr != nil || existing.BeginControlDigest != sourceMaterializationBytesDigest(controlBytes) {
			return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT), nil
		}
		challenge, found, err := s.sourceMaterializationRepo.challenge(ctx, existing.ChallengeID)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "load source materialization begin replay challenge: %v", err)
		}
		if !found || challenge.RuntimeInstanceID != runtimeInstanceID {
			return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT), nil
		}
		if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(challenge.SourceRef) {
			return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH), nil
		}
		reason := sourceMaterializationReasonForUploadState(existing)
		if existing.State == runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN && challenge.State == runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED {
			reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
		} else if existing.State == runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
			reason = sourceMaterializationReasonForChallengeState(challenge.State)
		}
		return sourceMaterializationBeginResponse(existing, challenge.State, reason), nil
	}
	if controlMarshalErr != nil || req.GetControl() == nil || req.GetControl().GetPacketEnvelope() == nil {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	if len(controlBytes) > maxSourceMaterializationControlBytes {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID), nil
	}
	if admission == nil {
		return nil, status.Error(codes.FailedPrecondition, "source materialization admission is not configured")
	}
	challengeID := strings.TrimSpace(req.GetControl().GetPacketEnvelope().GetChallengeId())
	challenge, found, err := s.sourceMaterializationRepo.challenge(ctx, challengeID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load source materialization challenge: %v", err)
	}
	if !found {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_NOT_FOUND), nil
	}
	if challenge.RuntimeInstanceID != runtimeInstanceID {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT), nil
	}
	if challenge.MaterializerAccountID != accountID {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH), nil
	}
	if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(challenge.SourceRef) {
		return sourceMaterializationBeginFailure(runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH), nil
	}
	binding := sourceMaterializationBinding(challenge)
	if reason := validateSourceMaterializationBeginControl(req.GetControl(), binding, now); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationBeginFailure(reason), nil
	}
	if err := admission.VerifySourceMaterializationBegin(ctx, req.GetControl(), binding, now); err != nil {
		return sourceMaterializationBeginFailure(sourceMaterializationReasonFromError(err, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PROOF_INVALID)), nil
	}
	uploadID, err := newSourceMaterializationOpaqueID("smu_")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "generate source materialization upload: %v", err)
	}
	envelope := req.GetControl().GetPacketEnvelope()
	record := sourceMaterializationUploadRecord{
		UploadID:              uploadID,
		ChallengeID:           challenge.ChallengeID,
		MaterializerAccountID: accountID,
		BeginRequestID:        beginRequestID,
		BeginControlDigest:    sourceMaterializationBytesDigest(controlBytes),
		PacketHash:            strings.TrimSpace(envelope.GetPacketHash()),
		BundleManifestHash:    strings.TrimSpace(envelope.GetBundleManifestHash()),
		State:                 runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN,
		ControlBytes:          controlBytes,
		TerminalReasonCode:    runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
		CreatedAt:             now,
		ExpiresAt:             challenge.ExpiresAt,
		UpdatedAt:             now,
	}
	nonceReplay := sourceMaterializationNonceReplayRecord{
		RuntimeInstanceID: runtimeInstanceID,
		Issuer:            strings.TrimSpace(envelope.GetIssuer()),
		NonceDigest:       sourceMaterializationNonceDigest(envelope.GetNonce()),
		PacketHash:        record.PacketHash,
		ChallengeID:       challenge.ChallengeID,
		FirstSeenAt:       now,
		ExpiresAt:         challenge.ExpiresAt,
	}
	committedUpload, committedChallenge, _, reason, err := s.sourceMaterializationRepo.beginUpload(ctx, record, nonceReplay, now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "persist source materialization upload: %v", err)
	}
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationBeginFailure(reason), nil
	}
	return sourceMaterializationBeginResponse(committedUpload, committedChallenge.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE), nil
}

func (s *Service) PutSourceMaterializationChunk(ctx context.Context, req *runtimev1.PutSourceMaterializationChunkRequest) (*runtimev1.PutSourceMaterializationChunkResponse, error) {
	accountID, requestContext, err := authenticateSourceMaterializationRequest(ctx, req.GetContext(), true)
	if err != nil {
		return nil, err
	}
	_, _, _, nowFn, err := s.sourceMaterializationDependencies()
	if err != nil {
		return nil, err
	}
	if !validSourceMaterializationRequestID(req.GetPutRequestId()) || !validSourceMaterializationOpaqueID(req.GetUploadId(), "smu_") || !validSHA256Hex(req.GetPacketHash()) || !validSHA256Hex(req.GetBundleManifestHash()) {
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	now := nowFn().UTC()
	if err := s.sourceMaterializationRepo.sweepExpired(ctx, now); err != nil {
		return nil, status.Errorf(codes.Internal, "sweep source materialization state: %v", err)
	}
	upload, found, err := s.sourceMaterializationRepo.upload(ctx, req.GetUploadId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load source materialization upload: %v", err)
	}
	if !found {
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND), nil
	}
	if upload.MaterializerAccountID != accountID {
		return sourceMaterializationPutFailure(req, upload.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH), nil
	}
	challenge, found, err := s.sourceMaterializationRepo.challenge(ctx, upload.ChallengeID)
	if err != nil || !found {
		if err != nil {
			return nil, status.Errorf(codes.Internal, "load source materialization challenge: %v", err)
		}
		return sourceMaterializationPutFailure(req, upload.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_NOT_FOUND), nil
	}
	if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(challenge.SourceRef) {
		return sourceMaterializationPutFailure(req, upload.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH), nil
	}
	preflightChunk := sourceMaterializationChunkRecord{
		UploadID:        upload.UploadID,
		GlobalOrdinal:   req.GetGlobalOrdinal(),
		PutRequestID:    req.GetPutRequestId(),
		ComponentID:     req.GetComponentId(),
		ComponentOffset: req.GetComponentOffset(),
		ChunkSHA256:     req.GetChunkSha256(),
		Bytes:           append([]byte(nil), req.GetBytes()...),
		CreatedAt:       now,
	}
	preflightUpload, foundRequest, idempotentRequest, preflightReason, err := s.sourceMaterializationRepo.preflightPutRequest(ctx, upload.UploadID, accountID, preflightChunk.PutRequestID, req.GetPacketHash(), req.GetBundleManifestHash(), preflightChunk, now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "preflight source materialization chunk: %v", err)
	}
	if foundRequest {
		if preflightReason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
			return sourceMaterializationPutFailure(req, preflightUpload.State, preflightReason), nil
		}
		return &runtimev1.PutSourceMaterializationChunkResponse{UploadId: preflightUpload.UploadID, GlobalOrdinal: req.GetGlobalOrdinal(), ComponentId: req.GetComponentId(), IdempotentReplay: idempotentRequest, UploadState: preflightUpload.State, ReasonCode: runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE}, nil
	}
	if preflightReason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationPutFailure(req, preflightUpload.State, preflightReason), nil
	}
	if upload.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
		return sourceMaterializationPutFailure(req, upload.State, sourceMaterializationReasonForUploadState(upload)), nil
	}
	control := &runtimev1.SourceMaterializationBeginControl{}
	if len(upload.ControlBytes) == 0 || proto.Unmarshal(upload.ControlBytes, control) != nil {
		_, _, _ = s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED), nil
	}
	layout, reason := sourceMaterializationChunkLayout(control.GetBundleTransportManifest(), challenge.Limits)
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		_, _, _ = s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, reason, now)
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED, reason), nil
	}
	expected, ok := layout[req.GetGlobalOrdinal()]
	if !ok || expected.ComponentID != req.GetComponentId() || expected.Offset != req.GetComponentOffset() || expected.Length != uint64(len(req.GetBytes())) {
		reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
		_, _, _ = s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, reason, now)
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED, reason), nil
	}
	if uint64(len(req.GetBytes())) > challenge.Limits.GetMaxChunkBytes() {
		reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CAPACITY_EXCEEDED
		_, _, _ = s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, reason, now)
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED, reason), nil
	}
	actualDigest := sourceMaterializationBytesDigest(req.GetBytes())
	if req.GetChunkSha256() != expected.SHA256 || actualDigest != expected.SHA256 {
		reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DIGEST_MISMATCH
		_, _, _ = s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, reason, now)
		return sourceMaterializationPutFailure(req, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED, reason), nil
	}
	chunk := sourceMaterializationChunkRecord{
		UploadID:        upload.UploadID,
		GlobalOrdinal:   req.GetGlobalOrdinal(),
		PutRequestID:    req.GetPutRequestId(),
		ComponentID:     req.GetComponentId(),
		ComponentOffset: req.GetComponentOffset(),
		ChunkSHA256:     actualDigest,
		Bytes:           append([]byte(nil), req.GetBytes()...),
		CreatedAt:       now,
	}
	committed, idempotent, reason, err := s.sourceMaterializationRepo.putChunk(ctx, chunk, accountID, req.GetPacketHash(), req.GetBundleManifestHash(), now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "persist source materialization chunk: %v", err)
	}
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationPutFailure(req, committed.State, reason), nil
	}
	return &runtimev1.PutSourceMaterializationChunkResponse{
		UploadId:         committed.UploadID,
		GlobalOrdinal:    req.GetGlobalOrdinal(),
		ComponentId:      req.GetComponentId(),
		IdempotentReplay: idempotent,
		UploadState:      committed.State,
		ReasonCode:       runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
	}, nil
}

func (s *Service) CommitSourceMaterialization(ctx context.Context, req *runtimev1.CommitSourceMaterializationRequest) (*runtimev1.CommitSourceMaterializationResponse, error) {
	accountID, requestContext, err := authenticateSourceMaterializationRequest(ctx, req.GetContext(), true)
	if err != nil {
		return nil, err
	}
	_, admission, committer, nowFn, err := s.sourceMaterializationDependencies()
	if err != nil {
		return nil, err
	}
	if admission == nil || committer == nil {
		return nil, status.Error(codes.FailedPrecondition, "source materialization commit dependencies are not configured")
	}
	commitRequestID := req.GetCommitRequestId()
	if !validSourceMaterializationRequestID(commitRequestID) || !validSourceMaterializationOpaqueID(req.GetUploadId(), "smu_") || !validSHA256Hex(req.GetPacketHash()) || !validSHA256Hex(req.GetBundleManifestHash()) {
		return sourceMaterializationCommitFailure(req.GetUploadId(), runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	now := nowFn().UTC()
	if err := s.sourceMaterializationRepo.sweepExpired(ctx, now); err != nil {
		return nil, status.Errorf(codes.Internal, "sweep source materialization state: %v", err)
	}
	upload, challenge, disposition, reason, err := s.sourceMaterializationRepo.prepareCommit(ctx, req.GetUploadId(), accountID, commitRequestID, req.GetPacketHash(), req.GetBundleManifestHash(), now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "prepare source materialization commit: %v", err)
	}
	if disposition == sourceMaterializationCommitDispositionRejected {
		return sourceMaterializationCommitFailure(req.GetUploadId(), upload.State, challenge.State, reason), nil
	}
	if disposition == sourceMaterializationCommitDispositionReplay {
		return s.replaySourceMaterializationCommit(ctx, upload, challenge)
	}
	if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(challenge.SourceRef) {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH, now)
	}
	control := &runtimev1.SourceMaterializationBeginControl{}
	if len(upload.ControlBytes) == 0 || proto.Unmarshal(upload.ControlBytes, control) != nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	binding := sourceMaterializationBinding(challenge)
	if reason := validateSourceMaterializationBeginControl(control, binding, now); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return s.failSourceMaterializationCommit(ctx, upload, reason, now)
	}
	if err := admission.VerifySourceMaterializationBegin(ctx, control, binding, now); err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, sourceMaterializationReasonFromError(err, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PROOF_INVALID), now)
	}
	chunks, err := s.sourceMaterializationRepo.chunksByUpload(ctx, upload.UploadID)
	if err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	components, reason := assembleSourceMaterializationComponents(control.GetBundleTransportManifest(), challenge.Limits, chunks)
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return s.failSourceMaterializationCommit(ctx, upload, reason, now)
	}
	candidate, err := admission.AdmitSourceMaterializationCommit(ctx, control, binding, components, now)
	if err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, sourceMaterializationReasonFromError(err, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ADMISSION_FAILED), now)
	}
	if !sourceMaterializationCandidateMatchesControl(candidate, control, challenge.SourceRef) {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ADMISSION_FAILED, now)
	}
	localAgentRef, err := generateRuntimeLocalAgentRef()
	if err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	preview, err := finalizeLocalAgentSourceSnapshotV1(candidate, localAgentRef, now)
	if err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ADMISSION_FAILED, now)
	}
	sourceStatus := localAgentSourceContextStatus(preview)
	statusBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(sourceStatus)
	if err != nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	prepared, err := committer.PrepareSourceMaterializationProduct(ctx, localAgentRef, accountID, challenge.SourceRef, preview)
	if err != nil || prepared == nil {
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	committedProduct := false
	defer func() {
		if !committedProduct {
			prepared.SourceMaterializationProductRolledBack()
		}
	}()
	hook := func(tx *sql.Tx, _ string, _ localAgentSourceSnapshotV1) error {
		return prepared.CommitSourceMaterializationProductTx(tx)
	}
	if err := s.sourceMaterializationRepo.finishCommit(ctx, upload, challenge, commitRequestID, candidate, localAgentRef, statusBytes, now, hook); err != nil {
		if errors.Is(err, errSourceMaterializationCommitLost) {
			return sourceMaterializationCommitFailure(upload.UploadID, runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING, challenge.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_CONFLICT), nil
		}
		return s.failSourceMaterializationCommit(ctx, upload, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED, now)
	}
	prepared.SourceMaterializationProductCommitted()
	committedProduct = true
	return &runtimev1.CommitSourceMaterializationResponse{
		UploadId:            upload.UploadID,
		LocalAgentRef:       localAgentRef,
		UploadState:         runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED,
		ChallengeState:      runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED,
		ReasonCode:          runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
		SourceContextStatus: sourceStatus,
	}, nil
}

func (s *Service) AbortSourceMaterializationUpload(ctx context.Context, req *runtimev1.AbortSourceMaterializationUploadRequest) (*runtimev1.AbortSourceMaterializationUploadResponse, error) {
	accountID, requestContext, err := authenticateSourceMaterializationRequest(ctx, req.GetContext(), true)
	if err != nil {
		return nil, err
	}
	_, _, _, nowFn, err := s.sourceMaterializationDependencies()
	if err != nil {
		return nil, err
	}
	abortRequestID := req.GetAbortRequestId()
	if !validSourceMaterializationRequestID(abortRequestID) || !validSourceMaterializationOpaqueID(req.GetUploadId(), "smu_") || !validSHA256Hex(req.GetPacketHash()) || !validSHA256Hex(req.GetBundleManifestHash()) {
		return sourceMaterializationAbortFailure(req.GetUploadId(), runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST), nil
	}
	upload, found, err := s.sourceMaterializationRepo.upload(ctx, req.GetUploadId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load source materialization upload: %v", err)
	}
	if !found {
		return sourceMaterializationAbortFailure(req.GetUploadId(), runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND), nil
	}
	challenge, found, err := s.sourceMaterializationRepo.challenge(ctx, upload.ChallengeID)
	if err != nil || !found {
		if err != nil {
			return nil, status.Errorf(codes.Internal, "load source materialization challenge: %v", err)
		}
		return sourceMaterializationAbortFailure(req.GetUploadId(), upload.State, runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_UNSPECIFIED, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_NOT_FOUND), nil
	}
	if requestContext.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(challenge.SourceRef) {
		return sourceMaterializationAbortFailure(req.GetUploadId(), upload.State, challenge.State, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH), nil
	}
	now := nowFn().UTC()
	committed, challengeState, idempotent, reason, err := s.sourceMaterializationRepo.abortUpload(ctx, req.GetUploadId(), accountID, abortRequestID, req.GetPacketHash(), req.GetBundleManifestHash(), now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "abort source materialization upload: %v", err)
	}
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return sourceMaterializationAbortFailure(req.GetUploadId(), committed.State, challengeState, reason), nil
	}
	return &runtimev1.AbortSourceMaterializationUploadResponse{
		UploadId:         committed.UploadID,
		UploadState:      committed.State,
		ChallengeState:   challengeState,
		ReasonCode:       runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
		IdempotentReplay: idempotent,
	}, nil
}

func (s *Service) failSourceMaterializationCommit(ctx context.Context, upload sourceMaterializationUploadRecord, reason runtimev1.AgentSourceMaterializationReasonCode, now time.Time) (*runtimev1.CommitSourceMaterializationResponse, error) {
	failed, challengeState, err := s.sourceMaterializationRepo.failUpload(ctx, upload.UploadID, reason, now)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "fail source materialization commit: %v", err)
	}
	return sourceMaterializationCommitFailure(upload.UploadID, failed.State, challengeState, reason), nil
}

func (s *Service) sourceMaterializationDependencies() (string, sourceMaterializationAdmission, sourceMaterializationProductCommitter, func() time.Time, error) {
	if s == nil || s.sourceMaterializationRepo == nil {
		return "", nil, nil, nil, status.Error(codes.FailedPrecondition, "source materialization repository is unavailable")
	}
	s.sourceMaterializationMu.RLock()
	runtimeInstanceID := strings.TrimSpace(s.sourceMaterializationRuntimeInstance)
	admission := s.sourceMaterializationAdmission
	committer := s.sourceMaterializationProductCommitter
	nowFn := s.sourceMaterializationNow
	s.sourceMaterializationMu.RUnlock()
	if runtimeInstanceID == "" {
		return "", nil, nil, nil, status.Error(codes.FailedPrecondition, "source materialization runtime identity is not configured")
	}
	if nowFn == nil {
		nowFn = func() time.Time { return time.Now().UTC() }
	}
	return runtimeInstanceID, admission, committer, nowFn, nil
}

func (s *Service) sourceMaterializationClock() func() time.Time {
	if s == nil {
		return func() time.Time { return time.Now().UTC() }
	}
	s.sourceMaterializationMu.RLock()
	nowFn := s.sourceMaterializationNow
	s.sourceMaterializationMu.RUnlock()
	if nowFn == nil {
		return func() time.Time { return time.Now().UTC() }
	}
	return nowFn
}

func (s *Service) startSourceMaterializationSweeper() {
	if s == nil || s.sourceMaterializationRepo == nil {
		return
	}
	s.sourceMaterializationMu.Lock()
	if s.sourceMaterializationSweepDone != nil {
		s.sourceMaterializationMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	s.sourceMaterializationSweepCancel = cancel
	s.sourceMaterializationSweepDone = done
	s.sourceMaterializationMu.Unlock()
	go func() {
		defer close(done)
		ticker := time.NewTicker(defaultSourceMaterializationSweepPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.sourceMaterializationRepo.sweepExpired(ctx, s.sourceMaterializationClock()().UTC()); err != nil && s.logger != nil && !errors.Is(err, context.Canceled) {
					s.logger.Warn("source materialization TTL sweep failed", "error", err)
				}
			}
		}
	}()
}

func (s *Service) stopSourceMaterializationSweeper() {
	if s == nil {
		return
	}
	s.sourceMaterializationMu.Lock()
	cancel := s.sourceMaterializationSweepCancel
	done := s.sourceMaterializationSweepDone
	s.sourceMaterializationSweepCancel = nil
	s.sourceMaterializationSweepDone = nil
	s.sourceMaterializationMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}
