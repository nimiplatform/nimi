//go:build realm_v3_full_data

package runtimeagent

import (
	"os"
	"testing"
)

const (
	realmV3FullDataPartitionRequestSchemaV1 = "nimi.realm-v3-full-data-partition-request/v1"
	realmV3FullDataPartitionReceiptSchemaV1 = "nimi.realm-v3-full-data-partition-receipt/v1"
	realmV3FullDataCapturedStageV1          = "captured-replay"
	realmV3FullDataLiveStageV1              = "live-materialize"
	realmV3FullDataRestartStageV1           = "restart-offline"
	realmV3FullDataSnapshotSchemaV2         = "nimi.runtime.local-agent-source-snapshot/v2"
	realmV3FullDataAccessPolicyVersionV5    = "realm.source-materialization-access-policy/v5"
	realmV3FullDataAuthorityClassV1         = "authenticated_first_party_product_operation"
	realmV3FullDataPermissionCatalogV1      = "empty"
	realmV3FullDataPacketOperationIDV1      = "WorldCoreController_createSourceMaterializationPacket"
	realmV3FullDataPacketOperationPathV1    = "/api/realm/core/source-materialization-packets"
	realmV3FullDataAccountCustodySchemaV1   = "nimi.realm-v3-full-data-account-custody/v1"
	realmV3FullDataRuntimeMarkerSchemaV1    = "nimi.realm-v3-full-data-runtime-root/v1"
	realmV3FullDataAuditJournalSchemaV2     = "nimi.realm-v3-full-data-audit-journal/v2"
	realmV3FullDataAttemptLedgerSchemaV1    = "nimi.realm-v3-full-data-attempt-ledger/v1"
	realmV3FullDataAuditPhasePreparedV2     = "prepared"
	realmV3FullDataAuditPhaseSealedV2       = "sealed"
	realmV3FullDataAttemptStatusActiveV1    = "active"
	realmV3FullDataAttemptStatusFailedV1    = "failed"
	realmV3FullDataAttemptStatusCommittedV1 = "committed"
	realmV3FullDataAccountCustodyFileV1     = ".realm-v3-full-data-account-custody.json"
	realmV3FullDataRuntimeMarkerFileV1      = ".nimi-realm-v3-full-data-runtime-root.json"
	realmV3FullDataRuntimeOwnerLockFileV1   = ".realm-v3-full-data-worker.lock"
	realmV3FullDataAuditJournalDirectoryV1  = ".realm-v3-full-data-audit"
	realmV3FullDataAttemptLedgerDirectoryV1 = ".realm-v3-full-data-attempts"
	realmV3FullDataLocalStateFileV1         = "local-state.json"
	realmV3FullDataFinalPartitionOrdinalV1  = 470
	realmV3FullDataDenominatorV1            = 471
)

var realmV3FullDataForbiddenAuthorizationInputsV1 = []string{
	"app_id",
	"permission_scope",
	"access_grant_id",
	"synthetic_grant_decision",
}

type realmV3FullDataWorkerIdentityV1 struct {
	Realm struct {
		Commit        string            `json:"commit"`
		Tree          string            `json:"tree"`
		OpenAPIDigest string            `json:"openapiDigest"`
		PolicyDigest  string            `json:"policyDigest"`
		VectorDigests map[string]string `json:"vectorDigests"`
	} `json:"realm"`
	Nimi struct {
		Commit         string `json:"commit"`
		Tree           string `json:"tree"`
		ContractDigest string `json:"contractDigest"`
		WorktreeDigest string `json:"worktreeDigest"`
	} `json:"nimi"`
}

type realmV3FullDataExpectedTransportV1 struct {
	PacketHash                 string `json:"packetHash"`
	ClosureSetManifestHash     string `json:"closureSetManifestHash"`
	OrderedComponentSetHash    string `json:"orderedComponentSetHash"`
	MaterializationContextHash string `json:"materializationContextHash"`
	PayloadHash                string `json:"payloadHash"`
	SegmentCount               uint64 `json:"segmentCount"`
	ComponentCount             uint64 `json:"componentCount"`
	ChunkCount                 uint64 `json:"chunkCount"`
	CanonicalBytes             uint64 `json:"canonicalBytes"`
}

