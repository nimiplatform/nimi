package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type testRoundTripper func(*http.Request) (*http.Response, error)

func (f testRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type testRevalidator func(context.Context, localappop.Ingress) (context.Context, error)

func (f testRevalidator) AuthorizeLocalAppIngress(ctx context.Context, i localappop.Ingress) (context.Context, error) {
	return f(ctx, i)
}

type testSecrets struct {
	mu     sync.Mutex
	values map[string]string
}

func (s *testSecrets) WriteSecret(id, payload string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[id] = payload
	return nil
}
func (s *testSecrets) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.values[id]
	return value, ok, nil
}
func (s *testSecrets) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}
func testDecision(subject string, seed byte) accountservice.LocalAppCallerDecision {
	d := accountservice.LocalAppCallerDecision{AppID: "test." + subject, AccountID: "test-account", RegisteredAppSubject: subject, AuthorityClass: localappop.AuthorityClassAppAccess, ExpiresAt: time.Now().Add(time.Hour)}
	for i := range d.SessionID {
		d.SessionID[i] = seed + byte(i)
	}
	return d
}
func testContext(d accountservice.LocalAppCallerDecision, op localappop.Operation) context.Context {
	c, _ := localappop.ClassifyOperation(op)
	d.Operation, d.OperationCapability = op, string(c.Domain)
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), d)
}
func newIntegrationTestService(t *testing.T, transport http.RoundTripper) *Service {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	s, err := New(Options{Backend: backend, Secrets: &testSecrets{values: map[string]string{}}, HTTPClient: client, Revalidator: testRevalidator(func(ctx context.Context, i localappop.Ingress) (context.Context, error) {
		d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
		if !ok || ctx.Err() != nil || closed(d.SessionInvalidated) {
			return nil, failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
		}
		c, err := localappop.ClassifyIngress(i)
		if err != nil {
			return nil, err
		}
		d.Operation, d.OperationCapability = c.Operation, string(c.Domain)
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d), nil
	})})
	if err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close(); _ = backend.Close() })
	return s
}
func jsonResponse(value any) *http.Response {
	data, _ := json.Marshal(value)
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(data))}
}
func testOperation(effect string) *runtimev1.IntegrationOperation {
	return &runtimev1.IntegrationOperation{Name: "document.read", Description: "Read an App-owned document", InputSchemaJson: `{"type":"object"}`, OutputSchemaJson: `{"type":"object"}`, Effect: effect, RetryPolicy: "none"}
}
func grantTestTarget(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, targetID string, ops ...string) {
	t.Helper()
	raw, _ := json.Marshal(ops)
	if _, err := s.backend.DB().Exec(`INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?) ON CONFLICT(account_id,consumer_subject,target_ref) DO UPDATE SET operations_json=excluded.operations_json`, d.AccountID, d.RegisteredAppSubject, targetID, string(raw)); err != nil {
		t.Fatal(err)
	}
}
func saveTelegramTestTarget(t *testing.T, s *Service) target {
	t.Helper()
	target := target{Account: "test-account", TelegramBotID: 123, Public: &runtimev1.IntegrationTarget{TargetRef: "test-telegram", IntegrationId: "telegram", Kind: "telegram", DisplayName: "Test Telegram", Operations: telegramOperations()}}
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	if err := s.secrets.WriteSecret("integration:"+target.Public.TargetRef, "test-token"); err != nil {
		t.Fatal(err)
	}
	return target
}
func invokeTestCall(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, targetID, op, input string) string {
	t.Helper()
	response, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: targetID, Operation: op, InputJson: input})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetCall().GetStatus() != "accepted" {
		t.Fatalf("invocation did not acknowledge acceptance: %v", response)
	}
	return response.Call.CallId
}
func waitTestCall(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, id string) *runtimev1.IntegrationCall {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result, err := s.GetIntegrationCall(testContext(d, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: id})
		if err != nil {
			t.Fatal(err)
		}
		if result.Call.Status != "accepted" {
			return result.Call
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("call did not terminalize")
	return nil
}
func registerTestProvider(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, effect string) string {
	t.Helper()
	result, err := s.RegisterIntegrationProvider(testContext(d, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "documents", DisplayName: "Test documents", Operations: []*runtimev1.IntegrationOperation{testOperation(effect)}})
	if err != nil {
		t.Fatal(err)
	}
	return result.Target.TargetRef
}
func pollTestProvider(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision) *runtimev1.PollIntegrationProviderResponse {
	t.Helper()
	r, err := s.PollIntegrationProvider(testContext(d, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{WaitMs: 1000})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestIntegrationAcceptedInvocationOutlivesRPCRequest(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var attempts atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(req.URL.Path, "/sendMessage") {
			return nil, fmt.Errorf("unexpected method %s", req.URL.Path)
		}
		attempts.Add(1)
		close(entered)
		select {
		case <-release:
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"message_id": 7, "chat": map[string]any{"id": 1}}}), nil
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	}))
	d := testDecision("consumer", 1)
	target := saveTelegramTestTarget(t, s)
	grantTestTarget(t, s, d, target.Public.TargetRef, "telegram.sendMessage")
	ctx, cancel := context.WithCancel(testContext(d, localappop.OperationIntegrationCallInvoke))
	defer cancel()
	response, err := s.InvokeIntegrationCall(ctx, &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: "telegram.sendMessage", InputJson: `{"chatId":"1","text":"test"}`})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("accepted operation did not dispatch after RPC returned")
	}
	close(release)
	result := waitTestCall(t, s, d, response.Call.CallId)
	if result.Status != "completed" || result.ResultJson == "" || attempts.Load() != 1 {
		t.Fatalf("RPC lifetime canceled accepted operation: %v attempts=%d", result, attempts.Load())
	}
}

