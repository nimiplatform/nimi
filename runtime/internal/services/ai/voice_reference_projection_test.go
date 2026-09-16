package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestSelectedLocalVoiceResourceProjectsDriverReferenceInputs(t *testing.T) {
	s := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry()}
	option := localexecution.LoadoutOption{CapabilityContract: "voice.create", ConfiguredFeatures: []string{"input.audio", "input.text"}, Implementation: &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.Qwen3VoiceLibraryImplementationID,
		DriverId:         capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3VoiceLibraryDriverDialect,
	}}
	result := s.projectLocalResourceProjection(option)
	input := result.GetReferenceAudioInput()
	if input == nil || !input.SupportsBytes || !input.SupportsUri || input.TextMode != "optional" {
		t.Fatalf("selected resource lost actual Driver input support: %+v", result)
	}
	option.Implementation.DriverDialect = "unknown"
	if got := s.projectLocalResourceProjection(option).GetReferenceAudioInput(); got != nil {
		t.Fatalf("unknown Driver fabricated support: %+v", got)
	}
}

func TestCommittedCloudVoiceResourcePreservesOptionInputCapabilities(t *testing.T) {
	const appID = "app.cloud-voice-input"
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen-audio-3.0-tts-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1", Config{})
	response, err := fixture.service.ListAppAIConfigOptions(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigOptionsList), &runtimev1.ListAppAIConfigOptionsRequest{
		Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudTargets{CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{CapabilityContract: "voice.create", ConnectorRef: fixture.connectorID, Search: "qwen-audio-3.0-tts-plus"}},
	})
	if err != nil || len(response.GetCloudTargets().GetOptions()) != 1 {
		t.Fatalf("options: %v %v", response, err)
	}
	option := response.GetCloudTargets().GetOptions()[0]
	intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "voice.create", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: option.ConnectorRef, Implementation: option.Implementation, ProviderModelTarget: option.ProviderModelTarget}}}
	_, err = fixture.service.OverwriteAppAIConfig(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigOverwrite), &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(intent), ExpectedRevision: "0"})
	if err != nil {
		t.Fatal(err)
	}
	read, err := fixture.service.GetAppAIConfig(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead), &runtimev1.GetAppAIConfigRequest{})
	if err != nil || len(read.GetEffectiveSelections()) != 1 {
		t.Fatalf("read: %v %v", read, err)
	}
	selected := read.GetEffectiveSelections()[0].GetCloud().GetTarget()
	if !proto.Equal(selected, option) {
		t.Fatalf("committed resource lost safe option metadata: selected=%v option=%v", selected, option)
	}
	if selected.GetReferenceAudioInput() == nil || len(selected.SupportedFeatures) != 2 {
		t.Fatalf("voice source capabilities absent: %v", selected)
	}
}
