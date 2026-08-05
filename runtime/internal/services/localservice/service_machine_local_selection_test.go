package localservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMachineLocalSelectionOverwritesOneCapabilityAndPersistsClear(t *testing.T) {
	root := t.TempDir()
	service := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	first := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	second := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())

	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, first.GetConfigurationId())
	selected := selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, second.GetConfigurationId())
	if selected.GetConfigurationId() != second.GetConfigurationId() {
		t.Fatalf("selected configuration = %q, want %q", selected.GetConfigurationId(), second.GetConfigurationId())
	}
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, second.GetConfigurationId())
	service.Close()

	restarted := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	assertOnlyMachineLocalSelection(t, restarted, capabilitydriver.LlamaCapabilityContract, second.GetConfigurationId())
	if _, err := restarted.ClearLocalCapabilitySelection(context.Background(), &runtimev1.ClearLocalCapabilitySelectionRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
	}); err != nil {
		t.Fatalf("ClearLocalCapabilitySelection: %v", err)
	}
	assertOnlyMachineLocalSelection(t, restarted, "", "")
	// Clear is explicitly idempotent and does not synthesize a replacement.
	if _, err := restarted.ClearLocalCapabilitySelection(context.Background(), &runtimev1.ClearLocalCapabilitySelectionRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
	}); err != nil {
		t.Fatalf("ClearLocalCapabilitySelection(second): %v", err)
	}
	restarted.Close()

	restartedAgain := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	defer restartedAgain.Close()
	assertOnlyMachineLocalSelection(t, restartedAgain, "", "")
}

func TestMachineLocalSelectionAllowsUnconfiguredButRejectsCapabilityMismatch(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())

	resolved, err := service.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if resolved != nil || status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("unselected resolution = %#v err=%v", resolved, err)
	}
	assertGRPCReasonCode(t, err, "ResolveSelectedLocalExecution(unselected)", runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)

	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, configuration.GetConfigurationId())
	resolved, err = service.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if resolved != nil || status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("unconfigured resolution = %#v err=%v", resolved, err)
	}
	assertGRPCReasonCode(t, err, "ResolveSelectedLocalExecution(unconfigured)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); !ok || metadata["local_reason"] != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING.String() {
		t.Fatalf("unconfigured metadata = %#v ok=%v", metadata, ok)
	}

	const mismatchedCapability = "image.generate"
	response, err := service.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: mismatchedCapability,
		ConfigurationId:    configuration.GetConfigurationId(),
	})
	if response != nil || status.Code(err) != codes.InvalidArgument {
		t.Fatalf("mismatched selection = %#v err=%v", response, err)
	}
	assertGRPCReasonCode(t, err, "SelectLocalCapabilityConfiguration(mismatch)", runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID)
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, configuration.GetConfigurationId())
}

func TestMachineLocalExecutionRelevantBindingUpdateRetainsSelection(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, configuration.GetConfigurationId())

	if _, err := service.UnbindLocalCapabilityRequirement(context.Background(), &runtimev1.UnbindLocalCapabilityRequirementRequest{
		ConfigurationId:        configuration.GetConfigurationId(),
		RequirementId:          capabilitydriver.MainGGUFRequirementID,
		ExpectedCurrentBinding: configuration.GetExactBindings()[0],
	}); err != nil {
		t.Fatalf("UnbindLocalCapabilityRequirement: %v", err)
	}
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, configuration.GetConfigurationId())
	resolved, err := service.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if resolved != nil {
		t.Fatalf("unbound selected configuration returned partial projection: %#v", resolved)
	}
	assertGRPCReasonCode(t, err, "ResolveSelectedLocalExecution(after unbind)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
}

func TestDeleteSelectedMachineLocalConfigurationClearsSelectionWithoutFallbackOrAssetCascade(t *testing.T) {
	root := t.TempDir()
	service := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	contentID := seedMachineLocalAssetForTest(t, service, "shared-asset", 'a', "llm")
	portable := mustStructForTest(t, map[string]any{"mainVerifiedContentId": "sha256:" + contentID})
	selected := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	fallbackCandidate := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, selected.GetConfigurationId())

	if _, err := service.DeleteLocalCapabilityConfiguration(context.Background(), &runtimev1.DeleteLocalCapabilityConfigurationRequest{
		ConfigurationId: selected.GetConfigurationId(),
	}); err != nil {
		t.Fatalf("DeleteLocalCapabilityConfiguration: %v", err)
	}
	aggregate := machineLocalAggregateForTest(t, service)
	if len(aggregate.GetConfigurations()) != 1 || aggregate.GetConfigurations()[0].GetConfigurationId() != fallbackCandidate.GetConfigurationId() {
		t.Fatalf("configurations after delete = %#v", aggregate.GetConfigurations())
	}
	if len(aggregate.GetSelections()) != 0 {
		t.Fatalf("delete selected configuration installed fallback selection: %#v", aggregate.GetSelections())
	}
	service.mu.RLock()
	asset := cloneLocalAsset(service.assets["shared-asset"])
	service.mu.RUnlock()
	if asset == nil {
		t.Fatal("deleting configuration cascaded to shared LocalAsset")
	}
	service.Close()

	restarted := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	defer restarted.Close()
	aggregate = machineLocalAggregateForTest(t, restarted)
	if len(aggregate.GetConfigurations()) != 1 || aggregate.GetConfigurations()[0].GetConfigurationId() != fallbackCandidate.GetConfigurationId() || len(aggregate.GetSelections()) != 0 {
		t.Fatalf("restored aggregate after delete = %#v", aggregate)
	}
}

