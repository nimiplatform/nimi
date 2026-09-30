package connector

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	testChatGPTPlanClientID = "oaiapp_test_client"
	testChatGPTPlanSubject  = "user-subject-1"
	testChatGPTPlanHostID   = "urn:uuid:4a0f7f2c-0d3c-4d8e-9d59-1f2a3b4c5d6e"
)

func testChatGPTPlanJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func testChatGPTPlanAccessToken(t *testing.T, clientID, subject string, expires time.Time, marker string) string {
	t.Helper()
	return testChatGPTPlanJWT(t, map[string]any{
		"iss": chatGPTPlanIssuer, "aud": chatGPTPlanResource, "client_id": clientID, "sub": subject,
		"scope": "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
		"exp":   expires.Unix(), "jti": marker,
	})
}

func testChatGPTPlanAuthorization(t *testing.T, now time.Time, mutate func(map[string]any)) string {
	t.Helper()
	value := map[string]any{
		"schema": chatGPTPlanCredentialSchema, "issuer": chatGPTPlanIssuer, "subject": testChatGPTPlanSubject,
		"email": "user@example.com", "client_id": testChatGPTPlanClientID, "ext_agent_host_id": testChatGPTPlanHostID,
		"access_token":  testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, now.Add(time.Hour), "initial"),
		"refresh_token": "refresh-1", "token_type": "Bearer",
		"scopes":   []string{"chatgpt.tokens.use.direct", "email", "offline_access", "openid", "profile", "resource.invoke"},
		"saved_at": now.UTC().Format(time.RFC3339),
	}
	if mutate != nil {
		mutate(value)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

type fakeChatGPTPlanRenewer struct {
	mu          sync.Mutex
	calls       atomic.Int32
	refreshSeen []string
	result      func(call int32, refreshToken string) (ChatGPTPlanTokenSet, error)
	revokeErr   error
	// revokeErrFor, when set, decides the revocation result per token.
	revokeErrFor func(refreshToken string) error
	revoked      []string
}

func (renewer *fakeChatGPTPlanRenewer) Renew(_ context.Context, clientID string, refreshToken string) (ChatGPTPlanTokenSet, error) {
	call := renewer.calls.Add(1)
	renewer.mu.Lock()
	renewer.refreshSeen = append(renewer.refreshSeen, clientID+"|"+refreshToken)
	renewer.mu.Unlock()
	return renewer.result(call, refreshToken)
}

func (renewer *fakeChatGPTPlanRenewer) Revoke(_ context.Context, clientID string, refreshToken string) error {
	renewer.mu.Lock()
	renewer.revoked = append(renewer.revoked, clientID+"|"+refreshToken)
	renewer.mu.Unlock()
	if renewer.revokeErrFor != nil {
		return renewer.revokeErrFor(refreshToken)
	}
	return renewer.revokeErr
}

type chatGPTPlanTestClock struct {
	mu  sync.Mutex
	now time.Time
}

func (clock *chatGPTPlanTestClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *chatGPTPlanTestClock) Advance(duration time.Duration) {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	clock.now = clock.now.Add(duration)
}

func newChatGPTPlanTestStore(t *testing.T, renewer ChatGPTPlanTokenRenewer) (*ConnectorStore, *chatGPTPlanTestClock, ConnectorRecord) {
	t.Helper()
	clock := &chatGPTPlanTestClock{now: time.Now().UTC().Truncate(time.Second)}
	store := NewConnectorStoreWithMemorySecrets(t.TempDir(), WithChatGPTPlanRenewer(renewer), WithClock(clock.Now))
	sealed, registration, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, clock.Now(), nil), "", clock.Now())
	if err != nil {
		t.Fatalf("seal authorization: %v", err)
	}
	record, err := store.Create(ConnectorRecord{
		ConnectorID: "siwc-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
		Provider: ChatGPTPlanProvider, Endpoint: ChatGPTPlanEndpoint, Label: "user@example.com",
		Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: ChatGPTPlanAuthProfile, OAuthRegistration: registration,
	}, sealed)
	if err != nil {
		t.Fatalf("create SIWC connector: %v", err)
	}
	return store, clock, record
}

func sealedChatGPTPlanForTest(t *testing.T, store *ConnectorStore, connectorID string) chatGPTPlanCredential {
	t.Helper()
	payload, err := store.LoadSecretPayload(connectorID)
	if err != nil {
		t.Fatal(err)
	}
	credential, err := decodeChatGPTPlanCredential(payload)
	if err != nil {
		t.Fatalf("decode sealed SIWC record: %v", err)
	}
	return credential
}

