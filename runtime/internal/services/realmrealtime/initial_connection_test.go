package realmrealtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type initialRealmAccount struct {
	mu           sync.Mutex
	lease        accountservice.RealmRealtimeAccountLease
	invalidated  chan struct{}
	beforeCommit func(context.Context)
}

func (a *initialRealmAccount) BindRealmRealtimeAccount(ctx context.Context) (accountservice.RealmRealtimeAccountLease, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return accountservice.RealmRealtimeAccountLease{}, err
	}
	return a.lease, nil
}

func (a *initialRealmAccount) RefreshRealmRealtimeAccount(ctx context.Context, _ uint64, _ string) (accountservice.RealmRealtimeAccountLease, error) {
	return a.BindRealmRealtimeAccount(ctx)
}

func (a *initialRealmAccount) CommitAuthenticatedRuntimeGeneration(ctx context.Context, accountID, realmID string, generation uint64, commit func() error) (bool, error) {
	if a.beforeCommit != nil {
		a.beforeCommit(ctx)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if a.lease.AccountID != accountID || a.lease.RealmEnvironmentID != realmID || a.lease.Generation != generation {
		return false, nil
	}
	select {
	case <-a.lease.Invalidated:
		return false, nil
	default:
	}
	return true, commit()
}

func newInitialRealmAccount(origin string) *initialRealmAccount {
	invalidated := make(chan struct{})
	return &initialRealmAccount{invalidated: invalidated, lease: accountservice.RealmRealtimeAccountLease{
		AccountID: "account-1", RealmEnvironmentID: "realm-1", Generation: 1,
		Invalidated: invalidated, AccessToken: "task-owned-token", RealmRealtimeURL: origin,
	}}
}

func (a *initialRealmAccount) invalidate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	close(a.invalidated)
	a.invalidated = make(chan struct{})
	a.lease.Invalidated = a.invalidated
	a.lease.Generation++
}

func realmOpenContext(ctx context.Context) context.Context {
	return metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-app-id", "app.test", "x-nimi-session-id", "session-1"))
}

func serveInitialRealmSocket(conn *websocket.Conn) {
	defer conn.Close()
	if websocket.Message.Send(conn, `0{"sid":"initial","upgrades":[],"pingInterval":25000,"pingTimeout":20000}`) != nil {
		return
	}
	var auth string
	if websocket.Message.Receive(conn, &auth) != nil || websocket.Message.Send(conn, `40{"sid":"connected"}`) != nil {
		return
	}
	for websocket.Message.Receive(conn, &auth) == nil {
	}
}

func TestInitialRealmConnectionRetriesTransportFailure(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if attempts.Add(1) == 1 {
			conn, _, err := response.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		websocket.Handler(serveInitialRealmSocket).ServeHTTP(response, request)
	}))
	defer server.Close()
	service := New(nil, newInitialRealmAccount(server.URL))
	defer service.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
	if err != nil {
		t.Fatalf("initial transport recovery failed: %v", err)
	}
	if opened.GetChannelId() == "" || attempts.Load() != 2 {
		t.Fatalf("channel=%q attempts=%d; want one channel after the second transport attempt", opened.GetChannelId(), attempts.Load())
	}
}

func TestInitialRealmConnectionTransportRetryIsBounded(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts.Add(1)
		conn, _, err := response.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}))
	defer server.Close()
	service := New(nil, newInitialRealmAccount(server.URL))
	defer service.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
	if opened != nil || status.Code(err) != codes.Unavailable || attempts.Load() != 6 {
		t.Fatalf("persistent transport failure opened=%v error=%v attempts=%d; want six bounded attempts", opened, err, attempts.Load())
	}
	assertNoInitialRealmPublication(t, service)
}

func TestInitialRealmConnectionRetriesTemporaryHTTPUpgradeRefusal(t *testing.T) {
	for _, code := range []int{http.StatusBadGateway, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if attempts.Add(1) == 1 {
					response.WriteHeader(code)
					return
				}
				websocket.Handler(serveInitialRealmSocket).ServeHTTP(response, request)
			}))
			defer server.Close()
			service := New(nil, newInitialRealmAccount(server.URL))
			defer service.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
			if err != nil || opened.GetChannelId() == "" || attempts.Load() != 2 {
				t.Fatalf("HTTP upgrade recovery: opened=%v error=%v attempts=%d", opened, err, attempts.Load())
			}
		})
	}
}

