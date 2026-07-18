package runtimeagent

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

const (
	compactRealmMaterializationBearer       = "compact-account-bearer"
	compactRealmMaterializationPolicyDigest = "7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa"
)

// TestRealmSourceMaterializationCompactHermeticProtocolFullChain is the
// platform-neutral protocol proof. Unlike the focused issuer and verifier
// tests, it joins the real Account custody and first-party service operation to the
// real Runtime acquisition, streaming verifier, atomic product transaction,
// SnapshotV2 store, and five-lane compiler. Its in-process Realm is explicitly
// hermetic and cannot satisfy the separate current-Realm live acceptance.
func TestRealmSourceMaterializationCompactHermeticProtocolFullChain(t *testing.T) {
	now := realmSourceMaterializationServiceTestNow
	worldVector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	previousCeilings := sourceMaterializationProducerCeilingsV3
	sourceMaterializationProducerCeilingsV3 = worldVector.Expectation.PublishedLimits
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })

	rotatedKey, err := rsa.GenerateKey(cryptorand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rotated compact Realm key: %v", err)
	}
	realm := newCompactRealmMaterializationServer(t, now)
	server := httptest.NewServer(realm)
	account := newCompactRealmMaterializationAccount(t, server, now)

	statePath := filepath.Join(t.TempDir(), "compact-runtime-state.json")
	svc, closeService := openSourceMaterializationTransportTestService(t, statePath)
	svc.sourceMaterializationNow = func() time.Time { return now }
	svc.SetRealmSourceMaterializationIssuer(&compactRealmMaterializationAccountIssuer{
		t: t, account: account, expectedIssuer: worldVector.Expectation.Issuer,
	})

	type admittedProduct struct {
		localAgentRef string
		snapshotHash  string
		laneHash      string
	}
	products := make([]admittedProduct, 0, 2)
	for index, vectorName := range []string{"world-character", "persona-character"} {
		// The admitted producer vectors deliberately exercise different
		// deterministic segment ceilings. Publish the ceiling that belongs to
		// the vector before Runtime creates the challenge so the packet remains
		// a valid first-fit partition instead of silently rewriting segments.
		vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
		sourceMaterializationProducerCeilingsV3 = vector.Expectation.PublishedLimits
		if index == 1 {
			realm.setSigningAndCurrentKey(rotatedKey, "compact-rotated-key-v2")
		}
		ctx, request := realmSourceMaterializationServiceTestRequest(t, vectorName, "compact-fullchain-"+vectorName)
		response, materializeErr := svc.MaterializeRealmSource(ctx, request)
		if materializeErr == nil && response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
			t.Logf("compact %s verifier detail: %v", vectorName, realm.verificationError())
			t.Logf("compact %s server detail: %s", vectorName, realm.debugState())
		}
		assertRealmSourceMaterializationSuccess(t, response, materializeErr, vectorName)

		store, storeErr := newRealmSourceSnapshotV2Store(svc.backend.DB())
		if storeErr != nil {
			t.Fatal(storeErr)
		}
		snapshot, found, loadErr := store.sourceSnapshot(ctx, response.GetLocalAgentRef())
		if loadErr != nil || !found {
			t.Fatalf("load compact %s SnapshotV2: found=%v err=%v", vectorName, found, loadErr)
		}
		laneHash := compactRealmMaterializationFiveLaneHash(t, snapshot)
		products = append(products, admittedProduct{
			localAgentRef: response.GetLocalAgentRef(), snapshotHash: snapshot.SnapshotHash, laneHash: laneHash,
		})

		if index == 0 {
			beforeReplayCalls := realm.callCount()
			replay, replayErr := svc.MaterializeRealmSource(ctx, proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest))
			assertRealmSourceMaterializationSuccess(t, replay, replayErr, vectorName)
			if !replay.GetIdempotentReplay() || replay.GetLocalAgentRef() != response.GetLocalAgentRef() || realm.callCount() != beforeReplayCalls {
				t.Fatalf("compact idempotent replay crossed Realm or changed product: first=%+v replay=%+v calls=%d/%d", response, replay, beforeReplayCalls, realm.callCount())
			}
			conflict := proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest)
			conflict.GetSourceRef().GetWorldCharacter().SourceHash = strings.Repeat("f", 64)
			conflicted, conflictErr := svc.MaterializeRealmSource(ctx, conflict)
			if conflictErr != nil || conflicted.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_CONFLICT || realm.callCount() != beforeReplayCalls {
				t.Fatalf("compact request conflict did not fail before Realm: response=%+v err=%v calls=%d/%d", conflicted, conflictErr, beforeReplayCalls, realm.callCount())
			}
		}
	}

	assertRealmSourceMaterializationGlobalProductRows(t, svc, 2, 2)
	assertCompactRealmMaterializationNoOrphansOrRawResidue(t, svc)
	realm.assertExactSuccessfulLifecycle(t, 2)
	server.Close()
	offlineCallCount := realm.callCount()
	closeService()

	// Two cold starts run with no Realm issuer and after the Realm endpoint has
	// been taken offline. Both must rehydrate and compile the exact frozen
	// SnapshotV2 semantics without source rebase or network fallback.
	for coldStart := 1; coldStart <= 2; coldStart++ {
		restarted, closeRestart := openSourceMaterializationTransportTestService(t, statePath)
		store, storeErr := newRealmSourceSnapshotV2Store(restarted.backend.DB())
		if storeErr != nil {
			closeRestart()
			t.Fatal(storeErr)
		}
		if validateErr := store.validatePersistedSnapshots(context.Background()); validateErr != nil {
			closeRestart()
			t.Fatalf("cold start %d SnapshotV2 gate: %v", coldStart, validateErr)
		}
		for _, product := range products {
			snapshot, found, loadErr := store.sourceSnapshot(context.Background(), product.localAgentRef)
			if loadErr != nil || !found || snapshot.SnapshotHash != product.snapshotHash {
				closeRestart()
				t.Fatalf("cold start %d changed SnapshotV2 %s: found=%v hash=%s want=%s err=%v", coldStart, product.localAgentRef, found, snapshot.SnapshotHash, product.snapshotHash, loadErr)
			}
			if laneHash := compactRealmMaterializationFiveLaneHash(t, snapshot); laneHash != product.laneHash {
				closeRestart()
				t.Fatalf("cold start %d changed five-lane hash for %s: %s != %s", coldStart, product.localAgentRef, laneHash, product.laneHash)
			}
		}
		assertRealmSourceMaterializationGlobalProductRows(t, restarted, 2, 2)
		assertCompactRealmMaterializationNoOrphansOrRawResidue(t, restarted)
		if coldStart == 2 {
			for _, product := range products {
				entry := compactRealmMaterializationAgentEntry(t, restarted, product.localAgentRef)
				ctx := sourceMaterializationTransportTestContext(entry.Agent.GetOwnerUserId())
				terminated, terminateErr := restarted.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
					Context: &runtimev1.AgentRequestContext{
						AppId: "runtime-realm-v3-compact", SubjectUserId: entry.Agent.GetOwnerUserId(), OwnerUserId: entry.Agent.GetOwnerUserId(),
						LocalAgentRef: entry.Agent.GetLocalAgentRef(), RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(),
					},
					AgentId: entry.Agent.GetLocalAgentRef(), Reason: "compact acceptance cleanup",
				})
				if terminateErr != nil || terminated.GetAck() == nil || !terminated.GetAck().GetOk() {
					closeRestart()
					t.Fatalf("terminate compact product %s: response=%+v err=%v", product.localAgentRef, terminated, terminateErr)
				}
			}
			assertRealmSourceMaterializationGlobalProductRows(t, restarted, 0, 0)
			assertCompactRealmMaterializationNoOrphansOrRawResidue(t, restarted)
		}
		closeRestart()
	}
	if realm.callCount() != offlineCallCount {
		t.Fatalf("restart/offline lifecycle contacted Realm: calls=%d want=%d", realm.callCount(), offlineCallCount)
	}
}

