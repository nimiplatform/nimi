package account

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPrimaryRuntimePreparesProofAndPromotesOnlyConfirmedIdentity(t *testing.T) {
	var binding *realmv1.PrimaryRuntimeBindingDto
	var prepared realmv1.PrimaryRuntimePrepareDto
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer access-1" {
			t.Error("missing owner token")
		}
		switch r.URL.Path {
		case realmv1.GetMyPrimaryRuntimePath:
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{AccountId: "acct-1", ServerTime: time.Now().UTC().Format(time.RFC3339Nano), Binding: binding})
		case realmv1.PrepareMyPrimaryRuntimePath:
			if err := json.NewDecoder(r.Body).Decode(&prepared); err != nil {
				t.Error(err)
			}
			key, _ := base64.RawURLEncoding.DecodeString(prepared.PublicKey)
			sig, _ := base64.RawURLEncoding.DecodeString(prepared.Signature)
			payload, _ := json.Marshal([]any{"nimi.primary-runtime/v1", "realm-local", prepared.Operation, "acct-1", prepared.RuntimeId, prepared.ExpectedBindingId, prepared.DisplayName, prepared.PublicKey, prepared.SignedAt})
			if !ed25519.Verify(key, payload, sig) {
				t.Error("invalid host proof")
			}
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeIntentDto{IntentId: "6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7", ExpectedAccountId: "acct-1", RuntimeId: prepared.RuntimeId, DisplayName: prepared.DisplayName, Operation: prepared.Operation, ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), ConfirmationUrl: "https://nimi.ai/account/runtime?intent=6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7"})
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	secrets := newAccountBinarySecretStore()
	svc := newHarnessService(t, &memoryCustody{has: true, material: testMaterial("acct-1", "access-1", "refresh-1")}, WithRealmBaseURL(server.URL), WithRealmHTTPClient(server.Client()), WithCustodyPartition("logon-before-reboot"), func(s *Service) { s.primarySecrets, s.primaryKeyScope = secrets, "install-one\x00os-user-one" })
	projection, generation, done, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("fixture account not live")
	}
	p := protectedprincipal.NewDirect("nimi.desktop", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductProfileID, projection, generation, done, make(chan struct{}))
	ctx := protectedprincipal.With(context.Background(), p)
	if _, err := svc.PreparePrimaryRuntime(context.Background(), &runtimev1.PreparePrimaryRuntimeRequest{Action: "bind", DisplayName: "PC"}); status.Code(err) != codes.PermissionDenied || calls != 0 {
		t.Fatal("unprotected caller reached Realm")
	}
	result, err := svc.PreparePrimaryRuntime(ctx, &runtimev1.PreparePrimaryRuntimeRequest{Action: "bind", DisplayName: "家里的 <PC>&"})
	if err != nil {
		t.Fatal(err)
	}
	if result.IntentId != "6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7" || len(secrets.lastStoreName) > 64 {
		t.Fatal("invalid result or native custody name")
	}
	identity := prepared.RuntimeId
	state, err := svc.GetPrimaryRuntimeState(ctx, &runtimev1.GetPrimaryRuntimeStateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if state.ThisRuntime || state.PrimaryRuntimeId != "" {
		t.Fatal("preparation invented binding")
	}
	binding = &realmv1.PrimaryRuntimeBindingDto{BindingId: "9b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7", LeaseVersion: "ab05fd00-4c98-40dd-9c0c-2ca0d9d60ab7", RuntimeId: identity, PublicKey: prepared.PublicKey, DisplayName: prepared.DisplayName, ValidAfter: time.Now().UTC().Format(time.RFC3339Nano)}
	state, err = svc.GetPrimaryRuntimeState(ctx, &runtimev1.GetPrimaryRuntimeStateRequest{})
	if err != nil || !state.ThisRuntime {
		t.Fatalf("confirmed identity not recognized: %v", err)
	}
	for _, item := range []struct {
		name, scope string
		matches     bool
	}{
		{"same installation after login changes", "install-one\x00os-user-one", true},
		{"another installation", "install-two\x00os-user-one", false},
		{"another OS user", "install-one\x00os-user-two", false},
	} {
		t.Run(item.name, func(t *testing.T) {
			reopened := newHarnessService(t, &memoryCustody{has: true, material: testMaterial("acct-1", "access-1", "refresh-1")}, WithRealmBaseURL(server.URL), WithRealmHTTPClient(server.Client()), WithCustodyPartition("logon-after-reboot"), func(s *Service) { s.primarySecrets, s.primaryKeyScope = secrets, item.scope })
			projection, generation, invalidated, ok := reopened.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("reopened account is unavailable")
			}
			principal := protectedprincipal.NewDirect("nimi.desktop", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductProfileID, projection, generation, invalidated, make(chan struct{}))
			observed, err := reopened.GetPrimaryRuntimeState(protectedprincipal.With(context.Background(), principal), &runtimev1.GetPrimaryRuntimeStateRequest{})
			if err != nil || observed.ThisRuntime != item.matches {
				t.Fatalf("host identity scope changed: matches=%v, error=%v", observed.GetThisRuntime(), err)
			}
			_, controlErr := reopened.BindPrimaryRuntimeControl(context.Background())
			if item.matches && controlErr != nil || !item.matches && status.Code(controlErr) != codes.FailedPrecondition {
				t.Fatalf("host control did not preserve identity admission: %v", controlErr)
			}
		})
	}
	if _, err = svc.PreparePrimaryRuntime(ctx, &runtimev1.PreparePrimaryRuntimeRequest{Action: "reinitialize", ExpectedBindingId: "9b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7", DisplayName: "Replacement"}); err != nil {
		t.Fatal(err)
	}
	if prepared.RuntimeId == identity {
		t.Fatal("reinitialization reused active identity")
	}
	state, err = svc.GetPrimaryRuntimeState(ctx, &runtimev1.GetPrimaryRuntimeStateRequest{})
	if err != nil || !state.ThisRuntime || state.RuntimeId != identity {
		t.Fatal("pending replacement destroyed active identity")
	}
	keys, _, err := svc.loadPrimaryKeys(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	defer clearPrimaryKeys(keys)
	if keys.Pending == nil || keys.Active == nil {
		t.Fatal("missing saved identities")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), prepared.PublicKey) || strings.Contains(string(encoded), base64.StdEncoding.EncodeToString(keys.Active.Seed)) {
		t.Fatal("private carrier leaked")
	}
}