func TestInitialRealmUpgradeDoesNotInventDiscardedHTTPStatus(t *testing.T) {
	for _, code := range []int{http.StatusUnauthorized, http.StatusBadGateway, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(code)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			driver, err := dialSocketIO(ctx, server.URL, "task-owned-token")
			if driver != nil {
				driver.Close()
				t.Fatal("non-101 upgrade produced a driver")
			}
			projected := realmOpeningError(err)
			reason, _ := grpcerr.ExtractReasonCode(projected)
			if status.Code(projected) != codes.Unavailable || reason != runtimev1.ReasonCode_REALM_UNAVAILABLE {
				t.Fatalf("opaque HTTP upgrade failure was misclassified: %v", projected)
			}
		})
	}
}

func assertNoInitialRealmPublication(t *testing.T, service *Service) {
	t.Helper()
	service.mu.Lock()
	defer service.mu.Unlock()
	if service.remote != nil || len(service.channels) != 0 {
		t.Fatalf("cancelled or rejected opening published remote=%t channels=%d", service.remote != nil, len(service.channels))
	}
}

func TestInitialRealmConnectionPreservesTerminalFailure(t *testing.T) {
	for _, test := range []struct {
		name   string
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{"authentication", codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID},
		{"socket-protocol", codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{"websocket-protocol", codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
	} {
		t.Run(test.name, func(t *testing.T) {
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				attempts.Add(1)
				if test.name == "websocket-protocol" {
					response.Header().Set("Connection", "upgrade")
					response.Header().Set("Upgrade", "not-websocket")
					response.WriteHeader(http.StatusSwitchingProtocols)
					return
				}
				websocket.Handler(func(conn *websocket.Conn) {
					defer conn.Close()
					if test.name == "socket-protocol" {
						_ = websocket.Message.Send(conn, "not-an-engine-opening")
						return
					}
					_ = websocket.Message.Send(conn, `0{"sid":"initial"}`)
					var frame string
					if websocket.Message.Receive(conn, &frame) == nil {
						_ = websocket.Message.Send(conn, `44{"message":"authentication rejected"}`)
					}
				}).ServeHTTP(response, request)
			}))
			defer server.Close()
			service := New(nil, newInitialRealmAccount(server.URL))
			defer service.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
			reason, _ := grpcerr.ExtractReasonCode(err)
			if opened != nil || status.Code(err) != test.code || reason != test.reason || attempts.Load() != 1 {
				t.Fatalf("terminal opening=%v error=%v reason=%s attempts=%d", opened, err, reason, attempts.Load())
			}
			assertNoInitialRealmPublication(t, service)
		})
	}
}

func TestInitialRealmConnectionCancellationAndOwnerLossStopHandshake(t *testing.T) {
	for _, cause := range []string{"cancel", "deadline", "account-generation", "service-close"} {
		t.Run(cause, func(t *testing.T) {
			started, disconnected := make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
				defer conn.Close()
				defer close(disconnected)
				_ = websocket.Message.Send(conn, `0{"sid":"initial"}`)
				var frame string
				if websocket.Message.Receive(conn, &frame) != nil {
					return
				}
				close(started)
				_ = websocket.Message.Receive(conn, &frame) // Wait for cancellation instead of sending a ready acknowledgement.
			}))
			defer server.Close()
			account := newInitialRealmAccount(server.URL)
			service := New(nil, account)
			defer service.Close()
			timeout := 3 * time.Second
			if cause == "deadline" {
				timeout = 200 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
				if opened != nil {
					t.Error("late successful channel after opening scope ended")
				}
				done <- err
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("handshake did not start")
			}
			want := codes.Canceled
			switch cause {
			case "cancel":
				cancel()
			case "deadline":
				want = codes.DeadlineExceeded
			case "account-generation":
				want = codes.Unauthenticated
				account.invalidate()
			case "service-close":
				want = codes.Unavailable
				service.Close()
			}
			select {
			case err := <-done:
				if status.Code(err) != want {
					t.Fatalf("error=%v; want %s", err, want)
				}
			case <-time.After(time.Second):
				t.Fatal("opening did not promptly stop")
			}
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("cancelled handshake retained its socket")
			}
			assertNoInitialRealmPublication(t, service)
		})
	}
}