func requireChatGPTPlanReason(t *testing.T, err error, want runtimev1.ReasonCode) {
	t.Helper()
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != want {
		t.Fatalf("reason = %v present=%v err=%v, want %v", reason, ok, err, want)
	}
}

func TestSealChatGPTPlanAuthorizationBindsTokenToRegistration(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	sealed, registration, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, nil), "", now)
	if err != nil {
		t.Fatal(err)
	}
	credential, err := decodeChatGPTPlanCredential(sealed)
	if err != nil || credential.Generation != 1 || credential.State != chatGPTPlanStateActive || credential.AccessExpiresAt != now.Add(time.Hour).Unix() {
		t.Fatalf("sealed credential = %+v err=%v", credential, err)
	}
	if registration.ClientID != testChatGPTPlanClientID || registration.AccountLabel != "user@example.com" || strings.Contains(sealed, "id_token") {
		t.Fatalf("registration projection = %+v", registration)
	}
	invalid := map[string]func(map[string]any){
		"missing direct scope": func(value map[string]any) {
			value["scopes"] = []string{"email", "offline_access", "openid", "profile"}
		},
		"dynamic registration client": func(value map[string]any) { value["client_id"] = chatGPTPlanDynamicClientID },
		"identifying host id":         func(value map[string]any) { value["ext_agent_host_id"] = "user@example.com" },
		"foreign issuer":              func(value map[string]any) { value["issuer"] = "https://example.com" },
		"token for another client": func(value map[string]any) {
			value["access_token"] = testChatGPTPlanAccessToken(t, "oaiapp_other", testChatGPTPlanSubject, now.Add(time.Hour), "x")
		},
		"token for another account": func(value map[string]any) {
			value["access_token"] = testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, "other-subject", now.Add(time.Hour), "x")
		},
		"expired token": func(value map[string]any) {
			value["access_token"] = testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, now.Add(-time.Second), "x")
		},
		"wrong audience": func(value map[string]any) {
			value["access_token"] = testChatGPTPlanJWT(t, map[string]any{"iss": chatGPTPlanIssuer, "aud": "https://chatgpt.com", "client_id": testChatGPTPlanClientID, "sub": testChatGPTPlanSubject, "scope": chatGPTPlanDirectScope, "exp": now.Add(time.Hour).Unix()})
		},
		"runtime-owned generation": func(value map[string]any) { value["generation"] = 9 },
	}
	for name, mutate := range invalid {
		t.Run(name, func(t *testing.T) {
			_, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, mutate), "", now)
			requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		})
	}
}

func TestSealChatGPTPlanReauthorizationKeepsRegistrationIdentity(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	first, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, nil), "", now)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, func(value map[string]any) { value["refresh_token"] = "refresh-2" }), first, now)
	if err != nil {
		t.Fatal(err)
	}
	if credential, _ := decodeChatGPTPlanCredential(second); credential.Generation != 2 || credential.RefreshToken != "refresh-2" ||
		len(credential.PriorSessions) != 1 || credential.PriorSessions[0] != "refresh-1" || credential.PriorSessionUnconfirmed {
		t.Fatalf("reauthorized credential = %+v", credential)
	}
	otherAccount := testChatGPTPlanAuthorization(t, now, func(value map[string]any) {
		value["subject"] = "other-subject"
		value["access_token"] = testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, "other-subject", now.Add(time.Hour), "x")
	})
	_, _, err = SealChatGPTPlanAuthorization(otherAccount, first, now)
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	otherHost := testChatGPTPlanAuthorization(t, now, func(value map[string]any) { value["ext_agent_host_id"] = "urn:uuid:other" })
	_, _, err = SealChatGPTPlanAuthorization(otherHost, first, now)
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
}

func TestOpenChatGPTPlanAccessTokenReusesValidTokenWithoutRenewal(t *testing.T) {
	renewer := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{}, errors.New("unexpected renewal")
	}}
	store, clock, record := newChatGPTPlanTestStore(t, renewer)
	clock.Advance(30 * time.Minute)
	token, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
	if err != nil || token == "" || renewer.calls.Load() != 0 {
		t.Fatalf("token=%q err=%v renewals=%d", token, err, renewer.calls.Load())
	}
}

