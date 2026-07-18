//go:build realm_v3_full_data

package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestRealmV3FullDataLiveWorkerUsesFormalAccountRuntimeChain(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	previousCeilings := sourceMaterializationProducerCeilingsV3
	sourceMaterializationProducerCeilingsV3 = vector.Expectation.PublishedLimits
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })
	realm := newCompactRealmMaterializationServer(t, now)
	realm.mu.Lock()
	currentKey, currentKeyID := realm.currentKey, realm.currentKeyID
	realm.mu.Unlock()
	realm.packetMutation = func(packet []byte) ([]byte, error) {
		return realmV3FullDataRebindPacketPolicyV1(packet, currentKey, currentKeyID, compactRealmMaterializationPolicyDigest)
	}
	refreshCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/auth/refresh" {
			refreshCalls++
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"accessToken": compactRealmMaterializationBearer, "refreshToken": "rotated-refresh-not-evidence",
				"tokenType": "Bearer", "expiresIn": 3600,
			})
			return
		}
		realm.ServeHTTP(response, request)
	}))
	t.Cleanup(server.Close)
	ref, err := compactRealmMaterializationVectorSourceRef(t, "world-character")
	if err != nil {
		t.Fatalf("load compact full-data source ref: %v", err)
	}
	runtimeRoot := t.TempDir()
	runtimeRoot, err = filepath.EvalSymlinks(runtimeRoot)
	if err != nil {
		t.Fatalf("canonicalize compact full-data runtime root: %v", err)
	}
	if err := os.Chmod(runtimeRoot, 0o700); err != nil {
		t.Fatalf("protect compact full-data runtime root: %v", err)
	}
	request := realmV3FullDataPartitionRequestV1{
		SchemaVersion: realmV3FullDataPartitionRequestSchemaV1,
		Stage:         realmV3FullDataLiveStageV1, InputDigest: strings.Repeat("a", 64),
		PartitionKey: strings.Repeat("b", 64), Ordinal: 0, RuntimeDataRoot: &runtimeRoot,
	}
	request.Source.Kind = ref.Kind
	request.Source.ID = ref.ID
	request.Source.WorldID = ref.WorldID
	request.Source.SourceHash = ref.SourceHash
	request.Source.SourceRef = ref
	request.Source.SourceRefHash, err = realmV3FullDataCanonicalDomainHashV1("nimi.realm-v3-full-data-source-ref/v1", ref)
	if err != nil {
		t.Fatalf("hash compact full-data source ref: %v", err)
	}
	request.Identity.Realm.Commit = strings.Repeat("a", 40)
	request.Identity.Realm.Tree = strings.Repeat("b", 40)
	request.Identity.Realm.OpenAPIDigest = strings.Repeat("c", 64)
	request.Identity.Realm.PolicyDigest = compactRealmMaterializationPolicyDigest
	request.Identity.Realm.VectorDigests = map[string]string{"world-character.json": strings.Repeat("d", 64)}
	request.Identity.Nimi.Commit = strings.Repeat("c", 40)
	request.Identity.Nimi.Tree = strings.Repeat("d", 40)
	request.Identity.Nimi.ContractDigest = strings.Repeat("e", 64)
	request.Identity.Nimi.WorktreeDigest = strings.Repeat("f", 64)
	request.AuthorizationBoundary = realmV3FullDataExpectedAuthorizationBoundaryV1()
	request.LiveEnvironment = &realmV3FullDataLiveEnvironmentV1{
		CanonicalRealmBaseURL:          server.URL,
		CanonicalTokenURL:              server.URL + "/api/auth/oauth/token",
		ExpectedIssuer:                 vector.Expectation.Issuer,
		MaterializerAccountIDHash:      sha256HexBytes([]byte("materializer-1")),
		ServerExportAttestationDigest:  sha256HexBytes([]byte("hermetic-server-export-attestation")),
		DisposableSourceInstanceDigest: sha256HexBytes([]byte("hermetic-disposable-source-instance")),
	}
	validateRealmV3FullDataCurrentRequestV1(t, request, realmV3FullDataLiveStageV1)
	writeRealmV3FullDataPrivateJSONV1(
		t,
		filepath.Join(runtimeRoot, realmV3FullDataRuntimeMarkerFileV1),
		realmV3FullDataExpectedRuntimeRootMarkerV1(t, request, runtimeRoot),
	)

	t.Setenv("NIMI_REALM_V3_LIVE_BASE_URL", server.URL)
	t.Setenv("NIMI_REALM_V3_LIVE_TOKEN_URL", server.URL+"/api/auth/oauth/token")
	t.Setenv("NIMI_REALM_V3_LIVE_BEARER", compactRealmMaterializationBearer)
	t.Setenv("NIMI_REALM_V3_LIVE_REFRESH_TOKEN", "hermetic-refresh-not-evidence")
	t.Setenv("NIMI_REALM_V3_LIVE_ACCESS_EXPIRES_AT", now.Add(5*time.Second).Format(time.RFC3339Nano))
	t.Setenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID", "materializer-1")
	t.Setenv("NIMI_REALM_V3_LIVE_EXPECTED_ISSUER", vector.Expectation.Issuer)
	t.Setenv("NIMI_REALM_V3_LIVE_POLICY_DIGEST", compactRealmMaterializationPolicyDigest)

	// Simulate a process crash at the exact durability boundary: the original
	// Packet and current JWKS have been independently verified and the prepared
	// journal is fsynced, while Runtime has not entered committing.
	crashSentinel := &struct{ name string }{"after-prepared-before-commit"}
	realmV3FullDataAfterPreparedHookMuV1.Lock()
	realmV3FullDataAfterPreparedHookV1 = func() { panic(crashSentinel) }
	realmV3FullDataAfterPreparedHookMuV1.Unlock()
	func() {
		defer func() {
			if recovered := recover(); recovered != crashSentinel {
				t.Fatalf("precommit crash hook recovered=%v, want sentinel", recovered)
			}
		}()
		_ = runRealmV3FullDataLivePartitionV1(t, request)
	}()

	evidence := runRealmV3FullDataLivePartitionV1(t, request)
	if !evidence.Authorization.LiveAuthorizationProven ||
		!evidence.Authorization.PacketRequestAuthenticated ||
		evidence.Authorization.ThirdPartyAppPermissionRequired ||
		evidence.Authorization.ForbiddenInputObserved || evidence.Authorization.SyntheticDecisionObserved ||
		evidence.Atomicity.LocalAgentsCreated != 1 || evidence.Atomicity.RawTransportResidue != 0 ||
		len(evidence.AttemptGenerations) != 2 || evidence.AttemptGenerations[0].Status != realmV3FullDataAttemptStatusFailedV1 ||
		evidence.AttemptGenerations[1].Status != realmV3FullDataAttemptStatusCommittedV1 {
		t.Fatalf("hermetic full-data live evidence is incomplete: %+v", evidence)
	}
	if refreshCalls != 1 {
		t.Fatalf("formal Account refresh calls=%d, want 1", refreshCalls)
	}
	rotated, err := realmV3FullDataCustodyV1(runtimeRoot).Load(context.Background(), "")
	if err != nil || rotated.RefreshToken != "rotated-refresh-not-evidence" || len(rotated.RefreshTokenHashes) != 1 {
		t.Fatalf("shared full-data custody did not retain formal refresh rotation: err=%v", err)
	}
	realm.assertExactSuccessfulLifecycle(t, 2)
	journalPath := realmV3FullDataAuditJournalPathV1(runtimeRoot, request.PartitionKey, 2)
	sealedJournal, err := readRealmV3FullDataAuditJournalFileV2(journalPath)
	if err != nil || sealedJournal.Phase != realmV3FullDataAuditPhaseSealedV2 {
		t.Fatalf("read sealed original audit journal: phase=%s err=%v", sealedJournal.Phase, err)
	}
	preparedJournal := sealedJournal
	preparedJournal.Phase = realmV3FullDataAuditPhasePreparedV2
	preparedJournal.LocalAgentRefHash = nil
	preparedJournal.SnapshotHash = nil
	preparedJournal.ProvenanceKeyHash = nil
	preparedJournal.CommittedAttemptPacketHash = nil
	preparedJournal.ContentHash = ""
	preparedJournal, err = sealRealmV3FullDataAuditJournalV2(preparedJournal)
	if err != nil || writeRealmV3FullDataPrivateJSONAtomicV1(journalPath, preparedJournal) != nil {
		t.Fatalf("simulate crash retaining only prepared audit journal: %v", err)
	}
	callsBeforePreparedRecovery := realm.callCount()
	resumed := runRealmV3FullDataLivePartitionV1(t, request)
	if !reflect.DeepEqual(resumed.Materialization, evidence.Materialization) ||
		!reflect.DeepEqual(resumed.Atomicity, evidence.Atomicity) ||
		!reflect.DeepEqual(resumed.AttemptGenerations, evidence.AttemptGenerations) ||
		resumed.Authorization.LiveAuthorizationProven != true || !reflect.DeepEqual(resumed.Transport, evidence.Transport) ||
		refreshCalls != 1 || realm.callCount() != callsBeforePreparedRecovery {
		t.Fatalf("live partition journal-loss recovery is incomplete: resumed=%+v refreshCalls=%d", resumed, refreshCalls)
	}
	resealed, err := readRealmV3FullDataAuditJournalFileV2(journalPath)
	if err != nil || resealed.Phase != realmV3FullDataAuditPhaseSealedV2 || resealed.ContentHash != sealedJournal.ContentHash {
		t.Fatalf("prepared audit journal did not seal to the original product: phase=%s err=%v", resealed.Phase, err)
	}
	if err := os.Remove(journalPath); err != nil {
		t.Fatalf("simulate complete prepared journal loss: %v", err)
	}
	serviceForMissingJournal, closeMissingJournalService := openRealmV3FullDataRuntimeServiceV1(t, runtimeRoot, request.InputDigest)
	localAgentRef := realmV3FullDataCommittedLocalAgentRefV1(t, serviceForMissingJournal, "materializer-1", realmV3FullDataGenerationRequestIDV1(request, 2))
	storeForMissingJournal, err := newRealmSourceSnapshotV2Store(serviceForMissingJournal.backend.DB())
	if err != nil {
		closeMissingJournalService()
		t.Fatalf("open missing-journal SnapshotV2 store: %v", err)
	}
	snapshotForMissingJournal, found, err := storeForMissingJournal.sourceSnapshot(context.Background(), localAgentRef)
	if err != nil || !found {
		closeMissingJournalService()
		t.Fatalf("read missing-journal committed SnapshotV2: found=%v err=%v", found, err)
	}
	_, missingErr := sealRealmV3FullDataCommittedAuditJournalV2(
		serviceForMissingJournal, journalPath, request, 2, realmV3FullDataGenerationRequestIDV1(request, 2), localAgentRef, snapshotForMissingJournal,
	)
	closeMissingJournalService()
	if missingErr == nil || realm.callCount() != callsBeforePreparedRecovery {
		t.Fatalf("committed product without prepared journal did not fail closed: err=%v", missingErr)
	}
	if err := writeRealmV3FullDataPrivateJSONAtomicV1(journalPath, resealed); err != nil {
		t.Fatalf("restore original sealed audit journal after fail-closed probe: %v", err)
	}
	sealedReplay := runRealmV3FullDataLivePartitionV1(t, request)
	if !reflect.DeepEqual(sealedReplay, resumed) || refreshCalls != 1 || realm.callCount() != callsBeforePreparedRecovery {
		t.Fatalf("sealed recovery journal did not provide stable replay: replay=%+v refreshCalls=%d", sealedReplay, refreshCalls)
	}

	personaRef, err := compactRealmMaterializationVectorSourceRef(t, "persona-character")
	if err != nil {
		t.Fatalf("load compact PersonaCharacter source ref: %v", err)
	}
	personaVector := loadSourceMaterializationReferenceVectorV3(t, "persona-character")
	sourceMaterializationProducerCeilingsV3 = personaVector.Expectation.PublishedLimits
	personaRequest := request
	personaRequest.Ordinal = 1
	personaRequest.PartitionKey = strings.Repeat("c", 64)
	personaRequest.Source.Kind = personaRef.Kind
	personaRequest.Source.ID = personaRef.ID
	personaRequest.Source.WorldID = personaRef.WorldID
	personaRequest.Source.SourceHash = personaRef.SourceHash
	personaRequest.Source.SourceRef = personaRef
	personaRequest.Source.SourceRefHash, err = realmV3FullDataCanonicalDomainHashV1("nimi.realm-v3-full-data-source-ref/v1", personaRef)
	if err != nil {
		t.Fatalf("hash compact PersonaCharacter source ref: %v", err)
	}
	personaEvidence := runRealmV3FullDataLivePartitionV1(t, personaRequest)
	if personaEvidence.Materialization.LocalAgentRefHash == evidence.Materialization.LocalAgentRefHash ||
		refreshCalls != 1 || personaEvidence.Atomicity.PartialProductMutations != 0 {
		t.Fatalf("shared Runtime World/Persona materialization is incomplete: persona=%+v refreshCalls=%d", personaEvidence, refreshCalls)
	}
	realm.assertExactSuccessfulLifecycle(t, 3)
	offlineCalls := realm.callCount()
	personaRequest.Stage = realmV3FullDataRestartStageV1
	restart := runRealmV3FullDataRestartPartitionWithDenominatorV1(t, personaRequest, 2)
	if restart.ColdStarts != 2 || !restart.RealmOffline || restart.RealmRequestsWhileOffline != 0 ||
		restart.SourceRebased || restart.OrphanLocalAgents != 0 || restart.OrphanSnapshots != 0 ||
		restart.OrphanProvenance != 0 || restart.AccountCustodyResidue != 0 ||
		!reflect.DeepEqual(restart.Materialization, personaEvidence.Materialization) {
		t.Fatalf("hermetic full-data restart evidence is incomplete: %+v", restart)
	}
	if realm.callCount() != offlineCalls {
		t.Fatalf("full-data restart contacted Realm: calls=%d want=%d", realm.callCount(), offlineCalls)
	}
	if _, err := os.Lstat(realmV3FullDataAttemptLedgerPathV1(runtimeRoot, personaRequest.PartitionKey)); err != nil {
		t.Fatalf("restart removed resumable attempt ledger before receipt durability: %v", err)
	}
	if _, err := os.Lstat(realmV3FullDataAuditJournalPathV1(runtimeRoot, personaRequest.PartitionKey, 1)); err != nil {
		t.Fatalf("restart removed resumable audit journal before receipt durability: %v", err)
	}
	// Discard the first return value as if the worker crashed before its caller
	// durably installed the restart receipt. The same partition must replay from
	// retained non-secret evidence without Realm traffic or product mutation.
	resumedRestart := runRealmV3FullDataRestartPartitionWithDenominatorV1(t, personaRequest, 2)
	if !reflect.DeepEqual(resumedRestart, restart) || realm.callCount() != offlineCalls {
		t.Fatalf("restart receipt crash window was not resumable: resumed=%+v calls=%d", resumedRestart, realm.callCount())
	}
}

