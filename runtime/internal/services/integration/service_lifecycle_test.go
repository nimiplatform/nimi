package integration

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type integrationDesktopVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (v integrationDesktopVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return v.peers, nil
}

type integrationDesktopLiveness struct{ revoked chan struct{} }

func (l *integrationDesktopLiveness) Revoked() <-chan struct{} { return l.revoked }
func (l *integrationDesktopLiveness) Close() error             { return nil }
func desktopIntegrationContext(t *testing.T, op localappop.Operation) context.Context {
	t.Helper()
	ident := func(seed byte) protectedlocal.Identifier {
		var id protectedlocal.Identifier
		for i := range id {
			id[i] = seed
		}
		return id
	}
	process := func(pid uint32, name string, seed byte) protectedlocal.ProcessTuple {
		return protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: pid, CreationMarker: name + "-start", OSLoginSession: "login", SecurityPrincipal: name, CanonicalExecutableIdentity: name, ExecutableDigest: ident(seed), ExecutableTrustSetID: name + "-trust"}
	}
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), integrationDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{Client: process(101, "desktop", 1), Server: process(202, "runtime", 2), ClientLiveness: &integrationDesktopLiveness{revoked: make(chan struct{})}, RuntimeBootEpoch: ident(3), EndpointInstanceID: ident(4), TranscriptNonce: ident(5)}}, bytes.NewReader(bytes.Repeat([]byte{6}, protectedlocal.IdentifierBytes)))
	if err != nil {
		t.Fatal(err)
	}
	d := testDecision("desktop", 7)
	d.AppID = "nimi.desktop"
	d.TrustClass = accountservice.LocalAppTrustClassBuiltIn
	return protectedlocal.ContextWithDesktopConnection(testContext(d, op), connection)
}

type integrationTestRegistrations []Consumer

func (r integrationTestRegistrations) Consumers(context.Context) ([]Consumer, error) { return r, nil }
func (r integrationTestRegistrations) DescribeConsumer(_ context.Context, subject string) (Consumer, bool, error) {
	for _, consumer := range r {
		if consumer.Subject == subject {
			return consumer, true, nil
		}
	}
	return Consumer{}, false, nil
}

func TestIntegrationCompatibleConnectionRetainsPermissionAndRejectsCredentialRebind(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Path, "/getMe") {
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": 7, "username": "test-bot"}}), nil
		}
		if strings.HasSuffix(req.URL.Path, "/getWebhookInfo") {
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
		}
		return nil, fmt.Errorf("unexpected test request")
	}))
	putCtx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
	created, err := s.PutIntegrationConnection(putCtx, &runtimev1.PutIntegrationConnectionRequest{Adapter: "telegram", DisplayName: "original", Secret: "fixed-token"})
	if err != nil {
		t.Fatal(err)
	}
	consumer := testDecision("consumer", 9)
	grantTestTarget(t, s, consumer, created.Connection.TargetRef, "telegram.sendMessage")
	next := &runtimev1.PutIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef, Adapter: "telegram", DisplayName: "renamed"}
	if _, err := s.PutIntegrationConnection(putCtx, next); err != nil {
		t.Fatal(err)
	}
	if !s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, next.TargetRef, "telegram.sendMessage") {
		t.Fatal("compatible rename revoked permission")
	}
	next.Secret = "different-token"
	if _, err := s.PutIntegrationConnection(putCtx, next); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("credential rebound existing target: %v", err)
	}
	secret, _, err := s.secrets.ReadSecret("integration:" + next.TargetRef)
	if err != nil || secret != "fixed-token" {
		t.Fatalf("failed update changed custody: %q %v", secret, err)
	}
}

func TestIntegrationAcceptedCallKeepsCapturedCredential(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	observed := make(chan string, 1)
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		observed <- req.URL.Path
		return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"message_id": 1, "date": 1700000000, "text": "sent", "chat": map[string]any{"id": 1}}}), nil
	}))
	previous := s.revalidator
	s.revalidator = testRevalidator(func(ctx context.Context, i localappop.Ingress) (context.Context, error) {
		if i == localappop.IngressIntegrationCallInvoke {
			once.Do(func() { close(entered); <-release })
		}
		return previous.AuthorizeLocalAppIngress(ctx, i)
	})
	target := saveTelegramTestTarget(t, s)
	d := testDecision("consumer", 1)
	grantTestTarget(t, s, d, target.Public.TargetRef, "telegram.sendMessage")
	id := invokeTestCall(t, s, d, target.Public.TargetRef, "telegram.sendMessage", `{"chatId":"1","text":"test"}`)
	select {
	case <-entered:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("dispatch admission did not arrive")
	}
	// Emulate a custody update outside the selected invocation. Its captured
	// credential must remain fixed even if the store changes before dispatch.
	if err := s.secrets.WriteSecret("integration:"+target.Public.TargetRef, "replacement-token"); err != nil {
		t.Fatal(err)
	}
	close(release)
	result := waitTestCall(t, s, d, id)
	if result.Status != "completed" {
		t.Fatalf("captured call failed: %v", result)
	}
	if route := <-observed; route != "/bottest-token/sendMessage" {
		t.Fatalf("accepted invocation reread changed credential: %s", route)
	}
	s.mu.Lock()
	credential := s.calls[id].credential
	s.mu.Unlock()
	if credential != "" {
		t.Fatal("terminal invocation retained credential")
	}
}

