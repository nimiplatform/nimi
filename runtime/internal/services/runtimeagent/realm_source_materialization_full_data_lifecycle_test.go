//go:build realm_v3_full_data

package runtimeagent

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type realmV3FullDataAttemptLedgerV1 struct {
	SchemaVersion         string                               `json:"schemaVersion"`
	InputDigest           string                               `json:"inputDigest"`
	PartitionKey          string                               `json:"partitionKey"`
	SourceRefHash         string                               `json:"sourceRefHash"`
	LiveEnvironmentDigest string                               `json:"liveEnvironmentDigest"`
	Generations           []realmV3FullDataAttemptGenerationV1 `json:"generations"`
	ContentHash           string                               `json:"contentHash"`
}

type realmV3FullDataAuditJournalV2 struct {
	SchemaVersion              string                             `json:"schemaVersion"`
	Phase                      string                             `json:"phase"`
	InputDigest                string                             `json:"inputDigest"`
	PartitionKey               string                             `json:"partitionKey"`
	SourceRefHash              string                             `json:"sourceRefHash"`
	LiveEnvironmentDigest      string                             `json:"liveEnvironmentDigest"`
	Generation                 uint64                             `json:"generation"`
	AttemptRequestIDHash       string                             `json:"attemptRequestIdHash"`
	Authorization              realmV3FullDataLiveAuthorizationV1 `json:"authorization"`
	Transport                  realmV3FullDataExpectedTransportV1 `json:"transport"`
	LocalAgentRefHash          *string                            `json:"localAgentRefHash"`
	SnapshotHash               *string                            `json:"snapshotHash"`
	ProvenanceKeyHash          *string                            `json:"provenanceKeyHash"`
	CommittedAttemptPacketHash *string                            `json:"committedAttemptPacketHash"`
	ContentHash                string                             `json:"contentHash"`
}

type realmV3FullDataGenerationInspectionV1 struct {
	AttemptFound   bool
	AttemptState   string
	ProductRows    uint64
	ReplayRows     uint64
	ActiveRows     uint64
	StagingResidue uint64
}

func realmV3FullDataAttemptLedgerPathV1(runtimeRoot, partitionKey string) string {
	return filepath.Join(runtimeRoot, realmV3FullDataAttemptLedgerDirectoryV1, partitionKey+".json")
}

func realmV3FullDataGenerationRequestIDV1(request realmV3FullDataPartitionRequestV1, generation uint64) string {
	return realmV3FullDataRequestIDV1(request) + "-attempt-" + strconv.FormatUint(generation, 10)
}

