package realmrealtime

import (
	"context"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"golang.org/x/net/websocket"
)

type renewingRealmAccount struct {
	mu        sync.Mutex
	lease     accountservice.RealmRealtimeAccountLease
	refreshes int
}

func (a *renewingRealmAccount) BindRealmRealtimeAccount(context.Context) (accountservice.RealmRealtimeAccountLease, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.lease, nil
}

func (a *renewingRealmAccount) RefreshRealmRealtimeAccount(_ context.Context, generation uint64, rejected string) (accountservice.RealmRealtimeAccountLease, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if generation != a.lease.Generation || rejected != a.lease.AccessToken {
		return accountservice.RealmRealtimeAccountLease{}, errSocketAuth
	}
	a.refreshes++
	a.lease.AccessToken = "fresh-token"
	return a.lease, nil
}

func TestConnectionFailureProjectsReasonWithoutReconnectingRejectedCredentials(t *testing.T) {
	for _, test := range []struct {
		reason   string
		terminal runtimev1.RealtimeTerminalReason
	}{
		{"unauthenticated", runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNAUTHENTICATED},
		{"denied", runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_PERMISSION_DENIED},
		{"protocol-failure", runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_PROTOCOL_FAILURE},
		{"closed", runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED},
		{"unknown", runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_PROTOCOL_FAILURE},
	} {
		t.Run(test.reason, func(t *testing.T) {
			server := newSocketIOServer(t, func(conn *websocket.Conn, _ string) {
				_ = websocket.Message.Send(conn, `42["realtime:connection.closed",{"reasonCode":"`+test.reason+`"}]`)
				_ = websocket.Message.Send(conn, "41")
			})
			service, _, subscription := newRealmSubscriptionFixture(t, 4)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			driver, err := dialSocketIO(ctx, server.URL, "rejected-token")
			if err != nil {
				t.Fatal(err)
			}
			defer driver.Close()
			remote := &realmConnection{lease: accountservice.RealmRealtimeAccountLease{AccountID: "account-1", Generation: 1}, ctx: ctx, cancel: cancel, driver: driver}
			service.remote = remote
			reader, release, err := subscription.stream.ClaimReader()
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			service.runConnection(remote) // No account provider: rejected credentials must never enter reconnect.
			event, ok := <-reader
			if !ok || event.GetControl().GetTerminalReason() != test.terminal {
				t.Fatalf("terminal = %v; want %v", event, test.terminal)
			}
			if _, ok := <-reader; ok {
				t.Fatal("duplicate terminal projection")
			}
		})
	}
}

func TestTokenExpiryRefreshesBeforeReconnectAndStopsOnFreshCredentialRejection(t *testing.T) {
	tokens := make(chan string, 3)
	server := newSocketIOServer(t, func(conn *websocket.Conn, token string) {
		tokens <- token
		reason := "unauthenticated"
		if token == "expired-token" {
			reason = "token-expired"
		}
		_ = websocket.Message.Send(conn, `42["realtime:connection.closed",{"reasonCode":"`+reason+`"}]`)
		_ = websocket.Message.Send(conn, "41")
	})
	service, _, subscription := newRealmSubscriptionFixture(t, 4)
	accounts := &renewingRealmAccount{lease: accountservice.RealmRealtimeAccountLease{AccountID: "account-1", Generation: 1, AccessToken: "expired-token", RealmRealtimeURL: server.URL}}
	service.accounts = accounts
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lease, _ := accounts.BindRealmRealtimeAccount(ctx)
	driver, err := dialSocketIO(ctx, server.URL, lease.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close()
	remote := &realmConnection{lease: lease, ctx: ctx, cancel: cancel, driver: driver}
	service.remote = remote
	service.runConnection(remote)
	if len(tokens) != 2 {
		t.Fatalf("connection count = %d; want exactly expired and fresh attempts", len(tokens))
	}
	if first, second := <-tokens, <-tokens; first != "expired-token" || second != "fresh-token" {
		t.Fatalf("reconnect tokens = %q, %q", first, second)
	}
	accounts.mu.Lock()
	refreshes := accounts.refreshes
	accounts.mu.Unlock()
	if refreshes != 1 {
		t.Fatalf("refresh attempts = %d", refreshes)
	}
	reader, release, err := subscription.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	event := <-reader
	if event.GetControl().GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNAUTHENTICATED {
		t.Fatalf("fresh credential rejection = %v", event)
	}
}
