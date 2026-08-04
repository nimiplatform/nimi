package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/types/known/structpb"
)

type machineExecutionAccountProjectionStub struct {
	accountID string
}

func (stub machineExecutionAccountProjectionStub) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	if stub.accountID == "" {
		return nil, false
	}
	return &runtimev1.AccountProjection{AccountId: stub.accountID}, true
}

type machineLocalExecutionResolverStub struct {
	contracts   []string
	projections map[string]*localexecution.SelectedLocalExecution
	errors      map[string]error
}

func (stub machineLocalExecutionResolverStub) SelectedLocalCapabilityContracts() []string {
	return append([]string(nil), stub.contracts...)
}

func (stub machineLocalExecutionResolverStub) ResolveSelectedLocalExecution(capabilityContract string) (*localexecution.SelectedLocalExecution, error) {
	if err := stub.errors[capabilityContract]; err != nil {
		return nil, err
	}
	return stub.projections[capabilityContract], nil
}

func TestMachineLocalBindingResolverProjectsEveryConfiguredSelection(t *testing.T) {
	portable, err := structpb.NewStruct(map[string]any{"contextSize": 4096})
	if err != nil {
		t.Fatal(err)
	}
	source := machineLocalExecutionResolverStub{
		contracts: []string{"image.generate", capabilitydriver.LlamaCapabilityContract},
		projections: map[string]*localexecution.SelectedLocalExecution{
			capabilitydriver.LlamaCapabilityContract: machineLocalExecutionProjectionForTest("lcc_text", capabilitydriver.LlamaCapabilityContract, "Desktop llama", portable),
			"image.generate":                         machineLocalExecutionProjectionForTest("lcc_image", "image.generate", "", nil),
		},
	}
	service := &Service{runtimeAccountProjection: machineExecutionAccountProjectionStub{accountID: "account-1"}}
	service.SetMachineLocalExecutionResolver(source)
	if !service.HasMachineExecutionBindingResolver() {
		t.Fatal("machine execution binding resolver was not installed")
	}

	bindings, err := service.machineExecutionBindings(context.Background(), "account-1")
	if err != nil {
		t.Fatalf("machineExecutionBindings: %v", err)
	}
	if len(bindings) != 2 {
		t.Fatalf("bindings = %#v", bindings)
	}
	text := bindings[capabilitydriver.LlamaCapabilityContract]
	if text.BindingAlias != "lcc_text" || text.ModelID != "Desktop llama" || text.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
		text.TargetRef.GetLocalRuntime().GetVersion() != "v2" || text.TargetRef.GetLocalRuntime().GetProfileBindingId() != "lcc_text" ||
		text.SelectedParams.GetFields()["contextSize"].GetNumberValue() != 4096 {
		t.Fatalf("text binding = %#v", text)
	}
	image := bindings["image.generate"]
	if image.ModelID != "lcc_image" || image.TargetRef.GetLocalRuntime().GetProfileBindingId() != "lcc_image" {
		t.Fatalf("image binding = %#v", image)
	}
	if _, exists := bindings["audio.synthesize"]; exists {
		t.Fatal("unselected capability produced a machine execution binding")
	}

	bindings, err = service.machineExecutionBindings(context.Background(), "other-account")
	if bindings != nil || err == nil {
		t.Fatalf("account mismatch bindings=%#v err=%v", bindings, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("account mismatch reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestMachineLocalBindingResolverNeverReturnsPartialOrFallbackBindings(t *testing.T) {
	projection := machineLocalExecutionProjectionForTest("lcc_text", capabilitydriver.LlamaCapabilityContract, "", nil)
	source := machineLocalExecutionResolverStub{
		contracts:   []string{capabilitydriver.LlamaCapabilityContract, "image.generate"},
		projections: map[string]*localexecution.SelectedLocalExecution{capabilitydriver.LlamaCapabilityContract: projection},
		errors:      map[string]error{"image.generate": errors.New("selected image configuration is incomplete")},
	}
	service := &Service{runtimeAccountProjection: machineExecutionAccountProjectionStub{accountID: "account-1"}}
	service.SetMachineLocalExecutionResolver(source)
	bindings, err := service.machineExecutionBindings(context.Background(), "account-1")
	if bindings != nil || err == nil {
		t.Fatalf("partial resolver result bindings=%#v err=%v", bindings, err)
	}

	service.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{})
	bindings, err = service.machineExecutionBindings(context.Background(), "account-1")
	if bindings != nil || err == nil {
		t.Fatalf("empty selection result bindings=%#v err=%v", bindings, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("empty selection reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func machineLocalExecutionProjectionForTest(configurationID, capabilityContract, displayName string, portable *structpb.Struct) *localexecution.SelectedLocalExecution {
	absolutePath, _ := filepath.Abs(filepath.Join("runtime", "models", "main.gguf"))
	return &localexecution.SelectedLocalExecution{
		ConfigurationID:    configurationID,
		CapabilityContract: capabilityContract,
		DisplayName:        displayName,
		DriverIdentity: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: capabilitydriver.LlamaImplementationID,
			DriverId:         capabilitydriver.LlamaDriverID,
			DriverDialect:    capabilitydriver.LlamaDriverDialect,
		},
		PortableConfig: portable,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.MainGGUFRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.MainGGUFRequirementID,
			LocalAssetID:      "asset-main",
			AbsolutePath:      absolutePath,
			VerifiedContentID: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EntrySHA256:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		}},
		Configured: true,
	}
}