func TestRealmSourceMaterializationCompactSecurityMutationsRollbackWithoutResidue(t *testing.T) {
	packetMutations := []struct {
		name       string
		configure  func(*compactRealmMaterializationServer)
		wantReason runtimev1.RealmSourceMaterializationReasonCode
	}{
		{name: "tampered-proof", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetMutation = mutateRealmSourceMaterializationServicePacketProof
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PROOF_INVALID},
		{name: "missing-segment", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetMutation = compactRealmMaterializationJSONMutation(func(root map[string]any) {
				segments := root["orderedSegments"].([]any)
				root["orderedSegments"] = segments[:len(segments)-1]
			})
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "duplicate-segment", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetMutation = compactRealmMaterializationJSONMutation(func(root map[string]any) {
				segments := root["orderedSegments"].([]any)
				root["orderedSegments"] = append(segments, segments[0])
			})
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "reordered-segments", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetMutation = compactRealmMaterializationJSONMutation(func(root map[string]any) {
				segments := root["orderedSegments"].([]any)
				for left, right := 0, len(segments)-1; left < right; left, right = left+1, right-1 {
					segments[left], segments[right] = segments[right], segments[left]
				}
			})
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "conflicting-segment", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetMutation = compactRealmMaterializationJSONMutation(func(root map[string]any) {
				segments := root["orderedSegments"].([]any)
				segments[1].(map[string]any)["segmentId"] = segments[0].(map[string]any)["segmentId"]
			})
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "wrong-source", configure: func(realm *compactRealmMaterializationServer) {
			realm.packetVectorOverride = "persona-character"
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH},
		{name: "wrong-account", configure: func(realm *compactRealmMaterializationServer) {
			realm.requestMutation = func(request *RealmSourceMaterializationIssuanceRequest) {
				request.AuthenticatedAccountID = "cross-account"
			}
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH},
		{name: "wrong-audience", configure: func(realm *compactRealmMaterializationServer) {
			realm.requestMutation = func(request *RealmSourceMaterializationIssuanceRequest) {
				request.Challenge.IntendedRuntimeAudience = "runtime-instance:wrong"
			}
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH},
		{name: "wrong-challenge", configure: func(realm *compactRealmMaterializationServer) {
			realm.requestMutation = func(request *RealmSourceMaterializationIssuanceRequest) {
				request.Challenge.ChallengeDigest = strings.Repeat("f", 64)
			}
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH},
		{name: "wrong-ttl", configure: func(realm *compactRealmMaterializationServer) {
			realm.requestMutation = func(request *RealmSourceMaterializationIssuanceRequest) {
				request.Challenge.IssuedAt = realm.now.Add(6 * time.Minute)
			}
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "invalid-nonce", configure: func(realm *compactRealmMaterializationServer) {
			realm.nonceOverride = " "
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID},
		{name: "removed-jwks-key", configure: func(realm *compactRealmMaterializationServer) {
			removedKey, err := rsa.GenerateKey(cryptorand.Reader, 2048)
			if err != nil {
				realm.t.Fatalf("generate removed-key replacement: %v", err)
			}
			realm.setCurrentKey(removedKey, "compact-current-key-with-old-key-removed")
		}, wantReason: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_JWKS_INVALID},
	}
	for _, mutation := range packetMutations {
		mutation := mutation
		t.Run(mutation.name, func(t *testing.T) {
			runCompactRealmMaterializationRejectedScenario(t, mutation.configure, mutation.wantReason)
		})
	}

}

func TestRealmSourceMaterializationCompactNonceReplayIsRejectedAtomically(t *testing.T) {
	now := realmSourceMaterializationServiceTestNow
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	previousCeilings := sourceMaterializationProducerCeilingsV3
	sourceMaterializationProducerCeilingsV3 = vector.Expectation.PublishedLimits
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })

	realm := newCompactRealmMaterializationServer(t, now)
	realm.nonceOverride = "compact-reused-current-realm-nonce"
	server := httptest.NewServer(realm)
	defer server.Close()
	account := newCompactRealmMaterializationAccount(t, server, now)
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "compact-nonce-state.json"))
	defer closeService()
	svc.sourceMaterializationNow = func() time.Time { return now }
	svc.SetRealmSourceMaterializationIssuer(&compactRealmMaterializationAccountIssuer{t: t, account: account, expectedIssuer: vector.Expectation.Issuer})

	ctx, worldRequest := realmSourceMaterializationServiceTestRequest(t, "world-character", "compact-nonce-world")
	world, err := svc.MaterializeRealmSource(ctx, worldRequest)
	assertRealmSourceMaterializationSuccess(t, world, err, "world-character")
	personaVector := loadSourceMaterializationReferenceVectorV3(t, "persona-character")
	sourceMaterializationProducerCeilingsV3 = personaVector.Expectation.PublishedLimits
	_, personaRequest := realmSourceMaterializationServiceTestRequest(t, "persona-character", "compact-nonce-persona")
	persona, err := svc.MaterializeRealmSource(ctx, personaRequest)
	if err != nil || persona.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REPLAY_DETECTED || persona.GetLocalAgentRef() != "" {
		t.Fatalf("reused Realm nonce response=%+v err=%v", persona, err)
	}
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
	assertCompactRealmMaterializationNoOrphansOrRawResidue(t, svc)
}

func runCompactRealmMaterializationRejectedScenario(
	t *testing.T,
	configure func(*compactRealmMaterializationServer),
	wantReason runtimev1.RealmSourceMaterializationReasonCode,
) {
	t.Helper()
	now := realmSourceMaterializationServiceTestNow
	previousCeilings := sourceMaterializationProducerCeilingsV3
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })

	realm := newCompactRealmMaterializationServer(t, now)
	configure(realm)
	ceilingVectorName := "world-character"
	if realm.packetVectorOverride != "" {
		ceilingVectorName = realm.packetVectorOverride
	}
	ceilingVector := loadSourceMaterializationReferenceVectorV3(t, ceilingVectorName)
	sourceMaterializationProducerCeilingsV3 = ceilingVector.Expectation.PublishedLimits
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	server := httptest.NewServer(realm)
	defer server.Close()
	account := newCompactRealmMaterializationAccount(t, server, now)
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "compact-rejected-state.json"))
	defer closeService()
	svc.sourceMaterializationNow = func() time.Time { return now }
	svc.SetRealmSourceMaterializationIssuer(&compactRealmMaterializationAccountIssuer{t: t, account: account, expectedIssuer: vector.Expectation.Issuer})

	ctx, request := realmSourceMaterializationServiceTestRequest(t, "world-character", "compact-rejected-"+strings.ReplaceAll(t.Name(), "/", "-"))
	response, err := svc.MaterializeRealmSource(ctx, request)
	if err != nil || response == nil || response.GetReasonCode() != wantReason || response.GetLocalAgentRef() != "" || response.GetSourceContextStatus() != nil {
		t.Fatalf("rejected compact response=%+v err=%v want=%s", response, err, wantReason)
	}
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 0, 0)
	assertCompactRealmMaterializationNoOrphansOrRawResidue(t, svc)
	realm.assertNoProtocolViolations(t)
}