func prepareRealmV3FullDataAttemptGenerationV1(
	request realmV3FullDataPartitionRequestV1,
	runtimeRoot string,
	accountID string,
) (realmV3FullDataAttemptLedgerV1, uint64, string, bool, error) {
	ledgerPath := realmV3FullDataAttemptLedgerPathV1(runtimeRoot, request.PartitionKey)
	ledger, found, err := readRealmV3FullDataAttemptLedgerV1(ledgerPath, request)
	if err != nil {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, err
	}
	if !found {
		requestID := realmV3FullDataGenerationRequestIDV1(request, 1)
		ledger = realmV3FullDataAttemptLedgerV1{
			SchemaVersion: realmV3FullDataAttemptLedgerSchemaV1, InputDigest: request.InputDigest,
			PartitionKey: request.PartitionKey, SourceRefHash: request.Source.SourceRefHash,
			LiveEnvironmentDigest: realmV3FullDataLiveEnvironmentDigestValueV1(request.LiveEnvironment),
			Generations: []realmV3FullDataAttemptGenerationV1{{
				Generation: 1, Status: realmV3FullDataAttemptStatusActiveV1,
				ReasonCode: "attempt_started", RequestIDHash: sha256HexBytes([]byte(requestID)),
			}},
		}
		if err := writeRealmV3FullDataAttemptLedgerV1(ledgerPath, ledger); err != nil {
			return realmV3FullDataAttemptLedgerV1{}, 0, "", false, err
		}
		return ledger, 1, requestID, false, nil
	}
	last := ledger.Generations[len(ledger.Generations)-1]
	requestID := realmV3FullDataGenerationRequestIDV1(request, last.Generation)
	inspection, err := inspectRealmV3FullDataGenerationV1(runtimeRoot, accountID, requestID)
	if err != nil {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, err
	}
	if inspection.ProductRows != 0 && inspection.AttemptState != "committed" {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("attempt generation has product state without a committed attempt")
	}
	if inspection.ReplayRows != 0 && inspection.AttemptState != "committed" {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("attempt generation has replay state without a committed attempt")
	}
	if inspection.AttemptState == "committed" {
		if inspection.ProductRows != 1 || inspection.ReplayRows != 1 || inspection.ActiveRows != 0 || inspection.StagingResidue != 0 {
			return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("committed generation has uncertain product/replay/staging state: %+v", inspection)
		}
		ledger.Generations[len(ledger.Generations)-1].Status = realmV3FullDataAttemptStatusCommittedV1
		ledger.Generations[len(ledger.Generations)-1].ReasonCode = "committed"
		if err := writeRealmV3FullDataAttemptLedgerV1(ledgerPath, ledger); err != nil {
			return realmV3FullDataAttemptLedgerV1{}, 0, "", false, err
		}
		return ledger, last.Generation, requestID, false, nil
	}
	if last.Status == realmV3FullDataAttemptStatusCommittedV1 {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("committed generation lost its immutable Runtime product")
	}
	if inspection.ActiveRows != 0 {
		preparedPath := realmV3FullDataAuditJournalPathV1(runtimeRoot, request.PartitionKey, last.Generation)
		prepared, journalErr := readRealmV3FullDataAuditJournalFileV2(preparedPath)
		if journalErr == nil {
			if prepared.Phase != realmV3FullDataAuditPhasePreparedV2 ||
				validateRealmV3FullDataAuditJournalV2(prepared, request, last.Generation, requestID) != nil {
				return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("active generation has mutated prepared evidence")
			}
		} else if !errors.Is(journalErr, os.ErrNotExist) {
			return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("inspect active generation prepared evidence: %w", journalErr)
		}
		if inspection.AttemptState != "requested" && inspection.AttemptState != "acquiring" &&
			inspection.AttemptState != "verifying" && inspection.AttemptState != "committing" {
			return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("active generation state %q is not attributable", inspection.AttemptState)
		}
		return ledger, last.Generation, requestID, true, nil
	}
	if inspection.ProductRows != 0 || inspection.ReplayRows != 0 || inspection.StagingResidue != 0 {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("terminal generation is not clean: %+v", inspection)
	}
	if inspection.AttemptFound && inspection.AttemptState != "failed" && inspection.AttemptState != "aborted" && inspection.AttemptState != "expired" {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, fmt.Errorf("attempt generation state %q is not terminal", inspection.AttemptState)
	}
	if last.Status == realmV3FullDataAttemptStatusActiveV1 {
		ledger.Generations[len(ledger.Generations)-1].Status = realmV3FullDataAttemptStatusFailedV1
		if inspection.AttemptFound {
			ledger.Generations[len(ledger.Generations)-1].ReasonCode = "runtime_" + inspection.AttemptState
		} else {
			ledger.Generations[len(ledger.Generations)-1].ReasonCode = "crash_before_runtime_attempt"
		}
	}
	nextGeneration := last.Generation + 1
	nextRequestID := realmV3FullDataGenerationRequestIDV1(request, nextGeneration)
	ledger.Generations = append(ledger.Generations, realmV3FullDataAttemptGenerationV1{
		Generation: nextGeneration, Status: realmV3FullDataAttemptStatusActiveV1,
		ReasonCode: "attempt_started", RequestIDHash: sha256HexBytes([]byte(nextRequestID)),
	})
	if err := writeRealmV3FullDataAttemptLedgerV1(ledgerPath, ledger); err != nil {
		return realmV3FullDataAttemptLedgerV1{}, 0, "", false, err
	}
	return ledger, nextGeneration, nextRequestID, false, nil
}