func TestOpenChatGPTPlanAccessTokenRotatesOnceUnderConcurrency(t *testing.T) {
	var store *ConnectorStore
	var clock *chatGPTPlanTestClock
	renewer := &fakeChatGPTPlanRenewer{}
	renewer.result = func(call int32, refreshToken string) (ChatGPTPlanTokenSet, error) {
		time.Sleep(20 * time.Millisecond)
		return ChatGPTPlanTokenSet{
			AccessToken:  testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, clock.Now().Add(time.Hour), "rotated"),
			RefreshToken: "refresh-2", TokenType: "Bearer", ExpiresIn: 3600,
		}, nil
	}
	store, clock, record := newChatGPTPlanTestStore(t, renewer)
	clock.Advance(56 * time.Minute)
	var group sync.WaitGroup
	tokens := make([]string, 8)
	errs := make([]error, 8)
	for index := range tokens {
		group.Add(1)
		go func() {
			defer group.Done()
			tokens[index], errs[index] = store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
		}()
	}
	group.Wait()
	for index := range tokens {
		if errs[index] != nil || tokens[index] != tokens[0] || !strings.Contains(tokens[index], ".") {
			t.Fatalf("caller %d token=%q err=%v", index, tokens[index], errs[index])
		}
	}
	if renewer.calls.Load() != 1 || renewer.refreshSeen[0] != testChatGPTPlanClientID+"|refresh-1" {
		t.Fatalf("renewals=%d seen=%v", renewer.calls.Load(), renewer.refreshSeen)
	}
	sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
	if sealed.Generation != 2 || sealed.RefreshToken != "refresh-2" || sealed.State != chatGPTPlanStateActive || sealed.AccessToken != tokens[0] {
		t.Fatalf("rotated custody = %+v", sealed)
	}
}

// A renewal that issued no token set keeps the committed generation, serves an
// unexpired access token and retries only after bounded backoff.
func TestOpenChatGPTPlanAccessTokenTemporaryFailurePreservesCustody(t *testing.T) {
	for _, test := range []struct {
		name        string
		disposition chatGPTPlanRenewalDisposition
		reason      runtimev1.ReasonCode
	}{
		{name: "not sent", disposition: chatGPTPlanRenewalPreDispatch, reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{name: "server unavailable", disposition: chatGPTPlanRenewalTemporary, reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{name: "redirect not followed", disposition: chatGPTPlanRenewalRedirected, reason: runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN},
	} {
		t.Run(test.name, func(t *testing.T) {
			var clock *chatGPTPlanTestClock
			succeed := atomic.Bool{}
			renewer := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
				if succeed.Load() {
					return ChatGPTPlanTokenSet{AccessToken: testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, clock.Now().Add(time.Hour), "next"), RefreshToken: "refresh-2", TokenType: "Bearer", ExpiresIn: 3600}, nil
				}
				return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(test.disposition, errors.New("no token set"))
			}}
			store, testClock, record := newChatGPTPlanTestStore(t, renewer)
			clock = testClock
			initial := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
			// Inside the renewal window the committed access token still serves.
			clock.Advance(58 * time.Minute)
			if token, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID); err != nil || token != initial.AccessToken || renewer.calls.Load() != 1 {
				t.Fatalf("usable token after failed renewal = %v renewals=%d", err, renewer.calls.Load())
			}
			if token, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID); err != nil || token != initial.AccessToken || renewer.calls.Load() != 1 {
				t.Fatalf("renewal was not deferred: err=%v renewals=%d", err, renewer.calls.Load())
			}
			sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
			if current, _, _ := store.Get(record.ConnectorID); sealed.State != chatGPTPlanStateActive || sealed.RefreshToken != "refresh-1" || sealed.Generation != initial.Generation || !current.HasCredential {
				t.Fatalf("temporary failure changed custody: %+v has_credential=%v", sealed, current.HasCredential)
			}
			// Once the access token no longer covers a request, the failure is typed.
			clock.Advance(105 * time.Second)
			_, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
			requireChatGPTPlanReason(t, err, test.reason)
			if renewer.calls.Load() != 2 {
				t.Fatalf("renewal after backoff = %d attempts", renewer.calls.Load())
			}
			_, err = store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
			requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
			if renewer.calls.Load() != 2 {
				t.Fatalf("backoff did not defer the retry: %d attempts", renewer.calls.Load())
			}
			succeed.Store(true)
			clock.Advance(chatGPTPlanRenewalBackoffMin * 2)
			if _, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID); err != nil || renewer.calls.Load() != 3 {
				t.Fatalf("retry after backoff = %v attempts=%d", err, renewer.calls.Load())
			}
			if sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID); sealed.RefreshToken != "refresh-2" || sealed.Generation != initial.Generation+1 {
				t.Fatalf("retried renewal custody = %+v", sealed)
			}
		})
	}
}