type compactRealmMaterializationAccountIssuer struct {
	t              *testing.T
	account        *accountservice.Service
	expectedIssuer string
}

func (issuer *compactRealmMaterializationAccountIssuer) AcquireRealmSourceMaterialization(
	ctx context.Context,
	request RealmSourceMaterializationIssuanceRequest,
) (RealmSourceMaterializationAcquisition, error) {
	accountRequest := accountservice.RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: request.AuthenticatedAccountID,
		SourceRef: accountservice.RealmSourceMaterializationSourceRefV3{
			Kind: request.SourceRef.Kind, ID: request.SourceRef.ID, WorldID: request.SourceRef.WorldID,
			OwnerAccountID: request.SourceRef.OwnerAccountID, SourceHash: request.SourceRef.SourceHash,
		},
		Challenge: accountservice.RealmSourceMaterializationChallengeV3{
			ChallengeID: request.Challenge.ChallengeID, ChallengeDigest: request.Challenge.ChallengeDigest,
			IntendedRuntimeAudience: request.Challenge.IntendedRuntimeAudience, ExpiresAt: request.Challenge.ExpiresAt,
		},
		Limits: accountservice.RealmSourceMaterializationLimitsV3{
			MaxSegmentBytes: request.Limits.MaxSegmentBytes, MaxSegmentComponentCount: request.Limits.MaxSegmentComponentCount,
			MaxChunkBytes: request.Limits.MaxChunkBytes, MaxSegmentChunks: request.Limits.MaxSegmentChunks,
			MaxSetSegments: request.Limits.MaxSetSegments, MaxSetBytes: request.Limits.MaxSetBytes,
			MaxSetComponentCount: request.Limits.MaxSetComponentCount, MaxSetChunks: request.Limits.MaxSetChunks,
		},
	}
	if request.SourceRef.WorldEntityRef != nil {
		accountRequest.SourceRef.WorldEntityRef = &accountservice.RealmSourceMaterializationWorldEntityRefV3{
			WorldID: request.SourceRef.WorldEntityRef.WorldID, EntityID: request.SourceRef.WorldEntityRef.EntityID,
		}
	}
	acquisition, err := issuer.account.AcquireRealmSourceMaterialization(ctx, accountRequest)
	if err != nil {
		issuer.t.Logf("compact account acquisition error: %v", err)
		return RealmSourceMaterializationAcquisition{}, compactRealmMaterializationClassifyAccountError(err)
	}
	return RealmSourceMaterializationAcquisition{
		AccountLease: RealmSourceMaterializationAccountLease{
			AccountID: acquisition.AccountLease.AccountID, Generation: acquisition.AccountLease.Generation,
		},
		ExpectedIssuer: issuer.expectedIssuer, ExpectedAccessPolicyVersionDigest: compactRealmMaterializationPolicyDigest,
		PacketResponse: compactRealmMaterializationHTTPResponse(acquisition.PacketResponse),
	}, nil
}

