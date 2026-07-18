//go:build realm_v3_full_data

package runtimeagent

import (
	"crypto/rsa"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type realmV3FullDataRoundTripFuncV1 func(*http.Request) (*http.Response, error)

func (function realmV3FullDataRoundTripFuncV1) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func realmV3FullDataClosedStateTestRequestV1(root string) realmV3FullDataPartitionRequestV1 {
	_ = os.Chmod(root, 0o700)
	request := realmV3FullDataPartitionRequestV1{
		SchemaVersion: realmV3FullDataPartitionRequestSchemaV1, Stage: realmV3FullDataLiveStageV1,
		InputDigest: strings.Repeat("a", 64), PartitionKey: strings.Repeat("b", 64), RuntimeDataRoot: &root,
		LiveEnvironment: &realmV3FullDataLiveEnvironmentV1{
			CanonicalRealmBaseURL: "https://realm.example", CanonicalTokenURL: "https://realm.example/api/auth/oauth/token",
			ExpectedIssuer: "https://issuer.example", MaterializerAccountIDHash: sha256HexBytes([]byte("account-1")),
			ServerExportAttestationDigest: strings.Repeat("c", 64), DisposableSourceInstanceDigest: strings.Repeat("d", 64),
		},
	}
	request.Source.Kind = "worldCharacter"
	request.Source.ID = "world-1"
	request.Source.WorldID = "world-1"
	request.Source.SourceHash = strings.Repeat("e", 64)
	request.Source.SourceRefHash = strings.Repeat("f", 64)
	request.Identity.Realm.PolicyDigest = compactRealmMaterializationPolicyDigest
	request.AuthorizationBoundary = realmV3FullDataExpectedAuthorizationBoundaryV1()
	return request
}

func realmV3FullDataClosedStateTestLedgerV1(
	request realmV3FullDataPartitionRequestV1,
	requestID string,
) realmV3FullDataAttemptLedgerV1 {
	return realmV3FullDataAttemptLedgerV1{
		SchemaVersion: realmV3FullDataAttemptLedgerSchemaV1, InputDigest: request.InputDigest,
		PartitionKey: request.PartitionKey, SourceRefHash: request.Source.SourceRefHash,
		LiveEnvironmentDigest: realmV3FullDataLiveEnvironmentDigestValueV1(request.LiveEnvironment),
		Generations: []realmV3FullDataAttemptGenerationV1{{
			Generation: 1, Status: realmV3FullDataAttemptStatusActiveV1,
			ReasonCode: "attempt_started", RequestIDHash: sha256HexBytes([]byte(requestID)),
		}},
	}
}

func realmV3FullDataClosedStateTestJournalV2(
	request realmV3FullDataPartitionRequestV1,
	generation uint64,
	requestID string,
) realmV3FullDataAuditJournalV2 {
	boundaryDigest, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-authorization-boundary/v1",
		request.AuthorizationBoundary,
	)
	if err != nil {
		panic(err)
	}
	authorization := realmV3FullDataLiveAuthorizationV1{
		LiveAuthorizationProven:           true,
		AccessPolicyVersion:               realmV3FullDataAccessPolicyVersionV5,
		AccessPolicyDigest:                request.Identity.Realm.PolicyDigest,
		AuthorityClass:                    realmV3FullDataAuthorityClassV1,
		AuthorizationBoundaryDigest:       boundaryDigest,
		AuthenticatedAccountIDHash:        sha256HexBytes([]byte("account-1")),
		PacketOperation:                   realmV3FullDataPacketOperationV1Value(),
		PacketRequestHash:                 strings.Repeat("1", 64),
		PacketRequestAuthenticated:        true,
		CanonicalSourceVisibilityEnforced: true,
		SourceVisibilityDecisionOwner:     "realm",
		ThirdPartyAppPermissionRequired:   false,
		PermissionCatalog:                 realmV3FullDataPermissionCatalogV1,
		ForbiddenInputObserved:            false,
		SyntheticDecisionObserved:         false,
		FreshChallenge:                    true,
		FreshNonce:                        true,
		FreshTTL:                          true,
		CurrentJWKS:                       true,
	}
	return realmV3FullDataAuditJournalV2{
		SchemaVersion: realmV3FullDataAuditJournalSchemaV2, Phase: realmV3FullDataAuditPhasePreparedV2,
		InputDigest: request.InputDigest, PartitionKey: request.PartitionKey, SourceRefHash: request.Source.SourceRefHash,
		LiveEnvironmentDigest: realmV3FullDataLiveEnvironmentDigestValueV1(request.LiveEnvironment),
		Generation:            generation, AttemptRequestIDHash: sha256HexBytes([]byte(requestID)), Authorization: authorization,
		Transport: realmV3FullDataExpectedTransportV1{
			PacketHash: strings.Repeat("2", 64), ClosureSetManifestHash: strings.Repeat("3", 64),
			OrderedComponentSetHash: strings.Repeat("4", 64), MaterializationContextHash: strings.Repeat("5", 64),
			PayloadHash: strings.Repeat("6", 64), SegmentCount: 1, ComponentCount: 1, ChunkCount: 1, CanonicalBytes: 1,
		},
	}
}

