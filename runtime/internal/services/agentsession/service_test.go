package agentsession

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func testCallerCtx(appID, subject, domain string, op localappop.Operation) context.Context {
	domains := []string{domain}
	switch appID {
	case "nimi.desktop":
		domains = append(domains, DomainAgentSessionManage, DomainAgentLocal, DomainAgentTriggerDelegate)
	case "nimi.harness":
		domains = append(domains, DomainAgentBodyPC, DomainAgentSessionManage, DomainAgentLocal)
	case "nimi.zhiyu":
		domains = append(domains, DomainAgentCompanion, DomainAgentLocal)
	}
	return testCallerCtxWithDomains(appID, subject, domain, op, domains...)
}

func testCallerCtxWithDomains(appID, subject, domain string, op localappop.Operation, activated ...string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "acct-1",
		AppID:                appID,
		RegisteredAppSubject: subject,
		TrustClass:           accountservice.LocalAppTrustClassUserImported,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  domain,
		ActivatedDomains:     strings.Join(activated, ","),
		Operation:            op,
		ExpiresAt:            time.Now().UTC().Add(time.Hour),
	})
}

func TestRegisterBodyCarrierEnforcesCapabilityAndLeaseIsolation(t *testing.T) {
	svc := New(Options{})

	// 1. Any local App with activated agent.body.pc registers os.pc.workspace -> succeeds (zero-privilege).
	harnessCtx := testCallerCtx("com.custom.pcbody", "subj-pcbody", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg, err := svc.RegisterBodyCarrier(harnessCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("pc body register failed: %v", err)
	}
	if reg.GetLeaseEpoch() != 1 || reg.GetCapabilityNamespace() != "os.pc.workspace" {
		t.Fatalf("unexpected register response: %+v", reg)
	}

	// 2. Heartbeat with valid epoch -> succeeds.
	hbCtx := testCallerCtx("com.custom.pcbody", "subj-pcbody", DomainAgentBodyPC, localappop.OperationAgentBodyPCHeartbeat)
	hb, err := svc.HeartbeatBodyCarrier(hbCtx, &runtimev1.HeartbeatBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		LeaseEpoch:          reg.GetLeaseEpoch(),
		InstanceId:          "inst-1",
	})
	if err != nil || !hb.GetAlive() {
		t.Fatalf("heartbeat failed: resp=%+v err=%v", hb, err)
	}

	// 3. Another App without activated agent.body.pc is rejected.
	noCapCtx := testCallerCtxWithDomains("com.evil.app", "subj-evil", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentLocal)
	if _, err := svc.RegisterBodyCarrier(noCapCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-evil",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied without activated agent.body.pc, got %v", err)
	}

	// 3b. Another subject WITH agent.body.pc (even claiming app_id=nimi.harness) CANNOT preempt active lease!
	preemptCtx := testCallerCtx("nimi.harness", "subj-preempt", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	if _, err := svc.RegisterBodyCarrier(preemptCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-preempt",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied on cross-subject os.pc.workspace preemption, got %v", err)
	}

	// 4. App with agent.body.app can only register app.<app_id>.*, never os.pc.* or another app's namespace.
	appCtx := testCallerCtx("com.example.tool", "subj-tool", DomainAgentBodyApp, localappop.OperationAgentBodyAppRegister)
	if _, err := svc.RegisterBodyCarrier(appCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "inst-tool",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for agent.body.app requesting os.pc.*, got %v", err)
	}
	appReg, err := svc.RegisterBodyCarrier(appCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: "app.com.example.tool.runner",
		InstanceId:          "inst-tool",
	})
	if err != nil || appReg.GetLeaseEpoch() != 1 {
		t.Fatalf("expected app-scoped namespace registration to succeed, got resp=%+v err=%v", appReg, err)
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
