package account

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type accountRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn accountRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type failingAccountResponseReader struct{}

func (failingAccountResponseReader) Read([]byte) (int, error) {
	return 0, errors.New("response read interrupted")
}

func TestProjectRealmUnaryHTTPResultUsesExactBrokerMatrix(t *testing.T) {
	tests := []struct {
		name          string
		status        int
		reason        runtimev1.ReasonCode
		accountReason runtimev1.AccountReasonCode
	}{
		{name: "request timeout", status: http.StatusRequestTimeout, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE},
		{name: "bad gateway", status: http.StatusBadGateway, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE},
		{name: "service unavailable", status: http.StatusServiceUnavailable, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE},
		{name: "gateway timeout", status: http.StatusGatewayTimeout, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE},
		{name: "unauthorized", status: http.StatusUnauthorized, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID},
		{name: "forbidden", status: http.StatusForbidden, reason: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_FORBIDDEN},
		{name: "not found", status: http.StatusNotFound, reason: runtimev1.ReasonCode_REALM_NOT_FOUND, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_NOT_FOUND},
		{name: "conflict", status: http.StatusConflict, reason: runtimev1.ReasonCode_REALM_CONFLICT, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONFLICT},
		{name: "rate limited", status: http.StatusTooManyRequests, reason: runtimev1.ReasonCode_REALM_RATE_LIMITED, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RATE_LIMITED},
		{name: "bad request", status: http.StatusBadRequest, reason: runtimev1.ReasonCode_REALM_REQUEST_REJECTED, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED},
		{name: "unprocessable", status: http.StatusUnprocessableEntity, reason: runtimev1.ReasonCode_REALM_REQUEST_REJECTED, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED},
		{name: "redirect", status: http.StatusFound, reason: runtimev1.ReasonCode_REALM_CONTRACT_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED},
		{name: "method not allowed", status: http.StatusMethodNotAllowed, reason: runtimev1.ReasonCode_REALM_CONTRACT_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED},
		{name: "unsupported media type", status: http.StatusUnsupportedMediaType, reason: runtimev1.ReasonCode_REALM_CONTRACT_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED},
		{name: "other server failure", status: http.StatusInternalServerError, reason: runtimev1.ReasonCode_REALM_OPERATION_FAILED, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_FAILED},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := projectRealmUnaryHTTPResult(realmUnaryHTTPResult{
				status: test.status,
				header: http.Header{"Content-Type": []string{"application/json"}},
				body:   []byte(`{"error":"upstream"}`),
			})
			if response.GetAccepted() || response.GetReasonCode() != test.reason ||
				response.GetAccountReasonCode() != test.accountReason || response.GetHttpStatus() != int32(test.status) {
				t.Fatalf("status %d projection = %+v", test.status, response)
			}
		})
	}

	malformed := projectRealmUnaryHTTPResult(realmUnaryHTTPResult{
		status: http.StatusOK,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"not":"closed"`),
	})
	if malformed.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
		malformed.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED {
		t.Fatalf("malformed success projection = %+v", malformed)
	}
	duplicate := projectRealmUnaryHTTPResult(realmUnaryHTTPResult{
		status: http.StatusOK,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"items":[],"items":[]}`),
	})
	if duplicate.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
		duplicate.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED {
		t.Fatalf("duplicate-key success projection = %+v", duplicate)
	}
	duplicateError := projectRealmUnaryHTTPResult(realmUnaryHTTPResult{
		status: http.StatusBadRequest,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"message":"header.payload.signature","message":"safe"}`),
	})
	if duplicateError.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
		duplicateError.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED ||
		duplicateError.GetErrorMessage() != "Realm response violates the JSON contract" {
		t.Fatalf("duplicate-key error projection = %+v", duplicateError)
	}
}

func TestParseRealmUnaryRequestRejectsNonCanonicalEnvelope(t *testing.T) {
	for _, raw := range []string{
		``,
		`{"path":{},"path":{}}`,
		`{"path":{},"unexpected":true}`,
		`{"path":{}} trailing`,
	} {
		if _, err := parseRealmUnaryRequest(raw); err == nil {
			t.Fatalf("request envelope %q was accepted", raw)
		}
	}
}

func TestRealmUnaryRequestParametersUseGeneratedOpenAPIKinds(t *testing.T) {
	operation := realmBrokerOperations["WorldCoreController_listPersonaCharacters"]
	for _, request := range []realmUnaryRequestJSON{
		{Path: map[string]any{}, Query: map[string]any{"take": "10"}},
		{Path: map[string]any{}, Query: map[string]any{"afterId": map[string]any{"nested": true}}},
	} {
		if err := validateRealmUnaryRequestShape(operation, request); err == nil {
			t.Fatalf("invalid generated parameter shape was accepted: %+v", request)
		}
	}
	if err := validateRealmUnaryRequestShape(operation, realmUnaryRequestJSON{
		Path: map[string]any{}, Query: map[string]any{"take": float64(10), "afterId": "cursor"},
	}); err != nil {
		t.Fatalf("generated parameter kinds rejected canonical request: %v", err)
	}
}

func TestCanonicalRealmUnaryBaseURLRejectsAmbientAuthority(t *testing.T) {
	for _, value := range []string{
		"https://user:secret@realm.test",
		"https://realm.test?tenant=other",
		"https://realm.test#fragment",
	} {
		if _, err := canonicalRealmUnaryBaseURL(value); err == nil {
			t.Fatalf("Realm base URL %q was accepted", value)
		}
	}

	canonical, err := canonicalRealmUnaryBaseURL("https://realm.test/api%20root/")
	if err != nil || canonical != "https://realm.test/api%20root" {
		t.Fatalf("escaped canonical Realm base URL = %q, %v", canonical, err)
	}
}

func TestInvokeRealmUnaryTransportAndResponseReadFailuresAreUnavailable(t *testing.T) {
	tests := []struct {
		name      string
		transport http.RoundTripper
	}{
		{name: "dns", transport: accountRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("dns lookup failed") })},
		{name: "connection", transport: accountRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("connection refused") })},
		{name: "tls", transport: accountRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("tls handshake failed") })},
		{name: "timeout", transport: accountRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, context.DeadlineExceeded })},
		{name: "response read", transport: accountRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(failingAccountResponseReader{}),
			}, nil
		})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newHarnessService(t, nil,
				WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
				WithRealmBaseURL("https://realm.test"),
				WithRealmHTTPClient(&http.Client{Transport: test.transport}),
			)
			completeLogin(t, svc)
			response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorlds",
				RequestJson: `{}`,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
				response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE {
				t.Fatalf("transport failure projection = %+v", response)
			}
		})
	}
}

func TestInvokeRealmUnaryOwnsTimeoutClassificationBeforeCarrierDeadline(t *testing.T) {
	transport := accountRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL("https://realm.test"),
		WithRealmHTTPClient(&http.Client{Transport: transport}),
	)
	completeLogin(t, svc)
	startedAt := time.Now()
	response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds",
		RequestJson: `{}`, TimeoutMs: 20,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
		response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE {
		t.Fatalf("timeout projection = %+v", response)
	}
	if elapsed := time.Since(startedAt); elapsed < 10*time.Millisecond || elapsed > 500*time.Millisecond {
		t.Fatalf("Runtime-owned timeout elapsed = %v", elapsed)
	}
}

func TestInvokeRealmUnaryPreservesCallerCancellation(t *testing.T) {
	started := make(chan struct{})
	transport := accountRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL("https://realm.test"),
		WithRealmHTTPClient(&http.Client{Transport: transport}),
	)
	completeLogin(t, svc)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		response, err := svc.InvokeRealmUnary(ctx, &runtimev1.InvokeRealmUnaryRequest{
			Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds",
			RequestJson: `{}`, TimeoutMs: 30_000,
		})
		if response != nil {
			done <- errors.New("caller cancellation returned a broker response")
			return
		}
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("caller cancellation = %v, want context.Canceled", err)
	}
}

func TestInvokeRealmUnaryPreservesCallerDeadline(t *testing.T) {
	transport := accountRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL("https://realm.test"),
		WithRealmHTTPClient(&http.Client{Transport: transport}),
	)
	completeLogin(t, svc)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	response, err := svc.InvokeRealmUnary(ctx, &runtimev1.InvokeRealmUnaryRequest{
		Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds",
		RequestJson: `{}`, TimeoutMs: 30_000,
	})
	if response != nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller deadline response=(%+v, %v)", response, err)
	}
}

func TestInvokeRealmUnaryRejectsTimeoutOutsideCarrierBound(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.test")
	completeLogin(t, svc)
	for _, timeoutMs := range []int32{300_001, 2_147_483_647} {
		response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
			Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds",
			RequestJson: `{}`, TimeoutMs: timeoutMs,
		})
		if err != nil || response.GetAccepted() ||
			response.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID ||
			response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID {
			t.Fatalf("out-of-bound timeout %d response = (%+v, %v)", timeoutMs, response, err)
		}
	}
}

func TestInvokeRealmUnaryRefusesRedirectAndCredentialErrorPayloads(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirected.Add(1)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("credential") == "1" {
			response.Header().Set("content-type", "application/json")
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte(`{"accessToken":"must-not-leak"}`))
			return
		}
		response.Header().Set("location", target.URL+"/capture")
		response.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	redirectResponse, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds", RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("redirect InvokeRealmUnary: %v", err)
	}
	if redirectResponse.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID || redirected.Load() != 0 {
		t.Fatalf("redirect response=%+v redirected=%d", redirectResponse, redirected.Load())
	}

	credentialResponse := projectRealmUnaryHTTPResult(realmUnaryHTTPResult{
		status: http.StatusServiceUnavailable,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"accessToken":"must-not-leak"}`),
	})
	if credentialResponse.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
		credentialResponse.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CREDENTIAL_RESPONSE_FORBIDDEN ||
		credentialResponse.GetResponseJson() != "" {
		t.Fatalf("credential error payload did not fail closed: %+v", credentialResponse)
	}
}

