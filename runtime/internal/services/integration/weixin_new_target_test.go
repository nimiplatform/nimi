package integration

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Protocol and protected-caller fixtures drive the actual owner and SQLite;
// they are not live account setup or product acceptance.
type weixinNewTargetFixture struct {
	s           *Service
	ctx         context.Context
	view        *runtimev1.IntegrationConnectionSetup
	old         target
	row, secret string
	invalidated chan struct{}
	custody     *tracedWeixinSecrets
	drains      atomic.Int32
}

func newWeixinNewTargetFixture(t *testing.T, scanner string) *weixinNewTargetFixture {
	t.Helper()
	f := &weixinNewTargetFixture{invalidated: make(chan struct{})}
	var refreshing atomic.Bool
	f.s = newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/ilink/bot/get_bot_qrcode" {
			return jsonResponse(map[string]string{"qrcode": "private-fixture", "qrcode_img_content": "https://liteapp.weixin.qq.com/fixture"}), nil
		}
		bot, token, user := "original@im.bot", "original-token", "original-scanner"
		if refreshing.Load() {
			bot, token, user = "candidate@im.bot", "candidate-token", scanner
		}
		return jsonResponse(map[string]string{"status": "confirmed", "bot_token": token, "ilink_bot_id": bot, "baseurl": weixinAPIBase, "ilink_user_id": user}), nil
	}))
	f.ctx = desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	first := completedWeixinNameSetup(t, f.s, f.ctx, "", "Original remark", "completed")
	var err error
	f.old, err = f.s.loadTarget(context.Background(), "test-account", first.TargetRef)
	if err != nil {
		t.Fatal(err)
	}
	f.secret, err = f.s.captureCredential(f.old)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE account_id=? AND target_ref=?`, "test-account", first.TargetRef).Scan(&f.row); err != nil {
		t.Fatal(err)
	}
	grantTestTarget(t, f.s, testDecision("consumer", 1), first.TargetRef, "weixin.messages.reply")
	f.custody = &tracedWeixinSecrets{testSecrets: f.s.secrets.(*testSecrets)}
	f.s.secrets = f.custody
	receiverCtx, receiverCancel := context.WithCancel(context.Background())
	t.Cleanup(receiverCancel)
	done := make(chan struct{})
	close(done)
	f.s.nativeReceivers[first.TargetRef] = &nativeReceiver{ctx: receiverCtx, cancel: func() { f.drains.Add(1); receiverCancel() }, done: done}
	d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(f.ctx)
	d.SessionInvalidated = f.invalidated
	f.ctx = accountservice.ContextWithAuthorizedLocalAppDecision(f.ctx, d)
	refreshing.Store(true)
	f.view = completedWeixinNameSetup(t, f.s, f.ctx, first.TargetRef, "", "awaiting-new-target")
	return f
}

func (f *weixinNewTargetFixture) submit(ctx context.Context) error {
	_, err := f.s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: f.view.SetupId, Action: runtimev1.IntegrationConnectionSetupAction_INTEGRATION_CONNECTION_SETUP_ACTION_CREATE_NEW_TARGET})
	return err
}

func (f *weixinNewTargetFixture) requireOriginal(t *testing.T) {
	t.Helper()
	var row string
	if err := f.s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE account_id=? AND target_ref=?`, "test-account", f.old.Public.TargetRef).Scan(&row); err != nil || row != f.row {
		t.Fatal("original target changed", err)
	}
	secret, ok, err := f.s.secrets.ReadSecret("integration:" + f.old.Public.TargetRef)
	if err != nil || !ok || secret != f.secret || f.drains.Load() != 0 {
		t.Fatal("original credential or receiver changed", err)
	}
	if !f.s.permitted(context.Background(), "test-account", "consumer", f.old.Public.TargetRef, "weixin.messages.reply") {
		t.Fatal("original grant changed")
	}
}

func (f *weixinNewTargetFixture) requireCounts(t *testing.T, targets, secrets int) {
	t.Helper()
	var count int
	if err := f.s.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != targets {
		t.Fatalf("targets=%d want=%d: %v", count, targets, err)
	}
	f.custody.mu.Lock()
	defer f.custody.mu.Unlock()
	if len(f.custody.values) != secrets {
		t.Fatal("partial or extra custody entry")
	}
}