func (issuer *compactRealmMaterializationAccountIssuer) FetchCurrentRealmSourceMaterializationJWKS(
	ctx context.Context,
	lease RealmSourceMaterializationAccountLease,
) (RealmSourceMaterializationHTTPResponse, error) {
	response, err := issuer.account.FetchCurrentRealmSourceMaterializationJWKS(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	})
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	return compactRealmMaterializationHTTPResponse(response), nil
}

func (issuer *compactRealmMaterializationAccountIssuer) RevalidateRealmSourceMaterializationAccount(
	ctx context.Context,
	lease RealmSourceMaterializationAccountLease,
) error {
	return issuer.account.RevalidateRealmSourceMaterializationAccount(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	})
}

func (issuer *compactRealmMaterializationAccountIssuer) WithCurrentRealmSourceMaterializationAccount(
	ctx context.Context,
	lease RealmSourceMaterializationAccountLease,
	callback func() error,
) error {
	return issuer.account.WithCurrentRealmSourceMaterializationAccount(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	}, callback)
}

func compactRealmMaterializationClassifyAccountError(err error) error {
	switch {
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationInvalidRequest):
		return fmt.Errorf("%w: %v", ErrRealmSourceMaterializationAcquisitionInvalidRequest, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationSourceBinding):
		return fmt.Errorf("%w: %v", ErrRealmSourceMaterializationAcquisitionSourceBinding, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationDenied), errors.Is(err, accountservice.ErrRealmSourceMaterializationContract):
		return fmt.Errorf("%w: %v", ErrRealmSourceMaterializationAcquisitionDenied, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationResponseSize):
		return fmt.Errorf("%w: %v", ErrRealmSourceMaterializationAcquisitionCapacity, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationAccountLease):
		return fmt.Errorf("%w: %v", ErrRealmSourceMaterializationAcquisitionAccount, err)
	default:
		return err
	}
}