func TestRealmV3FullDataReceiptContentHashMatchesRunnerCanonicalDomain(t *testing.T) {
	receipt := realmV3FullDataPartitionReceiptV1{
		SchemaVersion: realmV3FullDataPartitionReceiptSchemaV1,
		Stage:         realmV3FullDataLiveStageV1,
		InputDigest:   "input",
		PartitionKey:  "partition",
		Ordinal:       7,
		Source: realmV3FullDataReceiptSourceV1{
			Kind: "worldCharacter", ID: "world-1", SourceHash: "source", SourceRefHash: "ref",
		},
		Status: "PASS", ReasonCode: "passed",
		Evidence: map[string]any{"z": 2, "a": []any{"x", true, nil}},
	}
	want := "bfe021f59306617c222e59c92f3174a47bc3582ab67a7eba17f31802c5b20048"
	got, err := realmV3FullDataReceiptContentHashV1(receipt)
	if err != nil {
		t.Fatalf("hash fixed full-data receipt: %v", err)
	}
	if got != want {
		t.Fatalf("full-data receipt domain hash=%s, want runner-compatible %s", got, want)
	}
	receipt.ContentHash = strings.Repeat("f", 64)
	coveredOnly, err := realmV3FullDataReceiptContentHashV1(receipt)
	if err != nil || coveredOnly != want {
		t.Fatalf("contentHash must be excluded from its own coverage: got=%s err=%v", coveredOnly, err)
	}
}

