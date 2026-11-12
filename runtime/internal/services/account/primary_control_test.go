package account

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPrimaryControlPresenceProofAndAuthorizationFence(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	runtimeID := "86ba1c17-84de-4132-bf83-c201b9ef0521"
	binding := realmv1.PrimaryRuntimeBindingDto{RuntimeId: runtimeID, BindingId: "14e92c91-d872-4a0e-9d72-4ea05bbea917",
		PublicKey:   base64.RawURLEncoding.EncodeToString(public),
		DisplayName: "PC", ValidAfter: time.Now().UTC().Format(time.RFC3339Nano)}
	controlID := "2893d76e-607e-446c-bb9d-52a634ea3514"
	contextID := "43515b26-263b-40f6-875e-04b022c37039"
	connectionID := "feb29b08-c6b3-46c4-a1fb-afb0a7344184"
	wrongOwner := false
	calls := 0
	checkProof := func(signature string, fields []any) {
		t.Helper()
		payload, _ := json.Marshal(append([]any{"nimi.primary-runtime/v1", "realm-local"}, fields...))
		proof, _ := base64.RawURLEncoding.DecodeString(signature)
		if !ed25519.Verify(public, payload, proof) {
			t.Error("control proof does not bind its actual request")
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != realmv1.HeartbeatPrimaryRuntimeControlPath && r.Header.Get("Authorization") != "Bearer access-1" {
			t.Error("owner credential missing")
		}
		serverTime := time.Now().Add(30 * time.Second).UTC()
		switch r.URL.Path {
		case realmv1.GetMyPrimaryRuntimePath:
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{AccountId: "acct-1", Binding: &binding, ServerTime: serverTime.Format(time.RFC3339Nano)})
		case realmv1.RegisterPrimaryRuntimeControlPath:
			var body realmv1.PrimaryRuntimeHostProofDto
			_ = json.NewDecoder(r.Body).Decode(&body)
			checkProof(body.Signature, []any{"register", "acct-1", runtimeID, binding.BindingId, "", primarySignalHash([]string{}), body.SignedAt})
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlRegisterResultDto{ControlSessionId: controlID})
		case realmv1.HeartbeatPrimaryRuntimeControlPath:
			if r.Header.Get("Authorization") != "" {
				t.Error("heartbeat used an Account bearer")
			}
			var body realmv1.RuntimeControlHeartbeatDto
			_ = json.NewDecoder(r.Body).Decode(&body)
			checkProof(body.Signature, []any{"heartbeat", "acct-1", runtimeID, binding.BindingId, controlID, body.Sequence, body.SignalRevision, body.SignedAt})
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlHeartbeatResultDto{Status: "sync_required"})
		case realmv1.SyncPrimaryRuntimeConnectionsPath:
			var body realmv1.RuntimeConnectionSyncDto
			_ = json.NewDecoder(r.Body).Decode(&body)
			checkProof(body.Signature, []any{"signal-sync", "acct-1", runtimeID, binding.BindingId, controlID, primarySignalHash(body.ContextIds), body.SignedAt})
			client := realmv1.RuntimeClientContextDto{AccountId: "acct-1", RealmEnvironmentId: "realm-local", AppId: "nimi.reference", ClientId: "nimi.reference.web", ContextId: contextID,
				ExpiresAt: serverTime.Add(time.Hour).Format(time.RFC3339Nano),
				Primary:   &realmv1.RuntimeClientPrimaryDto{BindingId: binding.BindingId, RuntimeId: runtimeID, PublicKey: binding.PublicKey},
				Source:    &realmv1.RuntimeClientSourceDto{AppId: "nimi.reference", ClientId: "nimi.reference.web", SourceRevision: 1, Role: "app", Origin: "https://example.test", RedirectUri: "https://example.test/callback", AppAccess: []string{"runtime.consume"}}}
			if wrongOwner {
				client.AccountId = "another-account"
			}
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeConnectionSyncResultDto{ServerTime: serverTime.Format(time.RFC3339Nano), AuthorizationExpiresAt: serverTime.Add(time.Minute).Format(time.RFC3339Nano),
				Contexts: []realmv1.RuntimeClientContextDto{client}, Offers: []realmv1.RuntimeConnectionOfferDto{{ConnectionId: connectionID, OfferSdp: "v=0\r\ns=signaling-fixture\r\n", ExpiresAt: serverTime.Add(time.Minute).Format(time.RFC3339Nano), Context: &client}}})
		case realmv1.AnswerPrimaryRuntimeConnectionPath:
			var body realmv1.RuntimeConnectionAnswerDto
			_ = json.NewDecoder(r.Body).Decode(&body)
			checkProof(body.Signature, []any{"signal-answer", "acct-1", runtimeID, binding.BindingId, controlID, primarySignalHash([]string{body.ConnectionId, body.AnswerSdp, body.RejectionReason}), body.SignedAt})
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeConnectionStateDto{ConnectionId: connectionID, BindingId: binding.BindingId, Status: "answered", AnswerSdp: body.AnswerSdp})
		default:
			t.Errorf("unexpected owner operation %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	secrets := newAccountBinarySecretStore()
	svc := newHarnessService(t, &memoryCustody{has: true, material: testMaterial("acct-1", "access-1", "refresh-1")}, WithRealmBaseURL(server.URL), WithRealmHTTPClient(server.Client()), func(s *Service) { s.primarySecrets, s.primaryKeyScope = secrets, "install-one\x00os-user-one" })
	ctx := context.Background()
	_, name, err := svc.loadPrimaryAccountKeys(ctx, "acct-1", "realm-local")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(primaryHostKeys{Version: 1, Active: &primaryHostKey{RuntimeID: runtimeID, Seed: private.Seed()}})
	if err = secrets.Store(ctx, name, encoded); err != nil {
		t.Fatal(err)
	}
	control, err := svc.BindPrimaryRuntimeControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.SyncPrimaryRuntimeConnections(ctx, control, nil); status.Code(err) != codes.Unavailable {
		t.Fatal("sync without registration was admitted")
	}
	if err = svc.RegisterPrimaryRuntimeControl(ctx, control); err != nil {
		t.Fatal(err)
	}
	if heartbeat, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); err != nil || heartbeat != "sync_required" {
		t.Fatalf("heartbeat = %q, %v", heartbeat, err)
	}
	sync, err := svc.SyncPrimaryRuntimeConnections(ctx, control, []string{contextID})
	if err != nil {
		t.Fatal(err)
	}
	remaining := time.Until(sync.AuthorityDeadline)
	if remaining <= 55*time.Second || remaining > time.Minute {
		t.Fatalf("owner clock extended or lost context authorization: %s", remaining)
	}
	if err = svc.AnswerPrimaryRuntimeConnection(ctx, control, connectionID, "v=0\r\ns=<PC>&\r\n", ""); err != nil {
		t.Fatal(err)
	}
	wrongOwner = true
	if _, err = svc.SyncPrimaryRuntimeConnections(ctx, control, []string{contextID}); status.Code(err) != codes.Internal {
		t.Fatal("foreign context escaped owner validation")
	}
	before := calls
	svc.mu.Lock()
	svc.invalidateAuthenticatedRuntimeIdentityLocked()
	svc.mu.Unlock()
	if err = svc.RegisterPrimaryRuntimeControl(ctx, control); status.Code(err) != codes.Unauthenticated || calls != before {
		t.Fatal("old Account control remained usable")
	}
}

