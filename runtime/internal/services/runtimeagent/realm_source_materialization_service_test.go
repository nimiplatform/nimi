package runtimeagent

import (
	"bytes"
	"context"
	"crypto"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	realmSourceMaterializationServiceTestIssuerURL = "https://realm.test.nimi.local"
	realmSourceMaterializationServiceTestKeyID     = "runtime-service-test-key"
)

var realmSourceMaterializationServiceTestNow = time.Date(2030, 1, 1, 0, 1, 0, 0, time.UTC)

func TestMaterializeRealmSourcePublicContractIsTransportFree(t *testing.T) {
	requestFields := (&runtimev1.MaterializeRealmSourceRequest{}).ProtoReflect().Descriptor().Fields()
	if requestFields.Len() != 3 {
		t.Fatalf("public request fields = %d, want exactly context/request_id/source_ref", requestFields.Len())
	}
	want := []string{"context", "request_id", "source_ref"}
	for index, name := range want {
		if got := string(requestFields.Get(index).Name()); got != name {
			t.Fatalf("public request field %d = %q, want %q", index, got, name)
		}
	}
	forbidden := []string{"realm_base", "bearer", "grant", "packet", "proof", "jwks", "segment", "chunk", "challenge", "nonce"}
	for _, message := range []proto.Message{&runtimev1.MaterializeRealmSourceRequest{}, &runtimev1.MaterializeRealmSourceResponse{}} {
		fields := message.ProtoReflect().Descriptor().Fields()
		for index := 0; index < fields.Len(); index++ {
			name := string(fields.Get(index).Name())
			for _, token := range forbidden {
				if strings.Contains(name, token) {
					t.Fatalf("public %s leaks private transport field %q", message.ProtoReflect().Descriptor().Name(), name)
				}
			}
		}
	}
	reasonValues := runtimev1.RealmSourceMaterializationReasonCode(0).Descriptor().Values()
	for index := 0; index < reasonValues.Len(); index++ {
		name := string(reasonValues.Get(index).Name())
		if strings.Contains(name, "LOCAL_PERMISSION") || strings.Contains(name, "AVATAR") {
			t.Fatalf("Realm materialization reason enum exposes non-participating local authority %q", name)
		}
	}

	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-public-contract")
	request.Context.RuntimeSourceRef = "caller-selected-runtime-source"
	request.Context.LocalAgentRef = "caller-selected-local-agent"
	response, err := svc.MaterializeRealmSource(ctx, request)
	if response != nil || status.Code(err) != codes.InvalidArgument {
		t.Fatalf("caller-selected private identity response=%+v err=%v", response, err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 0, 0, 0)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
}

func TestMaterializeRealmSourceReferenceWorldAndPersona(t *testing.T) {
	for _, vectorName := range []string{"world-character", "persona-character"} {
		vectorName := vectorName
		t.Run(vectorName, func(t *testing.T) {
			svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, vectorName)
			defer closeService()
			ctx, request := realmSourceMaterializationServiceTestRequest(t, vectorName, "request-success-"+vectorName)
			if vectorName == "persona-character" && request.GetSourceRef().GetPersonaCharacter().GetOwnerAccountId() == request.GetContext().GetSubjectUserId() {
				t.Fatal("reference PersonaCharacter did not exercise delegated materialization")
			}
			response, err := svc.MaterializeRealmSource(ctx, request)
			if err == nil && response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
				t.Fatalf("service verifier detail: %v", issuer.verificationError())
			}
			assertRealmSourceMaterializationSuccess(t, response, err, vectorName)
			assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)
			assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
			assertRealmSourceMaterializationProductRowsV3(t, svc, response.GetLocalAgentRef(), 1)
			assertRealmSourceMaterializationAttemptV3(t, svc, request.GetContext().GetSubjectUserId(), request.GetRequestId(), realmSourceMaterializationAttemptCommittedV3, "")
		})
	}
}