func inspectRealmV3FullDataGenerationV1(runtimeRoot, accountID, requestID string) (realmV3FullDataGenerationInspectionV1, error) {
	result := realmV3FullDataGenerationInspectionV1{}
	stagingPartition := sha256.Sum256([]byte(accountID + "\x00" + requestID))
	stagingPath := filepath.Join(runtimeRoot, realmSourceMaterializationStagingDirectoryV3, hex.EncodeToString(stagingPartition[:]))
	entries, err := os.ReadDir(stagingPath)
	if err == nil {
		result.StagingResidue = uint64(len(entries))
		if result.StagingResidue == 0 {
			result.StagingResidue = 1
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return result, fmt.Errorf("inspect attempt generation staging: %w", err)
	}
	databasePath := filepath.Join(runtimeRoot, "memory.db")
	if _, err := os.Lstat(databasePath); errors.Is(err, os.ErrNotExist) {
		return result, nil
	} else if err != nil {
		return result, fmt.Errorf("inspect Runtime database: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+url.PathEscape(databasePath)+"?mode=ro&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)")
	if err != nil {
		return result, fmt.Errorf("open Runtime database read-only: %w", err)
	}
	defer db.Close()
	err = db.QueryRow(`
		SELECT state FROM runtime_realm_source_materialization_attempt_v3
		WHERE materializer_account_id = ? AND request_id = ?
	`, accountID, requestID).Scan(&result.AttemptState)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	} else if err == nil {
		result.AttemptFound = true
	} else {
		return result, fmt.Errorf("read attempt generation state: %w", err)
	}
	for destination, query := range map[*uint64]string{
		&result.ProductRows: `
			SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3 AS attempt
			JOIN runtime_local_agent AS agent ON agent.local_agent_ref = attempt.local_agent_ref
			JOIN runtime_local_agent_source_snapshot_v2 AS snapshot ON snapshot.local_agent_ref = agent.local_agent_ref
			JOIN runtime_local_agent_source_provenance_v3 AS provenance ON provenance.local_agent_ref = agent.local_agent_ref
			WHERE attempt.materializer_account_id = ? AND attempt.request_id = ?`,
		&result.ReplayRows: `SELECT COUNT(*) FROM runtime_realm_source_materialization_replay_v3 WHERE materializer_account_id = ? AND request_id = ?`,
		&result.ActiveRows: `SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3 WHERE materializer_account_id = ? AND request_id = ? AND state IN ('requested','acquiring','verifying','committing')`,
	} {
		if err := db.QueryRow(query, accountID, requestID).Scan(destination); err != nil {
			return result, fmt.Errorf("inspect attempt generation cardinality: %w", err)
		}
	}
	return result, nil
}

func runRealmV3FullDataLivePartitionV1(t *testing.T, request realmV3FullDataPartitionRequestV1) realmV3FullDataLiveEvidenceV1 {
	t.Helper()
	validateRealmV3FullDataLiveEnvironmentV1(t, request.LiveEnvironment)
	for _, name := range []string{
		"NIMI_REALM_V3_LIVE_BASE_URL", "NIMI_REALM_V3_LIVE_TOKEN_URL",
		"NIMI_REALM_V3_LIVE_ACCOUNT_ID", "NIMI_REALM_V3_LIVE_EXPECTED_ISSUER",
		"NIMI_REALM_V3_LIVE_POLICY_DIGEST",
	} {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			t.Fatalf("mandatory current Realm input %s is missing", name)
		}
	}
	if os.Getenv("NIMI_REALM_V3_LIVE_BASE_URL") != request.LiveEnvironment.CanonicalRealmBaseURL ||
		os.Getenv("NIMI_REALM_V3_LIVE_TOKEN_URL") != request.LiveEnvironment.CanonicalTokenURL ||
		os.Getenv("NIMI_REALM_V3_LIVE_EXPECTED_ISSUER") != request.LiveEnvironment.ExpectedIssuer {
		t.Fatal("current Realm authority URLs differ from the frozen live environment")
	}
	if os.Getenv("NIMI_REALM_V3_LIVE_POLICY_DIGEST") != request.Identity.Realm.PolicyDigest {
		t.Fatal("current Realm live policy digest differs from the frozen partition")
	}
	accountID := strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID"))
	if os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID") != accountID ||
		sha256HexBytes([]byte(accountID)) != request.LiveEnvironment.MaterializerAccountIDHash {
		t.Fatal("current Realm materializer account differs from the frozen live environment")
	}
	realmV3FullDataValidateTokenAuthorityV1(t,
		os.Getenv("NIMI_REALM_V3_LIVE_BASE_URL"),
		os.Getenv("NIMI_REALM_V3_LIVE_TOKEN_URL"),
	)
	runtimeRoot := prepareRealmV3FullDataRuntimeRootV1(t, request)
	releaseRuntimeOwner := acquireRealmV3FullDataRuntimeRootOwnerV1(t, runtimeRoot)
	defer releaseRuntimeOwner()
	ledger, generation, attemptRequestID, needsRuntimeRecovery, err := prepareRealmV3FullDataAttemptGenerationV1(
		request, runtimeRoot, accountID,
	)
	if err != nil {
		t.Fatalf("prepare closed full-data attempt generation: %v", err)
	}
	if needsRuntimeRecovery {
		recoveryService, closeRecoveryService := openRealmV3FullDataRuntimeServiceV1(t, runtimeRoot, request.InputDigest)
		closeRecoveryService()
		_ = recoveryService
		ledger, generation, attemptRequestID, needsRuntimeRecovery, err = prepareRealmV3FullDataAttemptGenerationV1(
			request, runtimeRoot, accountID,
		)
		if err != nil || needsRuntimeRecovery {
			t.Fatalf("close recovered precommit attempt generation: recovery=%v err=%v", needsRuntimeRecovery, err)
		}
	}
	custody := realmV3FullDataCustodyV1(runtimeRoot)
	if initializedAccountID := initializeRealmV3FullDataAccountCustodyV1(t, custody); initializedAccountID != accountID {
		t.Fatal("shared full-data custody changed the frozen materializer account")
	}

	runtimeInstanceID := "realm-v3-full-data-" + request.InputDigest
	journalPath := realmV3FullDataAuditJournalPathV1(runtimeRoot, request.PartitionKey, generation)
	audit := newRealmV3FullDataHTTPAuditV1(realmV3FullDataAuditPreparationV1{
		Request: request, JournalPath: journalPath, Generation: generation,
		AttemptRequestID: attemptRequestID, AccountID: accountID, RuntimeInstanceID: runtimeInstanceID,
	})
	httpClient := &http.Client{Transport: audit, Timeout: 30 * time.Second}
	account := accountservice.NewProduction(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		accountservice.ProductionConfig{
			RealmBaseURL:     strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_BASE_URL")),
			TokenURL:         strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_TOKEN_URL")),
			CustodyPartition: "runtime-account:realm-v3-full-data-" + request.InputDigest,
			Custody:          custody,
			HTTPClient:       httpClient,
		},
	)
	issuer := &compactRealmMaterializationAccountIssuer{
		account: account, expectedIssuer: request.LiveEnvironment.ExpectedIssuer,
	}

	service, closeService := openRealmV3FullDataRuntimeServiceV1(t, runtimeRoot, request.InputDigest)
	defer closeService()
	service.SetRealmSourceMaterializationIssuer(issuer)
	ctx := sourceMaterializationTransportTestContext(accountID)
	materializeRequest := realmV3FullDataMaterializeRequestForGenerationV1(request, accountID, generation)
	response, materializeErr := service.MaterializeRealmSource(ctx, materializeRequest)
	if materializeErr != nil || response == nil ||
		response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE ||
		strings.TrimSpace(response.GetLocalAgentRef()) == "" || response.GetSourceContextStatus() == nil ||
		!response.GetSourceContextStatus().GetReady() {
		var failureCode string
		_ = service.backend.DB().QueryRow(`
			SELECT failure_code FROM runtime_realm_source_materialization_attempt_v3
			WHERE materializer_account_id = ? AND request_id = ?
		`, accountID, attemptRequestID).Scan(&failureCode)
		audit.mu.Lock()
		auditFailure := audit.protocolErr
		audit.mu.Unlock()
		if markErr := markRealmV3FullDataGenerationFailedV1(runtimeRoot, request, generation, failureCode); markErr != nil {
			t.Fatalf("current Realm partition materialization failed and generation could not close: response=%+v err=%v failure=%s audit=%v close=%v", response, materializeErr, failureCode, auditFailure, markErr)
		}
		t.Fatalf("current Realm partition materialization failed: response=%+v err=%v failure=%s audit=%v", response, materializeErr, failureCode, auditFailure)
	}

	store, err := newRealmSourceSnapshotV2Store(service.backend.DB())
	if err != nil {
		t.Fatalf("open current Realm SnapshotV2 store: %v", err)
	}
	snapshot, found, err := store.sourceSnapshot(ctx, response.GetLocalAgentRef())
	if err != nil || !found {
		t.Fatalf("load current Realm SnapshotV2: found=%v err=%v", found, err)
	}
	assertRealmV3FullDataSnapshotSourceV1(t, snapshot, request)
	materialization := compileRealmV3FullDataMaterializationV1(t, snapshot)
	materialization.LocalAgentRefHash = sha256HexBytes([]byte(response.GetLocalAgentRef()))

	journal, err := sealRealmV3FullDataCommittedAuditJournalV2(
		service, journalPath, request, generation, attemptRequestID, response.GetLocalAgentRef(), snapshot,
	)
	if err != nil {
		t.Fatalf("seal original precommit audit journal from immutable Runtime product: %v", err)
	}
	authorization := journal.Authorization
	transport := journal.Transport
	assertRealmV3FullDataTransportSnapshotParityV1(t, transport, snapshot, true)
	ledger, err = markRealmV3FullDataGenerationCommittedV1(runtimeRoot, request, generation)
	if err != nil {
		t.Fatalf("close committed full-data attempt generation: %v", err)
	}

	replayed, replayErr := service.MaterializeRealmSource(ctx, realmV3FullDataMaterializeRequestForGenerationV1(request, accountID, generation))
	if replayErr != nil || replayed == nil || !replayed.GetIdempotentReplay() ||
		replayed.GetLocalAgentRef() != response.GetLocalAgentRef() ||
		replayed.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		t.Fatalf("current Realm partition idempotent replay failed: response=%+v err=%v", replayed, replayErr)
	}
	atomicity := inspectRealmV3FullDataAtomicityV1(t, service, accountID, attemptRequestID, response.GetLocalAgentRef())
	return realmV3FullDataLiveEvidenceV1{
		EvidenceClass: "current_realm_live_materialization", AttemptGenerations: append([]realmV3FullDataAttemptGenerationV1(nil), ledger.Generations...), Authorization: authorization,
		Transport: transport, Materialization: materialization, Atomicity: atomicity,
	}
}