func TestRealmV3FullDataRuntimeRootMarkerMatchesRunnerClosedContract(t *testing.T) {
	domainFixture, err := realmV3FullDataCanonicalDomainHashV1(
		realmV3FullDataRuntimeMarkerSchemaV1,
		"/tmp/realm-v3-cross-contract",
	)
	if err != nil {
		t.Fatalf("hash fixed runner runtime root fixture: %v", err)
	}
	if want := "680c2b687e3ea3c9929b9749e8341ebb52d08f3abca6847720d71c4ebfb6b896"; domainFixture != want {
		t.Fatalf("runtime root domain hash=%s, want Node runner fixture %s", domainFixture, want)
	}

	runtimeRoot := t.TempDir()
	if err := os.Chmod(runtimeRoot, 0o700); err != nil {
		t.Fatalf("protect runtime-root marker fixture: %v", err)
	}
	request := realmV3FullDataPartitionRequestV1{
		InputDigest: strings.Repeat("a", 64), RuntimeDataRoot: &runtimeRoot,
		LiveEnvironment: &realmV3FullDataLiveEnvironmentV1{
			CanonicalRealmBaseURL:          "https://realm.example",
			CanonicalTokenURL:              "https://realm.example/api/auth/oauth/token",
			ExpectedIssuer:                 "https://realm.example",
			MaterializerAccountIDHash:      strings.Repeat("b", 64),
			ServerExportAttestationDigest:  strings.Repeat("c", 64),
			DisposableSourceInstanceDigest: strings.Repeat("d", 64),
		},
	}
	want := realmV3FullDataExpectedRuntimeRootMarkerV1(t, request, runtimeRoot)
	markerPath := filepath.Join(runtimeRoot, "runner-marker.json")
	writeRealmV3FullDataPrivateJSONV1(t, markerPath, want)
	if err := validateRealmV3FullDataRuntimeRootMarkerV1(markerPath, want); err != nil {
		t.Fatalf("worker rejected the runner four-field marker: %v", err)
	}
	mismatch := want
	mismatch.RuntimeDataRootDigest = strings.Repeat("e", 64)
	if err := validateRealmV3FullDataRuntimeRootMarkerV1(markerPath, mismatch); err == nil {
		t.Fatal("worker admitted a mismatched runner marker")
	}
	unknownPath := filepath.Join(runtimeRoot, "runner-marker-unknown.json")
	writeRealmV3FullDataPrivateJSONV1(t, unknownPath, map[string]any{
		"schemaVersion": want.SchemaVersion, "inputDigest": want.InputDigest,
		"runtimeDataRootDigest": want.RuntimeDataRootDigest, "liveEnvironmentDigest": want.LiveEnvironmentDigest,
		"unknown": true,
	})
	if err := validateRealmV3FullDataRuntimeRootMarkerV1(unknownPath, want); err == nil {
		t.Fatal("worker admitted an unknown runner marker field")
	}
}

