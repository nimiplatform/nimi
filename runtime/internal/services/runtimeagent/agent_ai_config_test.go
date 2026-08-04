package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const runtimeAgentAIConfigTestEmbedModel = "local/test-embedding"

func newSharedAIConfigTestService(t *testing.T) *Service {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: localStatePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	t.Cleanup(func() { _ = memorySvc.Close() })
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	t.Cleanup(svc.Close)
	svc.SetAIConfigStore(aiconfig.NewMemoryStore())
	return svc
}

func sharedAIConfigTestContext(accountID, appID string) (context.Context, *runtimev1.AgentRequestContext) {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: accountID}), &runtimev1.AgentRequestContext{
		AppId: appID, SubjectUserId: accountID, OwnerUserId: accountID,
	}
}

func sharedLocalIntent(contract string) *runtimev1.AIConfigCapabilityIntent {
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		Route: &runtimev1.AIConfigCapabilityIntent_Local{
			Local: &runtimev1.AIConfigLocalIntent{},
		},
	}
}

func TestSharedLocalAgentAIConfigOverwriteAndGetUseSingularOwner(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	overwritten, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext,
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{
			sharedLocalIntent("text.generate"),
		},
	})
	if err != nil {
		t.Fatalf("OverwriteSharedLocalAgentAIConfig: %v", err)
	}
	if overwritten.GetConfig().GetOwner().GetRuntimeLocalAgentSubsystem() == nil {
		t.Fatalf("shared owner = %+v", overwritten.GetConfig().GetOwner())
	}
	got, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("GetSharedLocalAgentAIConfig: %v", err)
	}
	if len(got.GetConfig().GetCapabilities()) != 1 || got.GetConfig().GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("shared config = %+v", got.GetConfig())
	}
}

func TestSharedLocalAgentAIConfigGetMissingIsTyped(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	_, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("code = %s, want NotFound: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND {
		t.Fatalf("reason = %s, present=%v", reason, ok)
	}
}

func TestSharedLocalAgentAIConfigRejectsPerAgentSelectors(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	requestContext.LocalAgentRef = "local-agent:forbidden"
	_, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, Capabilities: []*runtimev1.AIConfigCapabilityIntent{sharedLocalIntent("text.generate")},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
}

// Retired per-Agent AIConfig setup calls in unrelated Runtime behavior tests
// no longer mutate product configuration. Those tests install their own
// executor doubles and must not infer shared AIConfig from an Agent identity.
func configureRuntimeAgentTestAIConfig(t *testing.T, svc *Service, requestContext *runtimev1.AgentRequestContext) {
	t.Helper()
	upsertPublicChatTestAgentAIConfigForContext(t, svc, requestContext)
}
