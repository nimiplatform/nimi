package account

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAcquireRealmSourceMaterializationCallsOnlyTheFirstPartyPacketOperation(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		paths = append(paths, request.Method+" "+request.URL.Path)
		if request.Header.Get("Authorization") != "Bearer access-1" || request.Header.Get("Accept-Encoding") != "identity" {
			t.Errorf("private Realm headers = authorization %q, encoding %q", request.Header.Get("Authorization"), request.Header.Get("Accept-Encoding"))
		}
		response.Header().Set("Content-Type", "application/json")
		if request.URL.Path != realmSourceMaterializationPacketPath || request.Method != http.MethodPost {
			t.Errorf("unexpected Realm path %s", request.URL.Path)
			response.WriteHeader(http.StatusNotFound)
			return
		}
		body := decodeRealmSourceMaterializationRequestBody(t, request)
		if len(body) != 7 || body["materializerAccountId"] != "acct-1" || body["challengeId"] != "challenge-123456" {
			t.Errorf("packet request binding = %#v", body)
		}
		for _, forbidden := range []string{"accessGrantId", "appId", "scopeFamily", "scopeName", "grantId"} {
			if _, exists := body[forbidden]; exists {
				t.Errorf("packet request contains retired authority field %q", forbidden)
			}
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
	wantPaths := []string{http.MethodPost + " " + realmSourceMaterializationPacketPath}
	if strings.Join(paths, "\n") != strings.Join(wantPaths, "\n") {
		t.Fatalf("Realm operation sequence = %#v, want %#v", paths, wantPaths)
	}
}

func TestRealmSourceMaterializationAccountGenerationChangeFailsBeforePacketReturn(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var service *Service
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls++
		response.Header().Set("Content-Type", "application/json")
		if request.URL.Path != realmSourceMaterializationPacketPath {
			t.Errorf("unexpected call after account generation changed: %s", request.URL.Path)
		}
		service.mu.Lock()
		service.accountGeneration++
		service.mu.Unlock()
		response.WriteHeader(http.StatusCreated)
		_, _ = response.Write([]byte(`{}`))
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
				response.Header().Set("Location", realmSourceMaterializationPacketPath)
				response.WriteHeader(http.StatusTemporaryRedirect)
			}),
			want: ErrRealmSourceMaterializationUnavailable,
		},
		{
			name: "compressed response",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.Header().Set("Content-Encoding", "gzip")
				response.WriteHeader(http.StatusCreated)
				_, _ = response.Write([]byte(`{}`))
			}),
			want: ErrRealmSourceMaterializationContract,
		},
		{
			name: "wrong content type",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "text/plain")
				response.WriteHeader(http.StatusCreated)
				_, _ = response.Write([]byte(`{}`))
			}),
			want: ErrRealmSourceMaterializationContract,
		},
		{
			name: "oversized packet body",
			handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.Header().Set("Content-Length", "536870913")
				response.WriteHeader(http.StatusCreated)
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
		{name: "account policy denial", statusCode: http.StatusForbidden, want: ErrRealmSourceMaterializationDenied},
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
			var packetCalls int
			service.realmHTTP = &http.Client{
				Transport: realmSourceMaterializationTestRoundTripper(func(request *http.Request) (*http.Response, error) {
					if request.URL.Path != realmSourceMaterializationPacketPath {
						t.Fatalf("unexpected Realm request path %q", request.URL.Path)
						return nil, errors.New("unexpected Realm request")
					}
					packetCalls++
					return &http.Response{
						StatusCode: test.statusCode,
						Header:     http.Header{"Content-Type": []string{"application/json"}},
						Body:       errorBody,
						Request:    request,
					}, nil
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
			if packetCalls != 1 {
				t.Fatalf("Realm packet calls = %d", packetCalls)
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
