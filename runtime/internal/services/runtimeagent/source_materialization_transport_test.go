package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestSourceMaterializationChallengeRequiresAuthAndIsRequestIdempotent(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()

	sourceRef := sourceMaterializationTransportTestSourceRef("source-1")
	req := sourceMaterializationTransportTestChallengeRequest("challenge-request-1", sourceRef)
	if _, err := svc.CreateSourceMaterializationChallenge(context.Background(), req); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("anonymous CreateSourceMaterializationChallenge error = %v, want Unauthenticated", err)
	}
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	first, err := svc.CreateSourceMaterializationChallenge(ctx, req)
	if err != nil {
		t.Fatalf("CreateSourceMaterializationChallenge: %v", err)
	}
	if first.GetState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED || first.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		t.Fatalf("challenge response = %+v", first)
	}
	if first.GetMaterializerAccountId() != sourceMaterializationTransportTestAccount || first.GetIntendedRuntimeAudience() == "" || len(first.GetChallengeDigest()) != 64 {
		t.Fatalf("challenge binding is incomplete: %+v", first)
	}
	if first.GetExpiresAt().AsTime().Nanosecond()%int(time.Millisecond) != 0 {
		t.Fatalf("challenge expiry is not canonical millisecond precision: %s", first.GetExpiresAt().AsTime())
	}
	replay, err := svc.CreateSourceMaterializationChallenge(ctx, req)
	if err != nil {
		t.Fatalf("challenge replay: %v", err)
	}
	if replay.GetChallengeId() != first.GetChallengeId() || replay.GetChallengeDigest() != first.GetChallengeDigest() {
		t.Fatalf("challenge replay created a different challenge: first=%+v replay=%+v", first, replay)
	}
	conflictReq := sourceMaterializationTransportTestChallengeRequest("challenge-request-1", sourceMaterializationTransportTestSourceRef("source-2"))
	conflict, err := svc.CreateSourceMaterializationChallenge(ctx, conflictReq)
	if err != nil {
		t.Fatalf("challenge request-id conflict: %v", err)
	}
	if conflict.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT {
		t.Fatalf("challenge conflict reason = %s", conflict.GetReasonCode())
	}

	invalidHash := proto.Clone(req).(*runtimev1.CreateSourceMaterializationChallengeRequest)
	invalidHash.RequestId = "challenge-invalid-hash"
	invalidHash.SourceRef.SourceContentHash = "not-a-sha256"
	invalid, err := svc.CreateSourceMaterializationChallenge(ctx, invalidHash)
	if err != nil {
		t.Fatalf("invalid source hash response: %v", err)
	}
	if invalid.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST {
		t.Fatalf("invalid source hash reason = %s", invalid.GetReasonCode())
	}
	whitespaceRef := proto.Clone(req).(*runtimev1.CreateSourceMaterializationChallengeRequest)
	whitespaceRef.RequestId = "challenge-whitespace-source"
	whitespaceRef.SourceRef.WorldId = " world-materialization-1"
	whitespaceRef.Context.RuntimeSourceRef = runtimeSourceRefForMaterialization(whitespaceRef.SourceRef)
	whitespace, err := svc.CreateSourceMaterializationChallenge(ctx, whitespaceRef)
	if err != nil {
		t.Fatalf("whitespace source ref response: %v", err)
	}
	if whitespace.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST {
		t.Fatalf("whitespace source ref reason = %s", whitespace.GetReasonCode())
	}
	whitespaceRequestID := proto.Clone(req).(*runtimev1.CreateSourceMaterializationChallengeRequest)
	whitespaceRequestID.RequestId = " challenge-whitespace-request "
	whitespace, err = svc.CreateSourceMaterializationChallenge(ctx, whitespaceRequestID)
	if err != nil {
		t.Fatalf("whitespace request id response: %v", err)
	}
	if whitespace.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST {
		t.Fatalf("whitespace request id reason = %s", whitespace.GetReasonCode())
	}
}