func compactRealmMaterializationHTTPResponse(response accountservice.RealmSourceMaterializationHTTPResponse) RealmSourceMaterializationHTTPResponse {
	return RealmSourceMaterializationHTTPResponse{
		StatusCode: response.StatusCode, ContentType: response.ContentType, ContentEncoding: response.ContentEncoding,
		ContentLength: response.ContentLength, Body: response.Body,
	}
}

type compactRealmMaterializationCustody struct {
	mu       sync.Mutex
	material accountservice.AccountMaterial
}

func (custody *compactRealmMaterializationCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	custody.mu.Lock()
	defer custody.mu.Unlock()
	return custody.material, nil
}

func (custody *compactRealmMaterializationCustody) Store(_ context.Context, _ string, material accountservice.AccountMaterial) error {
	custody.mu.Lock()
	custody.material = material
	custody.mu.Unlock()
	return nil
}

func (custody *compactRealmMaterializationCustody) Clear(context.Context, string) error {
	custody.mu.Lock()
	custody.material = accountservice.AccountMaterial{}
	custody.mu.Unlock()
	return nil
}

func newCompactRealmMaterializationAccount(t *testing.T, server *httptest.Server, now time.Time) *accountservice.Service {
	t.Helper()
	custody := &compactRealmMaterializationCustody{material: accountservice.AccountMaterial{
		AccountID: "materializer-1", DisplayName: "Compact Materializer", RealmEnvironmentID: "realm-v3-compact",
		AccessToken: compactRealmMaterializationBearer, AccessTokenExpires: now.Add(time.Hour), RefreshToken: "compact-refresh-not-exported",
	}}
	return accountservice.New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(custody),
		accountservice.WithRealmBaseURL(server.URL), accountservice.WithRealmHTTPClient(server.Client()),
		accountservice.WithClock(func() time.Time { return now }),
	)
}

type compactRealmMaterializationServer struct {
	t   *testing.T
	now time.Time

	mu                   sync.Mutex
	paths                []string
	violations           []string
	signingKey           *rsa.PrivateKey
	signingKeyID         string
	currentKey           *rsa.PrivateKey
	currentKeyID         string
	requestMutation      func(*RealmSourceMaterializationIssuanceRequest)
	packetMutation       func([]byte) ([]byte, error)
	packetVectorOverride string
	nonceOverride        string
	lastPacket           []byte
	lastJWKS             []byte
	lastExpectation      sourceMaterializationVerificationExpectationV3
}

func newCompactRealmMaterializationServer(t *testing.T, now time.Time) *compactRealmMaterializationServer {
	t.Helper()
	key := sourceMaterializationTestPrivateKey(t)
	return &compactRealmMaterializationServer{
		t: t, now: now,
		signingKey: key, signingKeyID: realmSourceMaterializationServiceTestKeyID,
		currentKey: key, currentKeyID: realmSourceMaterializationServiceTestKeyID,
	}
}