// A caller that stops waiting never abandons a dispatched renewal: the
// exchange keeps its own deadline and the rotated set is committed.
func TestOpenChatGPTPlanAccessTokenFinishesRenewalAfterCallerCancel(t *testing.T) {
	var clock *chatGPTPlanTestClock
	renewer := &blockingChatGPTPlanRenewer{started: make(chan struct{}), release: make(chan struct{})}
	renewer.next = func() ChatGPTPlanTokenSet {
		return ChatGPTPlanTokenSet{AccessToken: testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, clock.Now().Add(time.Hour), "next"), RefreshToken: "refresh-2", TokenType: "Bearer", ExpiresIn: 3600}
	}
	store, testClock, record := newChatGPTPlanTestStore(t, renewer)
	clock = testClock
	clock.Advance(58 * time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	opened := make(chan error, 1)
	go func() {
		_, err := store.OpenChatGPTPlanAccessToken(ctx, record.ConnectorID)
		opened <- err
	}()
	<-renewer.started
	cancel()
	close(renewer.release)
	if err := <-opened; err != nil {
		t.Fatalf("renewal after caller cancel = %v", err)
	}
	if renewer.canceled {
		t.Fatal("the renewal exchange followed the caller cancellation")
	}
	if sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID); sealed.State != chatGPTPlanStateActive || sealed.RefreshToken != "refresh-2" {
		t.Fatalf("custody after caller cancel = %+v", sealed)
	}
}

type blockingChatGPTPlanRenewer struct {
	started  chan struct{}
	release  chan struct{}
	next     func() ChatGPTPlanTokenSet
	canceled bool
}

func (renewer *blockingChatGPTPlanRenewer) Renew(ctx context.Context, _ string, _ string) (ChatGPTPlanTokenSet, error) {
	close(renewer.started)
	<-renewer.release
	renewer.canceled = ctx.Err() != nil
	return renewer.next(), nil
}

func (renewer *blockingChatGPTPlanRenewer) Revoke(context.Context, string, string) error { return nil }

// Terminal renewal outcomes clear usable tokens and keep only what is known
// about the provider session; revocation reports exactly that.
func TestOpenChatGPTPlanAccessTokenTerminalFailuresRecordSessionFacts(t *testing.T) {
	for _, test := range []struct {
		name            string
		disposition     chatGPTPlanRenewalDisposition
		reason          runtimev1.ReasonCode
		hint            string
		remoteSession   string
		revocationToken string
		revocation      ChatGPTPlanRevocationOutcome
		revokeRequests  int
	}{
		{name: "unusable token ends the session", disposition: chatGPTPlanRenewalTokenInvalid, reason: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, hint: ChatGPTPlanReauthorizeHint,
			remoteSession: chatGPTPlanRemoteSessionEnded, revocation: ChatGPTPlanRevocationNotNeeded},
		{name: "lost response stays unconfirmed", disposition: chatGPTPlanRenewalOutcomeAmbiguous, reason: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, hint: ChatGPTPlanReauthorizeHint,
			remoteSession: chatGPTPlanRemoteSessionUnconfirmed, revocationToken: "refresh-1", revocation: ChatGPTPlanRevocationUnconfirmed, revokeRequests: 1},
		{name: "unusable success body stays unconfirmed", disposition: chatGPTPlanRenewalContractInvalid, reason: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, hint: ChatGPTPlanReauthorizeHint,
			remoteSession: chatGPTPlanRemoteSessionUnconfirmed, revocationToken: "refresh-1", revocation: ChatGPTPlanRevocationUnconfirmed, revokeRequests: 1},
		{name: "invalid client needs a new Connector", disposition: chatGPTPlanRenewalClientInvalid, reason: runtimev1.ReasonCode_AI_CONNECTOR_INVALID, hint: chatGPTPlanReplaceConnectorHint,
			remoteSession: chatGPTPlanRemoteSessionUnconfirmed, revocationToken: "refresh-1", revocation: ChatGPTPlanRevocationUnconfirmed, revokeRequests: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			renewer := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
				return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(test.disposition, errors.New("terminal"))
			}}
			store, clock, record := newChatGPTPlanTestStore(t, renewer)
			clock.Advance(58 * time.Minute)
			_, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
			requireChatGPTPlanReason(t, err, test.reason)
			if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["action_hint"] != test.hint {
				t.Fatalf("action hint = %v", metadata)
			}
			// A second use never replays the committed refresh token and reports
			// the same required action.
			_, err = store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
			requireChatGPTPlanReason(t, err, test.reason)
			if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["action_hint"] != test.hint || renewer.calls.Load() != 1 {
				t.Fatalf("second open hint=%v renewals=%d", metadata, renewer.calls.Load())
			}
			sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
			current, _, _ := store.Get(record.ConnectorID)
			if sealed.State != chatGPTPlanStateReauthorizationRequired || sealed.RefreshToken != "" || sealed.AccessToken != "" || current.HasCredential ||
				sealed.ClientID != testChatGPTPlanClientID || sealed.RemoteSession != test.remoteSession || sealed.RevocationToken != test.revocationToken {
				t.Fatalf("terminal custody = %+v has_credential=%v", sealed, current.HasCredential)
			}
			if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != test.revocation || len(renewer.revoked) != test.revokeRequests {
				t.Fatalf("revocation = %v requests=%v", outcome, renewer.revoked)
			}
		})
	}
}