func TestSourceMaterializationBeginAndPutRequestConflictsFailClosed(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)

	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "begin-put")
	beginReq := &runtimev1.BeginSourceMaterializationUploadRequest{
		Context:        sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()),
		BeginRequestId: "begin-request-1",
		Control:        control,
	}
	begin, err := svc.BeginSourceMaterializationUpload(ctx, beginReq)
	if err != nil {
		t.Fatalf("BeginSourceMaterializationUpload: %v", err)
	}
	if begin.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN || begin.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_LEASED {
		t.Fatalf("begin response = %+v", begin)
	}
	replay, err := svc.BeginSourceMaterializationUpload(ctx, beginReq)
	if err != nil {
		t.Fatalf("begin replay: %v", err)
	}
	if replay.GetUploadId() != begin.GetUploadId() {
		t.Fatalf("begin replay upload = %q, want %q", replay.GetUploadId(), begin.GetUploadId())
	}
	malformedConflict := proto.Clone(beginReq).(*runtimev1.BeginSourceMaterializationUploadRequest)
	malformedConflict.Control = nil
	beginConflict, err := svc.BeginSourceMaterializationUpload(ctx, malformedConflict)
	if err != nil {
		t.Fatalf("begin malformed conflict: %v", err)
	}
	if beginConflict.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT {
		t.Fatalf("malformed begin replay reason = %s", beginConflict.GetReasonCode())
	}

	putReq := sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "put-request-1")
	put, err := svc.PutSourceMaterializationChunk(ctx, putReq)
	if err != nil {
		t.Fatalf("PutSourceMaterializationChunk: %v", err)
	}
	if put.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN || put.GetIdempotentReplay() {
		t.Fatalf("put response = %+v", put)
	}
	putReplay, err := svc.PutSourceMaterializationChunk(ctx, putReq)
	if err != nil {
		t.Fatalf("put replay: %v", err)
	}
	if !putReplay.GetIdempotentReplay() {
		t.Fatalf("put replay was not marked idempotent: %+v", putReplay)
	}
	putConflictReq := proto.Clone(putReq).(*runtimev1.PutSourceMaterializationChunkRequest)
	putConflictReq.GlobalOrdinal = 9
	putConflictReq.ComponentOffset = 9
	putConflictReq.Bytes = []byte("conflicting bytes")
	putConflictReq.ChunkSha256 = sourceMaterializationBytesDigest(putConflictReq.Bytes)
	putConflict, err := svc.PutSourceMaterializationChunk(ctx, putConflictReq)
	if err != nil {
		t.Fatalf("put request-id conflict: %v", err)
	}
	if putConflict.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT || putConflict.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED {
		t.Fatalf("put conflict response = %+v", putConflict)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())

	challenge2, control2, bytes2 := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "ordinal-conflict")
	begin2, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge2.GetSourceRef()), BeginRequestId: "begin-ordinal-conflict", Control: control2})
	if err != nil {
		t.Fatalf("begin ordinal conflict upload: %v", err)
	}
	put2 := sourceMaterializationTransportTestPutRequest(begin2, control2, bytes2, "put-ordinal-first")
	if _, err := svc.PutSourceMaterializationChunk(ctx, put2); err != nil {
		t.Fatalf("put ordinal first: %v", err)
	}
	ordinalConflict := proto.Clone(put2).(*runtimev1.PutSourceMaterializationChunkRequest)
	ordinalConflict.PutRequestId = "put-ordinal-second"
	ordinalConflict.Bytes = []byte("different bytes for existing ordinal")
	ordinalConflict.ChunkSha256 = sourceMaterializationBytesDigest(ordinalConflict.Bytes)
	conflicted, err := svc.PutSourceMaterializationChunk(ctx, ordinalConflict)
	if err != nil {
		t.Fatalf("put ordinal conflict: %v", err)
	}
	if conflicted.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CONFLICT || conflicted.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED {
		t.Fatalf("ordinal conflict response = %+v", conflicted)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin2.GetUploadId())
}

func TestSourceMaterializationOversizedBeginControlFailsBeforeAdmission(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{beginErr: errors.New("admission must not run for oversized control")})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, control, _ := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "oversized-control")
	control.PacketProof = strings.Repeat("p", maxSourceMaterializationControlBytes+1)
	begin, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "begin-oversized-control", Control: control})
	if err != nil {
		t.Fatalf("oversized begin control: %v", err)
	}
	if begin.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID {
		t.Fatalf("oversized begin control response = %+v", begin)
	}
	record, found, err := svc.sourceMaterializationRepo.challenge(context.Background(), challenge.GetChallengeId())
	if err != nil || !found || record.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED {
		t.Fatalf("challenge after oversized control: found=%v record=%+v err=%v", found, record, err)
	}
}

