package account

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAcquireRealmSourceMaterializationDecidesPendingGrantAndUsesSameID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var mu sync.Mutex
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		mu.Lock()
		paths = append(paths, request.Method+" "+request.URL.Path)
		mu.Unlock()
		if request.Header.Get("Authorization") != "Bearer access-1" || request.Header.Get("Accept-Encoding") != "identity" {
			t.Errorf("private Realm headers = authorization %q, encoding %q", request.Header.Get("Authorization"), request.Header.Get("Accept-Encoding"))
		}
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case realmSourceMaterializationRequestGrantPath:
			body := decodeRealmSourceMaterializationRequestBody(t, request)
			if len(body) != 4 || body["appId"] != realmSourceMaterializationAppID || body["scopeFamily"] != realmSourceMaterializationScopeFamily || body["scopeName"] != realmSourceMaterializationScopeName || body["reason"] != realmSourceMaterializationRequestReason {
				t.Errorf("grant request body = %#v", body)
			}
			if _, exists := body["qualifier"]; exists {
				t.Error("Realm grant request must omit qualifier")
			}
			_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "PENDING", 7, "grant-7", nil))
		case realmSourceMaterializationGrantPathPrefix + "grant-7/grant":
			body := decodeRealmSourceMaterializationRequestBody(t, request)
			if len(body) != 1 || body["expectedVersion"] != float64(7) {
				t.Errorf("grant decision body = %#v", body)
			}
			_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "GRANTED", 8, "grant-7", nil))
		case realmSourceMaterializationPacketPath:
			body := decodeRealmSourceMaterializationRequestBody(t, request)
			if body["accessGrantId"] != "grant-7" || body["materializerAccountId"] != "acct-1" || body["challengeId"] != "challenge-123456" {
				t.Errorf("packet request binding = %#v", body)
			}
			sourceRef, _ := body["sourceRef"].(map[string]any)
			worldEntityRef, _ := sourceRef["worldEntityRef"].(map[string]any)
			if len(sourceRef) != 5 || sourceRef["kind"] != "worldCharacter" || worldEntityRef["kind"] != "worldEntity" || worldEntityRef["worldId"] != "world-1" || worldEntityRef["entityId"] != "entity-1" {
				t.Errorf("packet source ref = %#v", sourceRef)
			}
			limits, _ := body["publishedLimits"].(map[string]any)
			if len(limits) != 8 || limits["maxSetSegments"] != float64(64) || limits["maxSetBytes"] != float64(134217728) {
				t.Errorf("packet published limits = %#v", limits)
			}
			response.WriteHeader(http.StatusCreated)
			_, _ = response.Write([]byte(`{"packetSchemaVersion":"realm.source-materialization-packet/v3"}`))
		default:
			t.Errorf("unexpected Realm path %s", request.URL.Path)
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	service := newRealmSourceMaterializationHarness(t, server, now)
	acquisition, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
	if err != nil {
		t.Fatalf("AcquireRealmSourceMaterialization: %v", err)
	}
	defer acquisition.PacketResponse.Body.Close()
	if acquisition.AccountLease.AccountID != "acct-1" || acquisition.AccountLease.Generation == 0 || acquisition.PacketResponse.StatusCode != http.StatusCreated {
		t.Fatalf("acquisition = %+v", acquisition)
	}
	packet, err := io.ReadAll(acquisition.PacketResponse.Body)
	if err != nil || !strings.Contains(string(packet), "realm.source-materialization-packet/v3") {
		t.Fatalf("packet response = %q, %v", packet, err)
	}
	mu.Lock()
	defer mu.Unlock()
	wantPaths := []string{
		http.MethodPost + " " + realmSourceMaterializationRequestGrantPath,
		http.MethodPost + " " + realmSourceMaterializationGrantPathPrefix + "grant-7/grant",
		http.MethodPost + " " + realmSourceMaterializationPacketPath,
	}
	if strings.Join(paths, "\n") != strings.Join(wantPaths, "\n") {
		t.Fatalf("Realm lifecycle = %#v, want %#v", paths, wantPaths)
	}
}

