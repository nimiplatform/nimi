package agentsession

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func testCallerCtx(appID, subject, domain string, op localappop.Operation) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "acct-1",
		AppID:                appID,
		RegisteredAppSubject: subject,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  domain,
		Operation:            op,
		ExpiresAt:            time.Now().UTC().Add(time.Hour),
	})
}

func TestRegisterBodyCarrierEnforcesCorePCPrincipalAndNamespaceIsolation(t *testing.T) {
	svc := New(Options{})

	// 1. Core Harness with agent.body.pc registers os.pc.workspace -> succeeds.
	harnessCtx := testCallerCtx(CorePCBodyAppID, "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg, err := svc.RegisterBodyCarrier(harnessCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("core harness register failed: %v", err)
	}
	if reg.GetLeaseEpoch() != 1 || reg.GetCapabilityNamespace() != "os.pc.workspace" {
		t.Fatalf("unexpected register response: %+v", reg)
	}

	// 2. Heartbeat with valid epoch -> succeeds.
	hbCtx := testCallerCtx(CorePCBodyAppID, "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCHeartbeat)
	hb, err := svc.HeartbeatBodyCarrier(hbCtx, &runtimev1.HeartbeatBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		LeaseEpoch:          reg.GetLeaseEpoch(),
		InstanceId:          "inst-1",
	})
	if err != nil || !hb.GetAlive() {
		t.Fatalf("heartbeat failed: resp=%+v err=%v", hb, err)
	}

	// 3. Ordinary third-party App claiming agent.body.pc is rejected.
	spoofCtx := testCallerCtx("com.evil.app", "subj-evil", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	if _, err := svc.RegisterBodyCarrier(spoofCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-evil",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for non-core app on agent.body.pc, got %v", err)
	}

	// 4. Third-party app with agent.body.app can only register app.<app_id>.*, never os.pc.* or another app's namespace.
	appCtx := testCallerCtx("com.example.tool", "subj-tool", DomainAgentBodyApp, localappop.OperationAgentBodyAppRegister)
	if _, err := svc.RegisterBodyCarrier(appCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-tool",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for third-party app requesting os.pc.*, got %v", err)
	}
	appReg, err := svc.RegisterBodyCarrier(appCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "app.com.example.tool.runner",
		InstanceId:          "inst-tool",
	})
	if err != nil || appReg.GetLeaseEpoch() != 1 {
		t.Fatalf("expected third-party app scoped namespace registration to succeed, got resp=%+v err=%v", appReg, err)
	}

	// 5. Another subject trying to preempt active lease -> rejected.
	otherSubjectCtx := testCallerCtx("com.example.tool", "subj-hijack", DomainAgentBodyApp, localappop.OperationAgentBodyAppRegister)
	if _, err := svc.RegisterBodyCarrier(otherSubjectCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "app.com.example.tool.runner",
		InstanceId:          "inst-hijack",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied on active lease preemption, got %v", err)
	}
}