func TestOpenChatGPTPlanAccessTokenRejectsIdentityChangingRenewal(t *testing.T) {
	renewer := &fakeChatGPTPlanRenewer{}
	var clock *chatGPTPlanTestClock
	renewer.result = func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{AccessToken: testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, "other-subject", clock.Now().Add(time.Hour), "x"), RefreshToken: "refresh-2", TokenType: "Bearer", ExpiresIn: 3600}, nil
	}
	store, testClock, record := newChatGPTPlanTestStore(t, renewer)
	clock = testClock
	clock.Advance(58 * time.Minute)
	_, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	// The old refresh token was consumed; only the rejected replacement is kept,
	// and only so deletion can try to revoke it.
	sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
	if sealed.State != chatGPTPlanStateReauthorizationRequired || sealed.RefreshToken != "" || sealed.AccessToken != "" ||
		sealed.RemoteSession != chatGPTPlanRemoteSessionUnconfirmed || sealed.RevocationToken != "refresh-2" {
		t.Fatalf("identity change custody: %+v", sealed)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed || len(renewer.revoked) != 1 || renewer.revoked[0] != testChatGPTPlanClientID+"|refresh-2" {
		t.Fatalf("revocation = %v requests=%v", outcome, renewer.revoked)
	}
}

func TestOpenChatGPTPlanAccessTokenInterruptedRenewalRequiresReauthorization(t *testing.T) {
	renewer := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{}, errors.New("must not replay")
	}}
	store, clock, record := newChatGPTPlanTestStore(t, renewer)
	pending := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
	pending.State = chatGPTPlanStateRefreshPending
	if err := store.writeChatGPTPlanCredential(record.ConnectorID, pending); err != nil {
		t.Fatal(err)
	}
	clock.Advance(time.Minute)
	_, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	if renewer.calls.Load() != 0 {
		t.Fatal("interrupted renewal replayed the committed refresh token")
	}
	if sealed := sealedChatGPTPlanForTest(t, store, record.ConnectorID); sealed.RemoteSession != chatGPTPlanRemoteSessionUnconfirmed || sealed.RevocationToken != "refresh-1" {
		t.Fatalf("interrupted renewal session fact = %+v", sealed)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed || len(renewer.revoked) != 1 {
		t.Fatalf("revocation after interrupted renewal = %v requests=%v", outcome, renewer.revoked)
	}
}