type realmV3FullDataCaptureV1 struct {
	PacketPath                   string `json:"packetPath"`
	PacketBytes                  int64  `json:"packetBytes"`
	PacketSHA256                 string `json:"packetSha256"`
	JWKSPath                     string `json:"jwksPath"`
	JWKSSHA256                   string `json:"jwksSha256"`
	HistoricalAccessPolicyDigest string `json:"historicalAccessPolicyDigest"`
	PacketIssuedAt               string `json:"packetIssuedAt"`
	Expectation                  struct {
		AccessPolicyVersionDigest string                                 `json:"accessPolicyVersionDigest"`
		ChallengeDigest           string                                 `json:"challengeDigest"`
		ChallengeExpiresAt        string                                 `json:"challengeExpiresAt"`
		ChallengeID               string                                 `json:"challengeId"`
		IntendedRuntimeAudience   string                                 `json:"intendedRuntimeAudience"`
		Issuer                    string                                 `json:"issuer"`
		MaterializerAccountID     string                                 `json:"materializerAccountId"`
		PublishedLimits           sourceMaterializationPublishedLimitsV3 `json:"publishedLimits"`
		VerifiedAt                string                                 `json:"verifiedAt"`
	} `json:"expectation"`
	ExpectedTransport realmV3FullDataExpectedTransportV1 `json:"expectedTransport"`
}

type realmV3FullDataPartitionRequestV1 struct {
	SchemaVersion string `json:"schemaVersion"`
	Stage         string `json:"stage"`
	InputDigest   string `json:"inputDigest"`
	PartitionKey  string `json:"partitionKey"`
	Ordinal       uint64 `json:"ordinal"`
	Source        struct {
		Kind          string                                    `json:"kind"`
		ID            string                                    `json:"id"`
		WorldID       string                                    `json:"worldId"`
		SourceHash    string                                    `json:"sourceHash"`
		SourceRefHash string                                    `json:"sourceRefHash"`
		SourceRef     sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	} `json:"source"`
	Identity              realmV3FullDataWorkerIdentityV1        `json:"identity"`
	AuthorizationBoundary realmV3FullDataAuthorizationBoundaryV1 `json:"authorizationBoundary"`
	LiveEnvironment       *realmV3FullDataLiveEnvironmentV1      `json:"liveEnvironment"`
	Capture               *realmV3FullDataCaptureV1              `json:"capture"`
	RuntimeDataRoot       *string                                `json:"runtimeDataRoot"`
}

type realmV3FullDataAuthorizationBoundaryV1 struct {
	AuthorityClass                    string   `json:"authorityClass"`
	AuthenticatedRealmAccountRequired bool     `json:"authenticatedRealmAccountRequired"`
	CanonicalSourceVisibilityRequired bool     `json:"canonicalSourceVisibilityRequired"`
	ThirdPartyAppPermissionRequired   bool     `json:"thirdPartyAppPermissionRequired"`
	PermissionCatalog                 string   `json:"permissionCatalog"`
	ForbiddenInputs                   []string `json:"forbiddenInputs"`
}

type realmV3FullDataPacketOperationV1 struct {
	OperationID string `json:"operationId"`
	Method      string `json:"method"`
	Path        string `json:"path"`
}

func realmV3FullDataExpectedAuthorizationBoundaryV1() realmV3FullDataAuthorizationBoundaryV1 {
	return realmV3FullDataAuthorizationBoundaryV1{
		AuthorityClass:                    realmV3FullDataAuthorityClassV1,
		AuthenticatedRealmAccountRequired: true,
		CanonicalSourceVisibilityRequired: true,
		ThirdPartyAppPermissionRequired:   false,
		PermissionCatalog:                 realmV3FullDataPermissionCatalogV1,
		ForbiddenInputs:                   append([]string(nil), realmV3FullDataForbiddenAuthorizationInputsV1...),
	}
}

func realmV3FullDataPacketOperationV1Value() realmV3FullDataPacketOperationV1 {
	return realmV3FullDataPacketOperationV1{
		OperationID: realmV3FullDataPacketOperationIDV1,
		Method:      "post",
		Path:        realmV3FullDataPacketOperationPathV1,
	}
}

type realmV3FullDataLiveEnvironmentV1 struct {
	CanonicalRealmBaseURL          string `json:"canonicalRealmBaseURL"`
	CanonicalTokenURL              string `json:"canonicalTokenURL"`
	ExpectedIssuer                 string `json:"expectedIssuer"`
	MaterializerAccountIDHash      string `json:"materializerAccountIdHash"`
	ServerExportAttestationDigest  string `json:"serverExportAttestationDigest"`
	DisposableSourceInstanceDigest string `json:"disposableSourceInstanceDigest"`
}