func TestMaterializeRealmSourceAcquisitionErrorsRetainPublicSemantics(t *testing.T) {
	tests := []struct {
		name       string
		acquireErr error
		wantReason runtimev1.RealmSourceMaterializationReasonCode
		wantCode   sourceMaterializationFailureCodeV3
	}{
		{name: "invalid Packet request", acquireErr: ErrRealmSourceMaterializationAcquisitionInvalidRequest, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST, wantCode: sourceMaterializationFailureInvalidRequestV3},
		{name: "stale source binding", acquireErr: ErrRealmSourceMaterializationAcquisitionSourceBinding, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH, wantCode: sourceMaterializationFailureSourceBindingV3},
		{name: "wrong-scope grant", acquireErr: ErrRealmSourceMaterializationAcquisitionDenied, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_ACQUISITION_DENIED, wantCode: sourceMaterializationFailureAcquisitionDeniedV3},
		{name: "account authentication", acquireErr: ErrRealmSourceMaterializationAcquisitionAccount, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH, wantCode: sourceMaterializationFailureAccountBindingV3},
		{name: "response capacity", acquireErr: ErrRealmSourceMaterializationAcquisitionCapacity, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_CAPACITY_EXCEEDED, wantCode: sourceMaterializationFailureCapacityV3},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
			defer closeService()
			issuer.acquireErr = fmt.Errorf("classified Realm acquisition: %w", test.acquireErr)
			ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-acquisition-"+strings.ReplaceAll(test.name, " ", "-"))

			response, err := svc.MaterializeRealmSource(ctx, request)
			if err != nil || response.GetReasonCode() != test.wantReason || response.GetLocalAgentRef() != "" || response.GetSourceContextStatus() != nil {
				t.Fatalf("acquisition response=%+v err=%v, want reason=%s", response, err, test.wantReason)
			}
			assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 0, 0)
			assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
			assertRealmSourceMaterializationAttemptV3(t, svc, request.GetContext().GetSubjectUserId(), request.GetRequestId(), realmSourceMaterializationAttemptFailedV3, test.wantCode)
		})
	}
}

func TestMaterializeRealmSourceDurableReplayAndConflictStopBeforeIssuer(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-durable-replay")

	first, err := svc.MaterializeRealmSource(ctx, request)
	assertRealmSourceMaterializationSuccess(t, first, err, "world-character")
	if first.GetIdempotentReplay() {
		t.Fatal("first materialization was reported as a replay")
	}
	second, err := svc.MaterializeRealmSource(ctx, proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest))
	assertRealmSourceMaterializationSuccess(t, second, err, "world-character")
	if !second.GetIdempotentReplay() || second.GetLocalAgentRef() != first.GetLocalAgentRef() ||
		second.GetSourceContextStatus().GetSnapshotHash() != first.GetSourceContextStatus().GetSnapshotHash() {
		t.Fatalf("durable replay differs: first=%+v second=%+v", first, second)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)

	conflict := proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest)
	conflict.GetSourceRef().GetWorldCharacter().SourceHash = strings.Repeat("f", 64)
	conflicted, err := svc.MaterializeRealmSource(ctx, conflict)
	if err != nil || conflicted.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_CONFLICT ||
		conflicted.GetLocalAgentRef() != "" || conflicted.GetSourceContextStatus() != nil {
		t.Fatalf("conflicting request response=%+v err=%v", conflicted, err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
}

func TestMaterializeRealmSourceConcurrentSameRequestCreatesOneLocalAgent(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-concurrent-idempotency")

	const callers = 12
	responses := make([]*runtimev1.MaterializeRealmSourceResponse, callers)
	errorsByCall := make([]error, callers)
	var wait sync.WaitGroup
	wait.Add(callers)
	for index := 0; index < callers; index++ {
		index := index
		go func() {
			defer wait.Done()
			responses[index], errorsByCall[index] = svc.MaterializeRealmSource(ctx, proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest))
		}()
	}
	wait.Wait()

	localAgentRef := ""
	fresh := 0
	for index := range responses {
		assertRealmSourceMaterializationSuccess(t, responses[index], errorsByCall[index], "world-character")
		if localAgentRef == "" {
			localAgentRef = responses[index].GetLocalAgentRef()
		}
		if responses[index].GetLocalAgentRef() != localAgentRef {
			t.Fatalf("concurrent call %d created %q, want sole LocalAgent %q", index, responses[index].GetLocalAgentRef(), localAgentRef)
		}
		if !responses[index].GetIdempotentReplay() {
			fresh++
		}
	}
	if fresh != 1 {
		t.Fatalf("fresh concurrent responses = %d, want exactly one", fresh)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
	assertRealmSourceMaterializationProductRowsV3(t, svc, localAgentRef, 1)
}

func TestMaterializeRealmSourceDifferentRequestReplayIsRejectedByAtomicLedger(t *testing.T) {
	previousReader := cryptorand.Reader
	randomSequence := make([]byte, 0, 64)
	randomSequence = append(randomSequence, bytes.Repeat([]byte{0x42}, 16)...)
	randomSequence = append(randomSequence, bytes.Repeat([]byte{0x43}, 16)...)
	randomSequence = append(randomSequence, bytes.Repeat([]byte{0x42}, 16)...)
	randomSequence = append(randomSequence, bytes.Repeat([]byte{0x44}, 16)...)
	cryptorand.Reader = bytes.NewReader(randomSequence)
	t.Cleanup(func() { cryptorand.Reader = previousReader })

	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	issuer.reusePacket = true
	ctx, firstRequest := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-replay-first")
	first, err := svc.MaterializeRealmSource(ctx, firstRequest)
	assertRealmSourceMaterializationSuccess(t, first, err, "world-character")

	// challenge_id and challenge_digest are independently unique. Move the
	// committed attempt's no-longer-live challenge identity aside so this test
	// can force the same signed Packet through the verifier a second time and
	// exercise the transaction's replay CAS defense in depth.
	err = svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, updateErr := tx.Exec(`
			UPDATE runtime_realm_source_materialization_attempt_v3
			SET challenge_id = ?, challenge_digest = ?
			WHERE materializer_account_id = ? AND request_id = ?
		`, "retired-challenge-for-ledger-test", strings.Repeat("e", 64),
			firstRequest.GetContext().GetSubjectUserId(), firstRequest.GetRequestId())
		return updateErr
	})
	if err != nil {
		t.Fatalf("retire first test challenge identity: %v", err)
	}

	_, secondRequest := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-replay-second")
	second, err := svc.MaterializeRealmSource(ctx, secondRequest)
	requests := issuer.requestsSnapshot()
	if err != nil || second.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REPLAY_DETECTED ||
		second.GetLocalAgentRef() != "" || second.GetSourceContextStatus() != nil {
		t.Fatalf("different-request packet replay response=%+v err=%v requests=%+v guard_callback=%v", second, err, requests, issuer.guardCallbackError())
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 2, 2, 2)
	if len(requests) != 2 || requests[0].RequestID == requests[1].RequestID ||
		requests[0].Challenge.ChallengeID != requests[1].Challenge.ChallengeID ||
		requests[0].Challenge.ChallengeDigest != requests[1].Challenge.ChallengeDigest {
		t.Fatalf("test did not replay one challenge-bound Packet across distinct requests: %+v", requests)
	}
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
	assertRealmSourceMaterializationAttemptV3(t, svc, secondRequest.GetContext().GetSubjectUserId(), secondRequest.GetRequestId(), realmSourceMaterializationAttemptFailedV3, sourceMaterializationFailureReplayV3)
}