func TestInitialRealmConnectionCancellationStopsPendingWebsocketUpgrade(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
	}))
	defer server.Close()
	service := New(nil, newInitialRealmAccount(server.URL))
	defer service.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("websocket upgrade did not start")
	}
	cancel()
	select {
	case err := <-done:
		if status.Code(err) != codes.Canceled {
			t.Fatalf("upgrade cancellation = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("upgrade ignored caller cancellation")
	}
	assertNoInitialRealmPublication(t, service)
}

func TestInitialRealmConnectionConcurrentOpensShareAccountConnection(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts.Add(1)
		websocket.Handler(serveInitialRealmSocket).ServeHTTP(response, request)
	}))
	defer server.Close()
	service := New(nil, newInitialRealmAccount(server.URL))
	defer service.Close()
	var group sync.WaitGroup
	for index := 0; index < 8; index++ {
		group.Go(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel() // Ending an accepted Open RPC must not close the account-owned connection.
			opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
			if err != nil || opened.GetChannelId() == "" {
				t.Errorf("concurrent opening = %v, %v", opened, err)
			}
		})
	}
	group.Wait()
	opened, err := service.OpenRealmRealtimeChannel(realmOpenContext(context.Background()), &runtimev1.OpenRealmRealtimeChannelRequest{})
	if err != nil || opened.GetChannelId() == "" || attempts.Load() != 1 {
		t.Fatalf("account connection did not survive accepted callers: %v attempts=%d", err, attempts.Load())
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if len(service.channels) != 9 {
		t.Fatalf("channel count=%d; want 9 independent channels", len(service.channels))
	}
}

func TestInitialRealmConnectionWaitingCallerCancelsWithoutStoppingOwner(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		_ = websocket.Message.Send(conn, `0{"sid":"initial"}`)
		var frame string
		if websocket.Message.Receive(conn, &frame) != nil {
			return
		}
		close(started)
		<-release
		_ = websocket.Message.Send(conn, `40{"sid":"connected"}`)
		for websocket.Message.Receive(conn, &frame) == nil {
		}
	}))
	defer server.Close()
	service := New(nil, newInitialRealmAccount(server.URL))
	defer service.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	first := make(chan error, 1)
	go func() {
		_, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
		first <- err
	}()
	<-started
	secondCtx, secondCancel := context.WithCancel(ctx)
	second := make(chan error, 1)
	go func() {
		_, err := service.OpenRealmRealtimeChannel(realmOpenContext(secondCtx), &runtimev1.OpenRealmRealtimeChannelRequest{})
		second <- err
	}()
	secondCancel()
	select {
	case err := <-second:
		if status.Code(err) != codes.Canceled {
			t.Fatalf("waiting caller cancellation=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("waiting caller could not cancel")
	}
	close(release)
	if err := <-first; err != nil {
		t.Fatalf("cancelled waiter interrupted the owning request: %v", err)
	}
}

func TestInitialRealmConnectionRevalidatesGenerationAtPublication(t *testing.T) {
	for _, stage := range []struct {
		name   string
		commit int32
	}{{"remote", 1}, {"channel", 2}} {
		t.Run(stage.name, func(t *testing.T) {
			disconnected := make(chan struct{})
			server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
				defer close(disconnected)
				serveInitialRealmSocket(conn)
			}))
			defer server.Close()
			account := newInitialRealmAccount(server.URL)
			committing, release := make(chan struct{}), make(chan struct{})
			var commits atomic.Int32
			account.beforeCommit = func(ctx context.Context) {
				if commits.Add(1) == stage.commit {
					close(committing)
					if stage.commit == 1 {
						<-ctx.Done() // Exercise the account-invalidation cancellation cause at the final fence.
					}
					<-release
				}
			}
			service := New(nil, account)
			defer service.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := service.OpenRealmRealtimeChannel(realmOpenContext(ctx), &runtimev1.OpenRealmRealtimeChannelRequest{})
				done <- err
			}()
			<-committing
			account.invalidate()
			close(release)
			if err := <-done; status.Code(err) != codes.Unauthenticated {
				t.Fatalf("publication accepted an invalidated account generation: %v", err)
			}
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("invalidated account retained the candidate driver")
			}
			assertNoInitialRealmPublication(t, service)
		})
	}
}