func realmV3FullDataCreateInspectionDatabaseV1(
	t *testing.T,
	root string,
	accountID string,
	requestID string,
	state string,
	productRows bool,
	replayRows bool,
) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("open inspection database: %v", err)
	}
	defer db.Close()
	for _, statement := range []string{
		`CREATE TABLE runtime_realm_source_materialization_attempt_v3(materializer_account_id TEXT, request_id TEXT, state TEXT, local_agent_ref TEXT)`,
		`CREATE TABLE runtime_realm_source_materialization_replay_v3(materializer_account_id TEXT, request_id TEXT)`,
		`CREATE TABLE runtime_local_agent(local_agent_ref TEXT)`,
		`CREATE TABLE runtime_local_agent_source_snapshot_v2(local_agent_ref TEXT)`,
		`CREATE TABLE runtime_local_agent_source_provenance_v3(local_agent_ref TEXT)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("create inspection database schema: %v", err)
		}
	}
	localAgentRef := any(nil)
	if state == "committed" || productRows {
		localAgentRef = "agent-1"
	}
	if _, err := db.Exec(`INSERT INTO runtime_realm_source_materialization_attempt_v3 VALUES (?, ?, ?, ?)`, accountID, requestID, state, localAgentRef); err != nil {
		t.Fatalf("insert inspection attempt: %v", err)
	}
	if productRows {
		for _, table := range []string{"runtime_local_agent", "runtime_local_agent_source_snapshot_v2", "runtime_local_agent_source_provenance_v3"} {
			if _, err := db.Exec(`INSERT INTO ` + table + ` VALUES ('agent-1')`); err != nil {
				t.Fatalf("insert inspection product: %v", err)
			}
		}
	}
	if replayRows {
		if _, err := db.Exec(`INSERT INTO runtime_realm_source_materialization_replay_v3 VALUES (?, ?)`, accountID, requestID); err != nil {
			t.Fatalf("insert inspection replay: %v", err)
		}
	}
}

func realmV3FullDataRebindPacketPolicyV1(
	packet []byte,
	privateKey *rsa.PrivateKey,
	keyID string,
	policyDigest string,
) ([]byte, error) {
	value, err := decodeSourceMaterializationJSON(packet)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok || privateKey == nil || keyID == "" || !isLowerSHA256V3(policyDigest) {
		return nil, fmt.Errorf("current full-data Packet policy fixture is unavailable")
	}
	object["accessPolicyVersionDigest"] = policyDigest
	unsigned, err := json.Marshal(object)
	if err != nil {
		return nil, err
	}
	var typed sourceMaterializationPacketV3Value
	if err := strictDecodeSourceMaterializationV3(unsigned, &typed); err != nil {
		return nil, err
	}
	packetHash, err := sourceMaterializationPacketHashV3(typed)
	if err != nil {
		return nil, err
	}
	proof, err := signRealmSourceMaterializationServiceTestPacketWithKeyID(privateKey, keyID, packetHash)
	if err != nil {
		return nil, err
	}
	object["packetHash"] = packetHash
	object["packetProof"] = proof
	return json.Marshal(object)
}
