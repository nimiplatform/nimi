//go:build realm_v3_full_data

package runtimeagent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func realmV3FullDataBaseReceiptV1(request realmV3FullDataPartitionRequestV1) realmV3FullDataPartitionReceiptV1 {
	return realmV3FullDataPartitionReceiptV1{
		SchemaVersion: realmV3FullDataPartitionReceiptSchemaV1,
		Stage:         request.Stage,
		InputDigest:   request.InputDigest,
		PartitionKey:  request.PartitionKey,
		Ordinal:       request.Ordinal,
		Source: realmV3FullDataReceiptSourceV1{
			Kind:          request.Source.Kind,
			ID:            request.Source.ID,
			SourceHash:    request.Source.SourceHash,
			SourceRefHash: request.Source.SourceRefHash,
		},
		Identity:   request.Identity,
		Status:     "FAIL",
		ReasonCode: "worker_failed",
		Evidence:   nil,
	}
}

func runRealmV3FullDataCapturedPartitionV1(t *testing.T, request realmV3FullDataPartitionRequestV1) realmV3FullDataCapturedEvidenceV1 {
	t.Helper()
	capture := request.Capture
	if capture == nil {
		t.Fatal("captured full-data request omitted capture evidence")
	}

	packetFile := inflateRealmV3FullDataPacketV1(t, request)
	defer func() {
		if err := os.Remove(packetFile); err != nil && !os.IsNotExist(err) {
			t.Errorf("remove temporary captured Packet v3: %v", err)
		}
	}()
	packet, err := os.Open(packetFile)
	if err != nil {
		t.Fatal(err)
	}
	jwksBytes, err := os.ReadFile(capture.JWKSPath)
	if err != nil {
		packet.Close()
		t.Fatalf("read historical capture JWKS: %v", err)
	}
	if got := sha256HexBytes(jwksBytes); got != capture.JWKSSHA256 {
		packet.Close()
		t.Fatalf("capture JWKS digest = %s, want %s", got, capture.JWKSSHA256)
	}
	issuedAt := mustRealmV3FullDataInstantV1(t, capture.PacketIssuedAt)
	verifiedAt := mustRealmV3FullDataInstantV1(t, capture.Expectation.VerifiedAt)
	challengeExpiresAt := mustRealmV3FullDataInstantV1(t, capture.Expectation.ChallengeExpiresAt)
	verified, err := verifySourceMaterializationPacketV3(
		packet,
		bytes.NewReader(jwksBytes),
		sourceMaterializationVerificationExpectationV3{
			Challenge: sourceMaterializationChallengeV3{
				ChallengeID:             capture.Expectation.ChallengeID,
				ChallengeDigest:         capture.Expectation.ChallengeDigest,
				IntendedRuntimeAudience: capture.Expectation.IntendedRuntimeAudience,
				MaterializerAccountID:   capture.Expectation.MaterializerAccountID,
				SourceRef:               request.Source.SourceRef,
				Limits:                  capture.Expectation.PublishedLimits,
				IssuedAt:                issuedAt,
				ExpiresAt:               challengeExpiresAt,
			},
			ExpectedIssuer:             capture.Expectation.Issuer,
			ExpectedAccessPolicyDigest: capture.HistoricalAccessPolicyDigest,
			Now:                        verifiedAt,
		},
	)
	if closeErr := packet.Close(); closeErr != nil {
		t.Fatalf("close staged captured Packet v3: %v", closeErr)
	}
	if err != nil {
		t.Fatalf("strict historical Packet v3 structural verification: %v (code=%s)", err, sourceMaterializationV3FailureCode(err))
	}
	if err := os.Remove(packetFile); err != nil {
		t.Fatalf("remove raw Packet v3 staging before product projection: %v", err)
	}

	assertRealmV3FullDataTransportV1(t, verified, capture.ExpectedTransport)
	localAgentRef := realmSourceMaterializationProductTestLocalAgentRef("full-data-" + request.PartitionKey)
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, localAgentRef)
	if err != nil {
		t.Fatalf("finalize full-data SnapshotV2: %v", err)
	}
	first := compileRealmV3FullDataMaterializationV1(t, snapshot)
	encoded, err := encodeLocalAgentSourceSnapshotV2(snapshot)
	if err != nil {
		t.Fatalf("encode full-data SnapshotV2: %v", err)
	}
	reloaded, err := decodeLocalAgentSourceSnapshotV2(encoded)
	if err != nil {
		t.Fatalf("strictly reload full-data SnapshotV2: %v", err)
	}
	second := compileRealmV3FullDataMaterializationV1(t, reloaded)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("SnapshotV2 codec reload changed compiler semantics: first=%+v second=%+v", first, second)
	}
	verified.CanonicalComponentBytes = nil
	verified.OrderedComponentIDs = nil

	evidence := realmV3FullDataCapturedEvidenceV1{
		EvidenceClass: "captured_structural_replay",
		Transport: realmV3FullDataCapturedTransportV1{
			realmV3FullDataExpectedTransportV1: capture.ExpectedTransport,
			PacketSHA256:                       capture.PacketSHA256,
		},
		Materialization:           first,
		SnapshotCodecReloadParity: true,
		RawTransportResidue:       0,
	}
	evidence.Authorization.HistoricalPacketProofOnly = true
	evidence.Authorization.LiveAuthorizationProven = false
	evidence.Authorization.CountsTowardCurrentRealmAuthorization = false
	return evidence
}