func realmV3FullDataValidateTokenAuthorityV1(t *testing.T, baseValue, tokenValue string) {
	t.Helper()
	base, baseErr := url.Parse(baseValue)
	token, tokenErr := url.Parse(tokenValue)
	if baseErr != nil || tokenErr != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" ||
		base.User != nil || token.User != nil || base.RawQuery != "" || token.RawQuery != "" ||
		base.ForceQuery || token.ForceQuery || base.Fragment != "" || token.Fragment != "" ||
		base.Opaque != "" || token.Opaque != "" || base.Path != "" || base.RawPath != "" || token.RawPath != "" ||
		token.Scheme != base.Scheme || token.Host != base.Host || token.Path != "/api/auth/oauth/token" {
		t.Fatalf("current Realm token authority is not the canonical same-origin endpoint: base=%v token=%v", baseErr, tokenErr)
	}
}

func runRealmV3FullDataRestartPartitionV1(t *testing.T, request realmV3FullDataPartitionRequestV1) realmV3FullDataRestartEvidenceV1 {
	t.Helper()
	return runRealmV3FullDataRestartPartitionWithDenominatorV1(t, request, realmV3FullDataDenominatorV1)
}

func runRealmV3FullDataRestartPartitionWithDenominatorV1(
	t *testing.T,
	request realmV3FullDataPartitionRequestV1,
	expectedProducts uint64,
) realmV3FullDataRestartEvidenceV1 {
	t.Helper()
	validateRealmV3FullDataLiveEnvironmentV1(t, request.LiveEnvironment)
	runtimeRoot := prepareRealmV3FullDataRuntimeRootV1(t, request)
	releaseRuntimeOwner := acquireRealmV3FullDataRuntimeRootOwnerV1(t, runtimeRoot)
	defer releaseRuntimeOwner()
	custody := realmV3FullDataCustodyV1(runtimeRoot)
	if err := custody.Clear(context.Background(), ""); err != nil {
		t.Fatalf("delete shared full-data account custody before offline restart: %v", err)
	}
	if residue, err := custody.residue(); err != nil || residue != 0 {
		t.Fatalf("shared full-data account custody residue=%d err=%v", residue, err)
	}
	accountID := strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID"))
	if accountID == "" || os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID") != accountID ||
		sha256HexBytes([]byte(accountID)) != request.LiveEnvironment.MaterializerAccountIDHash {
		t.Fatal("restart full-data request requires the non-secret frozen account identity")
	}
	ledgerPath := realmV3FullDataAttemptLedgerPathV1(runtimeRoot, request.PartitionKey)
	ledger, found, err := readRealmV3FullDataAttemptLedgerV1(ledgerPath, request)
	if err != nil || !found || len(ledger.Generations) == 0 {
		t.Fatalf("restart full-data request has no closed attempt ledger: found=%v err=%v", found, err)
	}
	committedGeneration := ledger.Generations[len(ledger.Generations)-1]
	if committedGeneration.Status != realmV3FullDataAttemptStatusCommittedV1 {
		t.Fatalf("restart full-data request generation is not committed: %+v", committedGeneration)
	}
	committedRequestID := realmV3FullDataGenerationRequestIDV1(request, committedGeneration.Generation)

	var admitted realmV3FullDataMaterializationEvidenceV1
	var finalCounts realmV3FullDataResidueCountsV1
	for coldStart := 1; coldStart <= 2; coldStart++ {
		service, closeService := openRealmV3FullDataRuntimeServiceV1(t, runtimeRoot, request.InputDigest)
		// Deliberately do not install a Realm issuer. Restart acceptance reads
		// immutable Runtime product state and cannot cross the Realm boundary.
		localAgentRef := realmV3FullDataCommittedLocalAgentRefV1(t, service, accountID, committedRequestID)
		store, err := newRealmSourceSnapshotV2Store(service.backend.DB())
		if err != nil {
			closeService()
			t.Fatalf("open restart SnapshotV2 store: %v", err)
		}
		snapshot, found, err := store.sourceSnapshot(context.Background(), localAgentRef)
		if err != nil || !found {
			closeService()
			t.Fatalf("cold start %d SnapshotV2 readback: found=%v err=%v", coldStart, found, err)
		}
		assertRealmV3FullDataSnapshotSourceV1(t, snapshot, request)
		compiled := compileRealmV3FullDataMaterializationV1(t, snapshot)
		compiled.LocalAgentRefHash = sha256HexBytes([]byte(localAgentRef))
		counts := inspectRealmV3FullDataGlobalResidueV1(t, service)
		if counts.LocalAgents != expectedProducts || counts.Snapshots != expectedProducts ||
			counts.Provenance != expectedProducts || counts.CommittedAttempts != expectedProducts ||
			counts.ReplayBindings != expectedProducts || counts.ActiveAttempts != 0 || counts.RawTransportResidue != 0 ||
			counts.OrphanLocalAgents != 0 || counts.OrphanSnapshots != 0 || counts.OrphanProvenance != 0 {
			closeService()
			t.Fatalf("cold start %d shared Runtime residue/cardinality mismatch: %+v", coldStart, counts)
		}
		if coldStart == 1 {
			admitted = compiled
		} else if !reflect.DeepEqual(admitted, compiled) {
			closeService()
			t.Fatalf("two cold starts changed SnapshotV2/five-lane semantics: first=%+v second=%+v", admitted, compiled)
		}
		finalCounts = counts
		closeService()
	}
	// Ledger and non-secret audit journals remain until the disposable runtime
	// root is removed by final aggregate cleanup. Deleting them here creates a
	// crash window in which restart passed but its receipt was not yet durable,
	// leaving the partition unable to resume or prove the admitted generation.
	if residue, err := custody.residue(); err != nil || residue != 0 {
		t.Fatalf("offline restart restored account custody: residue=%d err=%v", residue, err)
	}
	boundaryDigest, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-authorization-boundary/v1",
		request.AuthorizationBoundary,
	)
	if err != nil {
		t.Fatalf("hash restart authorization boundary: %v", err)
	}
	return realmV3FullDataRestartEvidenceV1{
		EvidenceClass: "runtime_restart_offline_readback", ColdStarts: 2,
		AttemptGenerations: append([]realmV3FullDataAttemptGenerationV1(nil), ledger.Generations...),
		RealmOffline:       true, RealmRequestsWhileOffline: 0, SourceRebased: false,
		Materialization: admitted, RawTransportResidue: finalCounts.RawTransportResidue,
		OrphanLocalAgents: finalCounts.OrphanLocalAgents, OrphanSnapshots: finalCounts.OrphanSnapshots,
		OrphanProvenance: finalCounts.OrphanProvenance, AccountCustodyResidue: 0,
		AuthorizationBoundaryDigest: boundaryDigest, AuthorizationStatePersisted: false,
	}
}