func (realm *compactRealmMaterializationServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	realm.mu.Lock()
	realm.paths = append(realm.paths, request.Method+" "+request.URL.Path)
	realm.mu.Unlock()
	response.Header().Set("Content-Type", "application/json")

	if request.URL.Path == "/api/auth/jwks/source-materialization" {
		realm.serveJWKS(response, request)
		return
	}
	if request.Header.Get("Authorization") != "Bearer "+compactRealmMaterializationBearer {
		realm.violation("authenticated Realm request omitted the account bearer")
	}
	if request.Header.Get("Accept-Encoding") != "identity" {
		realm.violation("Realm request did not forbid transport compression")
	}
	switch {
	case request.Method == http.MethodPost && request.URL.Path == "/api/realm/core/source-materialization-packets":
		realm.servePacket(response, request)
	default:
		realm.violation("unexpected Realm operation " + request.Method + " " + request.URL.Path)
		response.WriteHeader(http.StatusNotFound)
		_, _ = response.Write([]byte(`{}`))
	}
}

func (realm *compactRealmMaterializationServer) servePacket(response http.ResponseWriter, request *http.Request) {
	var body struct {
		SourceRef               json.RawMessage                    `json:"sourceRef"`
		MaterializerAccountID   string                             `json:"materializerAccountId"`
		ChallengeID             string                             `json:"challengeId"`
		ChallengeDigest         string                             `json:"challengeDigest"`
		IntendedRuntimeAudience string                             `json:"intendedRuntimeAudience"`
		ChallengeExpiresAt      string                             `json:"challengeExpiresAt"`
		PublishedLimits         RealmSourceMaterializationLimitsV3 `json:"publishedLimits"`
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		realm.violation("decode Packet request: " + err.Error())
		response.WriteHeader(http.StatusBadRequest)
		return
	}
	_ = request.Body.Close()
	realm.mu.Lock()
	requestMutation := realm.requestMutation
	packetMutation := realm.packetMutation
	vectorOverride := realm.packetVectorOverride
	nonceOverride := realm.nonceOverride
	signingKey, signingKeyID := realm.signingKey, realm.signingKeyID
	realm.mu.Unlock()
	if body.MaterializerAccountID != "materializer-1" {
		realm.violation(fmt.Sprintf("Packet request did not use the authenticated account: account=%s", body.MaterializerAccountID))
	}
	var sourceRef sourceMaterializationCharacterSourceRefV3
	if err := json.Unmarshal(body.SourceRef, &sourceRef); err != nil || sourceRef.validate() != nil {
		realm.violation(fmt.Sprintf("Packet CharacterSourceRefV3 is invalid: %v", err))
		response.WriteHeader(http.StatusBadRequest)
		return
	}
	vectorName := "world-character"
	if sourceRef.Kind == "personaCharacter" {
		vectorName = "persona-character"
	}
	if vectorOverride != "" {
		vectorName = vectorOverride
		vectorSource, err := compactRealmMaterializationVectorSourceRef(realm.t, vectorName)
		if err != nil {
			realm.violation(err.Error())
			response.WriteHeader(http.StatusInternalServerError)
			return
		}
		sourceRef = vectorSource
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, body.ChallengeExpiresAt)
	if err != nil {
		realm.violation("Packet challenge expiry is invalid")
		response.WriteHeader(http.StatusBadRequest)
		return
	}
	issuance := RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: body.MaterializerAccountID, RequestID: "compact-realm-http",
		SourceRef: sourceMaterializationExternalRefV3(sourceRef),
		Challenge: RealmSourceMaterializationChallengeV3{
			ChallengeID: body.ChallengeID, ChallengeDigest: body.ChallengeDigest,
			IntendedRuntimeAudience: body.IntendedRuntimeAudience, IssuedAt: realm.now, ExpiresAt: expiresAt,
		},
		Limits: body.PublishedLimits,
	}
	realm.mu.Lock()
	realm.lastExpectation = sourceMaterializationVerificationExpectationV3{
		Challenge: sourceMaterializationChallengeV3{
			ChallengeID: body.ChallengeID, ChallengeDigest: body.ChallengeDigest,
			IntendedRuntimeAudience: body.IntendedRuntimeAudience, MaterializerAccountID: body.MaterializerAccountID,
			SourceRef: sourceRef, Limits: sourceMaterializationPublishedLimitsV3{
				MaxSegmentBytes: body.PublishedLimits.MaxSegmentBytes, MaxSegmentComponentCount: body.PublishedLimits.MaxSegmentComponentCount,
				MaxChunkBytes: body.PublishedLimits.MaxChunkBytes, MaxSegmentChunks: body.PublishedLimits.MaxSegmentChunks,
				MaxSetSegments: body.PublishedLimits.MaxSetSegments, MaxSetBytes: body.PublishedLimits.MaxSetBytes,
				MaxSetComponentCount: body.PublishedLimits.MaxSetComponentCount, MaxSetChunks: body.PublishedLimits.MaxSetChunks,
			}, IssuedAt: realm.now, ExpiresAt: expiresAt,
		},
		ExpectedIssuer:             loadSourceMaterializationReferenceVectorV3(realm.t, vectorName).Expectation.Issuer,
		ExpectedAccessPolicyDigest: compactRealmMaterializationPolicyDigest,
		Now:                        realm.now,
	}
	realm.mu.Unlock()
	if requestMutation != nil {
		requestMutation(&issuance)
	}
	vector := loadSourceMaterializationReferenceVectorV3(realm.t, vectorName)
	packet, err := buildRealmSourceMaterializationServiceTestPacketWithKeyID(vector.Packet, signingKey, signingKeyID, issuance, nonceOverride)
	if err == nil && packetMutation != nil {
		packet, err = packetMutation(packet)
	}
	if err != nil {
		realm.violation("build compact Realm Packet: " + err.Error())
		response.WriteHeader(http.StatusInternalServerError)
		return
	}
	realm.mu.Lock()
	realm.lastPacket = append(realm.lastPacket[:0], packet...)
	realm.mu.Unlock()
	compactRealmMaterializationWriteJSONBytes(response, http.StatusCreated, packet)
}