func TestAcquireRealmSourceMaterializationReusesExactCurrentGrantedWithoutDecision(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var decisionCalls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case realmSourceMaterializationRequestGrantPath:
			expires := now.Add(time.Hour)
			_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "GRANTED", 19, "grant-current", &expires))
		case realmSourceMaterializationPacketPath:
			body := decodeRealmSourceMaterializationRequestBody(t, request)
			if body["accessGrantId"] != "grant-current" {
				t.Errorf("packet accessGrantId = %#v", body["accessGrantId"])
			}
			response.WriteHeader(http.StatusCreated)
			_, _ = response.Write([]byte(`{}`))
		default:
			decisionCalls++
			response.WriteHeader(http.StatusConflict)
			_, _ = response.Write([]byte(`{}`))
		}
	}))
	defer server.Close()

	service := newRealmSourceMaterializationHarness(t, server, now)
	acquisition, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
	if err != nil {
		t.Fatalf("AcquireRealmSourceMaterialization: %v", err)
	}
	_ = acquisition.PacketResponse.Body.Close()
	if decisionCalls != 0 {
		t.Fatalf("existing GRANTED authority made %d decision calls", decisionCalls)
	}
}

func TestAcquireRealmSourceMaterializationRejectsGrantContractMutations(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "wrong app", mutate: func(grant map[string]any) { grant["appId"] = "nimi.other" }},
		{name: "local scope", mutate: func(grant map[string]any) { grant["scopeName"] = "agent.identity.project" }},
		{name: "wrong subject", mutate: func(grant map[string]any) { grant["subjectAccountId"] = "acct-other" }},
		{name: "non-null qualifier", mutate: func(grant map[string]any) { grant["qualifier"] = "source-1" }},
		{name: "missing qualifier", mutate: func(grant map[string]any) { delete(grant, "qualifier") }},
		{name: "terminal state", mutate: func(grant map[string]any) { grant["state"] = "REVOKED" }},
		{name: "fractional version", mutate: func(grant map[string]any) { grant["version"] = 1.5 }},
		{name: "expired granted", mutate: func(grant map[string]any) {
			grant["state"] = "GRANTED"
			grant["grantedAt"] = now.Add(-time.Hour).Format(time.RFC3339Nano)
			grant["grantedByAccountId"] = "acct-1"
			grant["expiresAt"] = now.Add(-time.Second).Format(time.RFC3339Nano)
		}},
		{name: "unknown field", mutate: func(grant map[string]any) { grant["qualifierKey"] = "" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var packetCalls int
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				if request.URL.Path == realmSourceMaterializationPacketPath {
					packetCalls++
					response.WriteHeader(http.StatusCreated)
					_, _ = response.Write([]byte(`{}`))
					return
				}
				var grant map[string]any
				if err := json.Unmarshal(realmSourceMaterializationGrantFixture(t, now, "PENDING", 1, "grant-1", nil), &grant); err != nil {
					t.Fatal(err)
				}
				test.mutate(grant)
				_ = json.NewEncoder(response).Encode(grant)
			}))
			defer server.Close()
			service := newRealmSourceMaterializationHarness(t, server, now)
			acquisition, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
			if acquisition.PacketResponse.Body != nil {
				_ = acquisition.PacketResponse.Body.Close()
			}
			if !errors.Is(err, ErrRealmSourceMaterializationContract) || packetCalls != 0 {
				t.Fatalf("mutation error = %v, packet calls = %d", err, packetCalls)
			}
		})
	}
}

func TestAcquireRealmSourceMaterializationRequiresExactVersionAdvance(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(request.URL.Path, "/grant") {
			_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "GRANTED", 9, "grant-1", nil))
			return
		}
		_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "PENDING", 7, "grant-1", nil))
	}))
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	_, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
	if !errors.Is(err, ErrRealmSourceMaterializationContract) {
		t.Fatalf("version jump error = %v", err)
	}
}

func TestAcquireRealmSourceMaterializationRejectsDuplicateGrantKey(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		raw := string(realmSourceMaterializationGrantFixture(t, now, "PENDING", 1, "grant-1", nil))
		raw = strings.Replace(raw, `"appId":"nimi.avatar"`, `"appId":"nimi.avatar","appId":"nimi.avatar"`, 1)
		_, _ = response.Write([]byte(raw))
	}))
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	_, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
	if !errors.Is(err, ErrRealmSourceMaterializationContract) {
		t.Fatalf("duplicate key error = %v", err)
	}
}

func TestRealmSourceMaterializationAccountGenerationChangeFailsBeforeDecision(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var service *Service
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls++
		response.Header().Set("Content-Type", "application/json")
		if request.URL.Path != realmSourceMaterializationRequestGrantPath {
			t.Errorf("unexpected call after account generation changed: %s", request.URL.Path)
		}
		service.mu.Lock()
		service.accountGeneration++
		service.mu.Unlock()
		_, _ = response.Write(realmSourceMaterializationGrantFixture(t, now, "PENDING", 1, "grant-1", nil))
	}))
	defer server.Close()
	service = newRealmSourceMaterializationHarness(t, server, now)
	_, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
	if !errors.Is(err, ErrRealmSourceMaterializationAccountLease) || calls != 1 {
		t.Fatalf("account switch error = %v, calls = %d", err, calls)
	}
}