func realmV3FullDataRequestIDV1(request realmV3FullDataPartitionRequestV1) string {
	return "realm-v3-full-data-" + request.PartitionKey
}

func realmV3FullDataMaterializeRequestV1(
	request realmV3FullDataPartitionRequestV1,
	accountID string,
) *runtimev1.MaterializeRealmSourceRequest {
	return realmV3FullDataMaterializeRequestWithIDV1(request, accountID, realmV3FullDataRequestIDV1(request))
}

func realmV3FullDataMaterializeRequestForGenerationV1(
	request realmV3FullDataPartitionRequestV1,
	accountID string,
	generation uint64,
) *runtimev1.MaterializeRealmSourceRequest {
	return realmV3FullDataMaterializeRequestWithIDV1(request, accountID, realmV3FullDataGenerationRequestIDV1(request, generation))
}

func realmV3FullDataMaterializeRequestWithIDV1(
	request realmV3FullDataPartitionRequestV1,
	accountID string,
	requestID string,
) *runtimev1.MaterializeRealmSourceRequest {
	return &runtimev1.MaterializeRealmSourceRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId: "runtime-realm-v3-full-data", SubjectUserId: accountID, OwnerUserId: accountID,
		},
		RequestId: requestID,
		SourceRef: sourceMaterializationProtoRefV3(request.Source.SourceRef),
	}
}