func (realm *compactRealmMaterializationServer) serveJWKS(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || request.Header.Get("Authorization") != "" {
		realm.violation("current JWKS request carried wrong method or bearer")
	}
	if !strings.Contains(request.Header.Get("Cache-Control"), "no-store") || request.Header.Get("Pragma") != "no-cache" {
		realm.violation("current JWKS request was cacheable")
	}
	response.Header().Set("Cache-Control", "no-store, max-age=0")
	response.Header().Set("Pragma", "no-cache")
	realm.mu.Lock()
	key, keyID := realm.currentKey, realm.currentKeyID
	realm.mu.Unlock()
	jwks, err := realmSourceMaterializationServiceTestJWKS(key, keyID)
	if err != nil {
		realm.violation("encode compact JWKS: " + err.Error())
		response.WriteHeader(http.StatusInternalServerError)
		return
	}
	realm.mu.Lock()
	realm.lastJWKS = append(realm.lastJWKS[:0], jwks...)
	realm.mu.Unlock()
	compactRealmMaterializationWriteJSONBytes(response, http.StatusOK, jwks)
}

func (realm *compactRealmMaterializationServer) verificationError() error {
	realm.mu.Lock()
	packet := append([]byte(nil), realm.lastPacket...)
	jwks := append([]byte(nil), realm.lastJWKS...)
	expected := realm.lastExpectation
	realm.mu.Unlock()
	if len(packet) == 0 || len(jwks) == 0 {
		return fmt.Errorf("compact verification inputs are incomplete")
	}
	_, err := verifySourceMaterializationPacketV3(strings.NewReader(string(packet)), strings.NewReader(string(jwks)), expected)
	return err
}

func (realm *compactRealmMaterializationServer) debugState() string {
	realm.mu.Lock()
	defer realm.mu.Unlock()
	return fmt.Sprintf("paths=%v violations=%v", realm.paths, realm.violations)
}

func (realm *compactRealmMaterializationServer) setSigningAndCurrentKey(key *rsa.PrivateKey, keyID string) {
	realm.mu.Lock()
	realm.signingKey, realm.signingKeyID = key, keyID
	realm.currentKey, realm.currentKeyID = key, keyID
	realm.mu.Unlock()
}

func (realm *compactRealmMaterializationServer) setCurrentKey(key *rsa.PrivateKey, keyID string) {
	realm.mu.Lock()
	realm.currentKey, realm.currentKeyID = key, keyID
	realm.mu.Unlock()
}

func (realm *compactRealmMaterializationServer) violation(message string) {
	realm.mu.Lock()
	realm.violations = append(realm.violations, message)
	realm.mu.Unlock()
}

func (realm *compactRealmMaterializationServer) callCount() int {
	realm.mu.Lock()
	defer realm.mu.Unlock()
	return len(realm.paths)
}

func (realm *compactRealmMaterializationServer) assertNoProtocolViolations(t *testing.T) {
	t.Helper()
	realm.mu.Lock()
	defer realm.mu.Unlock()
	if len(realm.violations) != 0 {
		t.Fatalf("compact Realm protocol violations: %v", realm.violations)
	}
}

func (realm *compactRealmMaterializationServer) assertExactSuccessfulLifecycle(t *testing.T, attempts int) {
	t.Helper()
	realm.assertNoProtocolViolations(t)
	realm.mu.Lock()
	defer realm.mu.Unlock()
	if len(realm.paths) != attempts*2 {
		t.Fatalf("compact Realm lifecycle calls=%d want=%d: %v", len(realm.paths), attempts*2, realm.paths)
	}
	for index := 0; index < attempts; index++ {
		want := []string{
			http.MethodPost + " /api/realm/core/source-materialization-packets",
			http.MethodGet + " /api/auth/jwks/source-materialization",
		}
		got := realm.paths[index*2 : index*2+2]
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("compact Realm lifecycle %d=%v want=%v", index, got, want)
		}
	}
}