func TestIntegrationAppPermissionAndCancellationAreIndependent(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider := testDecision("provider", 1)
	one, two, denied := testDecision("one", 2), testDecision("two", 3), testDecision("denied", 4)
	target := registerTestProvider(t, s, provider, "read")
	grantTestTarget(t, s, one, target, "document.read")
	grantTestTarget(t, s, two, target, "document.read")
	if _, err := s.InvokeIntegrationCall(testContext(denied, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target, Operation: "document.read", InputJson: `{}`}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("ungranted caller invoked: %v", err)
	}
	first := invokeTestCall(t, s, one, target, "document.read", `{}`)
	second := invokeTestCall(t, s, two, target, "document.read", `{}`)
	polled := pollTestProvider(t, s, provider)
	if len(polled.Calls) != 2 {
		t.Fatalf("provider did not receive both consumers: %v", polled)
	}
	if _, err := s.CancelIntegrationCall(testContext(two, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: first}); status.Code(err) != codes.NotFound {
		t.Fatalf("foreign cancel succeeded: %v", err)
	}
	if _, err := s.GetIntegrationCall(testContext(two, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: first}); status.Code(err) != codes.NotFound {
		t.Fatalf("foreign call read succeeded: %v", err)
	}
	if _, err := s.CancelIntegrationCall(testContext(one, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: first}); err != nil {
		t.Fatal(err)
	}
	if r := waitTestCall(t, s, one, first); r.Status != "canceled" {
		t.Fatalf("own read cancel state=%v", r)
	}
	completed, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: second, ResultJson: `{"body":"owned result"}`})
	if err != nil || !completed.Accepted {
		t.Fatalf("unrelated consumer interrupted: %v %v", completed, err)
	}
	if r := waitTestCall(t, s, two, second); r.Status != "completed" || !strings.Contains(r.ResultJson, "owned result") {
		t.Fatalf("second result invalid: %v", r)
	}
	reopened := two
	reopened.SessionID[0]++
	old, err := s.GetIntegrationCall(testContext(reopened, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: second})
	if err != nil || old.Call.ResultJson != "" {
		t.Fatalf("new session received old private result: %v %v", old, err)
	}
}