func TestPrimaryControlAdmitsExactDevelopmentSchemeContext(t *testing.T) {
	now := time.Now().UTC()
	control := &PrimaryRuntimeControl{accountID: "owner", realmID: "dev", binding: realmv1.PrimaryRuntimeBindingDto{RuntimeId: "runtime", BindingId: "binding", PublicKey: "key"}}
	source := realmv1.RuntimeClientSourceDto{Kind: "android-dev-scheme", AppId: "nimi.editor", ClientId: "nimi.editor.android.dev", SourceRevision: 1, Role: "app", Origin: "ai.nimi.editor.dev:/", RedirectUri: "ai.nimi.editor.dev:/oauth/callback"}
	item := realmv1.RuntimeClientContextDto{AccountId: "owner", RealmEnvironmentId: "dev", AppId: source.AppId, ClientId: source.ClientId,
		ContextId: "43515b26-263b-40f6-875e-04b022c37039", ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), Source: &source,
		Primary: &realmv1.RuntimeClientPrimaryDto{RuntimeId: "runtime", BindingId: "binding", PublicKey: "key"}}
	if !validRemoteClientContext(control, &item, now) {
		t.Fatal("registered development source was rejected")
	}
	for _, change := range []func(*realmv1.RuntimeClientSourceDto){
		func(s *realmv1.RuntimeClientSourceDto) { s.Role = "official_manager" },
		func(s *realmv1.RuntimeClientSourceDto) { s.Origin = "ai.nimi.other:/" },
		func(s *realmv1.RuntimeClientSourceDto) { s.RedirectUri = "ai.nimi.editor.dev://host/oauth/callback" },
		func(s *realmv1.RuntimeClientSourceDto) { s.RedirectUri = "ai.nimi.editor.dev:/oauth/callback?" },
		func(s *realmv1.RuntimeClientSourceDto) { s.Kind = "web" },
	} {
		candidate := source
		change(&candidate)
		item.Source = &candidate
		if validRemoteClientContext(control, &item, now) {
			t.Fatal("invalid development source was admitted")
		}
	}
}
