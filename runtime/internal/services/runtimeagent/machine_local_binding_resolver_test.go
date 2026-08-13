package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
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

type recordingMachineLocalExecutionResolver struct {
	machineLocalExecutionResolverStub
	calls []string
}

func (stub *recordingMachineLocalExecutionResolver) ResolveSelectedLocalExecution(capabilityContract string) (*localexecution.SelectedLocalExecution, error) {
	stub.calls = append(stub.calls, capabilityContract)
	return stub.machineLocalExecutionResolverStub.ResolveSelectedLocalExecution(capabilityContract)
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
	installMachineAIConfigForTest(t, service, "account-1", capabilitydriver.LlamaCapabilityContract, "image.generate")
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
		text.TargetRef != nil || text.SelectedParams != nil || text.LocalExecution == nil || text.LocalExecution.ConfigurationID != "lcc_text" {
		t.Fatalf("text binding = %#v", text)
	}
	image := bindings["image.generate"]
	if image.ModelID != "lcc_image" || image.TargetRef != nil {
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

func TestCommittedOptionalAudioBindingAcceptsSelectedLocalExecutionWithoutTargetRef(t *testing.T) {
	service := newRuntimeAgentServiceForPublicChatTest(t)
	installMachineAIConfigForTest(t, service, "user-1", capabilitydriver.AudioSynthesizeContract)
	selected := machineLocalExecutionProjectionForTest("lcc-audio-synthesize", capabilitydriver.AudioSynthesizeContract, "speech/qwen3tts", nil)
	selected.DriverIdentity = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.Qwen3TTSImplementationID,
		DriverId:         capabilitydriver.Qwen3TTSDriverID,
		DriverDialect:    capabilitydriver.Qwen3TTSDriverDialect,
	}
	selected.Requirements[0].RequirementId = capabilitydriver.Qwen3TTSModelRequirementID
	selected.ExactBindings[0].RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	service.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{
		contracts: []string{capabilitydriver.AudioSynthesizeContract},
		projections: map[string]*localexecution.SelectedLocalExecution{
			capabilitydriver.AudioSynthesizeContract: selected,
		},
	})

	binding, ok, err := service.committedOptionalExecutionBinding(testRuntimeAgentLocalRef("agent-alpha"), capabilitydriver.AudioSynthesizeContract)
	if err != nil || !ok {
		t.Fatalf("committedOptionalExecutionBinding: binding=%+v ok=%v err=%v", binding, ok, err)
	}
	if binding.TargetRef != nil || !binding.LocalAIConfigIntent || binding.LocalExecution == nil ||
		binding.LocalExecution.ConfigurationID != selected.ConfigurationID {
		t.Fatalf("production-shape Local audio binding=%+v", binding)
	}
}

func TestCommittedOptionalAudioBindingKeepsCloudTargetFailClosed(t *testing.T) {
	cloudIntent := executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		CloudImplementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.audio.test",
			DriverId:         "driver.audio.test",
			DriverDialect:    "test/audio/v1",
		},
	}
	providerTarget, err := structpb.NewStruct(map[string]any{
		"provider":             "test",
		"providerModelId":      "cloud-tts",
		"remoteModelCatalogId": "test/cloud-tts",
	})
	if err != nil {
		t.Fatal(err)
	}
	cloudIntent.ProviderModelTarget = providerTarget

	missingTarget := publicChatExecutionBinding{
		ModelID:            "cloud-tts",
		RoutePolicy:        runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorID:        "connector-test",
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		ExecutionIntent:    cloudIntent,
	}
	if err := validateCommittedOptionalExecutionBinding(capabilitydriver.AudioSynthesizeContract, missingTarget); err == nil {
		t.Fatal("Cloud audio binding without TargetRef must fail closed")
	}
	valid := missingTarget
	valid.TargetRef = &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          "connector-test",
		Provider:             "test",
		ProviderModelID:      "cloud-tts",
		RemoteModelCatalogID: "test/cloud-tts",
	}}
	if err := validateCommittedOptionalExecutionBinding(capabilitydriver.AudioSynthesizeContract, valid); err != nil {
		t.Fatalf("valid Cloud audio binding rejected: %v", err)
	}
}

