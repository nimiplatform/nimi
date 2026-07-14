package localappkernel

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"
)

var testNow = time.Date(2026, 7, 13, 12, 30, 0, 123, time.UTC)

func TestVerifiedSIDPartitionFailsClosedAcrossRestart(t *testing.T) {
	ctx := context.Background()
	valid, err := ValidateVerifiedInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", " S-1-5-18", "S-2-5-18", "S-1-05-18", "S-1-5-admin"} {
		if _, err := ValidateVerifiedInteractiveUserSID(invalid); !errors.Is(err, ErrInvalidArgument) {
			t.Fatalf("ValidateVerifiedInteractiveUserSID(%q) error = %v", invalid, err)
		}
	}
	path := filepath.Join(t.TempDir(), "local-app.db")
	kernel, err := OpenSQLite(ctx, path, valid, Options{Now: func() time.Time { return testNow }})
	if err != nil {
		t.Fatal(err)
	}
	anchor := kernel.LocalOSUserAnchor()
	if anchor == "" || anchor == "S-1-5-21-100-200-300-1001" {
		t.Fatalf("anchor must be a non-SID opaque derivation, got %q", anchor)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, path, valid, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.LocalOSUserAnchor() != anchor {
		t.Fatalf("anchor changed across restart: %q != %q", reopened.LocalOSUserAnchor(), anchor)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}
	other, err := ValidateVerifiedInteractiveUserSID("S-1-5-21-100-200-300-1002")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenSQLite(ctx, path, other, Options{}); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("different SID error = %v, want ErrPartitionMismatch", err)
	}
}

func TestPrincipalLineageAndRandomNonReuse(t *testing.T) {
	ctx := context.Background()
	entropyA := bytes.Repeat([]byte{0x11}, 32)
	entropyB := bytes.Repeat([]byte{0x22}, 32)
	random := bytes.NewReader(append(append(entropyA, entropyA...), entropyB...))
	kernel := openTestKernel(t, Options{Random: random, Now: func() time.Time { return testNow }})
	defer kernel.Close()

	if _, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindImmutable, AppID: "com.example.app", ImmutableLineageID: "lineage:one",
		DevelopmentAuthorizationID: "forbidden",
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("mixed lineage error = %v", err)
	}
	first, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.app",
		DevelopmentAuthorizationID: "dev-auth:one", CanonicalProjectFileID: "file-id:one",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.app",
		DevelopmentAuthorizationID: "dev-auth:two", CanonicalProjectFileID: "file-id:two",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.LocalAppPrincipalID == second.LocalAppPrincipalID {
		t.Fatal("random collision was reused")
	}
	if first.AppID != second.AppID {
		t.Fatal("test requires equal display app_id")
	}
	resolved, err := kernel.Principals().GetByDevelopmentAuthorizationID(ctx, "dev-auth:one")
	if err != nil || !reflect.DeepEqual(resolved, first) {
		t.Fatalf("development authorization lookup = (%+v, %v), want %+v", resolved, err, first)
	}
	if _, err := kernel.Principals().GetByDevelopmentAuthorizationID(ctx, "dev-auth:missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing development authorization error = %v", err)
	}
	tombstoned, err := kernel.Principals().Tombstone(ctx, first.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err = kernel.Principals().GetByDevelopmentAuthorizationID(ctx, "dev-auth:one")
	if err != nil || !reflect.DeepEqual(resolved, tombstoned) {
		t.Fatalf("tombstoned development authorization lookup = (%+v, %v), want %+v", resolved, err, tombstoned)
	}
}

func TestStoresUseSeparateTablesWithoutGrantFieldsInRecord(t *testing.T) {
	kernel := openTestKernel(t, Options{})
	defer kernel.Close()
	rows, err := kernel.db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('local_app_principals','local_app_records','local_app_grants') ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	wantTables := []string{"local_app_grants", "local_app_principals", "local_app_records"}
	if !reflect.DeepEqual(tables, wantTables) {
		t.Fatalf("tables = %v, want %v", tables, wantTables)
	}
	columns := tableColumns(t, kernel.db, "local_app_records")
	for _, forbidden := range []string{"grant_boolean", "permission_result", "account_owner", "session_proof", "operation_policy_result"} {
		if _, found := columns[forbidden]; found {
			t.Fatalf("record table contains forbidden owner field %q", forbidden)
		}
	}
	if indexes := indexedColumns(t, kernel.db, "local_app_principals"); contains(indexes, "app_id") {
		t.Fatalf("principal table has forbidden app_id lookup index: %v", indexes)
	}
}