func TestWithCurrentRealmSourceMaterializationAccountRejectsWhenSwitchWins(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	lease := currentRealmSourceMaterializationLease(t, service)

	service.mu.Lock()
	next := testMaterial("acct-2", "access-2", "refresh-2")
	if !service.installAuthenticatedRuntimeIdentityLocked(next) {
		service.mu.Unlock()
		t.Fatal("account switch did not install the next Runtime identity")
	}
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	service.mu.Unlock()

	called := false
	err := service.WithCurrentRealmSourceMaterializationAccount(context.Background(), lease, func() error {
		called = true
		return nil
	})
	if !errors.Is(err, ErrRealmSourceMaterializationAccountLease) || called {
		t.Fatalf("switch-first guard = error %v, callback called %t", err, called)
	}
}

func TestWithCurrentRealmSourceMaterializationAccountBlocksSwitchUntilCallbackEnds(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	lease := currentRealmSourceMaterializationLease(t, service)
	callbackEntered := make(chan struct{})
	releaseCallback := make(chan struct{})
	guardDone := make(chan error, 1)
	switchStarted := make(chan struct{})
	switchDone := make(chan struct{})

	go func() {
		guardDone <- service.WithCurrentRealmSourceMaterializationAccount(context.Background(), lease, func() error {
			close(callbackEntered)
			<-releaseCallback
			return nil
		})
	}()
	<-callbackEntered
	go func() {
		close(switchStarted)
		service.mu.Lock()
		next := testMaterial("acct-2", "access-2", "refresh-2")
		service.installAuthenticatedRuntimeIdentityLocked(next)
		service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
		service.mu.Unlock()
		close(switchDone)
	}()
	<-switchStarted
	select {
	case <-switchDone:
		t.Fatal("account switch completed while guarded callback still held the identity mutex")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseCallback)
	if err := <-guardDone; err != nil {
		t.Fatalf("guard callback: %v", err)
	}
	select {
	case <-switchDone:
	case <-time.After(time.Second):
		t.Fatal("account switch did not resume after guarded callback ended")
	}
}

func TestWithCurrentRealmSourceMaterializationAccountReturnsCallbackError(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	lease := currentRealmSourceMaterializationLease(t, service)
	want := errors.New("atomic product commit failed")
	err := service.WithCurrentRealmSourceMaterializationAccount(context.Background(), lease, func() error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("callback error = %v, want %v", err, want)
	}
}

func TestFetchCurrentRealmSourceMaterializationJWKSIsFreshAndBearerFree(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls++
		if request.URL.Path != realmSourceMaterializationJWKSPath || request.Method != http.MethodGet {
			t.Errorf("JWKS request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "" || !headerContainsDirective(request.Header.Values("Cache-Control"), "no-store") || !headerContainsDirective(request.Header.Values("Pragma"), "no-cache") {
			t.Errorf("JWKS request headers = %#v", request.Header)
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store, max-age=0")
		response.Header().Set("Pragma", "no-cache")
		_, _ = response.Write([]byte(`{"keys":[]}`))
	}))
	defer server.Close()
	service := newRealmSourceMaterializationHarness(t, server, now)
	projection, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("authenticated account context unavailable")
	}
	lease := RealmSourceMaterializationAccountLease{AccountID: projection.GetAccountId(), Generation: generation}
	for index := 0; index < 2; index++ {
		response, err := service.FetchCurrentRealmSourceMaterializationJWKS(context.Background(), lease)
		if err != nil {
			t.Fatalf("JWKS fetch %d: %v", index, err)
		}
		raw, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil || string(raw) != `{"keys":[]}` {
			t.Fatalf("JWKS body %d = %q, %v", index, raw, readErr)
		}
	}
	if calls != 2 {
		t.Fatalf("JWKS fetch calls = %d, want a fresh request for each attempt", calls)
	}
}