func TestInvokeRealmUnaryConcurrentUnauthorizedRefreshesExactlyOnce(t *testing.T) {
	const callers = 12
	var oldRequests atomic.Int32
	var refreshedRequests atomic.Int32
	var releaseOld sync.Once
	allOldArrived := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Header.Get("Authorization") {
		case "Bearer access-1":
			if oldRequests.Add(1) == callers {
				releaseOld.Do(func() { close(allOldArrived) })
			}
			<-allOldArrived
			response.Header().Set("content-type", "application/json")
			response.WriteHeader(http.StatusUnauthorized)
			_, _ = response.Write([]byte(`{"error":"expired"}`))
		case "Bearer access-refreshed":
			refreshedRequests.Add(1)
			response.Header().Set("content-type", "application/json")
			_, _ = response.Write([]byte(`{"ok":true}`))
		default:
			response.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer server.Close()
	refresher := &countingAccountRefresher{material: testMaterial("acct-1", "access-refreshed", "refresh-refreshed")}
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL(server.URL),
		WithRealmHTTPClient(server.Client()),
		WithRefresher(refresher),
	)
	completeLogin(t, svc)

	var wait sync.WaitGroup
	wait.Add(callers)
	errorsCh := make(chan error, callers)
	for range callers {
		go func() {
			defer wait.Done()
			response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds", RequestJson: `{}`,
			})
			if err != nil {
				errorsCh <- err
				return
			}
			if !response.GetAccepted() {
				errorsCh <- errors.New("broker request was not accepted after refresh")
			}
		}()
	}
	wait.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	if refresher.calls.Load() != 1 || oldRequests.Load() != callers || refreshedRequests.Load() != callers {
		t.Fatalf("refresh=%d old=%d retried=%d", refresher.calls.Load(), oldRequests.Load(), refreshedRequests.Load())
	}
}

func TestInvokeRealmUnaryRetriesUnauthorizedOnceThenRequiresReauthentication(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		response.Header().Set("content-type", "application/json")
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":"invalid"}`))
	}))
	defer server.Close()
	refresher := &countingAccountRefresher{material: testMaterial("acct-1", "access-refreshed", "refresh-refreshed")}
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL(server.URL),
		WithRealmHTTPClient(server.Client()),
		WithRefresher(refresher),
	)
	completeLogin(t, svc)
	response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller: realmDesktopShellCaller(), MethodId: "WorldPublicController_listWorlds", RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if response.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
		response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID ||
		requests.Load() != 2 || refresher.calls.Load() != 1 ||
		svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
		t.Fatalf("response=%+v requests=%d refreshes=%d state=%v", response, requests.Load(), refresher.calls.Load(), svc.currentState())
	}
}