func readRealmV3FullDataPartitionRequestV1(t *testing.T, requestPath string) realmV3FullDataPartitionRequestV1 {
	t.Helper()
	raw, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatalf("read full-data partition request: %v", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var request realmV3FullDataPartitionRequestV1
	if err := decoder.Decode(&request); err != nil {
		t.Fatalf("decode closed full-data partition request: %v", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		t.Fatal("full-data partition request has trailing JSON")
	}
	return request
}

func validateRealmV3FullDataCapturedRequestV1(t *testing.T, request realmV3FullDataPartitionRequestV1) {
	t.Helper()
	validateRealmV3FullDataCommonRequestV1(t, request, realmV3FullDataCapturedStageV1)
	if request.Capture == nil {
		t.Fatal("captured full-data request omitted capture evidence")
	}
	capture := request.Capture
	if request.SchemaVersion != realmV3FullDataPartitionRequestSchemaV1 || request.Stage != realmV3FullDataCapturedStageV1 {
		t.Fatalf("full-data request schema/stage = %q/%q", request.SchemaVersion, request.Stage)
	}
	for field, value := range map[string]string{
		"packetSha256": capture.PacketSHA256, "jwksSha256": capture.JWKSSHA256,
		"historicalAccessPolicyDigest": capture.HistoricalAccessPolicyDigest,
	} {
		if !isLowerSHA256V3(value) {
			t.Fatalf("full-data request %s is not a lowercase SHA-256", field)
		}
	}
	if capture.PacketPath == "" || !filepath.IsAbs(capture.PacketPath) ||
		capture.JWKSPath == "" || !filepath.IsAbs(capture.JWKSPath) || capture.PacketBytes <= 0 {
		t.Fatal("full-data captured input paths/size are invalid")
	}
	if capture.Expectation.AccessPolicyVersionDigest != capture.HistoricalAccessPolicyDigest {
		t.Fatal("capture expectation and historical access-policy digest differ")
	}
	if capture.HistoricalAccessPolicyDigest == request.Identity.Realm.PolicyDigest {
		t.Fatal("historical capture must not be classified as current Realm policy evidence")
	}
	if request.RuntimeDataRoot == nil {
		t.Fatal("captured full-data request omitted frozen runtimeDataRoot")
	}
	if request.LiveEnvironment != nil {
		t.Fatal("captured full-data request retained a live environment binding")
	}
}

func validateRealmV3FullDataCurrentRequestV1(t *testing.T, request realmV3FullDataPartitionRequestV1, stage string) {
	t.Helper()
	validateRealmV3FullDataCommonRequestV1(t, request, stage)
	if request.Capture != nil {
		t.Fatal("current Realm full-data request retained historical capture input")
	}
	if request.RuntimeDataRoot == nil {
		t.Fatal("current Realm full-data request omitted frozen runtimeDataRoot")
	}
	if request.Identity.Realm.PolicyDigest != compactRealmMaterializationPolicyDigest {
		t.Fatalf("current Realm policy digest %q is not admitted", request.Identity.Realm.PolicyDigest)
	}
	validateRealmV3FullDataLiveEnvironmentV1(t, request.LiveEnvironment)
}

func validateRealmV3FullDataLiveEnvironmentV1(t *testing.T, environment *realmV3FullDataLiveEnvironmentV1) {
	t.Helper()
	if environment == nil {
		t.Fatal("current Realm full-data request omitted the frozen live environment")
	}
	for field, value := range map[string]string{
		"materializerAccountIdHash":      environment.MaterializerAccountIDHash,
		"serverExportAttestationDigest":  environment.ServerExportAttestationDigest,
		"disposableSourceInstanceDigest": environment.DisposableSourceInstanceDigest,
	} {
		if !isLowerSHA256V3(value) {
			t.Fatalf("current Realm live environment %s is not a lowercase SHA-256", field)
		}
	}
	if environment.CanonicalRealmBaseURL != strings.TrimSpace(environment.CanonicalRealmBaseURL) ||
		environment.CanonicalTokenURL != strings.TrimSpace(environment.CanonicalTokenURL) ||
		environment.ExpectedIssuer != strings.TrimSpace(environment.ExpectedIssuer) {
		t.Fatal("current Realm live environment URLs are not canonical")
	}
	if err := requireSourceMaterializationV3Text(environment.ExpectedIssuer, "liveEnvironment.expectedIssuer"); err != nil {
		t.Fatalf("current Realm live environment issuer is invalid: %v", err)
	}
	realmV3FullDataValidateTokenAuthorityV1(
		t,
		environment.CanonicalRealmBaseURL,
		environment.CanonicalTokenURL,
	)
}

func validateRealmV3FullDataCommonRequestV1(t *testing.T, request realmV3FullDataPartitionRequestV1, stage string) {
	t.Helper()
	if request.SchemaVersion != realmV3FullDataPartitionRequestSchemaV1 || request.Stage != stage {
		t.Fatalf("full-data request schema/stage = %q/%q", request.SchemaVersion, request.Stage)
	}
	if request.Ordinal > realmV3FullDataFinalPartitionOrdinalV1 {
		t.Fatalf("full-data partition ordinal %d exceeds denominator", request.Ordinal)
	}
	for field, value := range map[string]string{
		"inputDigest": request.InputDigest, "partitionKey": request.PartitionKey,
		"sourceRefHash": request.Source.SourceRefHash, "sourceHash": request.Source.SourceHash,
		"realmOpenapiDigest": request.Identity.Realm.OpenAPIDigest, "realmPolicyDigest": request.Identity.Realm.PolicyDigest,
		"nimiContractDigest": request.Identity.Nimi.ContractDigest, "nimiWorktreeDigest": request.Identity.Nimi.WorktreeDigest,
	} {
		if !isLowerSHA256V3(value) {
			t.Fatalf("full-data request %s is not a lowercase SHA-256", field)
		}
	}
	for name, digest := range request.Identity.Realm.VectorDigests {
		if name == "" || !isLowerSHA256V3(digest) {
			t.Fatalf("full-data Realm vector digest %q is invalid", name)
		}
	}
	for field, value := range map[string]string{
		"realmCommit": request.Identity.Realm.Commit, "realmTree": request.Identity.Realm.Tree,
		"nimiCommit": request.Identity.Nimi.Commit, "nimiTree": request.Identity.Nimi.Tree,
	} {
		if !isRealmV3FullDataGitObjectV1(value) {
			t.Fatalf("full-data request %s is not a lowercase Git SHA-1", field)
		}
	}
	if err := request.Source.SourceRef.validate(); err != nil {
		t.Fatalf("validate full-data source ref: %v", err)
	}
	if request.Source.SourceRef.Kind != request.Source.Kind || request.Source.SourceRef.ID != request.Source.ID ||
		request.Source.SourceRef.WorldID != request.Source.WorldID || request.Source.SourceRef.SourceHash != request.Source.SourceHash {
		t.Fatal("full-data source identity does not match its strict source ref")
	}
	sourceRefHash, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-source-ref/v1",
		request.Source.SourceRef,
	)
	if err != nil || sourceRefHash != request.Source.SourceRefHash {
		t.Fatalf("full-data sourceRefHash does not cover the strict source ref: hash=%s err=%v", sourceRefHash, err)
	}
	if !reflect.DeepEqual(
		request.AuthorizationBoundary,
		realmV3FullDataExpectedAuthorizationBoundaryV1(),
	) {
		t.Fatal("full-data request authorization boundary is not the admitted first-party no-permission operation")
	}
}

type realmV3FullDataRuntimeRootMarkerV1 struct {
	SchemaVersion         string `json:"schemaVersion"`
	InputDigest           string `json:"inputDigest"`
	RuntimeDataRootDigest string `json:"runtimeDataRootDigest"`
	LiveEnvironmentDigest string `json:"liveEnvironmentDigest"`
}

func realmV3FullDataLiveEnvironmentDigestV1(t *testing.T, environment *realmV3FullDataLiveEnvironmentV1) string {
	t.Helper()
	if environment == nil {
		return ""
	}
	digest, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-live-environment/v1",
		environment,
	)
	if err != nil {
		t.Fatalf("hash fixed full-data live environment: %v", err)
	}
	return digest
}