func TestRealmSourceMaterializationHTTPEnvelopeFailsClosed(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name    string
		handler http.Handler
		want    error
	}{
		{
			name: "redirect",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Location", realmSourceMaterializationRequestGrantPath)
				response.WriteHeader(http.StatusTemporaryRedirect)
			}),
			want: ErrRealmSourceMaterializationUnavailable,
		},
		{
			name: "compressed response",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.Header().Set("Content-Encoding", "gzip")
				_, _ = response.Write([]byte(`{}`))
			}),
			want: ErrRealmSourceMaterializationContract,
		},
		{
			name: "wrong content type",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "text/plain")
				_, _ = response.Write([]byte(`{}`))
			}),
			want: ErrRealmSourceMaterializationContract,
		},
		{
			name: "oversized control body",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.Header().Set("Content-Length", "65537")
				response.WriteHeader(http.StatusOK)
			}),
			want: ErrRealmSourceMaterializationResponseSize,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			service := newRealmSourceMaterializationHarness(t, server, now)
			_, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
			if !errors.Is(err, test.want) {
				t.Fatalf("envelope error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestAcquireRealmSourceMaterializationClassifiesPacketStatusWithoutReadingErrorBody(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name       string
		statusCode int
		want       error
	}{
		{name: "invalid challenge", statusCode: http.StatusBadRequest, want: ErrRealmSourceMaterializationInvalidRequest},
		{name: "invalid source ref", statusCode: http.StatusBadRequest, want: ErrRealmSourceMaterializationInvalidRequest},
		{name: "invalid published limits", statusCode: http.StatusBadRequest, want: ErrRealmSourceMaterializationInvalidRequest},
		{name: "account authentication", statusCode: http.StatusUnauthorized, want: ErrRealmSourceMaterializationAccountLease},
		{name: "revoked grant", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
		{name: "expired grant", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
		{name: "superseded grant", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
		{name: "wrong scope grant", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
		{name: "source visibility denial", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
		{name: "stale canonical source", statusCode: http.StatusConflict, want: ErrRealmSourceMaterializationSourceBinding},
		{name: "dependency not ready", statusCode: http.StatusConflict, want: ErrRealmSourceMaterializationSourceBinding},
		{name: "canonical source conflict", statusCode: http.StatusConflict, want: ErrRealmSourceMaterializationSourceBinding},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.NotFoundHandler())
			defer server.Close()
			service := newRealmSourceMaterializationHarness(t, server, now)
			secret := "private-realm-error-body-" + strings.ReplaceAll(test.name, " ", "-")
			errorBody := &realmSourceMaterializationErrorBodyTestReadCloser{reader: strings.NewReader(secret)}
			var grantCalls, packetCalls int
			service.realmHTTP = &http.Client{
				Transport: realmSourceMaterializationTestRoundTripper(func(request *http.Request) (*http.Response, error) {
					switch request.URL.Path {
					case realmSourceMaterializationRequestGrantPath:
						grantCalls++
						return &http.Response{
							StatusCode: http.StatusOK,
							Header:     http.Header{"Content-Type": []string{"application/json"}},
							Body:       io.NopCloser(strings.NewReader(string(realmSourceMaterializationGrantFixture(t, now, "GRANTED", 1, "grant-1", nil)))),
							Request:    request,
						}, nil
					case realmSourceMaterializationPacketPath:
						packetCalls++
						return &http.Response{
							StatusCode: test.statusCode,
							Header:     http.Header{"Content-Type": []string{"application/json"}},
							Body:       errorBody,
							Request:    request,
						}, nil
					default:
						t.Fatalf("unexpected Realm request path %q", request.URL.Path)
						return nil, errors.New("unexpected Realm request")
					}
				}),
				Timeout: time.Second,
			}

			acquisition, err := service.AcquireRealmSourceMaterialization(context.Background(), realmSourceMaterializationRequestFixture(now))
			if acquisition.PacketResponse.Body != nil {
				_ = acquisition.PacketResponse.Body.Close()
			}
			if !errors.Is(err, test.want) {
				t.Fatalf("status %d error = %v, want %v", test.statusCode, err, test.want)
			}
			if errors.Is(err, ErrRealmSourceMaterializationUnavailable) || errors.Is(err, ErrRealmSourceMaterializationContract) {
				t.Fatalf("status %d collapsed into generic error: %v", test.statusCode, err)
			}
			if strings.Contains(err.Error(), secret) {
				t.Fatalf("status %d error leaked response body: %v", test.statusCode, err)
			}
			if grantCalls != 1 || packetCalls != 1 {
				t.Fatalf("Realm calls = grant %d, packet %d", grantCalls, packetCalls)
			}
			if errorBody.reads != 0 || !errorBody.closed {
				t.Fatalf("error body lifecycle = reads %d, closed %t", errorBody.reads, errorBody.closed)
			}
		})
	}
}

func TestCanonicalRealmSourceMaterializationBaseURLRejectsRemoteHTTPAndAuthoritySyntax(t *testing.T) {
	for _, value := range []string{
		"http://realm.example.test",
		"https://user:secret@realm.example.test",
		"https://realm.example.test?tenant=one",
		"https://realm.example.test#fragment",
		" https://realm.example.test",
	} {
		if _, err := canonicalRealmSourceMaterializationBaseURL(value); !errors.Is(err, ErrRealmSourceMaterializationUnavailable) {
			t.Errorf("base %q error = %v", value, err)
		}
	}
	for _, value := range []string{"https://realm.example.test/root", "http://localhost:3002", "http://127.0.0.1:3002", "http://[::1]:3002"} {
		if _, err := canonicalRealmSourceMaterializationBaseURL(value); err != nil {
			t.Errorf("admitted base %q: %v", value, err)
		}
	}
}

func newRealmSourceMaterializationHarness(t *testing.T, server *httptest.Server, now time.Time) *Service {
	t.Helper()
	service := newHarnessService(t, nil, WithRealmBaseURL(server.URL+"/ignored-base-path"), WithRealmHTTPClient(server.Client()), WithClock(func() time.Time { return now }))
	completeLogin(t, service)
	return service
}

func currentRealmSourceMaterializationLease(t testing.TB, service *Service) RealmSourceMaterializationAccountLease {
	t.Helper()
	projection, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("authenticated Runtime account context is unavailable")
	}
	return RealmSourceMaterializationAccountLease{AccountID: projection.GetAccountId(), Generation: generation}
}

func realmSourceMaterializationRequestFixture(now time.Time) RealmSourceMaterializationIssuanceRequest {
	return RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: "acct-1",
		SourceRef: RealmSourceMaterializationSourceRefV3{
			Kind: "worldCharacter", ID: "character-1", WorldID: "world-1", SourceHash: strings.Repeat("a", 64),
			WorldEntityRef: &RealmSourceMaterializationWorldEntityRefV3{WorldID: "world-1", EntityID: "entity-1"},
		},
		Challenge: RealmSourceMaterializationChallengeV3{
			ChallengeID: "challenge-123456", ChallengeDigest: strings.Repeat("b", 64), IntendedRuntimeAudience: "nimi-runtime:test", ExpiresAt: now.Add(time.Minute),
		},
		Limits: RealmSourceMaterializationLimitsV3{
			MaxSegmentBytes: 8388608, MaxSegmentComponentCount: 256, MaxChunkBytes: 262144, MaxSegmentChunks: 4096,
			MaxSetSegments: 64, MaxSetBytes: 134217728, MaxSetComponentCount: 16384, MaxSetChunks: 65536,
		},
	}
}