type realmV3FullDataMaterializationEvidenceV1 struct {
	SnapshotSchema             string            `json:"snapshotSchema"`
	SnapshotHash               string            `json:"snapshotHash"`
	MaterializationContextHash string            `json:"materializationContextHash"`
	SourceLaneSemanticHashes   map[string]string `json:"sourceLaneSemanticHashes"`
	SourceLaneItemCounts       map[string]uint64 `json:"sourceLaneItemCounts"`
	SourceLanesHash            string            `json:"sourceLanesHash"`
	LocalAgentRefHash          string            `json:"localAgentRefHash,omitempty"`
}

type realmV3FullDataPartitionReceiptV1 struct {
	SchemaVersion string                          `json:"schemaVersion"`
	Stage         string                          `json:"stage"`
	InputDigest   string                          `json:"inputDigest"`
	PartitionKey  string                          `json:"partitionKey"`
	Ordinal       uint64                          `json:"ordinal"`
	Source        realmV3FullDataReceiptSourceV1  `json:"source"`
	Identity      realmV3FullDataWorkerIdentityV1 `json:"identity"`
	Status        string                          `json:"status"`
	ReasonCode    string                          `json:"reasonCode"`
	Evidence      any                             `json:"evidence"`
	ContentHash   string                          `json:"contentHash"`
}

type realmV3FullDataReceiptSourceV1 struct {
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	SourceHash    string `json:"sourceHash"`
	SourceRefHash string `json:"sourceRefHash"`
}

type realmV3FullDataCapturedEvidenceV1 struct {
	EvidenceClass string `json:"evidenceClass"`
	Authorization struct {
		HistoricalPacketProofOnly             bool `json:"historicalPacketProofOnly"`
		LiveAuthorizationProven               bool `json:"liveAuthorizationProven"`
		CountsTowardCurrentRealmAuthorization bool `json:"countsTowardCurrentRealmAuthorization"`
	} `json:"authorization"`
	Transport                 realmV3FullDataCapturedTransportV1       `json:"transport"`
	Materialization           realmV3FullDataMaterializationEvidenceV1 `json:"materialization"`
	SnapshotCodecReloadParity bool                                     `json:"snapshotCodecReloadParity"`
	RawTransportResidue       uint64                                   `json:"rawTransportResidue"`
}

type realmV3FullDataCapturedTransportV1 struct {
	realmV3FullDataExpectedTransportV1
	PacketSHA256 string `json:"packetSha256"`
}

type realmV3FullDataLiveAuthorizationV1 struct {
	LiveAuthorizationProven           bool                             `json:"liveAuthorizationProven"`
	AccessPolicyVersion               string                           `json:"accessPolicyVersion"`
	AccessPolicyDigest                string                           `json:"accessPolicyDigest"`
	AuthorityClass                    string                           `json:"authorityClass"`
	AuthorizationBoundaryDigest       string                           `json:"authorizationBoundaryDigest"`
	AuthenticatedAccountIDHash        string                           `json:"authenticatedAccountIdHash"`
	PacketOperation                   realmV3FullDataPacketOperationV1 `json:"packetOperation"`
	PacketRequestHash                 string                           `json:"packetRequestHash"`
	PacketRequestAuthenticated        bool                             `json:"packetRequestAuthenticated"`
	CanonicalSourceVisibilityEnforced bool                             `json:"canonicalSourceVisibilityEnforced"`
	SourceVisibilityDecisionOwner     string                           `json:"sourceVisibilityDecisionOwner"`
	ThirdPartyAppPermissionRequired   bool                             `json:"thirdPartyAppPermissionRequired"`
	PermissionCatalog                 string                           `json:"permissionCatalog"`
	ForbiddenInputObserved            bool                             `json:"forbiddenInputObserved"`
	SyntheticDecisionObserved         bool                             `json:"syntheticDecisionObserved"`
	FreshChallenge                    bool                             `json:"freshChallenge"`
	FreshNonce                        bool                             `json:"freshNonce"`
	FreshTTL                          bool                             `json:"freshTtl"`
	CurrentJWKS                       bool                             `json:"currentJwks"`
}