func TestSourceMaterializationAbortIsExactIdempotentAndClearsRawBytes(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "abort")
	begin, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "begin-abort", Control: control})
	if err != nil {
		t.Fatalf("begin abort upload: %v", err)
	}
	if _, err := svc.PutSourceMaterializationChunk(ctx, sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "put-abort")); err != nil {
		t.Fatalf("put abort upload: %v", err)
	}
	abortReq := &runtimev1.AbortSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), AbortRequestId: "abort-request-1", UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()}
	aborted, err := svc.AbortSourceMaterializationUpload(ctx, abortReq)
	if err != nil {
		t.Fatalf("AbortSourceMaterializationUpload: %v", err)
	}
	if aborted.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED || aborted.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED {
		t.Fatalf("abort response = %+v", aborted)
	}
	replay, err := svc.AbortSourceMaterializationUpload(ctx, abortReq)
	if err != nil {
		t.Fatalf("abort replay: %v", err)
	}
	if !replay.GetIdempotentReplay() {
		t.Fatalf("abort replay = %+v", replay)
	}
	conflictReq := proto.Clone(abortReq).(*runtimev1.AbortSourceMaterializationUploadRequest)
	conflictReq.AbortRequestId = "abort-request-2"
	conflict, err := svc.AbortSourceMaterializationUpload(ctx, conflictReq)
	if err != nil {
		t.Fatalf("abort request conflict: %v", err)
	}
	if conflict.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_ID_CONFLICT {
		t.Fatalf("abort conflict reason = %s", conflict.GetReasonCode())
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
}

func TestSourceMaterializationRestartPreservesIssuedAndInvalidatesOpenUpload(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	first, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
	first.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	issued, err := first.CreateSourceMaterializationChallenge(ctx, sourceMaterializationTransportTestChallengeRequest("restart-issued", sourceMaterializationTransportTestSourceRef("issued")))
	if err != nil {
		t.Fatalf("create issued challenge: %v", err)
	}
	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControl(t, first, ctx, "restart-open")
	begin, err := first.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "restart-begin", Control: control})
	if err != nil {
		t.Fatalf("begin restart upload: %v", err)
	}
	if _, err := first.PutSourceMaterializationChunk(ctx, sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "restart-put")); err != nil {
		t.Fatalf("put restart upload: %v", err)
	}
	closeFirst()

	restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
	defer closeRestarted()
	issuedRecord, found, err := restarted.sourceMaterializationRepo.challenge(context.Background(), issued.GetChallengeId())
	if err != nil || !found {
		t.Fatalf("load issued challenge after restart: found=%v err=%v", found, err)
	}
	if issuedRecord.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_ISSUED {
		t.Fatalf("issued challenge state after restart = %s", issuedRecord.State)
	}
	upload, found, err := restarted.sourceMaterializationRepo.upload(context.Background(), begin.GetUploadId())
	if err != nil || !found {
		t.Fatalf("load upload after restart: found=%v err=%v", found, err)
	}
	if upload.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED || len(upload.ControlBytes) != 0 {
		t.Fatalf("unfinished upload after restart = %+v", upload)
	}
	challengeRecord, found, err := restarted.sourceMaterializationRepo.challenge(context.Background(), challenge.GetChallengeId())
	if err != nil || !found || challengeRecord.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED {
		t.Fatalf("leased challenge after restart = %+v found=%v err=%v", challengeRecord, found, err)
	}
	assertSourceMaterializationNoRawUploadBytes(t, restarted, begin.GetUploadId())
}

