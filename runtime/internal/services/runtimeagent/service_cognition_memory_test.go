package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalAppMemoryMethodsFailTypedWhenOwnerUnavailable(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	svc.cognitionMemoryFacade = nil

	tests := []struct {
		name      string
		operation accountservice.LocalAppOperation
		invoke    func(context.Context, string) error
	}{
		{
			name:      "inspect",
			operation: accountservice.LocalAppOperationMemoryInspect,
			invoke: func(ctx context.Context, handle string) error {
				_, err := svc.InspectLocalAppAgentMemory(ctx, &runtimev1.InspectLocalAppAgentMemoryRequest{AgentHandle: handle})
				return err
			},
		},
		{
			name:      "correct",
			operation: accountservice.LocalAppOperationMemoryCorrect,
			invoke: func(ctx context.Context, handle string) error {
				_, err := svc.CorrectLocalAppAgentMemory(ctx, &runtimev1.CorrectLocalAppAgentMemoryRequest{AgentHandle: handle, MemoryId: "memory-a", CorrectedContent: "corrected content"})
				return err
			},
		},
		{
			name:      "forget",
			operation: accountservice.LocalAppOperationMemoryForget,
			invoke: func(ctx context.Context, handle string) error {
				_, err := svc.ForgetLocalAppAgentMemory(ctx, &runtimev1.ForgetLocalAppAgentMemoryRequest{AgentHandle: handle, MemoryIds: []string{"memory-a"}, Confirmed: true})
				return err
			},
		},
		{
			name:      "switch",
			operation: accountservice.LocalAppOperationMemorySwitch,
			invoke: func(ctx context.Context, handle string) error {
				_, err := svc.SetLocalAppAgentMemoryEnabled(ctx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: handle, Enabled: true})
				return err
			},
		},
		{
			name:      "delete-all",
			operation: accountservice.LocalAppOperationMemoryDelete,
			invoke: func(ctx context.Context, handle string) error {
				_, err := svc.DeleteAllLocalAppAgentMemory(ctx, &runtimev1.DeleteAllLocalAppAgentMemoryRequest{AgentHandle: handle, Confirmed: true})
				return err
			},
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decision, ctx := localAppConfigureContext(test.operation, byte(0x61+index), accountID)
			handle := mintLocalAppAgentHandle(decision, localAgentRef)
			err := test.invoke(ctx, handle)
			if status.Code(err) != codes.Unavailable {
				t.Fatalf("status = %s, want Unavailable; err=%v", status.Code(err), err)
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
				t.Fatalf("reason = %s ok=%v, want LOCAL_APP_OWNER_UNAVAILABLE; err=%v", reason, ok, err)
			}
		})
	}
}

func TestLocalAppMemoryInspectCarriesSeekPagination(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	for _, content := range []string{"I prefer cedar forests", "I prefer jasmine tea", "I prefer quiet mornings"} {
		seedCognitionMemoryForTerminationTest(t, svc, localAgentRef, content)
	}
	decision, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemoryInspect, 0x71, "user-1")
	handle := mintLocalAppAgentHandle(decision, localAgentRef)
	first, err := svc.InspectLocalAppAgentMemory(ctx, &runtimev1.InspectLocalAppAgentMemoryRequest{AgentHandle: handle, Limit: 2})
	if err != nil || len(first.GetProjection().GetItems()) != 2 || first.GetProjection().GetNextPageToken() == "" {
		t.Fatalf("first Memory page: response=%+v err=%v", first, err)
	}
	second, err := svc.InspectLocalAppAgentMemory(ctx, &runtimev1.InspectLocalAppAgentMemoryRequest{AgentHandle: handle, Limit: 2, PageToken: first.GetProjection().GetNextPageToken()})
	if err != nil || len(second.GetProjection().GetItems()) != 1 || second.GetProjection().GetNextPageToken() != "" {
		t.Fatalf("second Memory page: response=%+v err=%v", second, err)
	}
	seen := map[string]struct{}{}
	for _, item := range append(first.GetProjection().GetItems(), second.GetProjection().GetItems()...) {
		if _, duplicate := seen[item.GetMemoryId()]; duplicate {
			t.Fatalf("Memory pagination duplicated %q", item.GetMemoryId())
		}
		seen[item.GetMemoryId()] = struct{}{}
	}
	if len(seen) != 3 {
		t.Fatalf("Memory pagination returned %d unique items, want 3", len(seen))
	}
}
