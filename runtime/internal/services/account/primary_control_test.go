package account

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSlowAnswersAllowHeartbeatAndFenceReplacedControl(t *testing.T) {
	for _, replace := range []bool{false, true} {
		t.Run(fmt.Sprintf("replace-%t", replace), func(t *testing.T) {
			public, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			binding := realmv1.PrimaryRuntimeBindingDto{RuntimeId: "86ba1c17-84de-4132-bf83-c201b9ef0521", BindingId: "14e92c91-d872-4a0e-9d72-4ea05bbea917",
				PublicKey: base64.RawURLEncoding.EncodeToString(public), DisplayName: "PC", ValidAfter: time.Now().UTC().Format(time.RFC3339Nano)}
			entered := make(chan struct{}, 5)
			release := make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			var registrations atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case realmv1.GetMyPrimaryRuntimePath:
					_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{AccountId: "acct-1", Binding: &binding, ServerTime: time.Now().UTC().Format(time.RFC3339Nano)})
				case realmv1.RegisterPrimaryRuntimeControlPath:
					w.WriteHeader(201)
					_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlRegisterResultDto{ControlSessionId: fmt.Sprintf("%08x-607e-446c-bb9d-52a634ea3514", registrations.Add(1))})
				case realmv1.HeartbeatPrimaryRuntimeControlPath:
					w.WriteHeader(201)
					_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlHeartbeatResultDto{Status: "idle"})
				case realmv1.AnswerPrimaryRuntimeConnectionPath:
					var request realmv1.RuntimeConnectionAnswerDto
					_ = json.NewDecoder(r.Body).Decode(&request)
					entered <- struct{}{}
					<-release
					w.WriteHeader(201)
					_ = json.NewEncoder(w).Encode(realmv1.RuntimeConnectionStateDto{ConnectionId: request.ConnectionId, BindingId: binding.BindingId, Status: "answered", AnswerSdp: request.AnswerSdp})
				default:
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			defer unblock()
			secrets := newAccountBinarySecretStore()
			svc := newHarnessService(t, &memoryCustody{has: true, material: testMaterial("acct-1", "access-1", "refresh-1")}, WithRealmBaseURL(server.URL), WithRealmHTTPClient(server.Client()), func(s *Service) { s.primarySecrets, s.primaryKeyScope = secrets, "answer-test\x00os-user" })
			ctx := context.Background()
			_, key, err := svc.loadPrimaryAccountKeys(ctx, "acct-1", "realm-local")
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(primaryHostKeys{Version: 1, Active: &primaryHostKey{RuntimeID: binding.RuntimeId, Seed: private.Seed()}})
			if err := secrets.Store(ctx, key, encoded); err != nil {
				t.Fatal(err)
			}
			control, err := svc.BindPrimaryRuntimeControl(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.RegisterPrimaryRuntimeControl(ctx, control); err != nil {
				t.Fatal(err)
			}
			answers := make(chan error, 5)
			for i := range 5 {
				go func() {
					answers <- svc.AnswerPrimaryRuntimeConnection(ctx, control, fmt.Sprintf("%08x-c6b3-46c4-a1fb-afb0a7344184", i+1), "v=0\r\ns=answer\r\n", "")
				}()
			}
			deadline := time.After(3 * time.Second)
			for range 5 {
				select {
				case <-entered:
				case <-deadline:
					t.Fatal("answers were serialized across network IO")
				}
			}
			heartbeat := make(chan error, 1)
			go func() { _, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); heartbeat <- err }()
			select {
			case err := <-heartbeat:
				if err != nil {
					t.Fatal(err)
				}
			case <-deadline:
				t.Fatal("heartbeat blocked behind answers")
			}
			if replace {
				if err := svc.RegisterPrimaryRuntimeControl(ctx, control); err != nil {
					t.Fatal(err)
				}
			}
			unblock()
			for range 5 {
				err := <-answers
				if replace && status.Code(err) != codes.Aborted {
					t.Fatalf("old control result accepted: %v", err)
				}
				if !replace && err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

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

func TestPrimaryControlFailsClosedOnNaturalAccessTokenExpiryAndRecoversOnRefresh(t *testing.T) {
	clock := newControllableClock(time.Date(2026, 11, 27, 16, 0, 0, 0, time.UTC))
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	runtimeID := "86ba1c17-84de-4132-bf83-c201b9ef0521"
	binding := realmv1.PrimaryRuntimeBindingDto{
		RuntimeId:   runtimeID,
		BindingId:   "14e92c91-d872-4a0e-9d72-4ea05bbea917",
		PublicKey:   base64.RawURLEncoding.EncodeToString(public),
		DisplayName: "PC",
		ValidAfter:  clock.Now().Format(time.RFC3339Nano),
	}
	controlID := "2893d76e-607e-446c-bb9d-52a634ea3514"
	connectionID := "feb29b08-c6b3-46c4-a1fb-afb0a7344184"

	var (
		mu                  sync.Mutex
		tokenExpired        bool
		refreshOffline      bool
		lastAuthorizedToken string
	)
	var (
		controlRequests   atomic.Int32
		heartbeatRequests atomic.Int32
		refreshRequests   atomic.Int32
		expiredBearerSeen atomic.Bool
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == realmv1.RefreshTokenOperation.Path() {
			refreshRequests.Add(1)
			_, _ = w.Write([]byte(`{"accessToken":"access-2","refreshToken":"refresh-2","tokenType":"Bearer","expiresIn":300}`))
			return
		}
		authHeader := r.Header.Get("Authorization")
		mu.Lock()
		expired := tokenExpired
		if authHeader != "" {
			lastAuthorizedToken = authHeader
		}
		mu.Unlock()
		if expired && authHeader == "Bearer access-1" {
			expiredBearerSeen.Store(true)
		}
		controlRequests.Add(1)
		serverTime := time.Now().UTC()
		switch r.URL.Path {
		case realmv1.GetMyPrimaryRuntimePath:
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{
				AccountId:  "acct-1",
				Binding:    &binding,
				ServerTime: serverTime.Format(time.RFC3339Nano),
			})
		case realmv1.RegisterPrimaryRuntimeControlPath:
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlRegisterResultDto{ControlSessionId: controlID})
		case realmv1.HeartbeatPrimaryRuntimeControlPath:
			heartbeatRequests.Add(1)
			if authHeader != "" {
				t.Errorf("heartbeat must not send an Account bearer, got %q", authHeader)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlHeartbeatResultDto{Status: "idle"})
		case realmv1.SyncPrimaryRuntimeConnectionsPath:
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeConnectionSyncResultDto{
				ServerTime:             serverTime.Format(time.RFC3339Nano),
				AuthorizationExpiresAt: serverTime.Add(time.Minute).Format(time.RFC3339Nano),
			})
		case realmv1.AnswerPrimaryRuntimeConnectionPath:
			var body realmv1.RuntimeConnectionAnswerDto
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeConnectionStateDto{
				ConnectionId: body.ConnectionId,
				BindingId:    binding.BindingId,
				Status:       "answered",
				AnswerSdp:    body.AnswerSdp,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	baseTransport := server.Client().Transport
	httpClient := &http.Client{
		Transport: accountRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path == realmv1.RefreshTokenOperation.Path() {
				mu.Lock()
				offline := refreshOffline
				mu.Unlock()
				if offline {
					return nil, errors.New("dial tcp: network unreachable")
				}
			}
			return baseTransport.RoundTrip(req)
		}),
	}

	initial := testMaterial("acct-1", "access-1", "refresh-1")
	initial.RealmOrigin = server.URL
	initial.AccessTokenExpires = clock.Now().Add(5 * time.Minute)
	custody := &refreshRestartProofCustody{material: initial, has: true}
	cfg := resolveProductionConfig(ProductionConfig{RealmBaseURL: server.URL, HTTPClient: httpClient})
	refresher := newRealmTokenRefresher(cfg)
	refresher.now = clock.Now

	secrets := newAccountBinarySecretStore()
	svc := newHarnessService(t, nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("primary-control-expiry"),
		WithRealmBaseURL(server.URL),
		WithRealmHTTPClient(httpClient),
		WithRefresher(refresher),
		WithClock(clock.Now),
		func(s *Service) {
			s.primarySecrets, s.primaryKeyScope = secrets, "expiry-test\x00os-user"
		},
	)
	stopAccountRefreshTimer(t, svc)

	ctx := context.Background()
	_, keyName, err := svc.loadPrimaryAccountKeys(ctx, "acct-1", "realm-local")
	if err != nil {
		t.Fatal(err)
	}
	encodedKeys, _ := json.Marshal(primaryHostKeys{
		Version: 1,
		Active:  &primaryHostKey{RuntimeID: runtimeID, Seed: private.Seed()},
	})
	if err := secrets.Store(ctx, keyName, encodedKeys); err != nil {
		t.Fatal(err)
	}

	proj, gen, fence, localLive := svc.BindAuthenticatedRuntimeGeneration(ctx)
	if !localLive || proj.GetAccountId() != "acct-1" {
		t.Fatalf("baseline local identity = (%+v, %d, %v)", proj, gen, localLive)
	}
	control, err := svc.BindPrimaryRuntimeControl(ctx)
	if err != nil {
		t.Fatalf("baseline BindPrimaryRuntimeControl: %v", err)
	}
	if err := svc.RegisterPrimaryRuntimeControl(ctx, control); err != nil {
		t.Fatalf("baseline RegisterPrimaryRuntimeControl: %v", err)
	}
	if hb, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); err != nil || hb != "idle" {
		t.Fatalf("baseline HeartbeatPrimaryRuntimeControl = (%q, %v)", hb, err)
	}
	if !svc.primaryControlOnlineCredentialsLive(control) || !svc.PrimaryControlOnlineCredentialsLive(control) {
		t.Fatal("baseline primaryControlOnlineCredentialsLive must be true")
	}
	if _, _, selected := svc.RemoteAccessSettingsOwner(); !selected {
		t.Fatal("baseline RemoteAccessSettingsOwner must be true")
	}

	// Advance controlled clock past natural access-token expiry while offline.
	mu.Lock()
	tokenExpired = true
	refreshOffline = true
	mu.Unlock()
	clock.Advance(10 * time.Minute)

	// Local login stays live; online bearer and primary control eligibility fail closed.
	afterProj, afterGen, afterFence, afterLocalLive := svc.BindAuthenticatedRuntimeGeneration(ctx)
	if !afterLocalLive || afterProj.GetAccountId() != "acct-1" || afterGen != gen || afterFence != fence {
		t.Fatalf("natural access-token expiry disrupted local login: proj=%+v gen=%d(want %d) live=%v", afterProj, afterGen, gen, afterLocalLive)
	}
	select {
	case <-fence:
		t.Fatal("natural access-token expiry closed local identity fence")
	default:
	}
	if committed, commitErr := svc.CommitAuthenticatedRuntimeGeneration(ctx, afterProj.GetAccountId(), afterProj.GetRealmEnvironmentId(), afterGen, func() error { return nil }); !committed || commitErr != nil {
		t.Fatalf("local commit failed after natural access-token expiry: committed=%v err=%v", committed, commitErr)
	}
	svc.mu.RLock()
	onlineBearerLive := svc.onlineAccessTokenLiveLocked()
	svc.mu.RUnlock()
	if onlineBearerLive {
		t.Fatal("online bearer must not be live after AccessTokenExpires")
	}
	if svc.primaryControlOnlineCredentialsLive(control) || svc.PrimaryControlOnlineCredentialsLive(control) {
		t.Fatal("primaryControlOnlineCredentialsLive must be false after AccessTokenExpires")
	}
	if _, _, selected := svc.RemoteAccessSettingsOwner(); selected {
		t.Fatal("RemoteAccessSettingsOwner must be false after AccessTokenExpires")
	}

	beforeControl := controlRequests.Load()
	beforeHeartbeats := heartbeatRequests.Load()
	if _, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired HeartbeatPrimaryRuntimeControl error = %v, want Unauthenticated", err)
	}
	if _, err := svc.SyncPrimaryRuntimeConnections(ctx, control, nil); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired SyncPrimaryRuntimeConnections error = %v, want Unauthenticated", err)
	}
	if err := svc.AnswerPrimaryRuntimeConnection(ctx, control, connectionID, "v=0\r\ns=answer\r\n", ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired AnswerPrimaryRuntimeConnection error = %v, want Unauthenticated", err)
	}
	if err := svc.RegisterPrimaryRuntimeControl(ctx, control); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired RegisterPrimaryRuntimeControl error = %v, want Unauthenticated", err)
	}
	if controlRequests.Load() != beforeControl || heartbeatRequests.Load() != beforeHeartbeats {
		t.Fatalf("expired primary control leaked Realm requests: control=%d->%d heartbeats=%d->%d",
			beforeControl, controlRequests.Load(), beforeHeartbeats, heartbeatRequests.Load())
	}
	if _, err := svc.BindPrimaryRuntimeControl(ctx); status.Code(err) != codes.Unavailable {
		t.Fatalf("offline expired BindPrimaryRuntimeControl error = %v, want Unavailable", err)
	}
	if expiredBearerSeen.Load() {
		t.Fatal("expired access token was sent to Realm")
	}

	// Bring Realm back online and refresh the online token (same account).
	mu.Lock()
	refreshOffline = false
	mu.Unlock()
	refreshRes, err := svc.refreshAccountSessionInternal(ctx, true)
	if err != nil || !refreshRes.accepted {
		t.Fatalf("refreshAccountSessionInternal = (%+v, %v)", refreshRes, err)
	}
	svc.mu.RLock()
	onlineBearerLive = svc.onlineAccessTokenLiveLocked()
	svc.mu.RUnlock()
	if !onlineBearerLive || !svc.primaryControlOnlineCredentialsLive(control) || !svc.PrimaryControlOnlineCredentialsLive(control) {
		t.Fatal("refreshed online token did not restore primaryControlOnlineCredentialsLive")
	}
	if _, _, selected := svc.RemoteAccessSettingsOwner(); !selected {
		t.Fatal("refreshed online token did not restore RemoteAccessSettingsOwner")
	}
	if hb, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); err != nil || hb != "idle" {
		t.Fatalf("recovered HeartbeatPrimaryRuntimeControl = (%q, %v)", hb, err)
	}
	if _, err := svc.SyncPrimaryRuntimeConnections(ctx, control, nil); err != nil {
		t.Fatalf("recovered SyncPrimaryRuntimeConnections: %v", err)
	}
	if err := svc.AnswerPrimaryRuntimeConnection(ctx, control, connectionID, "v=0\r\ns=recovered\r\n", ""); err != nil {
		t.Fatalf("recovered AnswerPrimaryRuntimeConnection: %v", err)
	}
	mu.Lock()
	gotBearer := lastAuthorizedToken
	mu.Unlock()
	if gotBearer != "Bearer access-2" {
		t.Fatalf("recovered authorized bearer = %q, want Bearer access-2", gotBearer)
	}
	if expiredBearerSeen.Load() {
		t.Fatal("expired access token was sent to Realm during recovery")
	}
	_, finalGen, finalFence, finalLive := svc.BindAuthenticatedRuntimeGeneration(ctx)
	if !finalLive || finalGen != gen || finalFence != fence {
		t.Fatalf("same-account refresh disrupted local identity: gen=%d(want %d) live=%v", finalGen, gen, finalLive)
	}
}
