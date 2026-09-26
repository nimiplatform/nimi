package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func telegramIdentityTransport(id *atomic.Int64) http.RoundTripper {
	return testRoundTripper(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/getMe"):
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": id.Load(), "username": "identity_test_bot"}}), nil
		case strings.HasSuffix(req.URL.Path, "/getWebhookInfo"):
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
		default:
			return nil, fmt.Errorf("unexpected adapter operation")
		}
	})
}

func TestTelegramConcurrentConnectionsUseOneActualBotIdentity(t *testing.T) {
	var botID atomic.Int64
	botID.Store(777)
	s := newIntegrationTestService(t, telegramIdentityTransport(&botID))
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
	start := make(chan struct{})
	var wg sync.WaitGroup
	var accepted, rejected atomic.Int32
	for _, credential := range []string{"first-credential", "different-credential-same-bot"} {
		wg.Add(1)
		go func(secret string) {
			defer wg.Done()
			<-start
			_, err := s.PutIntegrationConnection(ctx, &runtimev1.PutIntegrationConnectionRequest{Adapter: "telegram", DisplayName: "Test connection", Secret: secret})
			if err == nil {
				accepted.Add(1)
			} else if status.Code(err) == codes.AlreadyExists && strings.Contains(err.Error(), "INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED") {
				metadata, ok := grpcerr.ExtractReasonMetadata(err)
				if !ok || metadata["integration_reason"] != "INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED" {
					t.Error("duplicate bot lost its concrete public owner reason")
				}
				rejected.Add(1)
			} else {
				t.Errorf("unexpected configuration result: %v", err)
			}
		}(credential)
	}
	close(start)
	wg.Wait()
	if accepted.Load() != 1 || rejected.Load() != 1 {
		t.Fatalf("same actual bot admitted %d connections; rejected=%d", accepted.Load(), rejected.Load())
	}
	var count int
	if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate target persisted: count=%d err=%v", count, err)
	}
	secrets := s.secrets.(*testSecrets)
	secrets.mu.Lock()
	secretCount := len(secrets.values)
	secrets.mu.Unlock()
	if secretCount != 1 {
		t.Fatalf("rejected connection retained a credential: %d", secretCount)
	}
	// Display names cannot merge different upstream accounts.
	botID.Store(778)
	if _, err := s.PutIntegrationConnection(ctx, &runtimev1.PutIntegrationConnectionRequest{Adapter: "telegram", DisplayName: "Test connection", Secret: "another-bot"}); err != nil {
		t.Fatalf("distinct bot identity was rejected: %v", err)
	}
}

func TestTelegramExplicitVerificationPreservesTargetPermissionAndCursor(t *testing.T) {
	var botID atomic.Int64
	botID.Store(777)
	s := newIntegrationTestService(t, telegramIdentityTransport(&botID))
	consumer := testDecision("consumer", 4)
	target := saveTelegramTestTarget(t, s)
	target.TelegramBotID = 0
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	grantTestTarget(t, s, consumer, target.Public.TargetRef, "telegram.updates.read")
	if _, err := s.backend.DB().Exec(`INSERT INTO runtime_integration_receiver(account_id,target_ref,next_offset) VALUES(?,?,?)`, target.Account, target.Public.TargetRef, 481); err != nil {
		t.Fatal(err)
	}
	catalog, err := s.ListIntegrationCatalog(testContext(consumer, localappop.OperationIntegrationCatalogList), &runtimev1.ListIntegrationCatalogRequest{})
	if err != nil || len(catalog.GetTargets()) != 1 || catalog.Targets[0].Available {
		t.Fatalf("unverified identity claimed availability: %v %v", catalog, err)
	}
	if _, err := s.InvokeIntegrationCall(testContext(consumer, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: "telegram.updates.read", InputJson: `{"chatIds":["1"]}`}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("unverified identity dispatched: %v", err)
	}
	request := &runtimev1.PutIntegrationConnectionRequest{TargetRef: target.Public.TargetRef, Adapter: "telegram", DisplayName: target.Public.DisplayName}
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
	verified, err := s.PutIntegrationConnection(ctx, request)
	if err != nil || verified.GetConnection().GetTargetRef() != target.Public.TargetRef || !verified.GetConnection().GetAvailable() {
		t.Fatalf("explicit verification replaced or failed target: %v %v", verified, err)
	}
	stored, err := s.loadTarget(context.Background(), target.Account, target.Public.TargetRef)
	if err != nil || stored.TelegramBotID != 777 || !s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, target.Public.TargetRef, "telegram.updates.read") {
		t.Fatalf("verified binding or permission lost: %v", err)
	}
	var offset int64
	if err := s.backend.DB().QueryRow(`SELECT next_offset FROM runtime_integration_receiver WHERE account_id=? AND target_ref=?`, target.Account, target.Public.TargetRef).Scan(&offset); err != nil || offset != 481 {
		t.Fatalf("verification reset cursor: %d %v", offset, err)
	}
	botID.Store(778)
	if _, err := s.PutIntegrationConnection(ctx, request); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("same reference changed actual bot: %v", err)
	}
}