func TestIntegrationCompatibleProviderAdditionDoesNotExpandPermission(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	p, d := testDecision("provider", 1), testDecision("consumer", 2)
	id := registerTestProvider(t, s, p, "read")
	grantTestTarget(t, s, d, id, "document.read")
	added := proto.Clone(testOperation("read")).(*runtimev1.IntegrationOperation)
	added.Name = "document.extra"
	req := &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "documents", DisplayName: "documents", Operations: []*runtimev1.IntegrationOperation{testOperation("read"), added}}
	if _, err := s.RegisterIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderRegister), req); err != nil {
		t.Fatal(err)
	}
	if !s.permitted(context.Background(), d.AccountID, d.RegisteredAppSubject, id, "document.read") || s.permitted(context.Background(), d.AccountID, d.RegisteredAppSubject, id, "document.extra") {
		t.Fatal("compatible operation addition changed existing permission")
	}
	req.Operations[0].Effect = "write"
	if _, err := s.RegisterIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderRegister), req); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("provider changed operation semantics in place: %v", err)
	}
}

func TestIntegrationResultTimerDropsIdleBodyAndReturnsExpiredMetadata(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	p, d := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, p, "read")
	grantTestTarget(t, s, d, target, "document.read")
	id := invokeTestCall(t, s, d, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, p)
	if _, err := s.CompleteIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"private":"body"}`}); err != nil {
		t.Fatal(err)
	}
	_ = waitTestCall(t, s, d, id)
	s.mu.Lock()
	c := s.calls[id]
	c.fact.UpdatedAt = timestamppb.New(time.Now().Add(-resultRetention))
	s.scheduleCallExpiryLocked(c)
	s.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		gone := s.calls[id] == nil
		s.mu.Unlock()
		if gone {
			break
		}
		time.Sleep(time.Millisecond)
	}
	s.mu.Lock()
	gone := s.calls[id] == nil
	body := c.fact.ResultJson
	s.mu.Unlock()
	if !gone || body != "" {
		t.Fatal("timer retained idle private result without another API call")
	}
	result, err := s.GetIntegrationCall(testContext(d, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: id})
	if err != nil || result.Call.Status != "completed" || result.Call.ResultJson != "" || result.Call.ErrorCode != "INTEGRATION_RESULT_EXPIRED" {
		t.Fatalf("expired result became success body: %v %v", result, err)
	}
}

func TestIntegrationCallCapacityNeverEvictsAcceptedWork(t *testing.T) {
	s := &Service{calls: map[string]*invocation{}}
	for i := 0; i < maxRetainedCalls; i++ {
		id := fmt.Sprint(i)
		s.calls[id] = &invocation{fact: &runtimev1.IntegrationCall{CallId: id, Status: "accepted", UpdatedAt: timestamppb.Now()}}
	}
	if s.reserveCallSlotLocked(time.Now()) || len(s.calls) != maxRetainedCalls {
		t.Fatal("full active store evicted accepted work")
	}
	s.calls["0"].fact.Status = "completed"
	s.calls["0"].fact.ResultJson = `{"private":true}`
	if !s.reserveCallSlotLocked(time.Now()) || len(s.calls) != maxRetainedCalls-1 || s.calls["0"] != nil {
		t.Fatal("capacity did not evict terminal result first")
	}
	for _, c := range s.calls {
		if c.fact.Status != "accepted" {
			t.Fatal("unexpected surviving terminal call")
		}
	}
}

type integrationCountingBody struct {
	reader io.Reader
	read   int
	closed bool
}

func (b *integrationCountingBody) Read(p []byte) (int, error) {
	n, err := b.reader.Read(p)
	b.read += n
	return n, err
}
func (b *integrationCountingBody) Close() error { b.closed = true; return nil }
func TestIntegrationMCPOrdinaryHTTPResponseHasByteBound(t *testing.T) {
	body := &integrationCountingBody{reader: strings.NewReader(`{"value":"` + strings.Repeat("x", maxOutput*2) + `"}`)}
	transport := credentialTransport{base: testRoundTripper(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: body}, nil
	})}
	req, err := http.NewRequest(http.MethodPost, "https://mcp.test.invalid", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(req); !strings.Contains(fmt.Sprint(err), "INTEGRATION_RESULT_BOUNDS") {
		t.Fatalf("oversized non-SSE response admitted: %v", err)
	}
	if body.read > maxOutput+1 || !body.closed {
		t.Fatalf("HTTP response was not bounded and released: read=%d closed=%v", body.read, body.closed)
	}
}

func TestIntegrationTelegramPositionFailureIsNotMaskedAsCancellation(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
		t.Error("query failure dispatched HTTP")
		return nil, errors.New("unexpected HTTP")
	}))
	target := saveTelegramTestTarget(t, s)
	if _, err := s.backend.DB().Exec(`DROP TABLE runtime_integration_receiver`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	r := &telegramReceiver{readers: 1, epoch: "test", wake: make(chan struct{}), ctx: ctx, cancel: cancel, done: make(chan struct{})}
	s.mu.Lock()
	s.receivers[target.Public.TargetRef] = r
	s.workers.Add(1)
	s.mu.Unlock()
	go s.receiveTelegram(ctx, target, "test-token", r)
	deadline := time.Now().Add(time.Second)
	var failure error
	for time.Now().Before(deadline) {
		r.mu.Lock()
		failure = r.err
		r.mu.Unlock()
		if failure != nil {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if failure == nil {
		t.Fatal("position query error was hidden as poll cancellation")
	}
}

type integrationFailingBackend struct {
	Backend
	fail atomic.Bool
}

func (b *integrationFailingBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if b.fail.Load() {
		return errors.New("injected terminal record failure")
	}
	return b.Backend.WriteTx(ctx, fn)
}
func TestIntegrationProviderRecordFailureIsUnconfirmedAndNotAccepted(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	backend := &integrationFailingBackend{Backend: s.backend}
	s.backend = backend
	p, d := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, p, "write")
	grantTestTarget(t, s, d, target, "document.read")
	id := invokeTestCall(t, s, d, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, p)
	backend.fail.Store(true)
	result, err := s.CompleteIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"actual":true}`})
	if err != nil || result.Accepted {
		t.Fatalf("unrecorded result acknowledged success: %v %v", result, err)
	}
	call := waitTestCall(t, s, d, id)
	if call.Status != "unconfirmed" || call.ResultJson != "" || call.ErrorCode != "INTEGRATION_RESULT_RECORD_UNAVAILABLE" {
		t.Fatalf("record failure lost uncertainty: %v", call)
	}
	s.mu.Lock()
	s.dropCallLocked(id)
	s.mu.Unlock()
	old, err := s.GetIntegrationCall(testContext(d, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: id})
	if err != nil || old.Call.Status != "unconfirmed" {
		t.Fatalf("orphan accepted metadata became phantom running call: %v %v", old, err)
	}
}