func TestResolveSelectedLocalExecutionReturnsVerifiedAbsoluteBindingsAndRejectsDrift(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	portable := mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
		"contextSize":           4096,
	})
	configuration := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, configuration.GetConfigurationId())

	resolved, err := service.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if err != nil {
		t.Fatalf("ResolveSelectedLocalExecution: %v", err)
	}
	if !resolved.Configured || resolved.ConfigurationID != configuration.GetConfigurationId() ||
		resolved.CapabilityContract != capabilitydriver.LlamaCapabilityContract ||
		resolved.DriverIdentity.GetDriverId() != capabilitydriver.LlamaDriverID ||
		resolved.PortableConfig.GetFields()["contextSize"].GetNumberValue() != 4096 ||
		len(resolved.Requirements) != 1 || len(resolved.ExactBindings) != 1 {
		t.Fatalf("resolved execution = %#v", resolved)
	}
	binding := resolved.ExactBindings[0]
	if binding.RequirementID != capabilitydriver.MainGGUFRequirementID || binding.LocalAssetID != "asset-main" ||
		binding.VerifiedContentID != "sha256:"+contentID || binding.EntrySHA256 != contentID || !filepath.IsAbs(binding.AbsolutePath) {
		t.Fatalf("resolved exact binding = %#v", binding)
	}
	if _, err := os.Stat(binding.AbsolutePath); err != nil {
		t.Fatalf("resolved exact path: %v", err)
	}

	if err := os.WriteFile(binding.AbsolutePath, testMachineLocalGGUFBytes('b'), 0o600); err != nil {
		t.Fatalf("drift selected LocalAsset bytes: %v", err)
	}
	resolved, err = service.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if resolved != nil {
		t.Fatalf("byte drift returned partial projection: %#v", resolved)
	}
	assertGRPCReasonCode(t, err, "ResolveSelectedLocalExecution(byte drift)", runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH)
}

func TestMachineLocalSelectionMutationStoreFailureDoesNotPublishMemory(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	first := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	second := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	selectMachineLocalConfigurationForTest(t, service, capabilitydriver.LlamaCapabilityContract, first.GetConfigurationId())
	service.machineLocalConfigurationStore = failingMachineLocalConfigurationStore{err: errors.New("disk full")}

	_, err := service.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		ConfigurationId:    second.GetConfigurationId(),
	})
	assertGRPCReasonCode(t, err, "SelectLocalCapabilityConfiguration(store failure)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, first.GetConfigurationId())

	_, err = service.ClearLocalCapabilitySelection(context.Background(), &runtimev1.ClearLocalCapabilitySelectionRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract})
	assertGRPCReasonCode(t, err, "ClearLocalCapabilitySelection(store failure)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, first.GetConfigurationId())

	_, err = service.DeleteLocalCapabilityConfiguration(context.Background(), &runtimev1.DeleteLocalCapabilityConfigurationRequest{ConfigurationId: first.GetConfigurationId()})
	assertGRPCReasonCode(t, err, "DeleteLocalCapabilityConfiguration(store failure)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	assertOnlyMachineLocalSelection(t, service, capabilitydriver.LlamaCapabilityContract, first.GetConfigurationId())
}

func selectMachineLocalConfigurationForTest(t *testing.T, service *Service, capabilityContract, configurationID string) *runtimev1.LocalCapabilitySelection {
	t.Helper()
	response, err := service.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilityContract,
		ConfigurationId:    configurationID,
	})
	if err != nil {
		t.Fatalf("SelectLocalCapabilityConfiguration: %v", err)
	}
	return response.GetSelection()
}

func assertOnlyMachineLocalSelection(t *testing.T, service *Service, capabilityContract, configurationID string) {
	t.Helper()
	selections := machineLocalAggregateForTest(t, service).GetSelections()
	if capabilityContract == "" {
		if len(selections) != 0 {
			t.Fatalf("selections = %#v, want none", selections)
		}
		return
	}
	if len(selections) != 1 || selections[0].GetCapabilityContract() != capabilityContract || selections[0].GetConfigurationId() != configurationID {
		t.Fatalf("selections = %#v, want %q -> %q", selections, capabilityContract, configurationID)
	}
}

func machineLocalAggregateForTest(t *testing.T, service *Service) *runtimev1.MachineLocalAIConfiguration {
	t.Helper()
	response, err := service.GetMachineLocalAIConfiguration(context.Background(), &runtimev1.GetMachineLocalAIConfigurationRequest{})
	if err != nil {
		t.Fatalf("GetMachineLocalAIConfiguration: %v", err)
	}
	return response.GetAggregate()
}
