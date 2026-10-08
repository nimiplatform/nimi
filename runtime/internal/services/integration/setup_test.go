package integration

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func setupRequest() *runtimev1.StartIntegrationConnectionSetupRequest {
	return &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "telegram", DisplayName: "Setup bot", Config: &runtimev1.IntegrationConnectionConfig{Telegram: &runtimev1.IntegrationTelegramConfig{}}}
}

func TestSetupTerminalHistoryDoesNotConsumeActiveSlots(t *testing.T) {
	for _, terminal := range []string{"completed", "failed", "canceled"} {
		t.Run(terminal, func(t *testing.T) {
			var botID atomic.Int64
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if terminal == "failed" {
					return jsonResponse(map[string]any{"ok": false, "error_code": 401, "description": "Unauthorized"}), nil
				}
				if strings.HasSuffix(req.URL.Path, "/getMe") {
					return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": botID.Add(1), "username": "setup_bot"}}), nil
				}
				return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
			}))
			for i := 0; i < 8; i++ {
				started, err := s.StartIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart), setupRequest())
				if err != nil {
					t.Fatalf("terminal history blocked attempt %d: %v", i+1, err)
				}
				if terminal == "canceled" {
					_, err = s.CancelIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
					if err != nil {
						t.Fatal(err)
					}
				} else {
					_, err = s.SubmitIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "write-only"})
					if err != nil {
						t.Fatal(err)
					}
					deadline := time.Now().Add(3 * time.Second)
					for {
						observed, err := s.GetIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
						if err != nil {
							t.Fatal(err)
						}
						if observed.Setup.Status == terminal {
							break
						}
						if time.Now().After(deadline) {
							t.Fatal("unexpected terminal state", observed.Setup.Status)
						}
						time.Sleep(time.Millisecond)
					}
				}
			}
		})
	}
}

func TestSetupActiveLimitAndBoundedTerminalEviction(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	contextFor := func(op localappop.Operation) context.Context { return desktopIntegrationContext(t, op) }
	for i := 0; i < 130; i++ {
		started, err := s.StartIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupStart), setupRequest())
		if err != nil {
			t.Fatal(i, err)
		}
		_, err = s.CancelIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
		if err != nil {
			t.Fatal(err)
		}
	}
	s.mu.Lock()
	retained := len(s.setups)
	s.mu.Unlock()
	if retained > 128 {
		t.Fatal("terminal retention unbounded", retained)
	}
	var first string
	for i := 0; i < 4; i++ {
		started, err := s.StartIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupStart), setupRequest())
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = started.Setup.SetupId
		}
	}
	if _, err := s.StartIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupStart), setupRequest()); status.Code(err) != codes.ResourceExhausted {
		t.Fatal("true active limit lost", err)
	}
	if _, err := s.CancelIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: first}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupStart), setupRequest()); err != nil {
		t.Fatal("canceled slot not released", err)
	}
}
func TestSetupRejectsOrdinaryAppAndForeignScope(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	d := testDecision("consumer", 3)
	if _, err := s.StartIntegrationConnectionSetup(testContext(d, localappop.OperationIntegrationConnectionSetupStart), setupRequest()); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("ordinary App started management setup: %v", err)
	}
	started, err := s.StartIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart), setupRequest())
	if err != nil {
		t.Fatal(err)
	}
	if started.Setup.Status != "awaiting-input" || started.Setup.ExpiresAt.AsTime().After(time.Now().Add(10*time.Minute)) {
		t.Fatal("setup not bounded")
	}
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupGet)
	owner, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	owner.AccountID = "other-account"
	ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, owner)
	if _, err := s.GetIntegrationConnectionSetup(ctx, &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); status.Code(err) != codes.NotFound {
		t.Fatalf("foreign account observed setup: %v", err)
	}
	native := setupRequest()
	native.Adapter = "qq-official"
	native.Config = &runtimev1.IntegrationConnectionConfig{QqOfficial: &runtimev1.IntegrationQQOfficialConfig{AppId: "configuration-fixture"}}
	// Absence still fails closed. QQ now has a real handler in the default
	// registry; this fault fixture verifies only the missing-handler boundary.
	adapter := s.adapters[native.Adapter]
	adapter.configure = nil
	s.adapters[native.Adapter] = adapter
	if _, err := s.StartIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart), native); status.Code(err) != codes.Unavailable {
		t.Fatalf("unimplemented platform manufactured setup: %v", err)
	}
}

func TestSetupCommitOrdersCancelAndSessionInvalidation(t *testing.T) {
	for _, stop := range []string{"cancel", "session"} {
		for _, stopFirst := range []bool{false, true} {
			t.Run(stop+map[bool]string{false: "/commit-first", true: "/stop-first"}[stopFirst], func(t *testing.T) {
				s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
					if strings.HasSuffix(req.URL.Path, "/getMe") {
						return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": 77, "username": "setup_bot"}}), nil
					}
					return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
				}))
				entered, release := make(chan struct{}), make(chan struct{})
				adapter := s.adapters["telegram"]
				configure := adapter.configure
				adapter.configure = func(ctx context.Context, a, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
					configured, err := configure(ctx, a, id, req, secret)
					close(entered)
					<-release
					return configured, err
				}
				s.adapters["telegram"] = adapter
				invalidated := make(chan struct{})
				contextFor := func(op localappop.Operation) context.Context {
					ctx := desktopIntegrationContext(t, op)
					d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
					d.SessionInvalidated = invalidated
					return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d)
				}
				started, err := s.StartIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupStart), setupRequest())
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.SubmitIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "write-only-token"}); err != nil {
					t.Fatal(err)
				}
				<-entered
				stopSetup := func() {
					if stop == "session" {
						close(invalidated)
					} else {
						if _, err := s.CancelIntegrationConnectionSetup(contextFor(localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
							t.Fatal(err)
						}
					}
				}
				if stopFirst {
					stopSetup()
				}
				close(release)
				deadline := time.Now().Add(2 * time.Second)
				for {
					s.mu.Lock()
					view := s.setups[started.Setup.SetupId].view
					state := view.Status
					s.mu.Unlock()
					if state != "verifying" {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("setup did not terminate")
					}
					time.Sleep(time.Millisecond)
				}
				if !stopFirst {
					stopSetup()
				}
				var count int
				if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_target`).Scan(&count); err != nil {
					t.Fatal(err)
				}
				expected := 1
				if stopFirst {
					expected = 0
				}
				if count != expected {
					t.Fatalf("late/legitimate target commit: got %d want %d", count, expected)
				}
				secrets := s.secrets.(*testSecrets)
				secrets.mu.Lock()
				credentials := len(secrets.values)
				secrets.mu.Unlock()
				if credentials != expected {
					t.Fatalf("half committed credential: %d", credentials)
				}
				var grants int
				_ = s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_permission`).Scan(&grants)
				if grants != 0 {
					t.Fatal("setup manufactured consumer permission")
				}
			})
		}
	}
}