func TestIntegrationManagementRejectsSameNamedUnverifiedApp(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	d := testDecision("pretender", 1)
	d.AppID = "nimi.desktop"
	d.TrustClass = accountservice.LocalAppTrustClassBuiltIn
	if _, err := s.GetIntegrationManagement(testContext(d, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("name and coverage granted management: %v", err)
	}
	if _, err := s.SetIntegrationPermission(testContext(d, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("name and coverage granted self-permission: %v", err)
	}
}

func TestIntegrationProviderCompletesAtMostOnceAndCompletedIsNotCanceled(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, provider, "write")
	grantTestTarget(t, s, consumer, target, "document.read")
	id := invokeTestCall(t, s, consumer, target, "document.read", `{}`)
	if calls := pollTestProvider(t, s, provider); len(calls.Calls) != 1 {
		t.Fatalf("provider call missing: %v", calls)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	var accepted atomic.Int32
	body, _ := json.Marshal(map[string]any{"body": strings.Repeat("content ", 8192)})
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			r, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: string(body)})
			if err != nil {
				t.Errorf("complete failed: %v", err)
			}
			if r.GetAccepted() {
				accepted.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	if accepted.Load() != 1 {
		t.Errorf("provider accepted the same result %d times", accepted.Load())
	}
	result := waitTestCall(t, s, consumer, id)
	if result.Status != "completed" {
		t.Fatalf("completion failed: %v", result)
	}
	s.mu.Lock()
	done := s.calls[id].ctx.Done()
	s.mu.Unlock()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("call worker did not finish")
	}
	r, err := s.PollIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
	if err != nil || len(r.GetCanceledCallIds()) != 0 {
		t.Fatalf("completed call projected cancellation: %v %v", r, err)
	}
}