// Revocation of a renewable record reports confirmation only for HTTP 200,
// waits for an in-flight renewal and revokes the committed successor.
func TestRevokeChatGPTPlanSessionUsesCommittedGeneration(t *testing.T) {
	store, _, record := newChatGPTPlanTestStore(t, &fakeChatGPTPlanRenewer{})
	renewer := store.chatGPTPlanRenewer.(*fakeChatGPTPlanRenewer)
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationConfirmed || len(renewer.revoked) != 1 {
		t.Fatalf("active revocation = %v requests=%v", outcome, renewer.revoked)
	}
	renewer.revokeErr = errors.New("http 502")
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed {
		t.Fatalf("failed revocation = %v", outcome)
	}

	release, entered := make(chan struct{}), make(chan struct{})
	var clock *chatGPTPlanTestClock
	blocking := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		close(entered)
		<-release
		return ChatGPTPlanTokenSet{AccessToken: testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, clock.Now().Add(time.Hour), "next"), RefreshToken: "refresh-2", TokenType: "Bearer", ExpiresIn: 3600}, nil
	}}
	store, testClock, record := newChatGPTPlanTestStore(t, blocking)
	clock = testClock
	clock.Advance(58 * time.Minute)
	renewed := make(chan error, 1)
	go func() {
		_, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID)
		renewed <- err
	}()
	<-entered
	revoked := make(chan ChatGPTPlanRevocationOutcome, 1)
	go func() { revoked <- store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID) }()
	select {
	case outcome := <-revoked:
		t.Fatalf("revocation did not wait for the in-flight renewal: %v", outcome)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-renewed; err != nil {
		t.Fatal(err)
	}
	if outcome := <-revoked; outcome != ChatGPTPlanRevocationConfirmed || len(blocking.revoked) != 1 || blocking.revoked[0] != testChatGPTPlanClientID+"|refresh-2" {
		t.Fatalf("revocation after renewal = %v requests=%v", outcome, blocking.revoked)
	}
}