func compactRealmMaterializationWriteJSON(response http.ResponseWriter, status int, value any) {
	raw, err := json.Marshal(value)
	if err != nil {
		response.WriteHeader(http.StatusInternalServerError)
		return
	}
	compactRealmMaterializationWriteJSONBytes(response, status, raw)
}

func compactRealmMaterializationWriteJSONBytes(response http.ResponseWriter, status int, raw []byte) {
	response.WriteHeader(status)
	_, _ = response.Write(raw)
}

func compactRealmMaterializationJSONMutation(mutate func(map[string]any)) func([]byte) ([]byte, error) {
	return func(raw []byte) ([]byte, error) {
		value, err := decodeSourceMaterializationJSON(raw)
		if err != nil {
			return nil, err
		}
		root, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("Packet root is not an object")
		}
		mutate(root)
		return json.Marshal(root)
	}
}

func compactRealmMaterializationVectorSourceRef(t *testing.T, vectorName string) (sourceMaterializationCharacterSourceRefV3, error) {
	t.Helper()
	vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
	var packet struct {
		SourceRef sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	}
	if err := json.Unmarshal(vector.Packet, &packet); err != nil {
		return sourceMaterializationCharacterSourceRefV3{}, err
	}
	return packet.SourceRef, packet.SourceRef.validate()
}

func compactRealmMaterializationFiveLaneHash(t *testing.T, snapshot localAgentSourceSnapshotV2) string {
	t.Helper()
	items, err := compileAgentTurnSourceSnapshotV3(snapshot)
	if err != nil {
		t.Fatalf("compile compact SnapshotV2: %v", err)
	}
	assertRealmSourceCompilerFiveLanesV3(t, items)
	assertRealmSourceCompilerTypedItemsV3(t, snapshot, items)
	lanes, err := makeAgentTurnContextLanes(items)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := hashAgentTurnContextContent(lanes)
	if err != nil || !isLowerSHA256V3(hash) {
		t.Fatalf("hash compact five lanes: hash=%s err=%v", hash, err)
	}
	return hash
}

func compactRealmMaterializationAgentEntry(t *testing.T, svc *Service, localAgentRef string) *agentEntry {
	t.Helper()
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	entry := svc.agents[localAgentRef]
	if entry == nil || entry.Agent == nil {
		t.Fatalf("compact LocalAgent %s is not hydrated", localAgentRef)
	}
	return &agentEntry{Agent: cloneAgentRecord(entry.Agent), State: cloneAgentState(entry.State)}
}

func assertCompactRealmMaterializationNoOrphansOrRawResidue(t *testing.T, svc *Service) {
	t.Helper()
	assertRealmSourceMaterializationStagingEmpty(t, svc.realmSourceMaterializationStagingV3.root)
	queries := []string{
		`SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2 AS snapshot LEFT JOIN runtime_local_agent AS agent ON agent.local_agent_ref = snapshot.local_agent_ref WHERE agent.local_agent_ref IS NULL`,
		`SELECT COUNT(*) FROM runtime_local_agent_source_provenance_v3 AS provenance LEFT JOIN runtime_local_agent_source_snapshot_v2 AS snapshot ON snapshot.local_agent_ref = provenance.local_agent_ref WHERE snapshot.local_agent_ref IS NULL`,
		`SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2 AS snapshot LEFT JOIN runtime_local_agent_source_provenance_v3 AS provenance ON provenance.local_agent_ref = snapshot.local_agent_ref WHERE provenance.local_agent_ref IS NULL`,
	}
	for _, query := range queries {
		var count int
		if err := svc.backend.DB().QueryRow(query).Scan(&count); err != nil {
			t.Fatalf("count compact materialization orphans: %v", err)
		}
		if count != 0 {
			t.Fatalf("compact materialization orphan count=%d", count)
		}
	}
	rows, err := svc.backend.DB().Query(`SELECT typed_snapshot_json FROM runtime_local_agent_source_snapshot_v2`)
	if err != nil {
		t.Fatalf("read compact SnapshotV2 rows: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var typed []byte
		if err := rows.Scan(&typed); err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{`"packetProof"`, `"compactJws"`, `"signedPayload"`, `"accessGrantId"`, `"challengeDigest"`, `"orderedSegments"`, `"canonicalBytes"`, `"chunks"`} {
			if strings.Contains(string(typed), forbidden) {
				t.Fatalf("compact SnapshotV2 retained raw transport field %s", forbidden)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}