func realmV3FullDataRuntimeRootDigestV1(t *testing.T, runtimeRoot string) string {
	t.Helper()
	digest, err := realmV3FullDataCanonicalDomainHashV1(
		realmV3FullDataRuntimeMarkerSchemaV1,
		runtimeRoot,
	)
	if err != nil {
		t.Fatalf("hash canonical full-data runtimeDataRoot: %v", err)
	}
	return digest
}

func realmV3FullDataExpectedRuntimeRootMarkerV1(
	t *testing.T,
	request realmV3FullDataPartitionRequestV1,
	runtimeRoot string,
) realmV3FullDataRuntimeRootMarkerV1 {
	t.Helper()
	return realmV3FullDataRuntimeRootMarkerV1{
		SchemaVersion:         realmV3FullDataRuntimeMarkerSchemaV1,
		InputDigest:           request.InputDigest,
		RuntimeDataRootDigest: realmV3FullDataRuntimeRootDigestV1(t, runtimeRoot),
		LiveEnvironmentDigest: realmV3FullDataLiveEnvironmentDigestV1(t, request.LiveEnvironment),
	}
}

func validateRealmV3FullDataRuntimeRootMarkerV1(
	markerPath string,
	want realmV3FullDataRuntimeRootMarkerV1,
) error {
	info, err := os.Lstat(markerPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		validateRealmV3FullDataPrivatePathOwnerV1(markerPath, info, false) != nil {
		return fmt.Errorf("runtime root marker is unavailable or insecure: %w", err)
	}
	if info.Size() > 1<<20 {
		return fmt.Errorf("runtime root marker exceeds the fixed read bound")
	}
	file, err := os.Open(markerPath)
	if err != nil {
		return fmt.Errorf("open runtime root marker: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.DisallowUnknownFields()
	var got realmV3FullDataRuntimeRootMarkerV1
	if err := decoder.Decode(&got); err != nil {
		return fmt.Errorf("decode closed runtime root marker: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("runtime root marker has trailing JSON")
	}
	if got != want {
		return fmt.Errorf("runtime root marker does not match the frozen run")
	}
	return nil
}

func prepareRealmV3FullDataRuntimeRootV1(t *testing.T, request realmV3FullDataPartitionRequestV1) string {
	t.Helper()
	if request.RuntimeDataRoot == nil || *request.RuntimeDataRoot == "" ||
		*request.RuntimeDataRoot != strings.TrimSpace(*request.RuntimeDataRoot) ||
		!filepath.IsAbs(*request.RuntimeDataRoot) {
		t.Fatal("full-data runtimeDataRoot is not an absolute canonical path")
	}
	requested := filepath.Clean(*request.RuntimeDataRoot)
	if requested != *request.RuntimeDataRoot || requested == filepath.VolumeName(requested)+string(filepath.Separator) ||
		realmV3FullDataPathContainsComponentV1(requested, "nimi_dev") {
		t.Fatal("full-data runtimeDataRoot is not an admitted disposable target")
	}

	existing := requested
	missing := make([]string, 0, 4)
	for {
		_, err := os.Lstat(existing)
		if err == nil {
			break
		}
		if !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("inspect full-data runtimeDataRoot ancestor: %v", err)
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			t.Fatal("full-data runtimeDataRoot has no resolvable ancestor")
		}
		missing = append(missing, filepath.Base(existing))
		existing = parent
	}
	realExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		t.Fatalf("resolve full-data runtimeDataRoot ancestor: %v", err)
	}
	candidate := realExisting
	for index := len(missing) - 1; index >= 0; index-- {
		candidate = filepath.Join(candidate, missing[index])
	}
	assertRealmV3FullDataDisposablePathV1(t, candidate)
	if err := os.MkdirAll(candidate, 0o700); err != nil {
		t.Fatalf("create full-data runtimeDataRoot: %v", err)
	}
	realRoot, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		t.Fatalf("resolve full-data runtimeDataRoot: %v", err)
	}
	assertRealmV3FullDataDisposablePathV1(t, realRoot)
	info, err := os.Lstat(realRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		t.Fatalf("full-data runtimeDataRoot is not a regular directory: %v", err)
	}
	if err := os.Chmod(realRoot, 0o700); err != nil {
		t.Fatalf("protect full-data runtimeDataRoot: %v", err)
	}

	markerPath := filepath.Join(realRoot, realmV3FullDataRuntimeMarkerFileV1)
	marker := realmV3FullDataExpectedRuntimeRootMarkerV1(t, request, realRoot)
	if err := validateRealmV3FullDataRuntimeRootMarkerV1(markerPath, marker); err != nil {
		t.Fatalf("full-data runtimeDataRoot marker is invalid: %v", err)
	}
	return realRoot
}

func assertRealmV3FullDataDisposablePathV1(t *testing.T, candidate string) {
	t.Helper()
	resolved := filepath.Clean(candidate)
	if resolved == filepath.VolumeName(resolved)+string(filepath.Separator) || realmV3FullDataPathContainsComponentV1(resolved, "nimi_dev") {
		t.Fatal("full-data runtimeDataRoot resolves to a forbidden target")
	}
	for _, forbidden := range []string{realmV3FullDataNimiRootV1(t), realmV3FullDataHomeV1(t)} {
		if forbidden != "" && (resolved == forbidden || strings.HasPrefix(resolved, forbidden+string(filepath.Separator))) {
			t.Fatalf("full-data runtimeDataRoot resolves below forbidden root %s", forbidden)
		}
	}
}

func realmV3FullDataNimiRootV1(t *testing.T) string {
	t.Helper()
	cursor, err := os.Getwd()
	if err != nil {
		t.Fatalf("resolve full-data worker cwd: %v", err)
	}
	for {
		if info, statErr := os.Stat(filepath.Join(cursor, "go.mod")); statErr == nil && info.Mode().IsRegular() {
			root, evalErr := filepath.EvalSymlinks(filepath.Dir(cursor))
			if evalErr != nil {
				t.Fatalf("resolve Nimi repository root: %v", evalErr)
			}
			return filepath.Clean(root)
		}
		parent := filepath.Dir(cursor)
		if parent == cursor {
			t.Fatal("full-data worker cannot locate Runtime go.mod")
		}
		cursor = parent
	}
}

func realmV3FullDataHomeV1(t *testing.T) string {
	t.Helper()
	home := strings.TrimSpace(os.Getenv("HOME"))
	if home == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatalf("resolve home boundary for full-data worker: %v", err)
	}
	return filepath.Clean(resolved)
}