func TestMaterializeRealmSourceReusedNonceAcrossDistinctPacketsIsRejected(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	issuer.nonceOverride = "maliciously-reused-realm-nonce-v3"

	ctx, firstRequest := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-nonce-first")
	first, err := svc.MaterializeRealmSource(ctx, firstRequest)
	assertRealmSourceMaterializationSuccess(t, first, err, "world-character")

	_, secondRequest := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-nonce-second")
	second, err := svc.MaterializeRealmSource(ctx, secondRequest)
	if err != nil || second.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REPLAY_DETECTED ||
		second.GetLocalAgentRef() != "" || second.GetSourceContextStatus() != nil {
		t.Fatalf("reused nonce response=%+v err=%v", second, err)
	}
	requests := issuer.requestsSnapshot()
	if len(requests) != 2 || requests[0].Challenge.ChallengeID == requests[1].Challenge.ChallengeID ||
		requests[0].Challenge.ChallengeDigest == requests[1].Challenge.ChallengeDigest {
		t.Fatalf("nonce replay test did not use distinct challenge-bound Packets: %+v", requests)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 2, 2, 2)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
	assertRealmSourceMaterializationAttemptV3(t, svc, secondRequest.GetContext().GetSubjectUserId(), secondRequest.GetRequestId(), realmSourceMaterializationAttemptFailedV3, sourceMaterializationFailureReplayV3)
}

func TestMaterializeRealmSourceVerificationFailuresHaveZeroProductMutation(t *testing.T) {
	for _, test := range []struct {
		name       string
		configure  func(*realmSourceMaterializationServiceTestIssuer)
		wantReason runtimev1.RealmSourceMaterializationReasonCode
	}{
		{
			name: "tampered-proof",
			configure: func(issuer *realmSourceMaterializationServiceTestIssuer) {
				issuer.packetMutation = func(raw []byte) ([]byte, error) {
					return mutateRealmSourceMaterializationServicePacketProof(raw)
				}
			},
			wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PROOF_INVALID,
		},
		{
			name: "removed-current-key",
			configure: func(issuer *realmSourceMaterializationServiceTestIssuer) {
				issuer.currentKeyID = "removed-current-key"
			},
			wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_JWKS_INVALID,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
			defer closeService()
			test.configure(issuer)
			ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-"+test.name)
			response, err := svc.MaterializeRealmSource(ctx, request)
			if err != nil || response.GetReasonCode() != test.wantReason || response.GetLocalAgentRef() != "" || response.GetSourceContextStatus() != nil {
				t.Fatalf("verification failure response=%+v err=%v", response, err)
			}
			assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 0)
			assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
		})
	}
}