func TestRealmV3FullDataCustodyClearEnumeratesCrashTemps(t *testing.T) {
	runtimeRoot := t.TempDir()
	custody := realmV3FullDataCustodyV1(runtimeRoot)
	crashTemp := custody.path + ".tmp-crash-token"
	if err := os.WriteFile(crashTemp, []byte(`{"accessToken":"must-be-deleted"}`), 0o600); err != nil {
		t.Fatalf("create simulated custody crash temp: %v", err)
	}
	if residue, err := custody.residue(); err != nil || residue != 1 {
		t.Fatalf("custody crash temp residue=%d err=%v, want 1", residue, err)
	}
	if err := custody.Clear(context.Background(), ""); err != nil {
		t.Fatalf("clear enumerated custody crash temp: %v", err)
	}
	if residue, err := custody.residue(); err != nil || residue != 0 {
		t.Fatalf("custody residue after crash-temp clear=%d err=%v", residue, err)
	}
	if _, err := os.Lstat(crashTemp); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("custody crash temp survived clear: %v", err)
	}

	if runtime.GOOS != "windows" {
		unsafeTarget := filepath.Join(runtimeRoot, "unsafe-target")
		if err := os.WriteFile(unsafeTarget, []byte("not custody"), 0o600); err != nil {
			t.Fatalf("create custody symlink target: %v", err)
		}
		unsafeLink := custody.path + ".tmp-symlink"
		if err := os.Symlink(unsafeTarget, unsafeLink); err != nil {
			t.Fatalf("create simulated custody temp symlink: %v", err)
		}
		if _, err := custody.residue(); !errors.Is(err, accountservice.ErrCustodyUnavailable) {
			t.Fatalf("custody residue admitted a symlink temp: %v", err)
		}
		if err := custody.Clear(context.Background(), ""); !errors.Is(err, accountservice.ErrCustodyUnavailable) {
			t.Fatalf("custody clear admitted a symlink temp: %v", err)
		}
		if raw, err := os.ReadFile(unsafeTarget); err != nil || string(raw) != "not custody" {
			t.Fatalf("custody rejection changed symlink target: raw=%q err=%v", raw, err)
		}
		if err := os.Remove(unsafeLink); err != nil {
			t.Fatalf("remove simulated custody temp symlink: %v", err)
		}

		unsafeMode := custody.path + ".tmp-unsafe-mode"
		if err := os.WriteFile(unsafeMode, []byte("token"), 0o600); err != nil {
			t.Fatalf("create simulated custody mode temp: %v", err)
		}
		if err := os.Chmod(unsafeMode, 0o640); err != nil {
			t.Fatalf("weaken simulated custody temp mode: %v", err)
		}
		if _, err := custody.residue(); !errors.Is(err, accountservice.ErrCustodyUnavailable) {
			t.Fatalf("custody residue admitted an unsafe-mode temp: %v", err)
		}
		if err := custody.Clear(context.Background(), ""); !errors.Is(err, accountservice.ErrCustodyUnavailable) {
			t.Fatalf("custody clear admitted an unsafe-mode temp: %v", err)
		}
	}
}