func TestWeixinNewTargetExplicitConfirmationAndNoInheritedGrant(t *testing.T) {
	for _, scenario := range []struct{ name, scanner string }{{"same", "original-scanner"}, {"different", "different-scanner"}, {"missing", ""}} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newWeixinNewTargetFixture(t, scenario.scanner)
			f.requireOriginal(t)
			f.requireCounts(t, 1, 1)
			if f.view.TargetRef != f.old.Public.TargetRef || f.view.AccountLabel != "candidate@im.bot" || f.view.VerificationUrl != "" || f.view.ErrorCode != "" {
				t.Fatal("unsafe pending projection")
			}
			for _, req := range []*runtimev1.SubmitIntegrationConnectionSetupRequest{
				{SetupId: f.view.SetupId},
				{SetupId: f.view.SetupId, Action: 99},
				{SetupId: f.view.SetupId, Action: 1, Secret: "candidate-token"},
				{SetupId: f.view.SetupId, Action: 1, VerificationCode: "123456"},
			} {
				if _, err := f.s.SubmitIntegrationConnectionSetup(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionSetupSubmit), req); err == nil {
					t.Fatal("implicit or mixed confirmation accepted")
				}
			}
			for _, field := range []string{"account", "subject", "session", "epoch"} {
				d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(f.ctx)
				switch field {
				case "account":
					d.AccountID = "foreign"
				case "subject":
					d.RegisteredAppSubject = "foreign"
				case "session":
					d.SessionID[0]++
				case "epoch":
					d.RuntimeBootEpoch[0]++
				}
				if f.submit(accountservice.ContextWithAuthorizedLocalAppDecision(f.ctx, d)) == nil {
					t.Fatal("foreign confirmation accepted", field)
				}
			}
			f.requireCounts(t, 1, 1)
			var accepted atomic.Int32
			var group sync.WaitGroup
			for i := 0; i < 8; i++ {
				group.Add(1)
				go func() {
					defer group.Done()
					if f.submit(f.ctx) == nil {
						accepted.Add(1)
					}
				}()
			}
			group.Wait()
			if accepted.Load() != 1 {
				t.Fatal("duplicate confirmation accepted", accepted.Load())
			}
			waitSetupStatus(t, f.s, f.ctx, f.view.SetupId, "completed")
			f.s.workers.Wait()
			f.requireOriginal(t)
			f.requireCounts(t, 2, 2)
			f.s.mu.Lock()
			view := proto.Clone(f.s.setups[f.view.SetupId].view).(*runtimev1.IntegrationConnectionSetup)
			f.s.mu.Unlock()
			created, err := f.s.loadTarget(context.Background(), "test-account", view.TargetRef)
			if err != nil || view.TargetRef == f.old.Public.TargetRef || created.Identity != "weixin:candidate@im.bot" || created.CredentialGeneration != 1 || created.Public.DisplayName != "WeChat iLink · candidate@im.bot" {
				t.Fatal("new target identity or default name incorrect", err)
			}
			if f.s.permitted(context.Background(), "test-account", "consumer", view.TargetRef, "weixin.messages.reply") {
				t.Fatal("new target inherited standing grant")
			}
			if f.submit(f.ctx) == nil {
				t.Fatal("terminal setup reused")
			}
			requireNoSecretInIntegrationAudit(t, f.s, "original-token", "candidate-token", "private-fixture", "original-scanner", "different-scanner")
		})
	}
}

func TestWeixinNewTargetPendingStopsWithoutWriting(t *testing.T) {
	for _, stop := range []string{"cancel", "expiry", "session", "runtime", "audit"} {
		t.Run(stop, func(t *testing.T) {
			f := newWeixinNewTargetFixture(t, "original-scanner")
			switch stop {
			case "cancel":
				r, err := f.s.CancelIntegrationConnectionSetup(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: f.view.SetupId})
				if err != nil || r.Setup.Status != "canceled" {
					t.Fatal("cancel ineffective", err)
				}
			case "expiry":
				f.s.mu.Lock()
				f.s.setups[f.view.SetupId].view.ExpiresAt = timestamppb.New(time.Now().Add(-time.Second))
				f.s.mu.Unlock()
			case "session":
				close(f.invalidated)
			case "runtime":
				err := f.s.QuiesceDataRootContext(context.Background())
				if err != nil {
					t.Fatal(err)
				}
			case "audit":
				unblock := blockIntegrationAudit(t, f.s)
				err := f.submit(f.ctx)
				requireIntegrationAuditUnavailable(t, err)
				unblock()
				f.s.mu.Lock()
				status := f.s.setups[f.view.SetupId].view.Status
				f.s.mu.Unlock()
				if status != "awaiting-new-target" {
					t.Fatal("audit failure consumed candidate")
				}
				_, err = f.s.CancelIntegrationConnectionSetup(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: f.view.SetupId})
				if err != nil {
					t.Fatal(err)
				}
			}
			if f.submit(f.ctx) == nil {
				t.Fatal("late confirmation accepted")
			}
			f.s.workers.Wait()
			f.requireCounts(t, 1, 1)
			if stop != "runtime" {
				f.requireOriginal(t)
			}
		})
	}
}