func TestMaterializeRealmSourceAccountCommitGuardHasZeroProductMutation(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "persona-character")
	defer closeService()
	issuer.guardErr = errors.New("account generation changed")
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "persona-character", "request-account-guard")
	response, err := svc.MaterializeRealmSource(ctx, request)
	if err != nil || response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH ||
		response.GetLocalAgentRef() != "" || response.GetSourceContextStatus() != nil {
		t.Fatalf("account guard response=%+v err=%v", response, err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
}

func TestMaterializeRealmSourceProductFailureRollsBackAllRowsAndMemory(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			CREATE TRIGGER realm_source_materialization_service_test_fail_snapshot
			BEFORE INSERT ON runtime_local_agent_source_snapshot_v2
			BEGIN SELECT RAISE(ABORT, 'injected SnapshotV2 persistence failure'); END
		`)
		return err
	}); err != nil {
		t.Fatalf("install product failure trigger: %v", err)
	}
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-product-rollback")
	response, err := svc.MaterializeRealmSource(ctx, request)
	if err != nil || response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED ||
		response.GetLocalAgentRef() != "" || response.GetSourceContextStatus() != nil {
		t.Fatalf("product failure response=%+v err=%v", response, err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 1)
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
	assertRealmSourceMaterializationAttemptV3(t, svc, request.GetContext().GetSubjectUserId(), request.GetRequestId(), realmSourceMaterializationAttemptFailedV3, sourceMaterializationFailurePersistenceV3)
}

func TestMaterializeRealmSourceProductPersistenceContainsNoRawTransport(t *testing.T) {
	svc, _, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "request-transport-free-product")
	response, err := svc.MaterializeRealmSource(ctx, request)
	assertRealmSourceMaterializationSuccess(t, response, err, "world-character")

	var typedSnapshot []byte
	if err := svc.backend.DB().QueryRow(`
		SELECT typed_snapshot_json FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?
	`, response.GetLocalAgentRef()).Scan(&typedSnapshot); err != nil {
		t.Fatalf("read typed SnapshotV2: %v", err)
	}
	for _, forbidden := range []string{
		`"packetProof"`, `"compactJws"`, `"signedPayload"`, `"challengeId"`, `"challengeDigest"`,
		`"nonce"`, `"orderedSegments"`, `"segmentManifest"`, `"canonicalBytes"`, `"chunks"`,
		`"authorizationDecisionDigest"`, `"accessGrantId"`,
	} {
		if bytes.Contains(typedSnapshot, []byte(forbidden)) {
			t.Fatalf("SnapshotV2 persisted raw transport field %s", forbidden)
		}
	}
	for _, table := range []string{"runtime_local_agent_source_snapshot_v2", "runtime_local_agent_source_provenance_v3"} {
		rows, queryErr := svc.backend.DB().Query("PRAGMA table_info(" + table + ")")
		if queryErr != nil {
			t.Fatalf("inspect %s schema: %v", table, queryErr)
		}
		for rows.Next() {
			var ordinal, notNull, primaryKey int
			var name, columnType string
			var defaultValue any
			if scanErr := rows.Scan(&ordinal, &name, &columnType, &notNull, &defaultValue, &primaryKey); scanErr != nil {
				_ = rows.Close()
				t.Fatalf("scan %s schema: %v", table, scanErr)
			}
			for _, token := range []string{"proof", "segment", "chunk", "raw_packet", "packet_json"} {
				if strings.Contains(strings.ToLower(name), token) {
					_ = rows.Close()
					t.Fatalf("product table %s contains raw transport column %q", table, name)
				}
			}
		}
		if closeErr := rows.Close(); closeErr != nil {
			t.Fatalf("close %s schema rows: %v", table, closeErr)
		}
	}
}

type realmSourceMaterializationServiceTestIssuer struct {
	mu                sync.Mutex
	vectorPacket      json.RawMessage
	expectedPolicy    string
	privateKey        *rsa.PrivateKey
	reusePacket       bool
	packetCache       []byte
	packetMutation    func([]byte) ([]byte, error)
	currentKeyID      string
	nonceOverride     string
	acquireErr        error
	guardErr          error
	guardCallbackErr  error
	acquireCalls      int
	jwksCalls         int
	guardCalls        int
	revalidationCalls int
	requests          []RealmSourceMaterializationIssuanceRequest
	lastPacket        []byte
	lastJWKS          []byte
}

func newRealmSourceMaterializationServiceTestIssuer(t *testing.T, vectorName string) *realmSourceMaterializationServiceTestIssuer {
	t.Helper()
	vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
	return &realmSourceMaterializationServiceTestIssuer{
		vectorPacket: append(json.RawMessage(nil), vector.Packet...), expectedPolicy: vector.Expectation.AccessPolicyVersionDigest,
		privateKey: sourceMaterializationTestPrivateKey(t), currentKeyID: realmSourceMaterializationServiceTestKeyID,
	}
}

func (issuer *realmSourceMaterializationServiceTestIssuer) AcquireRealmSourceMaterialization(
	_ context.Context,
	request RealmSourceMaterializationIssuanceRequest,
) (RealmSourceMaterializationAcquisition, error) {
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	issuer.acquireCalls++
	issuer.requests = append(issuer.requests, request)
	if issuer.acquireErr != nil {
		return RealmSourceMaterializationAcquisition{}, issuer.acquireErr
	}
	packet := append([]byte(nil), issuer.packetCache...)
	if len(packet) == 0 || !issuer.reusePacket {
		var err error
		packet, err = buildRealmSourceMaterializationServiceTestPacket(issuer.vectorPacket, issuer.privateKey, request, issuer.nonceOverride)
		if err != nil {
			return RealmSourceMaterializationAcquisition{}, err
		}
		if issuer.packetMutation != nil {
			packet, err = issuer.packetMutation(packet)
			if err != nil {
				return RealmSourceMaterializationAcquisition{}, err
			}
		}
		if issuer.reusePacket {
			issuer.packetCache = append([]byte(nil), packet...)
		}
	}
	issuer.lastPacket = append([]byte(nil), packet...)
	return RealmSourceMaterializationAcquisition{
		AccountLease:                      RealmSourceMaterializationAccountLease{AccountID: request.AuthenticatedAccountID, Generation: 1},
		ExpectedIssuer:                    realmSourceMaterializationServiceTestIssuerURL,
		ExpectedAccessPolicyVersionDigest: issuer.expectedPolicy,
		PacketResponse: RealmSourceMaterializationHTTPResponse{
			StatusCode: 201, ContentType: sourceMaterializationPacketContentTypeV3, ContentLength: int64(len(packet)),
			Body: io.NopCloser(bytes.NewReader(packet)),
		},
	}, nil
}

func (issuer *realmSourceMaterializationServiceTestIssuer) FetchCurrentRealmSourceMaterializationJWKS(
	_ context.Context,
	lease RealmSourceMaterializationAccountLease,
) (RealmSourceMaterializationHTTPResponse, error) {
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	issuer.jwksCalls++
	if lease.AccountID == "" || lease.Generation != 1 {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("invalid test account lease")
	}
	jwks, err := realmSourceMaterializationServiceTestJWKS(issuer.privateKey, issuer.currentKeyID)
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	issuer.lastJWKS = append([]byte(nil), jwks...)
	return RealmSourceMaterializationHTTPResponse{
		StatusCode: 200, ContentType: sourceMaterializationPacketContentTypeV3, ContentLength: int64(len(jwks)),
		Body: io.NopCloser(bytes.NewReader(jwks)),
	}, nil
}

func (issuer *realmSourceMaterializationServiceTestIssuer) RevalidateRealmSourceMaterializationAccount(
	_ context.Context,
	lease RealmSourceMaterializationAccountLease,
) error {
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	issuer.revalidationCalls++
	if lease.AccountID == "" || lease.Generation != 1 {
		return fmt.Errorf("invalid test account lease")
	}
	return nil
}

func (issuer *realmSourceMaterializationServiceTestIssuer) WithCurrentRealmSourceMaterializationAccount(
	_ context.Context,
	lease RealmSourceMaterializationAccountLease,
	callback func() error,
) error {
	issuer.mu.Lock()
	issuer.guardCalls++
	guardErr := issuer.guardErr
	issuer.mu.Unlock()
	if lease.AccountID == "" || lease.Generation != 1 {
		return fmt.Errorf("invalid test account lease")
	}
	if guardErr != nil {
		return guardErr
	}
	err := callback()
	issuer.mu.Lock()
	issuer.guardCallbackErr = err
	issuer.mu.Unlock()
	return err
}

func (issuer *realmSourceMaterializationServiceTestIssuer) requestsSnapshot() []RealmSourceMaterializationIssuanceRequest {
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	return append([]RealmSourceMaterializationIssuanceRequest(nil), issuer.requests...)
}

func (issuer *realmSourceMaterializationServiceTestIssuer) guardCallbackError() error {
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	return issuer.guardCallbackErr
}

func (issuer *realmSourceMaterializationServiceTestIssuer) verificationError() error {
	issuer.mu.Lock()
	if len(issuer.requests) == 0 {
		issuer.mu.Unlock()
		return fmt.Errorf("issuer was not called")
	}
	request := issuer.requests[len(issuer.requests)-1]
	packet := append([]byte(nil), issuer.lastPacket...)
	jwks := append([]byte(nil), issuer.lastJWKS...)
	policy := issuer.expectedPolicy
	issuer.mu.Unlock()
	ref, err := request.SourceRef.internal()
	if err != nil {
		return err
	}
	_, err = verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(jwks), sourceMaterializationVerificationExpectationV3{
		Challenge: sourceMaterializationChallengeV3{
			ChallengeID: request.Challenge.ChallengeID, ChallengeDigest: request.Challenge.ChallengeDigest,
			IntendedRuntimeAudience: request.Challenge.IntendedRuntimeAudience, MaterializerAccountID: request.AuthenticatedAccountID,
			SourceRef: ref, Limits: sourceMaterializationPublishedLimitsV3{
				MaxSegmentBytes: request.Limits.MaxSegmentBytes, MaxSegmentComponentCount: request.Limits.MaxSegmentComponentCount,
				MaxChunkBytes: request.Limits.MaxChunkBytes, MaxSegmentChunks: request.Limits.MaxSegmentChunks,
				MaxSetSegments: request.Limits.MaxSetSegments, MaxSetBytes: request.Limits.MaxSetBytes,
				MaxSetComponentCount: request.Limits.MaxSetComponentCount, MaxSetChunks: request.Limits.MaxSetChunks,
			},
			IssuedAt: request.Challenge.IssuedAt, ExpiresAt: request.Challenge.ExpiresAt,
		},
		ExpectedIssuer: realmSourceMaterializationServiceTestIssuerURL, ExpectedAccessPolicyDigest: policy,
		Now: realmSourceMaterializationServiceTestNow,
	})
	return err
}

func buildRealmSourceMaterializationServiceTestPacket(
	vectorPacket json.RawMessage,
	privateKey *rsa.PrivateKey,
	request RealmSourceMaterializationIssuanceRequest,
	nonceOverride string,
) ([]byte, error) {
	value, err := decodeSourceMaterializationJSON(vectorPacket)
	if err != nil {
		return nil, err
	}
	packetObject, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("reference packet is not an object")
	}
	internalRef, err := request.SourceRef.internal()
	if err != nil {
		return nil, err
	}
	issuedAt := request.Challenge.IssuedAt.UTC().Truncate(time.Millisecond)
	packetObject["keyId"] = realmSourceMaterializationServiceTestKeyID
	packetObject["issuedAt"] = issuedAt.Format("2006-01-02T15:04:05.000Z")
	packetObject["expiresAt"] = issuedAt.Add(5 * time.Minute).Format("2006-01-02T15:04:05.000Z")
	packetObject["intendedRuntimeAudience"] = request.Challenge.IntendedRuntimeAudience
	packetObject["challengeId"] = request.Challenge.ChallengeID
	packetObject["challengeDigest"] = request.Challenge.ChallengeDigest
	packetObject["materializerAccountId"] = request.AuthenticatedAccountID
	nonceSeed := sha256.Sum256([]byte(request.Challenge.ChallengeID))
	packetObject["nonce"] = "runtime-service-" + base64.RawURLEncoding.EncodeToString(nonceSeed[:])
	if nonceOverride != "" {
		packetObject["nonce"] = nonceOverride
	}
	packetObject["sourceRef"] = internalRef
	packetObject["publishedLimits"] = sourceMaterializationPublishedLimitsV3{
		MaxSegmentBytes: request.Limits.MaxSegmentBytes, MaxSegmentComponentCount: request.Limits.MaxSegmentComponentCount,
		MaxChunkBytes: request.Limits.MaxChunkBytes, MaxSegmentChunks: request.Limits.MaxSegmentChunks,
		MaxSetSegments: request.Limits.MaxSetSegments, MaxSetBytes: request.Limits.MaxSetBytes,
		MaxSetComponentCount: request.Limits.MaxSetComponentCount, MaxSetChunks: request.Limits.MaxSetChunks,
	}
	unsignedBytes, err := json.Marshal(packetObject)
	if err != nil {
		return nil, err
	}
	var typedPacket sourceMaterializationPacketV3Value
	if err := strictDecodeSourceMaterializationV3(unsignedBytes, &typedPacket); err != nil {
		return nil, err
	}
	typedPacket.ClosureSetManifest.ChallengeDigest = typedPacket.ChallengeDigest
	typedPacket.ClosureSetManifest.PublishedLimits = typedPacket.PublishedLimits
	closureObject := packetObject["closureSetManifest"].(map[string]any)
	closureObject["challengeDigest"] = typedPacket.ChallengeDigest
	closureObject["publishedLimits"] = typedPacket.PublishedLimits
	segmentObjects := packetObject["orderedSegments"].([]any)
	closureSegmentObjects := closureObject["segments"].([]any)
	for index := range typedPacket.OrderedSegments {
		manifest := &typedPacket.OrderedSegments[index].SegmentManifest
		manifest.ChallengeDigest = typedPacket.ChallengeDigest
		manifest.PublishedSegmentLimits = typedPacket.PublishedLimits.segmentLimits()
		manifestHash, hashErr := sourceMaterializationSegmentManifestHashV3(*manifest)
		if hashErr != nil {
			return nil, hashErr
		}
		typedPacket.OrderedSegments[index].SegmentManifestHash = manifestHash
		typedPacket.ClosureSetManifest.Segments[index].SegmentManifestHash = manifestHash
		segmentObject := segmentObjects[index].(map[string]any)
		manifestObject := segmentObject["segmentManifest"].(map[string]any)
		manifestObject["challengeDigest"] = typedPacket.ChallengeDigest
		manifestObject["publishedSegmentLimits"] = typedPacket.PublishedLimits.segmentLimits()
		segmentObject["segmentManifestHash"] = manifestHash
		closureSegmentObjects[index].(map[string]any)["segmentManifestHash"] = manifestHash
	}
	closureHash, err := sourceMaterializationClosureSetManifestHashV3(typedPacket.ClosureSetManifest)
	if err != nil {
		return nil, err
	}
	typedPacket.ClosureSetManifestHash = closureHash
	packetHash, err := sourceMaterializationPacketHashV3(typedPacket)
	if err != nil {
		return nil, err
	}
	proof, err := signRealmSourceMaterializationServiceTestPacket(privateKey, packetHash)
	if err != nil {
		return nil, err
	}
	typedPacket.PacketHash = packetHash
	typedPacket.PacketProof = proof
	packetObject["closureSetManifestHash"] = closureHash
	packetObject["packetHash"] = packetHash
	packetObject["packetProof"] = proof
	return json.Marshal(packetObject)
}

func signRealmSourceMaterializationServiceTestPacket(privateKey *rsa.PrivateKey, packetHash string) (sourceMaterializationPacketProofV3, error) {
	header, err := canonicalizeSourceMaterializationRealmV3(map[string]any{
		"alg": "RS256", "kid": realmSourceMaterializationServiceTestKeyID, "typ": "realm-source-materialization",
	})
	if err != nil {
		return sourceMaterializationPacketProofV3{}, err
	}
	headerEncoded := base64.RawURLEncoding.EncodeToString(header)
	signedPayload := sourceMaterializationProofDomainV3 + packetHash
	payloadEncoded := base64.RawURLEncoding.EncodeToString([]byte(signedPayload))
	digest := sha256.Sum256([]byte(headerEncoded + "." + payloadEncoded))
	signature, err := rsa.SignPKCS1v15(nil, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return sourceMaterializationPacketProofV3{}, err
	}
	return sourceMaterializationPacketProofV3{
		CompactJWS: headerEncoded + ".." + base64.RawURLEncoding.EncodeToString(signature), SignedPayload: signedPayload,
	}, nil
}

func realmSourceMaterializationServiceTestJWKS(privateKey *rsa.PrivateKey, keyID string) ([]byte, error) {
	publicKey := privateKey.PublicKey
	exponent := []byte{byte(publicKey.E >> 16), byte(publicKey.E >> 8), byte(publicKey.E)}
	for len(exponent) > 1 && exponent[0] == 0 {
		exponent = exponent[1:]
	}
	return json.Marshal(sourceMaterializationJWKSV3{Keys: []sourceMaterializationJWKKeyV3{{
		KeyType: "RSA", KeyID: keyID, Use: "sig", Algorithm: "RS256", Operations: []string{"verify"},
		Modulus:  base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes()),
		Exponent: base64.RawURLEncoding.EncodeToString(exponent), Purpose: "realm-source-materialization",
	}}})
}

func mutateRealmSourceMaterializationServicePacketProof(raw []byte) ([]byte, error) {
	value, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		return nil, err
	}
	root := value.(map[string]any)
	proof := root["packetProof"].(map[string]any)
	parts := strings.Split(proof["compactJws"].(string), ".")
	if len(parts) != 3 || len(parts[2]) == 0 {
		return nil, fmt.Errorf("test proof is malformed")
	}
	if parts[2][0] == 'A' {
		parts[2] = "B" + parts[2][1:]
	} else {
		parts[2] = "A" + parts[2][1:]
	}
	proof["compactJws"] = strings.Join(parts, ".")
	return json.Marshal(root)
}

func openRealmSourceMaterializationServiceTest(
	t *testing.T,
	vectorName string,
) (*Service, *realmSourceMaterializationServiceTestIssuer, func()) {
	t.Helper()
	vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
	previousCeilings := sourceMaterializationProducerCeilingsV3
	sourceMaterializationProducerCeilingsV3 = vector.Expectation.PublishedLimits
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "runtime-state.json"))
	svc.sourceMaterializationNow = func() time.Time { return realmSourceMaterializationServiceTestNow }
	issuer := newRealmSourceMaterializationServiceTestIssuer(t, vectorName)
	svc.SetRealmSourceMaterializationIssuer(issuer)
	return svc, issuer, closeService
}

func realmSourceMaterializationServiceTestRequest(
	t *testing.T,
	vectorName string,
	requestID string,
) (context.Context, *runtimev1.MaterializeRealmSourceRequest) {
	t.Helper()
	vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
	var packet struct {
		MaterializerAccountID string                                    `json:"materializerAccountId"`
		SourceRef             sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	}
	if err := json.Unmarshal(vector.Packet, &packet); err != nil {
		t.Fatalf("decode %s request identity: %v", vectorName, err)
	}
	accountID := packet.MaterializerAccountID
	return sourceMaterializationTransportTestContext(accountID), &runtimev1.MaterializeRealmSourceRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId: "runtime-realm-source-service-test", SubjectUserId: accountID, OwnerUserId: accountID,
		},
		RequestId: requestID,
		SourceRef: sourceMaterializationProtoRefV3(packet.SourceRef),
	}
}

func assertRealmSourceMaterializationSuccess(
	t *testing.T,
	response *runtimev1.MaterializeRealmSourceResponse,
	err error,
	vectorName string,
) {
	t.Helper()
	if err != nil || response == nil || response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE ||
		response.GetLocalAgentRef() == "" || response.GetSourceContextStatus() == nil || !response.GetSourceContextStatus().GetReady() ||
		response.GetSourceContextStatus().GetLocalAgentRef() != response.GetLocalAgentRef() || response.GetSourceContextStatus().GetSnapshotSchemaVersion() != 2 {
		t.Fatalf("%s materialization response=%+v err=%v", vectorName, response, err)
	}
	if vectorName == "world-character" && response.GetSourceContextStatus().GetSourceRef().GetWorldCharacter() == nil {
		t.Fatalf("WorldCharacter response lost its source branch: %+v", response)
	}
	if vectorName == "persona-character" && response.GetSourceContextStatus().GetSourceRef().GetPersonaCharacter() == nil {
		t.Fatalf("PersonaCharacter response lost its source branch: %+v", response)
	}
}

func assertRealmSourceMaterializationIssuerCalls(
	t *testing.T,
	issuer *realmSourceMaterializationServiceTestIssuer,
	wantAcquire int,
	wantJWKS int,
	wantGuard int,
) {
	t.Helper()
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	if issuer.acquireCalls != wantAcquire || issuer.jwksCalls != wantJWKS || issuer.guardCalls != wantGuard {
		t.Fatalf("issuer calls acquire=%d jwks=%d guard=%d, want %d/%d/%d", issuer.acquireCalls, issuer.jwksCalls, issuer.guardCalls, wantAcquire, wantJWKS, wantGuard)
	}
}

func assertRealmSourceMaterializationGlobalProductRows(t *testing.T, svc *Service, wantProduct int, wantReplay int) {
	t.Helper()
	for _, table := range []string{
		"runtime_local_agent", "runtime_local_agent_state_projection", "runtime_local_agent_event_log",
		"runtime_agent_ai_config", "runtime_local_agent_source_snapshot_v2", "runtime_local_agent_source_provenance_v3",
	} {
		var got int
		if err := svc.backend.DB().QueryRow("SELECT COUNT(*) FROM " + table).Scan(&got); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if got != wantProduct {
			t.Fatalf("%s rows = %d, want %d", table, got, wantProduct)
		}
	}
	var replayCount int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_source_materialization_replay_v3`).Scan(&replayCount); err != nil {
		t.Fatalf("count replay bindings: %v", err)
	}
	if replayCount != wantReplay {
		t.Fatalf("replay rows = %d, want %d", replayCount, wantReplay)
	}
	var stagingCount int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3
		WHERE state IN ('requested','acquiring','verifying','committing')
	`).Scan(&stagingCount); err != nil {
		t.Fatalf("count staging attempts: %v", err)
	}
	if stagingCount != 0 {
		t.Fatalf("staging attempt residue = %d, want zero", stagingCount)
	}
	svc.mu.RLock()
	agentCount := len(svc.agents)
	svc.mu.RUnlock()
	if agentCount != wantProduct {
		t.Fatalf("in-memory LocalAgents = %d, want %d", agentCount, wantProduct)
	}
}

func assertRealmSourceMaterializationAttemptV3(
	t *testing.T,
	svc *Service,
	accountID string,
	requestID string,
	wantState realmSourceMaterializationAttemptStateV3,
	wantFailure sourceMaterializationFailureCodeV3,
) {
	t.Helper()
	var state string
	var failure sql.NullString
	if err := svc.backend.DB().QueryRow(`
		SELECT state, failure_code FROM runtime_realm_source_materialization_attempt_v3
		WHERE materializer_account_id = ? AND request_id = ?
	`, accountID, requestID).Scan(&state, &failure); err != nil {
		t.Fatalf("read materialization attempt: %v", err)
	}
	if realmSourceMaterializationAttemptStateV3(state) != wantState || sourceMaterializationFailureCodeV3(failure.String) != wantFailure {
		t.Fatalf("attempt state/failure = %s/%s, want %s/%s", state, failure.String, wantState, wantFailure)
	}
}
