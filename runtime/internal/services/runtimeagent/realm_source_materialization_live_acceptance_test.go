//go:build realm_v3_live

package runtimeagent

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

// TestRealmSourceMaterializationCurrentRealmLiveAcceptance is intentionally
// build-tagged. The compact runner invokes it only in explicit --live mode;
// missing current Realm authority is a hard failure, never a skip or fixture
// success. Secret values are consumed only by Account custody and are never
// logged or written to acceptance evidence.
func TestRealmSourceMaterializationCurrentRealmLiveAcceptance(t *testing.T) {
	required := []string{
		"NIMI_REALM_V3_LIVE_BASE_URL",
		"NIMI_REALM_V3_LIVE_BEARER",
		"NIMI_REALM_V3_LIVE_REFRESH_TOKEN",
		"NIMI_REALM_V3_LIVE_ACCESS_EXPIRES_AT",
		"NIMI_REALM_V3_LIVE_ACCOUNT_ID",
		"NIMI_REALM_V3_LIVE_EXPECTED_ISSUER",
		"NIMI_REALM_V3_LIVE_POLICY_DIGEST",
		"NIMI_REALM_V3_LIVE_WORLD_SOURCE_REF_JSON",
		"NIMI_REALM_V3_LIVE_PERSONA_SOURCE_REF_JSON",
	}
	missing := make([]string, 0)
	for _, name := range required {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) != 0 {
		t.Fatalf("mandatory current Realm live inputs are missing: %s", strings.Join(missing, ", "))
	}
	if digest := os.Getenv("NIMI_REALM_V3_LIVE_POLICY_DIGEST"); digest != compactRealmMaterializationPolicyDigest {
		t.Fatalf("current Realm policy digest %q does not match admitted policy digest", digest)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, os.Getenv("NIMI_REALM_V3_LIVE_ACCESS_EXPIRES_AT"))
	if err != nil || !expiresAt.After(time.Now().UTC().Add(30*time.Second)) {
		t.Fatalf("current Realm bearer expiry is invalid or too near: %v", err)
	}
	accountID := os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID")
	sourceRefs := []struct {
		name string
		env  string
	}{
		{name: "world-character", env: "NIMI_REALM_V3_LIVE_WORLD_SOURCE_REF_JSON"},
		{name: "persona-character", env: "NIMI_REALM_V3_LIVE_PERSONA_SOURCE_REF_JSON"},
	}
	parsedRefs := make([]sourceMaterializationCharacterSourceRefV3, 0, len(sourceRefs))
	for _, source := range sourceRefs {
		var ref sourceMaterializationCharacterSourceRefV3
		if err := strictDecodeSourceMaterializationV3([]byte(os.Getenv(source.env)), &ref); err != nil {
			t.Fatalf("%s CharacterSourceRefV3 is invalid: %v", source.name, err)
		}
		if err := ref.validate(); err != nil {
			t.Fatalf("%s CharacterSourceRefV3 is invalid: %v", source.name, err)
		}
		if source.name == "world-character" && ref.Kind != "worldCharacter" || source.name == "persona-character" && ref.Kind != "personaCharacter" {
			t.Fatalf("%s input carries wrong source branch %q", source.name, ref.Kind)
		}
		parsedRefs = append(parsedRefs, ref)
	}

	custody := &compactRealmMaterializationCustody{material: accountservice.AccountMaterial{
		AccountID: accountID, DisplayName: "Realm v3 live acceptance", RealmEnvironmentID: "realm-v3-live",
		AccessToken: os.Getenv("NIMI_REALM_V3_LIVE_BEARER"), AccessTokenExpires: expiresAt,
		RefreshToken: os.Getenv("NIMI_REALM_V3_LIVE_REFRESH_TOKEN"),
	}}
	account := accountservice.New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(custody),
		accountservice.WithRealmBaseURL(os.Getenv("NIMI_REALM_V3_LIVE_BASE_URL")),
		accountservice.WithRealmHTTPClient(&http.Client{Timeout: 30 * time.Second}),
	)
	if _, _, ok := account.AuthenticatedRuntimeSecurityContext(context.Background()); !ok {
		t.Fatal("current Realm account custody did not produce an authenticated Runtime security context")
	}

	statePath := filepath.Join(t.TempDir(), "current-realm-live-runtime-state.json")
	svc, closeService := openSourceMaterializationTransportTestService(t, statePath)
	svc.SetRealmSourceMaterializationIssuer(&compactRealmMaterializationAccountIssuer{
		account: account, expectedIssuer: os.Getenv("NIMI_REALM_V3_LIVE_EXPECTED_ISSUER"),
	})
	type product struct {
		localAgentRef string
		snapshotHash  string
		laneHash      string
	}
	products := make([]product, 0, len(parsedRefs))
	for index, ref := range parsedRefs {
		ctx := sourceMaterializationTransportTestContext(accountID)
		request := &runtimev1.MaterializeRealmSourceRequest{
			Context: &runtimev1.AgentRequestContext{
				AppId: "runtime-realm-v3-live-acceptance", SubjectUserId: accountID, OwnerUserId: accountID,
			},
			RequestId: "live-compact-" + sourceRefs[index].name + "-" + time.Now().UTC().Format("20060102T150405.000000000Z"),
			SourceRef: sourceMaterializationProtoRefV3(ref),
		}
		response, materializeErr := svc.MaterializeRealmSource(ctx, request)
		if materializeErr != nil || response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
			closeService()
			t.Fatalf("current Realm %s materialization failed: reason=%s err=%v", sourceRefs[index].name, response.GetReasonCode(), materializeErr)
		}
		store, err := newRealmSourceSnapshotV2Store(svc.backend.DB())
		if err != nil {
			closeService()
			t.Fatal(err)
		}
		snapshot, found, err := store.sourceSnapshot(ctx, response.GetLocalAgentRef())
		if err != nil || !found {
			closeService()
			t.Fatalf("current Realm %s SnapshotV2 missing: found=%v err=%v", sourceRefs[index].name, found, err)
		}
		products = append(products, product{
			localAgentRef: response.GetLocalAgentRef(), snapshotHash: snapshot.SnapshotHash,
			laneHash: compactRealmMaterializationFiveLaneHash(t, snapshot),
		})
		if index == 0 {
			replayed, replayErr := svc.MaterializeRealmSource(ctx, proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest))
			if replayErr != nil || !replayed.GetIdempotentReplay() || replayed.GetLocalAgentRef() != response.GetLocalAgentRef() {
				closeService()
				t.Fatalf("current Realm request replay failed: response=%+v err=%v", replayed, replayErr)
			}
		}
	}
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 2, 2)
	assertCompactRealmMaterializationNoOrphansOrRawResidue(t, svc)
	closeService()

	for coldStart := 1; coldStart <= 2; coldStart++ {
		restarted, closeRestart := openSourceMaterializationTransportTestService(t, statePath)
		store, err := newRealmSourceSnapshotV2Store(restarted.backend.DB())
		if err != nil {
			closeRestart()
			t.Fatal(err)
		}
		if err := store.validatePersistedSnapshots(context.Background()); err != nil {
			closeRestart()
			t.Fatalf("current Realm cold start %d failed: %v", coldStart, err)
		}
		for _, admitted := range products {
			snapshot, found, err := store.sourceSnapshot(context.Background(), admitted.localAgentRef)
			if err != nil || !found || snapshot.SnapshotHash != admitted.snapshotHash || compactRealmMaterializationFiveLaneHash(t, snapshot) != admitted.laneHash {
				closeRestart()
				t.Fatalf("current Realm cold start %d parity failed for %s: found=%v err=%v", coldStart, admitted.localAgentRef, found, err)
			}
		}
		assertCompactRealmMaterializationNoOrphansOrRawResidue(t, restarted)
		closeRestart()
	}
	for _, admitted := range products {
		t.Logf("current Realm live product localAgentRef=%s snapshotHash=%s laneHash=%s", admitted.localAgentRef, admitted.snapshotHash, admitted.laneHash)
	}
}