func TestPublicChatTurnAdmissionResolvesOnlyTurnExecutableSelections(t *testing.T) {
	const (
		textContract       = capabilitydriver.LlamaCapabilityContract
		imageContract      = "image.generate"
		videoContract      = "video.generate"
		synthesizeContract = "audio.synthesize"
		transcribeContract = "audio.transcribe"
	)
	service := newRuntimeAgentServiceForPublicChatTest(t)
	installMachineAIConfigForTest(t, service, "user-1", textContract, imageContract, videoContract, synthesizeContract, transcribeContract)
	projections := map[string]*localexecution.SelectedLocalExecution{}
	for _, contract := range []string{textContract, imageContract, videoContract, synthesizeContract, transcribeContract} {
		projections[contract] = machineLocalExecutionProjectionForTest("lcc_"+contract, contract, contract, nil)
	}
	source := &recordingMachineLocalExecutionResolver{machineLocalExecutionResolverStub: machineLocalExecutionResolverStub{
		contracts:   []string{textContract, imageContract, videoContract, synthesizeContract, transcribeContract},
		projections: projections,
	}}
	service.SetMachineLocalExecutionResolver(source)
	var capturedConfigurationID string
	service.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		captured, ok := localexecution.SelectedLocalExecutionFromContext(ctx, textContract)
		if ok {
			capturedConfigurationID = captured.ConfigurationID
		}
		return PublicChatBindingResolution{
			BindingAlias: req.BindingAlias, ModelID: req.ModelID, RoutePolicy: req.RouteHint,
			ContextWindowTokens: 32768, CatalogRevision: "catalog-v1", ModelRevision: "model-v1",
			ProviderID: "local", RouteDigest: strings.Repeat("a", 64),
		}, nil
	}})

	bindings, _, release, err := service.resolveExecutionBindingsFromConfig(
		context.Background(),
		testRuntimeAgentLocalRef("agent-alpha"),
		"user-1",
		publicChatTurnRequestPayload{},
	)
	if release != nil {
		defer release()
	}
	if err != nil {
		t.Fatalf("resolveExecutionBindingsFromConfig: %v", err)
	}
	wantCalls := []string{textContract, imageContract}
	if len(source.calls) != len(wantCalls) || source.calls[0] != wantCalls[0] || source.calls[1] != wantCalls[1] {
		t.Fatalf("turn admission resolved selections = %v, want %v", source.calls, wantCalls)
	}
	if len(bindings) != 2 || bindings[textContract].ModelID == "" || bindings[imageContract].ModelID == "" {
		t.Fatalf("turn execution bindings = %#v", bindings)
	}
	if capturedConfigurationID != "lcc_"+textContract {
		t.Fatalf("context metadata received captured configuration %q", capturedConfigurationID)
	}
}

func TestMachineBindingResolverCarriesCloudAIConfigIntentPrivately(t *testing.T) {
	const accountID = "account-1"
	service := &Service{runtimeAccountProjection: machineExecutionAccountProjectionStub{accountID: accountID}}
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := connectorStore.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: accountID, Provider: "dashscope", Endpoint: "https://dashscope.aliyuncs.com", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	modelCatalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	connectorService := connector.New(nil, connectorStore, nil)
	connectorService.SetModelCatalogResolver(modelCatalog)
	models, err := connectorService.ListConnectorModels(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: accountID}), &runtimev1.ListConnectorModelsRequest{
		ConnectorId: record.ConnectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatal(err)
	}
	var descriptor *runtimev1.ConnectorModelDescriptor
	for _, candidate := range models.GetModels() {
		if candidate.GetProviderModelId() == "qwen3-tts-vc-2026-01-22" {
			descriptor = candidate
			break
		}
	}
	if descriptor == nil {
		t.Fatal("qwen3-tts-vc descriptor not found")
	}
	providerTarget, _ := structpb.NewStruct(map[string]any{
		"provider": descriptor.GetProvider(), "providerModelId": descriptor.GetProviderModelId(), "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId(),
	})
	store := aiconfig.NewMemoryStore()
	if err := store.Overwrite(context.Background(), accountID, &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: "audio.synthesize",
			Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				Implementation:      &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.audio.dashscope", DriverId: "driver.dashscope", DriverDialect: "dashscope/audio/v1"},
				ProviderModelTarget: providerTarget,
			}},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	service.SetAIConfigStore(store)
	service.SetConnectorStore(connectorStore)
	service.SetModelCatalog(modelCatalog)
	service.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{})

	bindings, err := service.machineExecutionBindings(context.Background(), accountID)
	if err != nil {
		t.Fatalf("machineExecutionBindings: %v", err)
	}
	binding := bindings["audio.synthesize"]
	if !binding.ExecutionIntent.IsAIConfigCloud() || binding.ModelID != descriptor.GetProviderModelId() ||
		binding.TargetRef.GetCloud().GetConnectorId() != record.ConnectorID {
		t.Fatalf("Cloud machine binding=%+v intent=%+v", binding, binding.ExecutionIntent)
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
	installMachineAIConfigForTest(t, service, "account-1", capabilitydriver.LlamaCapabilityContract, "image.generate")
	service.SetMachineLocalExecutionResolver(source)
	bindings, err := service.machineExecutionBindings(context.Background(), "account-1")
	if bindings != nil || err == nil {
		t.Fatalf("partial resolver result bindings=%#v err=%v", bindings, err)
	}

	selectionErr := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	service.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{errors: map[string]error{
		capabilitydriver.LlamaCapabilityContract: selectionErr,
		"image.generate":                         selectionErr,
	}})
	bindings, err = service.machineExecutionBindings(context.Background(), "account-1")
	if bindings != nil || err == nil {
		t.Fatalf("empty selection result bindings=%#v err=%v", bindings, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("empty selection reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func installMachineAIConfigForTest(t *testing.T, service *Service, accountID string, contracts ...string) {
	t.Helper()
	store := aiconfig.NewMemoryStore()
	capabilities := make([]*runtimev1.AIConfigCapabilityIntent, 0, len(contracts))
	for _, contract := range contracts {
		capabilities = append(capabilities, &runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: contract,
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		})
	}
	if err := store.Overwrite(context.Background(), accountID, &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(), Capabilities: capabilities,
	}); err != nil {
		t.Fatalf("install shared LocalAgent AIConfig: %v", err)
	}
	service.SetAIConfigStore(store)
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