// A record written before session facts existed stays readable and never
// reports a remote sign-out it cannot confirm.
func TestRevokeChatGPTPlanSessionTreatsUnrecordedFactAsUnconfirmed(t *testing.T) {
	renewer := &fakeChatGPTPlanRenewer{}
	store, _, record := newChatGPTPlanTestStore(t, renewer)
	legacy := sealedChatGPTPlanForTest(t, store, record.ConnectorID)
	legacy.AccessToken, legacy.RefreshToken, legacy.TokenType, legacy.AccessExpiresAt = "", "", "", 0
	legacy.State = chatGPTPlanStateReauthorizationRequired
	if err := store.writeChatGPTPlanCredential(record.ConnectorID, legacy); err != nil {
		t.Fatal(err)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed || len(renewer.revoked) != 0 {
		t.Fatalf("legacy revocation = %v requests=%v", outcome, renewer.revoked)
	}
}

// Signing in again starts another provider session without ending the one it
// replaces, so the replaced token survives renewal sealed only for revocation
// and deletion confirms sign-out only when every session ended.
func TestChatGPTPlanReauthorizationKeepsReplacedSessionForRevocation(t *testing.T) {
	var clock *chatGPTPlanTestClock
	renewer := &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{AccessToken: testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, testChatGPTPlanSubject, clock.Now().Add(time.Hour), "rotated"), RefreshToken: "refresh-3", TokenType: "Bearer", ExpiresIn: 3600}, nil
	}}
	store, testClock, record := newChatGPTPlanTestStore(t, renewer)
	clock = testClock
	previous, err := store.LoadSecretPayload(record.ConnectorID)
	if err != nil {
		t.Fatal(err)
	}
	sealed, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, clock.Now(), func(value map[string]any) { value["refresh_token"] = "refresh-2" }), previous, clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	reauthorized, err := decodeChatGPTPlanCredential(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.writeChatGPTPlanCredential(record.ConnectorID, reauthorized); err != nil {
		t.Fatal(err)
	}
	clock.Advance(58 * time.Minute)
	if _, err := store.OpenChatGPTPlanAccessToken(context.Background(), record.ConnectorID); err != nil {
		t.Fatal(err)
	}
	if renewed := sealedChatGPTPlanForTest(t, store, record.ConnectorID); renewed.RefreshToken != "refresh-3" || len(renewed.PriorSessions) != 1 || renewed.PriorSessions[0] != "refresh-1" {
		t.Fatalf("renewal dropped the replaced session: %+v", renewed)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationConfirmed ||
		strings.Join(renewer.revoked, ",") != testChatGPTPlanClientID+"|refresh-3,"+testChatGPTPlanClientID+"|refresh-1" {
		t.Fatalf("revocation = %v requests=%v", outcome, renewer.revoked)
	}
	renewer.revoked = nil
	renewer.revokeErrFor = func(token string) error {
		if token == "refresh-1" {
			return errors.New("http 502")
		}
		return nil
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed || len(renewer.revoked) != 2 {
		t.Fatalf("replaced session left live = %v requests=%v", outcome, renewer.revoked)
	}
}

// A replaced session that may have rotated, or that no longer fits the kept
// bound, can never be confirmed ended.
func TestChatGPTPlanReauthorizationRecordsUnconfirmedReplacedSessions(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	first, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, nil), "", now)
	if err != nil {
		t.Fatal(err)
	}
	base, err := decodeChatGPTPlanCredential(first)
	if err != nil {
		t.Fatal(err)
	}
	reauthorizeFrom := func(existing chatGPTPlanCredential, refreshToken string) chatGPTPlanCredential {
		t.Helper()
		previous, err := encodeChatGPTPlanCredential(existing)
		if err != nil {
			t.Fatal(err)
		}
		sealed, _, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, now, func(value map[string]any) { value["refresh_token"] = refreshToken }), previous, now)
		if err != nil {
			t.Fatal(err)
		}
		next, err := decodeChatGPTPlanCredential(sealed)
		if err != nil {
			t.Fatal(err)
		}
		return next
	}
	pending := base
	pending.State = chatGPTPlanStateRefreshPending
	if next := reauthorizeFrom(pending, "refresh-new"); len(next.PriorSessions) != 1 || next.PriorSessions[0] != "refresh-1" || !next.PriorSessionUnconfirmed {
		t.Fatalf("interrupted renewal = %+v", next)
	}
	uncertain := base
	uncertain.AccessToken, uncertain.RefreshToken, uncertain.TokenType, uncertain.AccessExpiresAt = "", "", "", 0
	uncertain.State, uncertain.RemoteSession, uncertain.RevocationToken = chatGPTPlanStateReauthorizationRequired, chatGPTPlanRemoteSessionUnconfirmed, "refresh-maybe-rotated"
	if next := reauthorizeFrom(uncertain, "refresh-new"); len(next.PriorSessions) != 1 || next.PriorSessions[0] != "refresh-maybe-rotated" || !next.PriorSessionUnconfirmed {
		t.Fatalf("uncertain session = %+v", next)
	}
	ended := uncertain
	ended.RemoteSession, ended.RevocationToken = chatGPTPlanRemoteSessionEnded, ""
	if next := reauthorizeFrom(ended, "refresh-new"); len(next.PriorSessions) != 0 || next.PriorSessionUnconfirmed {
		t.Fatalf("ended session = %+v", next)
	}
	current := base
	for index := 2; index <= 6; index++ {
		current = reauthorizeFrom(current, fmt.Sprintf("refresh-%d", index))
	}
	if strings.Join(current.PriorSessions, ",") != "refresh-2,refresh-3,refresh-4,refresh-5" || !current.PriorSessionUnconfirmed {
		t.Fatalf("bounded replaced sessions = %+v", current)
	}

	renewer := &fakeChatGPTPlanRenewer{}
	store, _, record := newChatGPTPlanTestStore(t, renewer)
	if err := store.writeChatGPTPlanCredential(record.ConnectorID, reauthorizeFrom(uncertain, "refresh-new")); err != nil {
		t.Fatal(err)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationUnconfirmed || len(renewer.revoked) != 2 {
		t.Fatalf("revocation after an uncertain session = %v requests=%v", outcome, renewer.revoked)
	}
	renewer.revoked = nil
	if err := store.writeChatGPTPlanCredential(record.ConnectorID, reauthorizeFrom(ended, "refresh-new")); err != nil {
		t.Fatal(err)
	}
	if outcome := store.RevokeChatGPTPlanSession(context.Background(), record.ConnectorID); outcome != ChatGPTPlanRevocationConfirmed || len(renewer.revoked) != 1 {
		t.Fatalf("revocation after an ended session = %v requests=%v", outcome, renewer.revoked)
	}
}