func TestWeixinNewTargetOriginalChangeBeforeConfirmation(t *testing.T) {
	for _, change := range []string{"generation", "identity", "config", "credential", "remove"} {
		t.Run(change, func(t *testing.T) {
			f := newWeixinNewTargetFixture(t, "original-scanner")
			var err error
			switch change {
			case "generation":
				f.old.CredentialGeneration++
				err = f.s.saveTarget(context.Background(), f.old)
			case "identity":
				f.old.Identity = "weixin:changed@im.bot"
				err = f.s.saveTarget(context.Background(), f.old)
			case "config":
				f.old.Config = &runtimev1.IntegrationConnectionConfig{Telegram: &runtimev1.IntegrationTelegramConfig{}}
				err = f.s.saveTarget(context.Background(), f.old)
			case "credential":
				err = f.s.secrets.WriteSecret("integration:"+f.old.Public.TargetRef, "newer-credential")
			case "remove":
				_, err = f.s.RemoveIntegrationConnection(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: f.old.Public.TargetRef})
			}
			if err != nil {
				t.Fatal(err)
			}
			if f.submit(f.ctx) == nil {
				t.Fatal("changed original admitted before confirmation")
			}
			_, err = f.s.CancelIntegrationConnectionSetup(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: f.view.SetupId})
			if err != nil {
				t.Fatal(err)
			}
			f.s.workers.Wait()
			count := 1
			if change == "remove" {
				count = 0
			}
			f.requireCounts(t, count, count)
		})
	}
}

func TestWeixinNewTargetFinalCommitFenceAndRollback(t *testing.T) {
	for _, stop := range []string{"cancel", "expiry", "session", "new-session", "account", "subject", "epoch", "host", "trust", "generation", "identity", "config", "credential", "remove", "collision", "audit", "storage"} {
		t.Run(stop, func(t *testing.T) {
			f := newWeixinNewTargetFixture(t, "original-scanner")
			entered, release := make(chan struct{}), make(chan struct{})
			adapter := f.s.adapters["weixin"]
			configure := adapter.configure
			adapter.configure = func(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
				close(entered)
				<-release
				return configure(ctx, account, id, req, secret)
			}
			f.s.adapters["weixin"] = adapter
			if err := f.submit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("new commit not reached")
			}
			var err error
			switch stop {
			case "cancel":
				_, err = f.s.CancelIntegrationConnectionSetup(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: f.view.SetupId})
			case "expiry":
				f.s.mu.Lock()
				f.s.setups[f.view.SetupId].view.ExpiresAt = timestamppb.New(time.Now().Add(-time.Second))
				f.s.mu.Unlock()
			case "session":
				close(f.invalidated)
			case "account", "subject", "epoch", "host", "new-session", "trust":
				f.s.revalidator = testRevalidator(func(ctx context.Context, i localappop.Ingress) (context.Context, error) {
					d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
					switch stop {
					case "account":
						d.AccountID = "foreign"
					case "subject":
						d.RegisteredAppSubject = "foreign"
					case "epoch":
						d.RuntimeBootEpoch[0]++
					case "host":
						d.AppID = "not.desktop"
					case "new-session":
						d.SessionID[0]++
					case "trust":
						d.TrustClass = "foreign"
					}
					return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d), nil
				})
			case "generation":
				f.old.CredentialGeneration++
				err = f.s.saveTarget(context.Background(), f.old)
			case "identity":
				f.old.Identity = "weixin:changed@im.bot"
				err = f.s.saveTarget(context.Background(), f.old)
			case "config":
				f.old.Config = &runtimev1.IntegrationConnectionConfig{Telegram: &runtimev1.IntegrationTelegramConfig{}}
				err = f.s.saveTarget(context.Background(), f.old)
			case "credential":
				err = f.s.secrets.WriteSecret("integration:"+f.old.Public.TargetRef, "newer-credential")
			case "remove":
				_, err = f.s.RemoveIntegrationConnection(setupTestContext(f.ctx, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: f.old.Public.TargetRef})
			case "collision":
				collision := f.old
				collision.Public = proto.Clone(f.old.Public).(*runtimev1.IntegrationTarget)
				collision.Public.TargetRef = "collision"
				collision.Identity = "weixin:candidate@im.bot"
				err = f.s.saveTarget(context.Background(), collision)
			case "audit":
				unblock := blockIntegrationAudit(t, f.s)
				defer unblock()
			case "storage":
				_, err = f.s.backend.DB().Exec(`CREATE TRIGGER test_block_new_target BEFORE INSERT ON runtime_integration_target BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END`)
			}
			if err != nil {
				t.Fatal(err)
			}
			close(release)
			f.s.workers.Wait()
			f.s.mu.Lock()
			view := proto.Clone(f.s.setups[f.view.SetupId].view).(*runtimev1.IntegrationConnectionSetup)
			f.s.mu.Unlock()
			if activeSetupStatus(view.Status) || view.Status == "completed" || view.TargetRef != f.old.Public.TargetRef {
				t.Fatal("late candidate committed", view.Status)
			}
			targets, secrets := 1, 1
			if stop == "collision" {
				targets = 2
			}
			if stop == "remove" {
				targets, secrets = 0, 0
			}
			f.requireCounts(t, targets, secrets)
			if stop == "cancel" || stop == "expiry" || stop == "session" || stop == "account" || stop == "subject" || stop == "epoch" || stop == "host" || stop == "new-session" || stop == "trust" || stop == "audit" || stop == "storage" || stop == "collision" {
				f.requireOriginal(t)
			}
			if f.submit(f.ctx) == nil {
				t.Fatal("failed historical candidate reused")
			}
		})
	}
}
