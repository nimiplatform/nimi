package app

import (
	"context"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestJobWorkAuthoritySurvivesSessionLossAndFencesRealWithdrawal(t *testing.T) {
	for _, voiceChild := range []bool{false, true} {
		for _, withdrawal := range []string{"account", "registration"} {
			t.Run(fmt.Sprintf("voice=%t/%s", voiceChild, withdrawal), func(t *testing.T) {
				capability := "runtime.consume"
				if voiceChild {
					capability = "agent.local"
				}
				f := newLocalAppSessionFixture(t, []string{capability})
				account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
				WithRuntimeAccountProjectionProvider(account)(f.service)
				if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
					t.Fatal(err)
				}
				ingress := localappop.IngressScenarioJobSubmit
				if voiceChild {
					ingress = localappop.IngressConversationTurnSend
				}
				admitted, err := f.service.AuthorizeLocalAppIngress(f.context, ingress)
				if err != nil {
					t.Fatal(err)
				}
				decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(admitted)
				if !ok {
					t.Fatal("missing actual ingress decision")
				}
				authorizer := NewJobWorkAuthorizer(account, f.kernel)
				if voiceChild {
					if _, err := authorizer.AdmitJobWork(admitted, decision); err == nil {
						t.Fatal("ordinary Conversation ingress cannot submit Jobs")
					}
					// Agent owner has resolved the opaque handle before deriving voice work.
					decision.LocalAgentID = "local-agent:resolved"
					admitted = accountservice.ContextWithAuthorizedLocalAppDecision(admitted, decision)
					admitted = accountservice.ContextWithAgentVoiceJobOrigin(context.Background(), admitted, "runtime.agent.voice_lipsync", decision.AccountID, decision.LocalAgentID)
					admitted = executionintent.WithIntent(admitted, executionintent.Intent{Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, CapabilityContract: "audio.synthesize"})
				}
				permission, err := authorizer.AdmitJobWork(admitted, decision)
				if err != nil {
					t.Fatal(err)
				}
				defer permission.Release()
				f.connection.Revoke()
				select {
				case <-decision.SessionInvalidated:
				default:
					t.Fatal("technical session did not close")
				}
				select {
				case <-permission.Invalidated:
					t.Fatal("technical session closed Job work")
				default:
				}
				committed := false
				if err := permission.WithCurrent(context.Background(), func() error { committed = true; return nil }); err != nil || !committed {
					t.Fatalf("admitted work lost current owner after detach: %v", err)
				}
				if withdrawal == "account" {
					response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop-1", DeviceId: "device-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
					if err != nil || !response.GetAccepted() {
						t.Fatalf("logout: %v", err)
					}
				} else if err := f.kernel.Registrations().Tombstone(context.Background(), f.registration.RegistrationHandle); err != nil {
					t.Fatal(err)
				}
				committed = false
				if err := permission.WithCurrent(context.Background(), func() error { committed = true; return nil }); err == nil || committed {
					t.Fatal("withdrawn owner published")
				}
				select {
				case <-permission.Invalidated:
				case <-time.After(time.Second):
					t.Fatal("withdrawal failed to signal admitted work")
				}
			})
		}
	}
}

func TestLocalAgentMediaJobRetainsOriginalAdmissionAndRejectsOtherWork(t *testing.T) {
	f := newLocalAppSessionFixture(t, []string{"agent.local"})
	account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	admitted, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressConversationTurnSend)
	if err != nil {
		t.Fatal(err)
	}
	d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(admitted)
	if !ok {
		t.Fatal("missing protected ingress")
	}
	// Runtime Agent stamps the owned Agent only after resolving its opaque handle.
	d.LocalAgentID = "resolved-owned-agent"
	admitted = accountservice.ContextWithAuthorizedLocalAppDecision(admitted, d)
	authorizer := NewJobWorkAuthorizer(account, f.kernel)
	for _, capability := range []string{"image.generate", "audio.synthesize", "audio.transcribe", "text.generate", ""} {
		ctx := executionintent.WithIntent(admitted, executionintent.Intent{Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, CapabilityContract: capability})
		if capability == "audio.synthesize" {
			if _, err := authorizer.AdmitJobWork(ctx, d); err == nil {
				t.Fatal("speech work lost the private voice-owner boundary")
			}
			ctx = accountservice.ContextWithAgentVoiceJobOrigin(ctx, ctx, "runtime.agent.voice_lipsync", d.AccountID, d.LocalAgentID)
		}
		permission, err := authorizer.AdmitJobWork(ctx, d)
		if capability != "image.generate" && capability != "audio.synthesize" {
			if err == nil {
				permission.Release()
				t.Fatalf("Conversation image path admitted %q", capability)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		defer permission.Release()
		if err := permission.WithCurrent(context.Background(), func() error { return nil }); err != nil {
			t.Fatal(err)
		}
		missing := d
		missing.LocalAgentID = ""
		if _, err := authorizer.AdmitJobWork(ctx, missing); err == nil {
			t.Fatal("unresolved Agent admitted")
		}
	}
	for _, check := range []struct {
		ingress    localappop.Ingress
		capability string
	}{
		{localappop.IngressConversationVoiceRender, "audio.synthesize"},
		{localappop.IngressConversationVoiceTranscribe, "audio.transcribe"},
	} {
		voiceCtx, err := f.service.AuthorizeLocalAppIngress(f.context, check.ingress)
		if err != nil {
			t.Fatal(err)
		}
		voiceDecision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(voiceCtx)
		voiceDecision.LocalAgentID = d.LocalAgentID
		voiceCtx = accountservice.ContextWithAuthorizedLocalAppDecision(voiceCtx, voiceDecision)
		voiceCtx = executionintent.WithIntent(voiceCtx, executionintent.Intent{Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, CapabilityContract: check.capability})
		if check.capability == "audio.synthesize" {
			voiceCtx = accountservice.ContextWithAgentVoiceJobOrigin(voiceCtx, voiceCtx, "runtime.agent.voice_lipsync", voiceDecision.AccountID, voiceDecision.LocalAgentID)
		}
		permission, err := authorizer.AdmitJobWork(voiceCtx, voiceDecision)
		if err != nil {
			t.Fatal(err)
		}
		permission.Release()
		wrong := executionintent.WithIntent(voiceCtx, executionintent.Intent{Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, CapabilityContract: "image.generate"})
		if _, err := authorizer.AdmitJobWork(wrong, voiceDecision); err == nil {
			t.Fatal("voice ingress admitted an image Job")
		}
	}
	if _, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressScenarioJobSubmit); err == nil {
		t.Fatal("agent.local was widened into runtime.consume")
	}
}