func TestSourceMaterializationNonceReplayLedgerRejectsNewChallengeAcrossRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	first, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
	first.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, control, _ := sourceMaterializationTransportTestChallengeAndControl(t, first, ctx, "nonce-first")
	const rawNonce = "realm-issued-replay-nonce"
	control.PacketEnvelope.Nonce = rawNonce
	beginRequest := &runtimev1.BeginSourceMaterializationUploadRequest{
		Context:        sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()),
		BeginRequestId: "begin-nonce-first",
		Control:        control,
	}
	firstBegin, err := first.BeginSourceMaterializationUpload(ctx, beginRequest)
	if err != nil || firstBegin.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
		t.Fatalf("first nonce Begin = %+v err=%v", firstBegin, err)
	}
	idempotent, err := first.BeginSourceMaterializationUpload(ctx, beginRequest)
	if err != nil || idempotent.GetUploadId() != firstBegin.GetUploadId() {
		t.Fatalf("exact nonce Begin replay = %+v err=%v", idempotent, err)
	}
	var issuer, nonceDigest, packetHash string
	if err := first.backend.DB().QueryRow(`
		SELECT issuer, nonce_digest, packet_hash
		FROM runtime_source_materialization_nonce_replay WHERE challenge_id = ?
	`, challenge.GetChallengeId()).Scan(&issuer, &nonceDigest, &packetHash); err != nil {
		t.Fatalf("read nonce replay ledger: %v", err)
	}
	if issuer != control.GetPacketEnvelope().GetIssuer() ||
		nonceDigest != sourceMaterializationNonceDigest(rawNonce) ||
		nonceDigest == rawNonce || packetHash != control.GetPacketEnvelope().GetPacketHash() {
		t.Fatalf("nonce replay ledger contains invalid binding issuer=%q digest=%q packet=%q", issuer, nonceDigest, packetHash)
	}
	closeFirst()

	restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
	defer closeRestarted()
	restarted.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	replayChallenge, replayControl, _ := sourceMaterializationTransportTestChallengeAndControl(t, restarted, ctx, "nonce-restart-replay")
	replayControl.PacketEnvelope.Nonce = rawNonce
	replayed, err := restarted.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{
		Context:        sourceMaterializationTransportTestRequestContext(replayChallenge.GetSourceRef()),
		BeginRequestId: "begin-nonce-restart-replay",
		Control:        replayControl,
	})
	if err != nil {
		t.Fatalf("replayed nonce Begin: %v", err)
	}
	if replayed.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID || replayed.GetUploadId() != "" {
		t.Fatalf("replayed nonce Begin response = %+v", replayed)
	}
	var replayUploadCount int
	if err := restarted.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_source_materialization_upload WHERE begin_request_id = ?`, "begin-nonce-restart-replay").Scan(&replayUploadCount); err != nil || replayUploadCount != 0 {
		t.Fatalf("replayed nonce upload rows=%d err=%v", replayUploadCount, err)
	}

	freshChallenge, freshControl, _ := sourceMaterializationTransportTestChallengeAndControl(t, restarted, ctx, "nonce-restart-fresh")
	freshControl.PacketEnvelope.Nonce = rawNonce + "-fresh"
	fresh, err := restarted.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{
		Context:        sourceMaterializationTransportTestRequestContext(freshChallenge.GetSourceRef()),
		BeginRequestId: "begin-nonce-restart-fresh",
		Control:        freshControl,
	})
	if err != nil || fresh.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
		t.Fatalf("fresh nonce Begin = %+v err=%v", fresh, err)
	}
}

func TestSourceMaterializationTTLExpiresIssuedAndOpenState(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	issued, err := svc.CreateSourceMaterializationChallenge(ctx, sourceMaterializationTransportTestChallengeRequest("ttl-issued", sourceMaterializationTransportTestSourceRef("ttl-issued")))
	if err != nil {
		t.Fatalf("create TTL issued challenge: %v", err)
	}
	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "ttl-open")
	begin, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "ttl-begin", Control: control})
	if err != nil {
		t.Fatalf("begin TTL upload: %v", err)
	}
	if _, err := svc.PutSourceMaterializationChunk(ctx, sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "ttl-put")); err != nil {
		t.Fatalf("put TTL upload: %v", err)
	}
	past := formatSourceMaterializationTime(time.Now().UTC().Add(-time.Minute))
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_source_materialization_challenge SET expires_at = ? WHERE challenge_id IN (?, ?)`, past, issued.GetChallengeId(), challenge.GetChallengeId()); err != nil {
		t.Fatalf("expire challenges: %v", err)
	}
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_source_materialization_upload SET expires_at = ? WHERE upload_id = ?`, past, begin.GetUploadId()); err != nil {
		t.Fatalf("expire upload: %v", err)
	}
	if err := svc.sourceMaterializationRepo.sweepExpired(context.Background(), time.Now().UTC()); err != nil {
		t.Fatalf("sweepExpired: %v", err)
	}
	issuedRecord, _, _ := svc.sourceMaterializationRepo.challenge(context.Background(), issued.GetChallengeId())
	if issuedRecord.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED {
		t.Fatalf("issued TTL state = %s", issuedRecord.State)
	}
	upload, _, _ := svc.sourceMaterializationRepo.upload(context.Background(), begin.GetUploadId())
	if upload.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_EXPIRED {
		t.Fatalf("upload TTL state = %s", upload.State)
	}
	leased, _, _ := svc.sourceMaterializationRepo.challenge(context.Background(), challenge.GetChallengeId())
	if leased.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED {
		t.Fatalf("leased TTL challenge state = %s", leased.State)
	}
	issuedReplay, err := svc.CreateSourceMaterializationChallenge(ctx, sourceMaterializationTransportTestChallengeRequest("ttl-issued", issued.GetSourceRef()))
	if err != nil {
		t.Fatalf("expired challenge replay: %v", err)
	}
	if issuedReplay.GetState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_EXPIRED || issuedReplay.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_EXPIRED {
		t.Fatalf("expired challenge replay = %+v", issuedReplay)
	}
	beginReplay, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "ttl-begin", Control: control})
	if err != nil {
		t.Fatalf("expired begin replay: %v", err)
	}
	if beginReplay.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_EXPIRED || beginReplay.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_EXPIRED {
		t.Fatalf("expired begin replay = %+v", beginReplay)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
}

func TestSourceMaterializationTransportCapacityBoundaries(t *testing.T) {
	limits := &runtimev1.SourceMaterializationChallengeLimits{MaxBundleBytes: 4, MaxComponentCount: 2, MaxChunkBytes: 2, MaxChunks: 2}
	digestA := sourceMaterializationBytesDigest([]byte("aa"))
	digestB := sourceMaterializationBytesDigest([]byte("bb"))
	exact := &runtimev1.BundleTransportManifestV1{
		TotalCanonicalBytes: 4,
		ComponentCount:      2,
		ChunkCount:          2,
		Components: []*runtimev1.SourceMaterializationBundleComponentDescriptorV1{
			{ComponentId: "a", Kind: runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CORE, SchemaVersion: "v1", ContentHash: digestA, CanonicalBytesHash: digestA, CanonicalByteLength: 2},
			{ComponentId: "b", Kind: runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_COVERAGE_MANIFEST, SchemaVersion: "v1", ContentHash: digestB, CanonicalBytesHash: digestB, CanonicalByteLength: 2},
		},
		Chunks: []*runtimev1.SourceMaterializationBundleChunkDescriptorV1{
			{GlobalOrdinal: 0, ComponentOffset: 0, Length: 2, ChunkSha256: digestA},
			{GlobalOrdinal: 1, ComponentOffset: 0, Length: 2, ChunkSha256: digestB},
		},
	}
	if _, reason := sourceMaterializationChunkLayout(exact, limits); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		t.Fatalf("exact capacity reason = %s", reason)
	}

	bundlePlusOne := proto.Clone(exact).(*runtimev1.BundleTransportManifestV1)
	bundlePlusOne.TotalCanonicalBytes = 5
	bundlePlusOne.Components[1].CanonicalByteLength = 3
	bundlePlusOne.Chunks[1].Length = 3
	if _, reason := sourceMaterializationChunkLayout(bundlePlusOne, limits); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_BUNDLE_CAPACITY_EXCEEDED {
		t.Fatalf("bundle limit+1 reason = %s", reason)
	}

	componentPlusOne := proto.Clone(exact).(*runtimev1.BundleTransportManifestV1)
	componentPlusOne.ComponentCount = 3
	componentPlusOne.Components = append(componentPlusOne.Components, proto.Clone(componentPlusOne.Components[0]).(*runtimev1.SourceMaterializationBundleComponentDescriptorV1))
	if _, reason := sourceMaterializationChunkLayout(componentPlusOne, limits); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMPONENT_CAPACITY_EXCEEDED {
		t.Fatalf("component limit+1 reason = %s", reason)
	}

	chunkPlusOne := proto.Clone(exact).(*runtimev1.BundleTransportManifestV1)
	chunkPlusOne.ChunkCount = 3
	chunkPlusOne.Chunks = append(chunkPlusOne.Chunks, proto.Clone(chunkPlusOne.Chunks[0]).(*runtimev1.SourceMaterializationBundleChunkDescriptorV1))
	if _, reason := sourceMaterializationChunkLayout(chunkPlusOne, limits); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_COUNT_EXCEEDED {
		t.Fatalf("chunk-count limit+1 reason = %s", reason)
	}

	chunkBytesPlusOne := proto.Clone(exact).(*runtimev1.BundleTransportManifestV1)
	chunkBytesPlusOne.TotalCanonicalBytes = 5
	chunkBytesPlusOne.Components[1].CanonicalByteLength = 3
	chunkBytesPlusOne.Chunks[1].Length = 3
	wideBundleLimits := proto.Clone(limits).(*runtimev1.SourceMaterializationChallengeLimits)
	wideBundleLimits.MaxBundleBytes = 5
	if _, reason := sourceMaterializationChunkLayout(chunkBytesPlusOne, wideBundleLimits); reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CAPACITY_EXCEEDED {
		t.Fatalf("chunk-byte limit+1 reason = %s", reason)
	}
}

func TestSourceMaterializationRequestContextAccountMustMatchAuthenticatedSubject(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	sourceRef := sourceMaterializationTransportTestSourceRef("account-mismatch")
	req := sourceMaterializationTransportTestChallengeRequest("account-mismatch", sourceRef)
	req.Context.OwnerUserId = "forged-account"
	_, err := svc.CreateSourceMaterializationChallenge(sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount), req)
	if status.Code(err) != codes.PermissionDenied || !strings.Contains(err.Error(), "account binding") {
		t.Fatalf("account mismatch error = %v", err)
	}
}