func realmSourceMaterializationGrantFixture(t testing.TB, now time.Time, state string, version int, grantID string, expiresAt *time.Time) []byte {
	t.Helper()
	grant := map[string]any{
		"grantId": grantID, "subjectAccountId": "acct-1", "appId": realmSourceMaterializationAppID,
		"scopeFamily": realmSourceMaterializationScopeFamily, "scopeName": realmSourceMaterializationScopeName,
		"qualifier": nil, "state": state, "reason": realmSourceMaterializationRequestReason, "version": version,
		"requestedAt": now.Add(-time.Minute).Format(time.RFC3339Nano), "requestedByAccountId": "acct-1",
		"grantedAt": nil, "grantedByAccountId": nil, "deniedAt": nil, "deniedByAccountId": nil,
		"revokedAt": nil, "revokedByAccountId": nil, "expiredAt": nil, "supersededAt": nil,
		"supersededByAccountId": nil, "supersededByGrantId": nil, "expiresAt": nil,
	}
	if state == "GRANTED" {
		grant["grantedAt"] = now.Add(-30 * time.Second).Format(time.RFC3339Nano)
		grant["grantedByAccountId"] = "acct-1"
	}
	if expiresAt != nil {
		grant["expiresAt"] = expiresAt.Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(grant)
	if err != nil {
		t.Fatalf("encode grant fixture: %v", err)
	}
	return raw
}

func decodeRealmSourceMaterializationRequestBody(t testing.TB, request *http.Request) map[string]any {
	t.Helper()
	defer request.Body.Close()
	decoder := json.NewDecoder(request.Body)
	var body map[string]any
	if err := decoder.Decode(&body); err != nil {
		t.Fatalf("decode Realm request body: %v", err)
	}
	return body
}

type realmSourceMaterializationTestRoundTripper func(*http.Request) (*http.Response, error)

func (transport realmSourceMaterializationTestRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type realmSourceMaterializationErrorBodyTestReadCloser struct {
	reader *strings.Reader
	reads  int
	closed bool
}

func (body *realmSourceMaterializationErrorBodyTestReadCloser) Read(target []byte) (int, error) {
	body.reads++
	return body.reader.Read(target)
}

func (body *realmSourceMaterializationErrorBodyTestReadCloser) Close() error {
	body.closed = true
	return nil
}