func realmV3FullDataPathContainsComponentV1(value, component string) bool {
	for _, part := range strings.FieldsFunc(filepath.Clean(value), func(char rune) bool {
		return char == '/' || char == '\\'
	}) {
		if part == component {
			return true
		}
	}
	return false
}

func writeRealmV3FullDataPrivateJSONV1(t *testing.T, target string, value any) {
	t.Helper()
	if err := writeRealmV3FullDataPrivateJSONAtomicV1(target, value); err != nil {
		t.Fatalf("commit private full-data state: %v", err)
	}
}

func writeRealmV3FullDataPrivateJSONAtomicV1(target string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode private full-data state: %w", err)
	}
	parent := filepath.Dir(target)
	if err := ensureRealmV3FullDataPrivateDirectoryDurableV1(parent); err != nil {
		return err
	}
	if info, err := os.Lstat(target); err == nil {
		if err := validateRealmV3FullDataPrivatePathOwnerV1(target, info, false); err != nil {
			return fmt.Errorf("existing private full-data state is insecure: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect existing private full-data state: %w", err)
	}
	temporary := fmt.Sprintf("%s.tmp-%d-%d", target, os.Getpid(), time.Now().UnixNano())
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create private full-data state: %w", err)
	}
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(temporary)
		}
	}()
	if _, err := file.Write(append(raw, '\n')); err != nil {
		return fmt.Errorf("write private full-data state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync private full-data state: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close private full-data state: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		return fmt.Errorf("rename private full-data state: %w", err)
	}
	if err := os.Chmod(target, 0o600); err != nil {
		return fmt.Errorf("protect private full-data state: %w", err)
	}
	if err := syncRealmV3FullDataParentDirectoryV1(target); err != nil {
		return err
	}
	committed = true
	return nil
}