func TestIntegrationValidatedProviderResultCannotWinAfterCancellation(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	p, d := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, p, "read")
	grantTestTarget(t, s, d, target, "document.read")
	id := invokeTestCall(t, s, d, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, p)
	s.mu.Lock()
	c := s.calls[id]
	s.cancelInvocationLocked(c)
	s.mu.Unlock()
	if s.finishProvider(c, "completed", `{"late":true}`, "") {
		t.Fatal("validated but canceled provider result was accepted at commit")
	}
	if result := waitTestCall(t, s, d, id); result.Status != "canceled" || result.ResultJson != "" {
		t.Fatalf("late result replaced cancellation: %v", result)
	}
}

func TestIntegrationRootAbortReopensOnlyAfterCanceledWorkersDrain(t *testing.T) {
	entered := make(chan int, 4)
	release := make(chan struct{})
	var unblock sync.Once
	releaseOld := func() { unblock.Do(func() { close(release) }) }
	defer releaseOld()
	var attempts atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		id := int(attempts.Add(1))
		entered <- id
		<-req.Context().Done()
		if id == 1 {
			<-release
		}
		return nil, req.Context().Err()
	}))
	target := saveTelegramTestTarget(t, s)
	d := testDecision("consumer", 1)
	grantTestTarget(t, s, d, target.Public.TargetRef, "telegram.updates.read")
	id := invokeTestCall(t, s, d, target.Public.TargetRef, "telegram.updates.read", `{"chatIds":["1"],"waitMs":25000}`)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("receiver did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := s.QuiesceDataRootContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("quiesce did not preserve its deadline: %v", err)
	}
	s.ResumeDataRootAfterAbort()
	if !s.quiesced.Load() {
		t.Fatal("abort reopened while canceled worker still retained the data root")
	}
	if _, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: "telegram.updates.read", InputJson: `{"chatIds":["1"]}`}); err == nil {
		t.Fatal("new call admitted during unfinished root drain")
	}
	releaseOld()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && s.quiesced.Load() {
		time.Sleep(time.Millisecond)
	}
	if s.quiesced.Load() {
		t.Fatal("aborted root did not reopen after drain")
	}
	old, err := s.GetIntegrationCall(testContext(d, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: id})
	if err != nil || old.Call.Status == "accepted" {
		t.Fatalf("old work resumed or remained running: %v %v", old, err)
	}
	if attempts.Load() != 1 {
		t.Fatal("technical resume automatically restarted old receiver IO")
	}
	next := invokeTestCall(t, s, d, target.Public.TargetRef, "telegram.updates.read", `{"chatIds":["1"],"waitMs":25000}`)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("new explicit call could not run after abort")
	}
	_, _ = s.CancelIntegrationCall(testContext(d, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: next})
	_ = waitTestCall(t, s, d, next)
}

