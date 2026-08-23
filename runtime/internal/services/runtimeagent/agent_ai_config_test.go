package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/aiprofile"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
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
	svc.SetAIProfileStore(aiprofile.NewMemoryStore())
	svc.SetMachineLocalExecutionResolver(sharedAIConfigLocalResolver{})
	return svc
}

type sharedAIConfigLocalResolver struct{}

type missingSharedLoadoutProjectionResolver struct{}

func (missingSharedLoadoutProjectionResolver) ProjectSelectedLocalLoadout(contract string) (localexecution.LoadoutOption, bool, error) {
	return localexecution.LoadoutOption{
		LoadoutID: "loadout-deleted", CapabilityContract: contract,
		ValidationState: runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED,
		Reasons:         []runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND},
	}, true, nil
}

func (missingSharedLoadoutProjectionResolver) ResolveSelectedLocalExecution(string) (*localexecution.SelectedLocalExecution, error) {
	return nil, nil
}

func (missingSharedLoadoutProjectionResolver) ResolveLocalExecution(string, string) (*localexecution.SelectedLocalExecution, error) {
	return nil, nil
}

func (sharedAIConfigLocalResolver) ProjectSelectedLocalLoadout(contract string) (localexecution.LoadoutOption, bool, error) {
	selected, err := (sharedAIConfigLocalResolver{}).ResolveSelectedLocalExecution(contract)
	if err != nil {
		return localexecution.LoadoutOption{}, false, err
	}
	return localexecution.LoadoutOption{
		LoadoutID: selected.LoadoutID, DisplayName: selected.DisplayName,
		CapabilityContract: contract, Implementation: selected.DriverIdentity,
		ValidationState: runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
	}, true, nil
}

func (sharedAIConfigLocalResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	return (sharedAIConfigLocalResolver{}).ResolveLocalExecution(contract, "loadout-"+contract)
}

func (sharedAIConfigLocalResolver) ResolveLocalExecution(contract string, loadoutRef string) (*localexecution.SelectedLocalExecution, error) {
	return &localexecution.SelectedLocalExecution{
		LoadoutID: loadoutRef, CapabilityContract: contract, DisplayName: loadoutRef,
		DriverIdentity: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "test.local", DriverId: "test", DriverDialect: "test/local/v1",
		},
	}, nil
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
		Context:          requestContext,
		ExpectedRevision: "0",
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
	if !overwritten.GetCommitted() || overwritten.GetRevision() != "1" {
		t.Fatalf("overwrite result = %+v", overwritten)
	}
	got, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("GetSharedLocalAgentAIConfig: %v", err)
	}
	if len(got.GetConfig().GetCapabilities()) != 1 || got.GetConfig().GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("shared config = %+v", got.GetConfig())
	}
}

func TestSharedLocalAgentAIConfigEffectiveSelectionFollowsMachineWithoutRevisionChange(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	contract := capabilitydriver.LlamaCapabilityContract
	projections := map[string]*localexecution.SelectedLocalExecution{
		contract: machineLocalExecutionProjectionForTest("loadout-a", contract, "Model A", nil),
	}
	svc.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{projections: projections})
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	written, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, ExpectedRevision: "0",
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{sharedLocalIntent(contract)},
	})
	if err != nil || written.GetRevision() != "1" {
		t.Fatalf("shared Local write = %+v, %v", written, err)
	}
	assertLoadout := func(loadoutID string) {
		t.Helper()
		read, readErr := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
		if readErr != nil || read.GetRevision() != "1" || len(read.GetEffectiveSelections()) != 1 ||
			read.GetEffectiveSelections()[0].GetLocal().GetLoadoutRef() != loadoutID {
			t.Fatalf("shared effective selection = %+v, %v", read, readErr)
		}
	}
	assertLoadout("loadout-a")
	projections[contract] = machineLocalExecutionProjectionForTest("loadout-b", contract, "Model B", nil)
	assertLoadout("loadout-b")
}

func TestSharedLocalAgentAIConfigEffectiveSelectionBlocksFeatureIncompatibleLoadout(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	contract := capabilitydriver.LlamaCapabilityContract
	selected := machineLocalExecutionProjectionForTest("loadout-feature-mismatch", contract, "Model", nil)
	selected.SupportedFeatures = []string{"input.audio"}
	svc.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{projections: map[string]*localexecution.SelectedLocalExecution{
		contract: selected,
	}})
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	intent := sharedLocalIntent(contract)
	intent.RequiredFeatures = []string{"input.image"}
	if _, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, ExpectedRevision: "0", Capabilities: []*runtimev1.AIConfigCapabilityIntent{intent},
	}); err != nil {
		t.Fatalf("OverwriteSharedLocalAgentAIConfig: %v", err)
	}
	read, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	selection := read.GetEffectiveSelections()[0]
	if err != nil || selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
		len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH.String() ||
		selection.GetLocal().GetLoadoutRef() != selected.LoadoutID {
		t.Fatalf("shared feature-incompatible effective selection = %+v, %v", selection, err)
	}
}

func TestSharedLocalAgentAIConfigMissingLoadoutTakesPrecedenceOverFeatureMismatch(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	svc.SetMachineLocalExecutionResolver(missingSharedLoadoutProjectionResolver{})
	contract := capabilitydriver.LlamaCapabilityContract
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	intent := sharedLocalIntent(contract)
	intent.RequiredFeatures = []string{"input.image"}
	if _, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, ExpectedRevision: "0", Capabilities: []*runtimev1.AIConfigCapabilityIntent{intent},
	}); err != nil {
		t.Fatalf("OverwriteSharedLocalAgentAIConfig: %v", err)
	}
	read, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	selection := read.GetEffectiveSelections()[0]
	if err != nil || selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING ||
		len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND.String() {
		t.Fatalf("shared missing Loadout effective selection = %+v, %v", selection, err)
	}
}

func TestSharedLocalAgentAIConfigGetMissingIsTyped(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	projection, err := svc.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
	if err != nil || projection.GetConfig() != nil || projection.GetRevision() != "0" {
		t.Fatalf("missing projection = %+v err=%v", projection, err)
	}
	assertLocalAgentParticipation(t, projection.GetParticipation())
}

func assertLocalAgentParticipation(t *testing.T, rows []*runtimev1.LocalAgentCapabilityParticipation) {
	t.Helper()
	want := []struct {
		role       runtimev1.LocalAgentCapabilityParticipationRole
		capability string
	}{
		{runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_PRIMARY, "text.generate"},
		{runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_MEMORY_EMBEDDING, "text.embed"},
		{runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_INPUT_VOICE, "audio.transcribe"},
		{runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_OUTPUT_VOICE, "audio.synthesize"},
		{runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_ACTION_IMAGE, "image.generate"},
	}
	if len(rows) != len(want) {
		t.Fatalf("participation rows = %+v", rows)
	}
	for index := range want {
		if rows[index].GetRole() != want[index].role || rows[index].GetCapabilityContract() != want[index].capability {
			t.Fatalf("participation row %d = %+v want=%+v", index, rows[index], want[index])
		}
	}
}

func TestSharedLocalAgentAIConfigRejectsPerAgentSelectors(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	requestContext.LocalAgentRef = "local-agent:forbidden"
	_, err := svc.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, ExpectedRevision: "0", Capabilities: []*runtimev1.AIConfigCapabilityIntent{sharedLocalIntent("text.generate")},
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