func ensureRealmV3FullDataPrivateDirectoryDurableV1(directory string) error {
	directory = filepath.Clean(directory)
	info, err := os.Lstat(directory)
	if err == nil {
		if err := validateRealmV3FullDataPrivatePathOwnerV1(directory, info, true); err != nil {
			return fmt.Errorf("private full-data state directory is insecure: %w", err)
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect private full-data state directory: %w", err)
	}
	parent := filepath.Dir(directory)
	if parent == directory {
		return fmt.Errorf("private full-data state directory has no admitted ancestor")
	}
	if err := ensureRealmV3FullDataPrivateDirectoryDurableV1(parent); err != nil {
		return err
	}
	if err := os.Mkdir(directory, 0o700); err != nil {
		return fmt.Errorf("create private full-data state directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("protect private full-data state directory: %w", err)
	}
	if err := syncRealmV3FullDataDirectoryV1(parent); err != nil {
		return err
	}
	if err := syncRealmV3FullDataDirectoryV1(directory); err != nil {
		return err
	}
	return nil
}

func validateRealmV3FullDataPrivatePathOwnerV1(target string, info os.FileInfo, directory bool) error {
	if info == nil || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("path is absent or symbolic")
	}
	if directory {
		if !info.IsDir() {
			return fmt.Errorf("private path is not a directory")
		}
	} else if !info.Mode().IsRegular() {
		return fmt.Errorf("private path is not a regular file")
	}
	return validateRealmV3FullDataPrivatePathPlatformV1(target, info, directory)
}

func syncRealmV3FullDataParentDirectoryV1(target string) error {
	return syncRealmV3FullDataDirectoryV1(filepath.Dir(target))
}

func syncRealmV3FullDataDirectoryV1(directoryPath string) error {
	directory, err := os.Open(directoryPath)
	if err != nil {
		return fmt.Errorf("open private full-data state directory for sync: %w", err)
	}
	syncErr := syncRealmV3FullDataDirectoryPlatformV1(directory)
	closeErr := directory.Close()
	if err := errors.Join(syncErr, closeErr); err != nil {
		return fmt.Errorf("sync private full-data state directory: %w", err)
	}
	return nil
}

type realmV3FullDataRuntimeRootOwnerV1 struct {
	target string
	file   *os.File
}

func tryAcquireRealmV3FullDataRuntimeRootOwnerV1(runtimeRoot string) (*realmV3FullDataRuntimeRootOwnerV1, error) {
	target := filepath.Join(runtimeRoot, realmV3FullDataRuntimeOwnerLockFileV1)
	if info, err := os.Lstat(target); err == nil {
		if err := validateRealmV3FullDataPrivatePathOwnerV1(target, info, false); err != nil {
			return nil, fmt.Errorf("existing full-data runtime-root owner lock is insecure: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect full-data runtime-root owner lock: %w", err)
	}
	file, err := os.OpenFile(target, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open full-data runtime-root owner lock: %w", err)
	}
	if err := lockRealmV3FullDataFilePlatformV1(file); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("full-data runtime root has another live owner: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = unlockRealmV3FullDataFilePlatformV1(file)
		_ = file.Close()
		return nil, fmt.Errorf("protect full-data runtime-root owner lock: %w", err)
	}
	info, statErr := file.Stat()
	pathErr := validateRealmV3FullDataPrivatePathOwnerV1(target, info, false)
	if statErr != nil || pathErr != nil {
		_ = unlockRealmV3FullDataFilePlatformV1(file)
		_ = file.Close()
		return nil, fmt.Errorf("opened full-data runtime-root owner lock is insecure: %w", errors.Join(statErr, pathErr))
	}
	if err := errors.Join(file.Sync(), syncRealmV3FullDataParentDirectoryV1(target)); err != nil {
		_ = unlockRealmV3FullDataFilePlatformV1(file)
		_ = file.Close()
		return nil, fmt.Errorf("durably establish full-data runtime-root owner lock: %w", err)
	}
	return &realmV3FullDataRuntimeRootOwnerV1{target: target, file: file}, nil
}

func (owner *realmV3FullDataRuntimeRootOwnerV1) release() error {
	if owner == nil || owner.file == nil {
		return nil
	}
	file := owner.file
	owner.file = nil
	// The lock inode is deliberately stable for the entire disposable runtime
	// root lifetime. Unlinking after unlock permits a waiter on the old inode and
	// a new opener on a replacement inode to both hold an exclusive lock.
	return errors.Join(unlockRealmV3FullDataFilePlatformV1(file), file.Close())
}

func acquireRealmV3FullDataRuntimeRootOwnerV1(t *testing.T, runtimeRoot string) func() {
	t.Helper()
	owner, err := tryAcquireRealmV3FullDataRuntimeRootOwnerV1(runtimeRoot)
	if err != nil {
		t.Fatalf("acquire full-data runtime-root owner: %v", err)
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			if err := owner.release(); err != nil {
				t.Fatalf("release full-data runtime-root owner lock: %v", err)
			}
		})
	}
}

func readRealmV3FullDataPrivateJSONV1(t *testing.T, source string, target any) {
	t.Helper()
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		validateRealmV3FullDataPrivatePathOwnerV1(source, info, false) != nil {
		t.Fatalf("private full-data state is unavailable or insecure: %v", err)
	}
	if info.Size() > 1<<20 {
		t.Fatal("private full-data state exceeds the fixed read bound")
	}
	file, err := os.Open(source)
	if err != nil {
		t.Fatalf("open private full-data state: %v", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("decode private full-data state: %v", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		t.Fatal("private full-data state has trailing JSON")
	}
}