func TestIntegrationConnectionRemovalDrainsReceiverBeforeDeletingCustody(t *testing.T) {
	entered := make(chan struct{})
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		close(entered)
		<-req.Context().Done()
		return jsonResponse(map[string]any{"ok": true, "result": []any{map[string]any{"update_id": 99, "message": map[string]any{"message_id": 7, "text": "late", "chat": map[string]any{"id": 1}, "from": map[string]any{"id": 2}}}}}), nil
	}))
	target := saveTelegramTestTarget(t, s)
	d := testDecision("consumer", 1)
	grantTestTarget(t, s, d, target.Public.TargetRef, "telegram.updates.read")
	id := invokeTestCall(t, s, d, target.Public.TargetRef, "telegram.updates.read", `{"chatIds":["1"],"waitMs":25000}`)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("receiver never started")
	}
	removed, err := s.RemoveIntegrationConnection(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: target.Public.TargetRef})
	if err != nil || !removed.Removed {
		t.Fatalf("connection removal failed: %v %v", removed, err)
	}
	if call := waitTestCall(t, s, d, id); call.Status != "canceled" || call.ResultJson != "" {
		t.Fatalf("removed connection delivered late data: %v", call)
	}
	for _, table := range []string{"runtime_integration_target", "runtime_integration_receiver", "runtime_integration_update", "runtime_integration_permission"} {
		var count int
		if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE target_ref=?`, target.Public.TargetRef).Scan(&count); err != nil || count != 0 {
			t.Fatalf("removed %s state recreated: %d %v", table, count, err)
		}
	}
	if _, exists, err := s.secrets.ReadSecret("integration:" + target.Public.TargetRef); err != nil || exists {
		t.Fatalf("removed credential retained: exists=%v err=%v", exists, err)
	}
}

func TestIntegrationPermissionRevocationBeforeDispatchPreventsEffect(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("unexpected revoked dispatch")
	}))
	previous := s.revalidator
	s.revalidator = testRevalidator(func(ctx context.Context, i localappop.Ingress) (context.Context, error) {
		if i == localappop.IngressIntegrationCallInvoke {
			once.Do(func() { close(entered); <-release })
		}
		return previous.AuthorizeLocalAppIngress(ctx, i)
	})
	target := saveTelegramTestTarget(t, s)
	d := testDecision("consumer", 1)
	s.registrations = integrationTestRegistrations{{Subject: d.RegisteredAppSubject, AppID: d.AppID, DisplayName: "Consumer"}}
	grantTestTarget(t, s, d, target.Public.TargetRef, "telegram.sendMessage")
	id := invokeTestCall(t, s, d, target.Public.TargetRef, "telegram.sendMessage", `{"chatId":"1","text":"test"}`)
	select {
	case <-entered:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("dispatch did not reach admission")
	}
	_, err := s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{TargetRef: target.Public.TargetRef, ConsumerRef: ref("icons_", d.AccountID, d.RegisteredAppSubject)})
	close(release)
	if err != nil {
		t.Fatal(err)
	}
	if call := waitTestCall(t, s, d, id); call.Status != "canceled" || calls.Load() != 0 {
		t.Fatalf("revoked accepted call dispatched effect: %v HTTP=%d", call, calls.Load())
	}
}
