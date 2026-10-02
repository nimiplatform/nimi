package ai

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
	"testing"
)

func TestMusicVideoCapturedAssemblyRebuildRetainsEffectiveInputs(t *testing.T) {
	target, _ := structpb.NewStruct(map[string]any{"provider": "elevenlabs", "providerModelId": "music_v2", "remoteModelCatalogId": "catalog-music"})
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.music.generate.elevenlabs", DriverId: "nimi.runtime.driver.elevenlabs", DriverDialect: "provider/media-v1"}
	registry := capabilitydriver.NewProductionCloudMediaRegistry()
	driver, resolved, err := registry.Resolve(capabilitydriver.IdentityFromProto(identity), target, "music.generate")
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "account"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "scene", VideoReference: &runtimev1.MusicVideoReference{ArtifactId: "clip"}}}}}
	mapped, err := driver.MapRequest(resolved, request, nil, capabilitydriver.CloudMediaStreamNone)
	if err != nil {
		t.Fatal(err)
	}
	if request.GetSpec().GetMusicGenerate().GetDurationSeconds() != 0 || mapped.Request().GetSpec().GetMusicGenerate().GetDurationSeconds() != 600 {
		t.Fatal("author/effective input separation lost")
	}
	record := connector.ConnectorRecord{ConnectorID: "connector", Provider: "elevenlabs", OwnerID: "account", OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true}
	assembly, err := newCloudResolvedAssembly(cloudResolvedRequestMedia, "music.generate", identity, target, record, nil, mapped.Request(), request.ExecutionMode, capabilitydriver.CloudMediaStreamNone, "trace", "app", "account", nil)
	if err != nil {
		t.Fatal(err)
	}
	assembly.MusicVideoReference = &nimillm.MusicReferenceVideo{ArtifactID: "clip", MIMEType: "video/mp4", Bytes: []byte("owned-capture-fixture")}
	assembly.CredentialCustodyRef = "custody"
	svc := &Service{cloudMediaDrivers: registry}
	rebuilt, err := svc.cloudMediaEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt.request.GetSpec().GetMusicGenerate().GetDurationSeconds() != 600 || !bytes.Equal(rebuilt.resolvedAssembly.MusicVideoReference.Bytes, assembly.MusicVideoReference.Bytes) {
		t.Fatal("captured inputs changed during rebuild")
	}
	if _, err = svc.cloudMediaEffectiveInputsFromResolvedAssembly(rebuilt.resolvedAssembly); err != nil {
		t.Fatal("second captured reconstruction failed", err)
	}
	_ = context.Background()
}