func TestRecordRequiresMatchingPrincipalKindAndOneCurrentRecord(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer kernel.Close()
	principal := createDevelopmentPrincipal(t, kernel, "dev-auth:record", "file-id:record", "com.example.record")
	input := recordInput(principal.LocalAppPrincipalID)
	input.TrustClass = TrustClassVerified
	if _, err := kernel.Records().Create(ctx, input); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("mismatched trust class error = %v", err)
	}
	input.TrustClass = TrustClassLocalDevelopment
	record, err := kernel.Records().Create(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	got, err := kernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, record) {
		t.Fatalf("record round trip = %#v, want %#v", got, record)
	}
	if _, err := kernel.Records().Create(ctx, input); err == nil {
		t.Fatal("second current record unexpectedly succeeded")
	}
}

func TestTombstoneRemovesRecordAndNeverInheritsGrantOrKeys(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer kernel.Close()
	oldPrincipal := createDevelopmentPrincipal(t, kernel, "dev-auth:old", "file-id:same", "com.example.same")
	if _, err := kernel.Records().Create(ctx, recordInput(oldPrincipal.LocalAppPrincipalID)); err != nil {
		t.Fatal(err)
	}
	oldKeys, err := kernel.SecurityKeys().Derive(ctx, "account-a", oldPrincipal.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	grant := createPendingGrant(t, kernel, "account-a", oldPrincipal.LocalAppPrincipalID, "capfp:one", 1, 1, "")
	if _, err := kernel.Grants().Transition(ctx, "account-a", oldPrincipal.LocalAppPrincipalID, "capfp:one", grant.GrantRevision, GrantStateGranted, "presence:approve"); err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.Principals().Tombstone(ctx, oldPrincipal.LocalAppPrincipalID); err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.Records().GetByPrincipalID(ctx, oldPrincipal.LocalAppPrincipalID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("record after tombstone error = %v", err)
	}
	if _, err := kernel.Grants().GetCurrent(ctx, "account-a", oldPrincipal.LocalAppPrincipalID, "capfp:one"); !errors.Is(err, ErrPrincipalTombstoned) {
		t.Fatalf("grant after tombstone error = %v", err)
	}
	if _, err := kernel.SecurityKeys().Derive(ctx, "account-a", oldPrincipal.LocalAppPrincipalID); !errors.Is(err, ErrPrincipalTombstoned) {
		t.Fatalf("keys after tombstone error = %v", err)
	}
	if _, err := kernel.Principals().Tombstone(ctx, oldPrincipal.LocalAppPrincipalID); !errors.Is(err, ErrPrincipalTombstoned) {
		t.Fatalf("second tombstone error = %v", err)
	}
	newPrincipal := createDevelopmentPrincipal(t, kernel, "dev-auth:new", "file-id:same", "com.example.same")
	if newPrincipal.LocalAppPrincipalID == oldPrincipal.LocalAppPrincipalID {
		t.Fatal("reauthorization reused tombstoned principal")
	}
	newKeys, err := kernel.SecurityKeys().Derive(ctx, "account-a", newPrincipal.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	if newKeys == oldKeys {
		t.Fatal("reauthorization inherited old security keys")
	}
	if _, err := kernel.Grants().GetCurrent(ctx, "account-a", newPrincipal.LocalAppPrincipalID, "capfp:one"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("new principal inherited grant: %v", err)
	}
}

func TestGrantKeyIncludesAccountPrincipalAndFingerprint(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer kernel.Close()
	principal := createDevelopmentPrincipal(t, kernel, "dev-auth:grant", "file-id:grant", "com.example.grant")
	grant := createPendingGrant(t, kernel, "account-a", principal.LocalAppPrincipalID, "capfp:one", 1, 1, "")
	granted, err := kernel.Grants().Transition(ctx, "account-a", principal.LocalAppPrincipalID, "capfp:one", 1, GrantStateGranted, "presence:grant")
	if err != nil {
		t.Fatal(err)
	}
	if granted.State != GrantStateGranted || granted.GrantRevision != 2 {
		t.Fatalf("granted = %#v", granted)
	}
	if _, err := kernel.Grants().GetCurrent(ctx, "account-b", principal.LocalAppPrincipalID, "capfp:one"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("account switch transferred grant: %v", err)
	}
	if _, err := kernel.Grants().Transition(ctx, "account-a", principal.LocalAppPrincipalID, "capfp:one", 2, GrantStateDenied, ""); !errors.Is(err, ErrGrantTransition) {
		t.Fatalf("invalid granted->denied transition error = %v", err)
	}
	revoked, err := kernel.Grants().Transition(ctx, "account-a", principal.LocalAppPrincipalID, "capfp:one", 2, GrantStateRevoked, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.Grants().CreatePending(ctx, CreatePendingGrantInput{
		AccountID: "account-a", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		CapabilityScope: []string{"runtime_agent.invoke"}, ResourceScope: []string{"agent:one"},
		CapabilityResourceFingerprint: "capfp:one", GrantGeneration: 2, GrantRevision: 4,
		SupersedesGrantID: "wrong", PresenceEvidenceRef: "presence:new-request",
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("wrong supersedes error = %v", err)
	}
	next := createPendingGrant(t, kernel, "account-a", principal.LocalAppPrincipalID, "capfp:one", 2, 4, revoked.GrantID)
	if next.GrantID == grant.GrantID || next.State != GrantStatePending {
		t.Fatalf("next grant = %#v", next)
	}
}

func TestProvenanceAdvanceAtomicallyRecordsInvalidationWithoutGrantMutation(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{Now: func() time.Time { return testNow }})
	defer kernel.Close()
	principal := createDevelopmentPrincipal(t, kernel, "dev-auth:promotion", "file-id:promotion", "com.example.promotion")
	if _, err := kernel.Records().Create(ctx, recordInput(principal.LocalAppPrincipalID)); err != nil {
		t.Fatal(err)
	}
	grant := createPendingGrant(t, kernel, "account-a", principal.LocalAppPrincipalID, "capfp:one", 1, 1, "")
	grant, err := kernel.Grants().Transition(ctx, "account-a", principal.LocalAppPrincipalID, "capfp:one", grant.GrantRevision, GrantStateGranted, "presence:grant")
	if err != nil {
		t.Fatal(err)
	}
	fact, err := kernel.Records().AdvanceProvenanceRevision(ctx, principal.LocalAppPrincipalID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if fact.PreviousRevision != 1 || fact.CurrentRevision != 2 || !fact.LaunchLeasesInvalidated || !fact.SessionsInvalidated || fact.GrantStateChanged {
		t.Fatalf("invalidation fact = %#v", fact)
	}
	record, err := kernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	if record.ProvenanceRevision != 2 {
		t.Fatalf("record revision = %d", record.ProvenanceRevision)
	}
	unchangedGrant, err := kernel.Grants().GetCurrent(ctx, "account-a", principal.LocalAppPrincipalID, "capfp:one")
	if err != nil {
		t.Fatal(err)
	}
	if unchangedGrant.State != grant.State || unchangedGrant.GrantRevision != grant.GrantRevision || unchangedGrant.GrantID != grant.GrantID {
		t.Fatalf("grant changed during provenance advance: %#v -> %#v", grant, unchangedGrant)
	}
	if _, err := kernel.Records().AdvanceProvenanceRevision(ctx, principal.LocalAppPrincipalID, 1); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale revision error = %v", err)
	}
	facts, err := kernel.Records().ListInvalidationFacts(ctx, principal.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[0] != fact {
		t.Fatalf("facts = %#v, want %#v", facts, fact)
	}
}

func TestSecurityKeysIsolateAccountAndEqualDisplayAppID(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer kernel.Close()
	first := createDevelopmentPrincipal(t, kernel, "dev-auth:key-one", "file-id:key-one", "com.example.same")
	second := createDevelopmentPrincipal(t, kernel, "dev-auth:key-two", "file-id:key-two", "com.example.same")
	firstA, err := kernel.SecurityKeys().Derive(ctx, "account-a", first.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	firstB, err := kernel.SecurityKeys().Derive(ctx, "account-b", first.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	secondA, err := kernel.SecurityKeys().Derive(ctx, "account-a", second.LocalAppPrincipalID)
	if err != nil {
		t.Fatal(err)
	}
	if firstA.StoragePartitionKey == firstB.StoragePartitionKey || firstA.AudienceKey == firstB.AudienceKey {
		t.Fatal("account switch retained account-scoped storage or audience key")
	}
	if firstA.AuditSubjectKey != firstB.AuditSubjectKey {
		t.Fatal("machine-local audit subject changed with account")
	}
	if firstA == secondA {
		t.Fatal("equal display app_id collapsed distinct principals")
	}
}

func openTestKernel(t *testing.T, options Options) *Kernel {
	t.Helper()
	sid, err := ValidateVerifiedInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "local-app.db"), sid, options)
	if err != nil {
		t.Fatal(err)
	}
	return kernel
}

func createDevelopmentPrincipal(t *testing.T, kernel *Kernel, authorizationID string, fileID string, appID string) Principal {
	t.Helper()
	principal, err := kernel.Principals().Create(context.Background(), CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: appID,
		DevelopmentAuthorizationID: authorizationID, CanonicalProjectFileID: fileID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return principal
}

func recordInput(principalID string) CreateRecordInput {
	return CreateRecordInput{
		LocalAppPrincipalID: principalID, TrustClass: TrustClassLocalDevelopment,
		ProvenanceAttestationRefs: []string{"dev-attestation:one"}, ProvenanceRevision: 1,
		ActiveReleaseOrProjectIdentityRef: "project:file-id", InstallOrProjectGeneration: 1,
		ActiveCapabilityFingerprint: "capability-fingerprint:one", ExecutionProfileRef: "execution-profile:electron",
		HostExecutableDigest: "sha256:host", PayloadRootDigest: "sha256:payload", LifecycleState: LifecycleStateActive,
	}
}

func createPendingGrant(t *testing.T, kernel *Kernel, accountID string, principalID string, fingerprint string, generation uint64, revision uint64, supersedes string) Grant {
	t.Helper()
	grant, err := kernel.Grants().CreatePending(context.Background(), CreatePendingGrantInput{
		AccountID: accountID, LocalAppPrincipalID: principalID,
		CapabilityScope: []string{"runtime_agent.invoke"}, ResourceScope: []string{"agent:one"},
		CapabilityResourceFingerprint: fingerprint, GrantGeneration: generation, GrantRevision: revision,
		SupersedesGrantID: supersedes, PresenceEvidenceRef: "presence:request",
	})
	if err != nil {
		t.Fatal(err)
	}
	return grant
}

func tableColumns(t *testing.T, db *sql.DB, table string) map[string]struct{} {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns := make(map[string]struct{})
	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		columns[name] = struct{}{}
	}
	return columns
}

func indexedColumns(t *testing.T, db *sql.DB, table string) []string {
	t.Helper()
	rows, err := db.Query(`PRAGMA index_list(` + table + `)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var indexes []string
	for rows.Next() {
		var sequence int
		var name string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&sequence, &name, &unique, &origin, &partial); err != nil {
			t.Fatal(err)
		}
		indexes = append(indexes, name)
	}
	var columns []string
	for _, index := range indexes {
		info, err := db.Query(`PRAGMA index_info(` + index + `)`)
		if err != nil {
			t.Fatal(err)
		}
		for info.Next() {
			var sequence int
			var cid int
			var name string
			if err := info.Scan(&sequence, &cid, &name); err != nil {
				info.Close()
				t.Fatal(err)
			}
			columns = append(columns, name)
		}
		info.Close()
	}
	sort.Strings(columns)
	return columns
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