func TestChatGPTPlanRequestCaptureNeverCopiesRefreshToken(t *testing.T) {
	store, _, record := newChatGPTPlanTestStore(t, &fakeChatGPTPlanRenewer{})
	if _, _, err := store.CaptureCredentialCustody(record.ConnectorID, "job-1"); err == nil {
		t.Fatal("generic custody capture copied a SIWC record")
	}
	if _, _, err := store.CaptureRealtimeCredential(record.ConnectorID); err == nil {
		t.Fatal("Realtime capture accepted a SIWC record")
	}
	captured, ref, err := store.CaptureChatGPTPlanRequestCredential(context.Background(), record.ConnectorID, "job-1")
	if err != nil || captured.ConnectorID != record.ConnectorID {
		t.Fatalf("capture: %v", err)
	}
	payload, err := store.LoadCredentialCustody(ref)
	if err != nil || strings.Contains(payload, "refresh") || !strings.Contains(payload, chatGPTPlanRequestAccessSchema) {
		t.Fatalf("captured payload leaked or malformed: %q err=%v", payload, err)
	}
	if resolved := ResolveCredential(record, payload); resolved.APIKey == "" {
		t.Fatal("captured request token is unusable")
	}
	sealed, err := store.LoadSecretPayload(record.ConnectorID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved := ResolveCredential(record, sealed); resolved.APIKey != "" {
		t.Fatal("generic resolution opened the sealed SIWC record without renewal ownership")
	}
}

func TestChatGPTPlanHTTPRenewerUsesFixedFormAndRefusesRedirects(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer target.Close()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if err := r.ParseForm(); err != nil || r.Method != http.MethodPost || r.Form.Get("grant_type") != "refresh_token" ||
			r.Form.Get("client_id") != testChatGPTPlanClientID || r.Form.Get("resource") != chatGPTPlanResource || r.Form.Has("scope") {
			t.Errorf("renewal form = %v method=%s", r.Form, r.Method)
		}
		switch r.Form.Get("refresh_token") {
		case "redirect":
			http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
		case "reused":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"refresh_token_reused"}`))
		case "client":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
		case "busy":
			w.WriteHeader(http.StatusServiceUnavailable)
		case "rejected":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_request"}`))
		case "dropped":
			// The request arrived, but the connection closes before any answer.
			connection, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = connection.Close()
			}
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"a.b.c","refresh_token":"next","token_type":"Bearer","expires_in":3600,"scope":"chatgpt.tokens.use.direct offline_access"}`))
		}
	}))
	defer server.Close()
	renewer := newChatGPTPlanHTTPRenewer(server.Client(), server.URL, server.URL)
	set, err := renewer.Renew(context.Background(), testChatGPTPlanClientID, "ok")
	if err != nil || set.RefreshToken != "next" || set.ExpiresIn != 3600 {
		t.Fatalf("renewal = %+v err=%v", set, err)
	}
	for token, want := range map[string]chatGPTPlanRenewalDisposition{
		"redirect": chatGPTPlanRenewalRedirected, "reused": chatGPTPlanRenewalTokenInvalid,
		"client": chatGPTPlanRenewalClientInvalid, "busy": chatGPTPlanRenewalTemporary,
		"rejected": chatGPTPlanRenewalTemporary, "dropped": chatGPTPlanRenewalOutcomeAmbiguous,
	} {
		if _, err := renewer.Renew(context.Background(), testChatGPTPlanClientID, token); chatGPTPlanRenewalDispositionOf(err) != want {
			t.Fatalf("%s disposition = %v err=%v", token, chatGPTPlanRenewalDispositionOf(err), err)
		}
	}
	if redirected.Load() != 0 {
		t.Fatal("renewal followed a redirect away from the fixed endpoint")
	}
	closed := newChatGPTPlanHTTPRenewer(nil, "http://127.0.0.1:1/token", "")
	if _, err := closed.Renew(context.Background(), testChatGPTPlanClientID, "x"); chatGPTPlanRenewalDispositionOf(err) != chatGPTPlanRenewalPreDispatch {
		t.Fatalf("unreachable endpoint disposition = %v", chatGPTPlanRenewalDispositionOf(err))
	}
}

func TestChatGPTPlanRevocationConfirmsOnlyHTTP200(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil || r.Form.Get("token_type_hint") != "refresh_token" || r.Form.Get("client_id") != testChatGPTPlanClientID {
			t.Errorf("revocation form = %v", r.Form)
		}
		w.WriteHeader(status)
	}))
	defer server.Close()
	renewer := newChatGPTPlanHTTPRenewer(server.Client(), server.URL, server.URL)
	if err := renewer.Revoke(context.Background(), testChatGPTPlanClientID, "refresh-1"); err != nil {
		t.Fatalf("revocation: %v", err)
	}
	status = http.StatusBadGateway
	if err := renewer.Revoke(context.Background(), testChatGPTPlanClientID, "refresh-1"); err == nil {
		t.Fatal("unconfirmed revocation reported success")
	}
}