func assertRealmV3FullDataSnapshotSourceV1(
	t *testing.T,
	snapshot localAgentSourceSnapshotV2,
	request realmV3FullDataPartitionRequestV1,
) {
	t.Helper()
	if !reflect.DeepEqual(snapshot.Semantic.SourceRef, request.Source.SourceRef) ||
		snapshot.Semantic.SourceHash != request.Source.SourceHash || snapshot.SnapshotSchemaVersion != realmV3FullDataSnapshotSchemaV2 {
		t.Fatal("SnapshotV2 does not bind the frozen CharacterSourceRefV3")
	}
}

func assertRealmV3FullDataTransportSnapshotParityV1(
	t *testing.T,
	transport realmV3FullDataExpectedTransportV1,
	snapshot localAgentSourceSnapshotV2,
	requireCommittedPacket bool,
) {
	t.Helper()
	if (requireCommittedPacket && (transport.PacketHash != snapshot.PacketHash ||
		transport.ClosureSetManifestHash != snapshot.Semantic.ClosureSetManifestHash)) ||
		transport.OrderedComponentSetHash != snapshot.Semantic.OrderedComponentSetHash ||
		transport.MaterializationContextHash != snapshot.Semantic.MaterializationContextHash ||
		transport.PayloadHash != snapshot.Semantic.PayloadHash {
		t.Fatal("HTTP Packet audit summary differs from immutable SnapshotV2")
	}
}

func realmV3FullDataAuditJournalPathV1(runtimeRoot, partitionKey string, generation uint64) string {
	return filepath.Join(
		runtimeRoot,
		realmV3FullDataAuditJournalDirectoryV1,
		partitionKey+"-attempt-"+strconv.FormatUint(generation, 10)+".json",
	)
}