func TestIntegrationProviderStopFailsClosedAndRejectsLateCompletion(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, provider, "write")
	grantTestTarget(t, s, consumer, target, "document.read")
	id := invokeTestCall(t, s, consumer, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, provider)
	if _, err := s.UnregisterIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderUnregister), &runtimev1.UnregisterIntegrationProviderRequest{TargetRef: target}); err != nil {
		t.Fatal(err)
	}
	if result := waitTestCall(t, s, consumer, id); result.Status != "unconfirmed" {
		t.Fatalf("delivered write lost uncertainty: %v", result)
	}
	_, offlineErr := s.InvokeIntegrationCall(testContext(consumer, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target, Operation: "document.read", InputJson: `{}`})
	if status.Code(offlineErr) != codes.Unavailable {
		t.Fatalf("stopped provider remained callable: %v", offlineErr)
	}
	if reason, ok := grpcerr.ExtractReasonCode(offlineErr); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("provider outage must not look like consumer transport loss: %v", offlineErr)
	}
	if message, ok := grpcerr.ExtractPublicMessage(offlineErr); !ok || message != "INTEGRATION_PROVIDER_UNAVAILABLE" {
		t.Fatalf("provider failure lost its safe operation detail: %q (%v)", message, ok)
	}
	if _, err := s.ListIntegrationCalls(testContext(consumer, localappop.OperationIntegrationCallList), &runtimev1.ListIntegrationCallsRequest{}); err != nil {
		t.Fatalf("provider outage made the consumer unavailable: %v", err)
	}
	result, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"late":true}`})
	if err != nil || result.Accepted {
		t.Fatalf("late provider result accepted: %v %v", result, err)
	}
}

func TestIntegrationSchemaRejectsNullInputAndOutput(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, provider, "read")
	grantTestTarget(t, s, consumer, target, "document.read")
	if _, err := s.InvokeIntegrationCall(testContext(consumer, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target, Operation: "document.read", InputJson: `null`}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("null bypassed object input schema: %v", err)
	}
	id := invokeTestCall(t, s, consumer, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, provider)
	if _, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `null`}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("null bypassed object output schema: %v", err)
	}
}

func TestIntegrationMCPUnknownWriteIsNotRetried(t *testing.T) {
	var tools atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodDelete {
			return &http.Response{StatusCode: 204, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		var rpc struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if err := json.NewDecoder(req.Body).Decode(&rpc); err != nil {
			return nil, err
		}
		switch rpc.Method {
		case "initialize":
			return jsonResponse(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"protocolVersion": "2025-06-18", "serverInfo": map[string]any{"name": "test", "version": "1"}, "capabilities": map[string]any{"tools": map[string]any{}}}}), nil
		case "notifications/initialized":
			return &http.Response{StatusCode: 202, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
		case "tools/call":
			tools.Add(1)
			return nil, io.ErrUnexpectedEOF
		default:
			return nil, fmt.Errorf("unexpected MCP method %q", rpc.Method)
		}
	}))
	d := testDecision("consumer", 1)
	target := target{Account: d.AccountID, Endpoint: "https://mcp.test.invalid", Public: &runtimev1.IntegrationTarget{TargetRef: "test-mcp", Kind: "mcp", IntegrationId: "mcp", Operations: []*runtimev1.IntegrationOperation{testOperation("write")}}}
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	grantTestTarget(t, s, d, target.Public.TargetRef, "document.read")
	id := invokeTestCall(t, s, d, target.Public.TargetRef, "document.read", `{}`)
	result := waitTestCall(t, s, d, id)
	if result.Status != "unconfirmed" || tools.Load() != 1 {
		t.Fatalf("unknown MCP effect retried or hidden: %v attempts=%d", result, tools.Load())
	}
}

func waitReceiverReaders(t *testing.T, s *Service, id string, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		r := s.receivers[id]
		s.mu.Unlock()
		if r != nil {
			r.mu.Lock()
			readers := r.readers
			r.mu.Unlock()
			if readers == want {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("receiver did not reach %d readers", want)
}
func TestIntegrationTelegramReadersShareOwnerAndLastCancelStopsIO(t *testing.T) {
	entered, canceled := make(chan struct{}, 4), make(chan struct{}, 4)
	var requests atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(req.URL.Path, "/getUpdates") {
			return nil, fmt.Errorf("unexpected Telegram call")
		}
		requests.Add(1)
		entered <- struct{}{}
		<-req.Context().Done()
		canceled <- struct{}{}
		return nil, req.Context().Err()
	}))
	target := saveTelegramTestTarget(t, s)
	one, two := testDecision("one", 1), testDecision("two", 2)
	grantTestTarget(t, s, one, target.Public.TargetRef, "telegram.updates.read")
	grantTestTarget(t, s, two, target.Public.TargetRef, "telegram.updates.read")
	first := invokeTestCall(t, s, one, target.Public.TargetRef, "telegram.updates.read", `{"chatIds":["1"],"waitMs":25000}`)
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first receiver did not start")
	}
	second := invokeTestCall(t, s, two, target.Public.TargetRef, "telegram.updates.read", `{"chatIds":["1"],"waitMs":25000}`)
	waitReceiverReaders(t, s, target.Public.TargetRef, 2)
	if requests.Load() != 1 {
		t.Fatalf("readers started competing upstream receivers: %d", requests.Load())
	}
	if _, err := s.CancelIntegrationCall(testContext(one, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: first}); err != nil {
		t.Fatal(err)
	}
	_ = waitTestCall(t, s, one, first)
	waitReceiverReaders(t, s, target.Public.TargetRef, 1)
	select {
	case <-canceled:
		t.Fatal("one reader canceled another reader's receiver")
	default:
	}
	if _, err := s.CancelIntegrationCall(testContext(two, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: second}); err != nil {
		t.Fatal(err)
	}
	_ = waitTestCall(t, s, two, second)
	waitReceiverReaders(t, s, target.Public.TargetRef, 0)
	select {
	case <-canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("last reader left upstream IO running")
	}
	if requests.Load() != 1 {
		t.Fatalf("receiver restarted after all readers stopped: %d", requests.Load())
	}
}

func TestIntegrationTelegramNewReaderWaitsForCanceledPollToDrain(t *testing.T) {
	started, oldCanceled := make(chan int, 4), make(chan struct{})
	releaseOld := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(releaseOld) }) }
	defer unblock()
	var attempts, active, maxActive atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		id := int(attempts.Add(1))
		current := active.Add(1)
		defer active.Add(-1)
		for old := maxActive.Load(); current > old; old = maxActive.Load() {
			if maxActive.CompareAndSwap(old, current) {
				break
			}
		}
		started <- id
		<-req.Context().Done()
		if id == 1 {
			close(oldCanceled)
			<-releaseOld
		}
		return nil, req.Context().Err()
	}))
	target := saveTelegramTestTarget(t, s)
	firstCtx, firstCancel := context.WithCancel(context.Background())
	defer firstCancel()
	firstDone := make(chan error, 1)
	go func() {
		_, err := s.readTelegramUpdates(firstCtx, target, "test-token", `{"chatIds":["1"],"waitMs":25000}`)
		firstDone <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("first poll missing")
	}
	firstCancel()
	select {
	case <-firstDone:
	case <-time.After(2 * time.Second):
		t.Fatal("reader did not cancel")
	}
	select {
	case <-oldCanceled:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream poll did not cancel")
	}
	secondCtx, secondCancel := context.WithCancel(context.Background())
	defer secondCancel()
	secondDone := make(chan error, 1)
	go func() {
		_, err := s.readTelegramUpdates(secondCtx, target, "test-token", `{"chatIds":["1"],"waitMs":25000}`)
		secondDone <- err
	}()
	select {
	case id := <-started:
		t.Errorf("new poll %d overlapped canceled upstream request", id)
	case <-time.After(100 * time.Millisecond):
	}
	unblock()
	if attempts.Load() < 2 {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("new reader did not resume reception")
		}
	}
	secondCancel()
	select {
	case <-secondDone:
	case <-time.After(2 * time.Second):
		t.Fatal("second reader did not cancel")
	}
	if maxActive.Load() != 1 {
		t.Fatalf("same connection had %d concurrent upstream polls", maxActive.Load())
	}
}

type testTelegramRead struct {
	Cursor  string           `json:"cursor"`
	Updates []telegramUpdate `json:"updates"`
}

func telegramReadResult(t *testing.T, raw string, err error) testTelegramRead {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	var result testTelegramRead
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Cursor == "" {
		t.Fatal("receiver did not issue cursor")
	}
	return result
}
func TestIntegrationTelegramFreshCursorHandlesSparseUpstreamIDsAndExpiresLostData(t *testing.T) {
	deliver := make(chan struct{})
	var delivered atomic.Bool
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-deliver:
		}
		if delivered.CompareAndSwap(false, true) {
			return jsonResponse(map[string]any{"ok": true, "result": []any{map[string]any{"update_id": 987654, "message": map[string]any{"message_id": 77, "date": 1700000000, "text": "reply", "chat": map[string]any{"id": 1}, "from": map[string]any{"id": 2}}}}}), nil
		}
		<-req.Context().Done()
		return nil, req.Context().Err()
	}))
	target := saveTelegramTestTarget(t, s)
	raw, err := s.readTelegramUpdates(context.Background(), target, "test-token", `{"chatIds":["1"],"waitMs":0}`)
	first := telegramReadResult(t, raw, err)
	if len(first.Updates) != 0 {
		t.Fatalf("fresh cursor invented updates: %v", first)
	}
	close(deliver)
	input, _ := json.Marshal(map[string]any{"chatIds": []string{"1"}, "waitMs": 2000, "cursor": first.Cursor})
	raw, err = s.readTelegramUpdates(context.Background(), target, "test-token", string(input))
	next := telegramReadResult(t, raw, err)
	if len(next.Updates) != 1 || next.Updates[0].UpdateID != 987654 || next.Updates[0].Text != "reply" {
		t.Fatalf("sparse upstream id falsely expired/lost: %v", next)
	}
	// Retention is measured at the receiver owner. Once this real received
	// update expires, a pre-update cursor must not become an empty success.
	if _, err := s.backend.DB().Exec(`UPDATE runtime_integration_update SET received_ms=? WHERE account_id=? AND target_ref=?`, time.Now().Add(-25*time.Hour).UnixMilli(), target.Account, target.Public.TargetRef); err != nil {
		t.Fatal(err)
	}
	input, _ = json.Marshal(map[string]any{"chatIds": []string{"1"}, "waitMs": 0, "cursor": first.Cursor})
	if _, err := s.readTelegramUpdates(context.Background(), target, "test-token", string(input)); !strings.Contains(fmt.Sprint(err), "INTEGRATION_CURSOR_EXPIRED") {
		t.Fatalf("lost update reported empty success: %v", err)
	}
	// The post-update cursor has observed that update and remains valid after
	// cleanup; it is not invalid merely because the cache has become empty.
	input, _ = json.Marshal(map[string]any{"chatIds": []string{"1"}, "waitMs": 0, "cursor": next.Cursor})
	raw, err = s.readTelegramUpdates(context.Background(), target, "test-token", string(input))
	last := telegramReadResult(t, raw, err)
	if len(last.Updates) != 0 {
		t.Fatalf("expired event replayed: %v", last)
	}
}