type realmV3FullDataLiveEvidenceV1 struct {
	EvidenceClass      string                                   `json:"evidenceClass"`
	AttemptGenerations []realmV3FullDataAttemptGenerationV1     `json:"attemptGenerations"`
	Authorization      realmV3FullDataLiveAuthorizationV1       `json:"authorization"`
	Transport          realmV3FullDataExpectedTransportV1       `json:"transport"`
	Materialization    realmV3FullDataMaterializationEvidenceV1 `json:"materialization"`
	Atomicity          realmV3FullDataAtomicityEvidenceV1       `json:"atomicity"`
}

type realmV3FullDataAttemptGenerationV1 struct {
	Generation    uint64 `json:"generation"`
	Status        string `json:"status"`
	ReasonCode    string `json:"reasonCode"`
	RequestIDHash string `json:"requestIdHash"`
}

type realmV3FullDataAtomicityEvidenceV1 struct {
	LocalAgentsCreated      uint64 `json:"localAgentsCreated"`
	SnapshotsCreated        uint64 `json:"snapshotsCreated"`
	ProvenanceCreated       uint64 `json:"provenanceCreated"`
	PartialProductMutations uint64 `json:"partialProductMutations"`
	RawTransportResidue     uint64 `json:"rawTransportResidue"`
}

type realmV3FullDataRestartEvidenceV1 struct {
	EvidenceClass               string                                   `json:"evidenceClass"`
	AttemptGenerations          []realmV3FullDataAttemptGenerationV1     `json:"attemptGenerations"`
	ColdStarts                  uint64                                   `json:"coldStarts"`
	RealmOffline                bool                                     `json:"realmOffline"`
	RealmRequestsWhileOffline   uint64                                   `json:"realmRequestsWhileOffline"`
	SourceRebased               bool                                     `json:"sourceRebased"`
	Materialization             realmV3FullDataMaterializationEvidenceV1 `json:"materialization"`
	RawTransportResidue         uint64                                   `json:"rawTransportResidue"`
	OrphanLocalAgents           uint64                                   `json:"orphanLocalAgents"`
	OrphanSnapshots             uint64                                   `json:"orphanSnapshots"`
	OrphanProvenance            uint64                                   `json:"orphanProvenance"`
	AccountCustodyResidue       uint64                                   `json:"accountCustodyResidue"`
	AuthorizationBoundaryDigest string                                   `json:"authorizationBoundaryDigest"`
	AuthorizationStatePersisted bool                                     `json:"authorizationStatePersisted"`
}

func TestRealmV3FullDataPartitionWorker(t *testing.T) {
	requestPath := os.Getenv("NIMI_REALM_V3_FULL_PARTITION_REQUEST_PATH")
	receiptPath := os.Getenv("NIMI_REALM_V3_FULL_PARTITION_RECEIPT_PATH")
	if requestPath == "" || receiptPath == "" {
		t.Fatal("full-data worker requires explicit request and receipt paths")
	}
	request := readRealmV3FullDataPartitionRequestV1(t, requestPath)
	failure := realmV3FullDataBaseReceiptV1(request)
	receiptWritten := false
	defer func() {
		if !receiptWritten {
			receiptWritten = true
			writeRealmV3FullDataReceiptV1(t, receiptPath, failure)
		}
	}()

	var evidence any
	switch request.Stage {
	case realmV3FullDataCapturedStageV1:
		validateRealmV3FullDataCapturedRequestV1(t, request)
		evidence = runRealmV3FullDataCapturedPartitionV1(t, request)
	case realmV3FullDataLiveStageV1:
		validateRealmV3FullDataCurrentRequestV1(t, request, realmV3FullDataLiveStageV1)
		evidence = runRealmV3FullDataLivePartitionV1(t, request)
	case realmV3FullDataRestartStageV1:
		validateRealmV3FullDataCurrentRequestV1(t, request, realmV3FullDataRestartStageV1)
		evidence = runRealmV3FullDataRestartPartitionV1(t, request)
	default:
		t.Fatalf("full-data request stage %q is not admitted", request.Stage)
	}

	receipt := realmV3FullDataBaseReceiptV1(request)
	receipt.Status = "PASS"
	receipt.ReasonCode = "passed"
	receipt.Evidence = evidence
	receiptWritten = true
	writeRealmV3FullDataReceiptV1(t, receiptPath, receipt)
}