func TestRealmV3FullDataWorkerConcurrentReplayAndConflictingIntent(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	previousCeilings := sourceMaterializationProducerCeilingsV3
	sourceMaterializationProducerCeilingsV3 = vector.Expectation.PublishedLimits
	t.Cleanup(func() { sourceMaterializationProducerCeilingsV3 = previousCeilings })
	realm := newCompactRealmMaterializationServer(t, now)
	realm.mu.Lock()
	currentKey, currentKeyID := realm.currentKey, realm.currentKeyID
	realm.mu.Unlock()
	realm.packetMutation = func(packet []byte) ([]byte, error) {
		return realmV3FullDataRebindPacketPolicyV1(packet, currentKey, currentKeyID, compactRealmMaterializationPolicyDigest)
	}
	server := httptest.NewServer(realm)
	t.Cleanup(server.Close)
	account := newCompactRealmMaterializationAccount(t, server, now)
	service, closeService := openRealmV3FullDataRuntimeServiceV1(t, t.TempDir(), strings.Repeat("f", 64))
	defer closeService()
	service.SetRealmSourceMaterializationIssuer(&compactRealmMaterializationAccountIssuer{
		account: account, expectedIssuer: vector.Expectation.Issuer,
	})
	ref, err := compactRealmMaterializationVectorSourceRef(t, "world-character")
	if err != nil {
		t.Fatalf("load concurrent full-data source ref: %v", err)
	}
	request := realmV3FullDataPartitionRequestV1{PartitionKey: strings.Repeat("9", 64)}
	request.Source.SourceRef = ref
	ctx := sourceMaterializationTransportTestContext("materializer-1")
	type result struct {
		response *runtimev1.MaterializeRealmSourceResponse
		err      error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	var workers sync.WaitGroup
	for index := 0; index < 2; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			response, err := service.MaterializeRealmSource(
				ctx,
				realmV3FullDataMaterializeRequestV1(request, "materializer-1"),
			)
			results <- result{response: response, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	var responses []*runtimev1.MaterializeRealmSourceResponse
	for item := range results {
		if item.err != nil || item.response == nil ||
			item.response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
			t.Fatalf("concurrent same-request materialization failed: response=%+v err=%v", item.response, item.err)
		}
		responses = append(responses, item.response)
	}
	if len(responses) != 2 || responses[0].GetLocalAgentRef() == "" ||
		responses[0].GetLocalAgentRef() != responses[1].GetLocalAgentRef() ||
		responses[0].GetIdempotentReplay() == responses[1].GetIdempotentReplay() {
		t.Fatalf("concurrent same request did not converge to one product/replay: %+v", responses)
	}
	realm.assertExactSuccessfulLifecycle(t, 1)
	localAgentRef := responses[0].GetLocalAgentRef()
	_ = inspectRealmV3FullDataAtomicityV1(
		t,
		service,
		"materializer-1",
		realmV3FullDataRequestIDV1(request),
		localAgentRef,
	)
	beforeConflictCalls := realm.callCount()
	personaRef, err := compactRealmMaterializationVectorSourceRef(t, "persona-character")
	if err != nil {
		t.Fatalf("load conflicting full-data source ref: %v", err)
	}
	conflict := request
	conflict.Source.SourceRef = personaRef
	conflictResponse, conflictErr := service.MaterializeRealmSource(
		ctx,
		realmV3FullDataMaterializeRequestV1(conflict, "materializer-1"),
	)
	if conflictErr != nil || conflictResponse == nil ||
		conflictResponse.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_CONFLICT ||
		conflictResponse.GetLocalAgentRef() != "" {
		t.Fatalf("conflicting same request id did not fail closed: response=%+v err=%v", conflictResponse, conflictErr)
	}
	if realm.callCount() != beforeConflictCalls {
		t.Fatalf("conflicting same request id reached Realm: calls=%d want=%d", realm.callCount(), beforeConflictCalls)
	}
	counts := inspectRealmV3FullDataGlobalResidueV1(t, service)
	if counts.LocalAgents != 1 || counts.Snapshots != 1 || counts.Provenance != 1 ||
		counts.CommittedAttempts != 1 || counts.ReplayBindings != 1 || counts.ActiveAttempts != 0 ||
		counts.RawTransportResidue != 0 || counts.OrphanLocalAgents != 0 ||
		counts.OrphanSnapshots != 0 || counts.OrphanProvenance != 0 {
		t.Fatalf("conflicting same request id changed product/residue: %+v", counts)
	}
}

func TestRealmV3FullDataPreparedJournalAndGenerationStateFailClosed(t *testing.T) {
	t.Run("prepared journal rejects hash phase and binding mutation", func(t *testing.T) {
		root := t.TempDir()
		request := realmV3FullDataClosedStateTestRequestV1(root)
		requestID := realmV3FullDataGenerationRequestIDV1(request, 1)
		journal := realmV3FullDataClosedStateTestJournalV2(request, 1, requestID)
		if err := validateRealmV3FullDataAuditJournalV2(journal, request, 1, requestID); err != nil {
			t.Fatalf("valid prepared journal rejected: %v", err)
		}
		target := realmV3FullDataAuditJournalPathV1(root, request.PartitionKey, 1)
		if err := writeRealmV3FullDataAuditJournalAtomicV2(target, journal, false); err != nil {
			t.Fatalf("write prepared journal: %v", err)
		}
		stored, err := readRealmV3FullDataAuditJournalFileV2(target)
		if err != nil {
			t.Fatalf("read prepared journal: %v", err)
		}
		corrupt := stored
		corrupt.ContentHash = strings.Repeat("0", 64)
		if err := writeRealmV3FullDataPrivateJSONAtomicV1(target, corrupt); err != nil {
			t.Fatalf("write corrupt journal fixture: %v", err)
		}
		if _, err := readRealmV3FullDataAuditJournalFileV2(target); err == nil {
			t.Fatal("content-hash-mutated prepared journal was admitted")
		}
		if err := writeRealmV3FullDataPrivateJSONAtomicV1(target, stored); err != nil {
			t.Fatalf("restore prepared journal: %v", err)
		}
		mutations := []struct {
			name   string
			mutate func(*realmV3FullDataAuditJournalV2)
		}{
			{"phase", func(value *realmV3FullDataAuditJournalV2) { value.Phase = "committed" }},
			{"generation", func(value *realmV3FullDataAuditJournalV2) { value.Generation++ }},
			{"request hash", func(value *realmV3FullDataAuditJournalV2) { value.AttemptRequestIDHash = strings.Repeat("f", 64) }},
			{"input binding", func(value *realmV3FullDataAuditJournalV2) { value.InputDigest = strings.Repeat("e", 64) }},
			{"prepared product", func(value *realmV3FullDataAuditJournalV2) {
				hash := strings.Repeat("d", 64)
				value.LocalAgentRefHash = &hash
			}},
		}
		for _, mutation := range mutations {
			t.Run(mutation.name, func(t *testing.T) {
				candidate := journal
				mutation.mutate(&candidate)
				if err := validateRealmV3FullDataAuditJournalV2(candidate, request, 1, requestID); err == nil {
					t.Fatal("mutated prepared journal was admitted")
				}
			})
		}
		conflict := journal
		conflict.Transport.PacketHash = strings.Repeat("c", 64)
		if err := writeRealmV3FullDataAuditJournalAtomicV2(target, conflict, false); err == nil {
			t.Fatal("conflicting prepared journal overwrote immutable evidence")
		}
	})

	t.Run("uncertain active product replay and staging states are closed", func(t *testing.T) {
		cases := []struct {
			name         string
			state        string
			productRows  bool
			replayRows   bool
			staging      bool
			withPrepared bool
			wantRecovery bool
		}{
			{name: "requested crash without prepared", state: "requested", wantRecovery: true},
			{name: "acquiring crash without prepared", state: "acquiring", wantRecovery: true},
			{name: "acquiring crash with staging", state: "acquiring", staging: true, wantRecovery: true},
			{name: "committing crash without prepared", state: "committing", wantRecovery: true},
			{name: "committed without product", state: "committed", replayRows: true},
			{name: "committed without replay", state: "committed", productRows: true},
			{name: "terminal with replay residue", state: "failed", replayRows: true},
			{name: "staging residue without attempt", staging: true},
			{name: "strict prepared verifying crash", state: "verifying", withPrepared: true, wantRecovery: true},
		}
		for _, testCase := range cases {
			t.Run(testCase.name, func(t *testing.T) {
				root := t.TempDir()
				request := realmV3FullDataClosedStateTestRequestV1(root)
				requestID := realmV3FullDataGenerationRequestIDV1(request, 1)
				ledger := realmV3FullDataClosedStateTestLedgerV1(request, requestID)
				if err := writeRealmV3FullDataAttemptLedgerV1(realmV3FullDataAttemptLedgerPathV1(root, request.PartitionKey), ledger); err != nil {
					t.Fatalf("write active generation ledger: %v", err)
				}
				if testCase.state != "" {
					realmV3FullDataCreateInspectionDatabaseV1(t, root, "account-1", requestID, testCase.state, testCase.productRows, testCase.replayRows)
				}
				if testCase.staging {
					partition := sha256.Sum256([]byte("account-1\x00" + requestID))
					staging := filepath.Join(root, realmSourceMaterializationStagingDirectoryV3, hex.EncodeToString(partition[:]))
					if err := os.MkdirAll(staging, 0o700); err != nil {
						t.Fatalf("create uncertain staging: %v", err)
					}
					if err := os.WriteFile(filepath.Join(staging, "transport"), []byte("private"), 0o600); err != nil {
						t.Fatalf("write uncertain staging: %v", err)
					}
				}
				if testCase.withPrepared {
					journal := realmV3FullDataClosedStateTestJournalV2(request, 1, requestID)
					if err := writeRealmV3FullDataAuditJournalAtomicV2(
						realmV3FullDataAuditJournalPathV1(root, request.PartitionKey, 1), journal, false,
					); err != nil {
						t.Fatalf("write prepared crash journal: %v", err)
					}
				}
				_, _, _, recovery, err := prepareRealmV3FullDataAttemptGenerationV1(request, root, "account-1")
				if testCase.wantRecovery {
					if err != nil || !recovery {
						t.Fatalf("strict prepared verifying crash was not isolated for Runtime recovery: recovery=%v err=%v", recovery, err)
					}
				} else if err == nil || recovery {
					t.Fatalf("uncertain generation was admitted: recovery=%v err=%v", recovery, err)
				}
			})
		}
	})

	t.Run("private atomic state syncs file and parent directory", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Chmod(root, 0o700); err != nil {
			t.Fatalf("protect private state fixture root: %v", err)
		}
		target := filepath.Join(root, "closed", "state.json")
		if err := writeRealmV3FullDataPrivateJSONAtomicV1(target, map[string]string{"state": "closed"}); err != nil {
			t.Fatalf("write parent-synced private state: %v", err)
		}
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() ||
			validateRealmV3FullDataPrivatePathOwnerV1(target, info, false) != nil {
			t.Fatalf("parent-synced private state mode is invalid: info=%v err=%v", info, err)
		}
		if err := syncRealmV3FullDataParentDirectoryV1(filepath.Join(t.TempDir(), "missing", "state.json")); err == nil {
			t.Fatal("parent directory sync silently admitted a missing directory")
		}
		if runtime.GOOS != "windows" {
			permissive := filepath.Join(t.TempDir(), "permissive")
			if err := os.Mkdir(permissive, 0o700); err != nil || os.Chmod(permissive, 0o755) != nil {
				t.Fatalf("create permissive directory fixture: %v", err)
			}
			if err := writeRealmV3FullDataPrivateJSONAtomicV1(filepath.Join(permissive, "state.json"), map[string]bool{"closed": true}); err == nil {
				t.Fatal("private state writer admitted a permissive parent directory")
			}
			symlinkRoot := t.TempDir()
			realDirectory := filepath.Join(symlinkRoot, "real")
			if err := os.Mkdir(realDirectory, 0o700); err != nil {
				t.Fatalf("create symlink directory fixture: %v", err)
			}
			symlinkDirectory := filepath.Join(symlinkRoot, "link")
			if err := os.Symlink(realDirectory, symlinkDirectory); err != nil {
				t.Fatalf("create symlink directory fixture: %v", err)
			}
			if err := writeRealmV3FullDataPrivateJSONAtomicV1(filepath.Join(symlinkDirectory, "state.json"), map[string]bool{"closed": true}); err == nil {
				t.Fatal("private state writer admitted a symlink parent directory")
			}
		}
	})

	t.Run("failure and pass receipts share the durable private commit path", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Chmod(root, 0o700); err != nil {
			t.Fatalf("protect receipt fixture root: %v", err)
		}
		target := filepath.Join(root, "receipts", "partition.json")
		receipt := realmV3FullDataPartitionReceiptV1{
			SchemaVersion: realmV3FullDataPartitionReceiptSchemaV1,
			Stage:         realmV3FullDataLiveStageV1,
			InputDigest:   strings.Repeat("a", 64),
			PartitionKey:  strings.Repeat("b", 64),
			Status:        "FAIL",
			ReasonCode:    "process_interrupted",
			Evidence:      map[string]any{},
		}
		writeRealmV3FullDataReceiptV1(t, target, receipt)
		var failed realmV3FullDataPartitionReceiptV1
		readRealmV3FullDataPrivateJSONV1(t, target, &failed)
		failedHash, err := realmV3FullDataReceiptContentHashV1(failed)
		if err != nil || failed.ContentHash != failedHash || failed.Status != "FAIL" {
			t.Fatalf("durable failure receipt is invalid: receipt=%+v hash=%s err=%v", failed, failedHash, err)
		}

		receipt.Status = "PASS"
		receipt.ReasonCode = "passed"
		receipt.Evidence = map[string]any{"closed": true}
		writeRealmV3FullDataReceiptV1(t, target, receipt)
		var passed realmV3FullDataPartitionReceiptV1
		readRealmV3FullDataPrivateJSONV1(t, target, &passed)
		passedHash, err := realmV3FullDataReceiptContentHashV1(passed)
		if err != nil || passed.ContentHash != passedHash || passed.Status != "PASS" || passed.ContentHash == failed.ContentHash {
			t.Fatalf("durable pass receipt is invalid: receipt=%+v hash=%s err=%v", passed, passedHash, err)
		}
		entries, err := os.ReadDir(filepath.Dir(target))
		if err != nil || len(entries) != 1 || entries[0].Name() != filepath.Base(target) {
			t.Fatalf("receipt commit left a crash temp or unexpected residue: entries=%v err=%v", entries, err)
		}
	})

	t.Run("runtime root owner keeps one stable lock inode across competitors", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Chmod(root, 0o700); err != nil {
			t.Fatalf("protect lock fixture root: %v", err)
		}
		ownerA, err := tryAcquireRealmV3FullDataRuntimeRootOwnerV1(root)
		if err != nil {
			t.Fatalf("owner A acquire: %v", err)
		}
		identityA, err := realmV3FullDataFileIdentityPlatformV1(ownerA.file)
		if err != nil {
			_ = ownerA.release()
			t.Fatalf("owner A lock identity: %v", err)
		}
		if ownerB, err := tryAcquireRealmV3FullDataRuntimeRootOwnerV1(root); err == nil {
			_ = ownerB.release()
			_ = ownerA.release()
			t.Fatal("owner B acquired while owner A held the stable inode")
		}
		if err := ownerA.release(); err != nil {
			t.Fatalf("owner A release: %v", err)
		}
		ownerC, err := tryAcquireRealmV3FullDataRuntimeRootOwnerV1(root)
		if err != nil {
			t.Fatalf("owner C acquire after A release: %v", err)
		}
		defer func() {
			if err := ownerC.release(); err != nil {
				t.Fatalf("owner C release: %v", err)
			}
		}()
		identityC, err := realmV3FullDataFileIdentityPlatformV1(ownerC.file)
		if err != nil || identityA != identityC {
			t.Fatalf("owner lock file identity changed across A/B/C: A=%s C=%s err=%v", identityA, identityC, err)
		}
		if _, err := os.Lstat(filepath.Join(root, realmV3FullDataRuntimeOwnerLockFileV1)); err != nil {
			t.Fatalf("stable runtime-root lock inode was unlinked: %v", err)
		}
	})

	t.Run("retired permission carriers fail before the network", func(t *testing.T) {
		candidates := map[string]struct {
			path string
			body string
		}{
			"permission endpoint":         {path: "/api/human/me/permission-grants", body: `{}`},
			"synthetic decision endpoint": {path: "/api/runtime/realm-grants/issue", body: `{}`},
			"packet app id":               {path: realmV3FullDataPacketOperationPathV1, body: `{"appId":"forbidden"}`},
			"packet permission scope":     {path: realmV3FullDataPacketOperationPathV1, body: `{"permissionScope":"forbidden"}`},
			"packet access carrier":       {path: realmV3FullDataPacketOperationPathV1, body: `{"accessGrantId":"forbidden"}`},
		}
		for name, fixture := range candidates {
			t.Run(name, func(t *testing.T) {
				candidate, err := http.NewRequest(http.MethodPost, "https://realm.example"+fixture.path, strings.NewReader(fixture.body))
				if err != nil {
					t.Fatalf("create forbidden request fixture: %v", err)
				}
				baseCalls := 0
				audit := newRealmV3FullDataHTTPAuditV1()
				audit.base = realmV3FullDataRoundTripFuncV1(func(*http.Request) (*http.Response, error) {
					baseCalls++
					return nil, errors.New("forbidden authorization carrier reached the network")
				})
				if _, err := audit.RoundTrip(candidate); err == nil || baseCalls != 0 {
					t.Fatalf("forbidden authorization carrier was admitted: err=%v baseCalls=%d", err, baseCalls)
				}
			})
		}
	})
}
