package runtimeagent

import (
	"context"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestListLocalAppAgentInventoryProjectsZeroOneAndManyCurrentAccountRows(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
	}{
		{name: "zero", count: 0},
		{name: "one", count: 1},
		{name: "many", count: 3},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc := localAppInventoryTestService(t, test.count, 1)
			response, err := svc.ListLocalAppAgentInventory(
				localAppInventoryContext("account-a", 0x31),
				&runtimev1.ListLocalAppAgentInventoryRequest{},
			)
			if err != nil {
				t.Fatalf("list local-app inventory: %v", err)
			}
			if response.GetOwnerUserId() != "account-a" || int(response.GetCount()) != test.count || len(response.GetLocalAgents()) != test.count {
				t.Fatalf("inventory projection = %+v, want count %d", response, test.count)
			}
			for _, item := range response.GetLocalAgents() {
				if item.GetOwnerUserId() != "account-a" || item.GetLocalAgentRef() == "" || item.GetDisplayName() == "" || item.GetRuntimeSourceRef() == "" || !item.GetSourceReady() {
					t.Fatalf("invalid bounded inventory item: %+v", item)
				}
			}
			events, listErr := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.local_app_agent_inventory"})
			if listErr != nil || len(events.GetEvents()) != 1 || events.GetEvents()[0].GetSubjectUserId() != "account-a" {
				t.Fatalf("inventory audit = (%+v, %v)", events, listErr)
			}
		})
	}
}

func TestListLocalAppAgentInventoryFailsClosedWithoutSessionAuditOrWithinBound(t *testing.T) {
	svc := localAppInventoryTestService(t, 1, 0)
	if _, err := svc.ListLocalAppAgentInventory(context.Background(), &runtimev1.ListLocalAppAgentInventoryRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("missing session code = %s, err=%v", status.Code(err), err)
	}
	svc.auditStore = nil
	if _, err := svc.ListLocalAppAgentInventory(localAppInventoryContext("account-a", 0x41), &runtimev1.ListLocalAppAgentInventoryRequest{}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("missing audit code = %s, err=%v", status.Code(err), err)
	}

	overflow := localAppInventoryTestService(t, maxLocalAppAgentInventoryEntries+1, 0)
	response, err := overflow.ListLocalAppAgentInventory(localAppInventoryContext("account-a", 0x42), &runtimev1.ListLocalAppAgentInventoryRequest{})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("overflow response=%+v code = %s, err=%v", response, status.Code(err), err)
	}
}

func localAppInventoryTestService(t testing.TB, currentAccountCount int, otherAccountCount int) *Service {
	t.Helper()
	agents := make(map[string]*agentEntry, currentAccountCount+otherAccountCount)
	now := time.Now().UTC()
	add := func(owner string, index int) {
		source := fmt.Sprintf("%s-source-%03d", owner, index)
		ref := testOpaqueLocalAgentRef(owner, source)
		agents[ref] = &agentEntry{Agent: &runtimev1.AgentRecord{
			AgentId: ref, LocalAgentRef: ref, OwnerUserId: owner, RuntimeSourceRef: source,
			DisplayName:         fmt.Sprintf("Partner %03d", index),
			LifecycleStatus:     runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			SourceContextStatus: &runtimev1.LocalAgentSourceContextStatus{Ready: true},
			CreatedAt:           timestamppb.New(now.Add(-time.Duration(index) * time.Second)),
		}}
	}
	for index := 0; index < currentAccountCount; index++ {
		add("account-a", index)
	}
	for index := 0; index < otherAccountCount; index++ {
		add("account-b", index)
	}
	return &Service{agents: agents, auditStore: auditlog.New(64, 64)}
}

func localAppInventoryContext(accountID string, seed byte) context.Context {
	decision := accountservice.LocalAppCallerDecision{
		LocalOSUserAnchor: "windows-sid:S-1-5-21-current",
		AppID:             "sample.nimi.app", AccountID: accountID, AccountGeneration: 3,
		TrustClass:          accountservice.LocalAppTrustClassDevelopment,
		LocalAppPrincipalID: "lap_v1_inventory", LocalAppRecordID: "lar_v1_inventory",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed
	}
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
}