func readRealmV3FullDataPrivateJSONFileV1(source string, target any) (bool, error) {
	info, err := os.Lstat(source)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 || info.Size() > 1<<20 {
		return false, fmt.Errorf("private full-data state is unavailable or insecure: %w", err)
	}
	file, err := os.Open(source)
	if err != nil {
		return false, fmt.Errorf("open private full-data state: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false, fmt.Errorf("decode private full-data state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return false, fmt.Errorf("private full-data state has trailing JSON")
	}
	return true, nil
}

func readRealmV3FullDataAuditJournalFileV2(target string) (realmV3FullDataAuditJournalV2, error) {
	var journal realmV3FullDataAuditJournalV2
	found, err := readRealmV3FullDataPrivateJSONFileV1(target, &journal)
	if err != nil {
		return realmV3FullDataAuditJournalV2{}, err
	}
	if !found {
		return realmV3FullDataAuditJournalV2{}, os.ErrNotExist
	}
	expected, err := realmV3FullDataAuditJournalContentHashV2(journal)
	if err != nil || !isLowerSHA256V3(journal.ContentHash) || expected != journal.ContentHash {
		return realmV3FullDataAuditJournalV2{}, fmt.Errorf("full-data audit journal content hash is invalid")
	}
	return journal, nil
}

func writeRealmV3FullDataAuditJournalAtomicV2(target string, journal realmV3FullDataAuditJournalV2, allowSeal bool) error {
	sealed, err := sealRealmV3FullDataAuditJournalV2(journal)
	if err != nil {
		return err
	}
	current, readErr := readRealmV3FullDataAuditJournalFileV2(target)
	if readErr == nil {
		if reflect.DeepEqual(current, sealed) {
			return nil
		}
		if !allowSeal || current.Phase != realmV3FullDataAuditPhasePreparedV2 || sealed.Phase != realmV3FullDataAuditPhaseSealedV2 ||
			!sameRealmV3FullDataAuditJournalPreparationV2(current, sealed) {
			return fmt.Errorf("full-data audit journal conflicts with immutable precommit evidence")
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	} else if sealed.Phase != realmV3FullDataAuditPhasePreparedV2 {
		return fmt.Errorf("sealed full-data audit journal cannot be synthesized without prepared evidence")
	}
	return writeRealmV3FullDataPrivateJSONAtomicV1(target, sealed)
}

func sameRealmV3FullDataAuditJournalPreparationV2(left, right realmV3FullDataAuditJournalV2) bool {
	left.Phase, right.Phase = "", ""
	left.LocalAgentRefHash, right.LocalAgentRefHash = nil, nil
	left.SnapshotHash, right.SnapshotHash = nil, nil
	left.ProvenanceKeyHash, right.ProvenanceKeyHash = nil, nil
	left.CommittedAttemptPacketHash, right.CommittedAttemptPacketHash = nil, nil
	left.ContentHash, right.ContentHash = "", ""
	return reflect.DeepEqual(left, right)
}

func validateRealmV3FullDataAuditJournalV2(
	journal realmV3FullDataAuditJournalV2,
	request realmV3FullDataPartitionRequestV1,
	generation uint64,
	requestID string,
) error {
	if journal.SchemaVersion != realmV3FullDataAuditJournalSchemaV2 ||
		journal.InputDigest != request.InputDigest || journal.PartitionKey != request.PartitionKey ||
		journal.SourceRefHash != request.Source.SourceRefHash ||
		journal.LiveEnvironmentDigest != realmV3FullDataLiveEnvironmentDigestValueV1(request.LiveEnvironment) ||
		journal.Generation != generation || journal.AttemptRequestIDHash != sha256HexBytes([]byte(requestID)) {
		return fmt.Errorf("full-data audit journal generation binding is invalid")
	}
	if err := validateRealmV3FullDataAuthorizationEvidenceV1(journal.Authorization, request); err != nil {
		return err
	}
	transport := journal.Transport
	for _, value := range []string{
		transport.PacketHash, transport.ClosureSetManifestHash, transport.OrderedComponentSetHash,
		transport.MaterializationContextHash, transport.PayloadHash,
	} {
		if !isLowerSHA256V3(value) {
			return fmt.Errorf("full-data audit journal transport hash is invalid")
		}
	}
	if transport.SegmentCount == 0 || transport.ComponentCount == 0 || transport.ChunkCount == 0 || transport.CanonicalBytes == 0 {
		return fmt.Errorf("full-data audit journal transport counts are incomplete")
	}
	switch journal.Phase {
	case realmV3FullDataAuditPhasePreparedV2:
		if journal.LocalAgentRefHash != nil || journal.SnapshotHash != nil || journal.ProvenanceKeyHash != nil || journal.CommittedAttemptPacketHash != nil {
			return fmt.Errorf("prepared full-data audit journal contains product state")
		}
	case realmV3FullDataAuditPhaseSealedV2:
		for _, value := range []*string{journal.LocalAgentRefHash, journal.SnapshotHash, journal.ProvenanceKeyHash, journal.CommittedAttemptPacketHash} {
			if value == nil || !isLowerSHA256V3(*value) {
				return fmt.Errorf("sealed full-data audit journal product binding is incomplete")
			}
		}
	default:
		return fmt.Errorf("full-data audit journal phase %q is not admitted", journal.Phase)
	}
	return nil
}

func validateRealmV3FullDataAuthorizationEvidenceV1(
	authorization realmV3FullDataLiveAuthorizationV1,
	request realmV3FullDataPartitionRequestV1,
) error {
	boundaryDigest, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-authorization-boundary/v1",
		request.AuthorizationBoundary,
	)
	if err != nil {
		return fmt.Errorf("hash full-data authorization boundary: %w", err)
	}
	if request.LiveEnvironment == nil ||
		!reflect.DeepEqual(request.AuthorizationBoundary, realmV3FullDataExpectedAuthorizationBoundaryV1()) ||
		!authorization.LiveAuthorizationProven || authorization.AccessPolicyVersion != realmV3FullDataAccessPolicyVersionV5 ||
		authorization.AccessPolicyDigest != request.Identity.Realm.PolicyDigest ||
		authorization.AuthorityClass != realmV3FullDataAuthorityClassV1 ||
		authorization.AuthorizationBoundaryDigest != boundaryDigest ||
		authorization.AuthenticatedAccountIDHash != request.LiveEnvironment.MaterializerAccountIDHash ||
		!reflect.DeepEqual(authorization.PacketOperation, realmV3FullDataPacketOperationV1Value()) ||
		!isLowerSHA256V3(authorization.PacketRequestHash) || !authorization.PacketRequestAuthenticated ||
		!authorization.CanonicalSourceVisibilityEnforced || authorization.SourceVisibilityDecisionOwner != "realm" ||
		authorization.ThirdPartyAppPermissionRequired || authorization.PermissionCatalog != realmV3FullDataPermissionCatalogV1 ||
		authorization.ForbiddenInputObserved || authorization.SyntheticDecisionObserved ||
		!authorization.FreshChallenge || !authorization.FreshNonce || !authorization.FreshTTL || !authorization.CurrentJWKS {
		return fmt.Errorf("full-data audit journal authorization evidence is invalid")
	}
	return nil
}

func sealRealmV3FullDataAuditJournalV2(journal realmV3FullDataAuditJournalV2) (realmV3FullDataAuditJournalV2, error) {
	hash, err := realmV3FullDataAuditJournalContentHashV2(journal)
	if err != nil {
		return realmV3FullDataAuditJournalV2{}, err
	}
	journal.ContentHash = hash
	return journal, nil
}

func realmV3FullDataAuditJournalContentHashV2(journal realmV3FullDataAuditJournalV2) (string, error) {
	journal.ContentHash = ""
	return realmV3FullDataClosedContentHashV1(realmV3FullDataAuditJournalSchemaV2, journal)
}

func sealRealmV3FullDataCommittedAuditJournalV2(
	service *Service,
	target string,
	request realmV3FullDataPartitionRequestV1,
	generation uint64,
	requestID string,
	localAgentRef string,
	snapshot localAgentSourceSnapshotV2,
) (realmV3FullDataAuditJournalV2, error) {
	journal, err := readRealmV3FullDataAuditJournalFileV2(target)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return realmV3FullDataAuditJournalV2{}, fmt.Errorf("committed Runtime product has no original prepared audit journal")
		}
		return realmV3FullDataAuditJournalV2{}, err
	}
	if err := validateRealmV3FullDataAuditJournalV2(journal, request, generation, requestID); err != nil {
		return realmV3FullDataAuditJournalV2{}, err
	}
	var state, packetHash, attemptLocalAgentRef, provenanceKey, provenanceSnapshotHash, provenanceContextHash string
	err = service.backend.DB().QueryRow(`
		SELECT attempt.state, attempt.packet_hash, attempt.local_agent_ref,
			provenance.provenance_key, provenance.snapshot_hash, provenance.materialization_context_hash
		FROM runtime_realm_source_materialization_attempt_v3 AS attempt
		JOIN runtime_local_agent_source_provenance_v3 AS provenance ON provenance.local_agent_ref = attempt.local_agent_ref
		WHERE attempt.materializer_account_id = ? AND attempt.request_id = ?
	`, strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID")), requestID).Scan(
		&state, &packetHash, &attemptLocalAgentRef, &provenanceKey, &provenanceSnapshotHash, &provenanceContextHash,
	)
	if err != nil {
		return realmV3FullDataAuditJournalV2{}, fmt.Errorf("read immutable committed audit bindings: %w", err)
	}
	if state != "committed" || attemptLocalAgentRef != localAgentRef || packetHash != snapshot.PacketHash ||
		packetHash != journal.Transport.PacketHash || provenanceSnapshotHash != snapshot.SnapshotHash ||
		provenanceContextHash != snapshot.Semantic.MaterializationContextHash {
		return realmV3FullDataAuditJournalV2{}, fmt.Errorf("prepared audit journal differs from the immutable committed product")
	}
	localAgentRefHash := sha256HexBytes([]byte(localAgentRef))
	provenanceKeyHash := sha256HexBytes([]byte(provenanceKey))
	if journal.Phase == realmV3FullDataAuditPhasePreparedV2 {
		journal.Phase = realmV3FullDataAuditPhaseSealedV2
		journal.LocalAgentRefHash = &localAgentRefHash
		journal.SnapshotHash = &snapshot.SnapshotHash
		journal.ProvenanceKeyHash = &provenanceKeyHash
		journal.CommittedAttemptPacketHash = &packetHash
		if err := writeRealmV3FullDataAuditJournalAtomicV2(target, journal, true); err != nil {
			return realmV3FullDataAuditJournalV2{}, err
		}
		journal, err = readRealmV3FullDataAuditJournalFileV2(target)
		if err != nil {
			return realmV3FullDataAuditJournalV2{}, err
		}
	}
	if journal.Phase != realmV3FullDataAuditPhaseSealedV2 || journal.LocalAgentRefHash == nil ||
		journal.SnapshotHash == nil || journal.ProvenanceKeyHash == nil || journal.CommittedAttemptPacketHash == nil ||
		*journal.LocalAgentRefHash != localAgentRefHash || *journal.SnapshotHash != snapshot.SnapshotHash ||
		*journal.ProvenanceKeyHash != provenanceKeyHash || *journal.CommittedAttemptPacketHash != packetHash {
		return realmV3FullDataAuditJournalV2{}, fmt.Errorf("sealed audit journal does not bind the immutable committed product")
	}
	return journal, nil
}
