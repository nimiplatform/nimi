package ai

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type catalogProjectionSecretStore struct {
	mu      sync.Mutex
	values  map[string]string
	readOps int
}

func (s *catalogProjectionSecretStore) WriteSecret(id string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[id] = value
	return nil
}

func (s *catalogProjectionSecretStore) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readOps++
	value, ok := s.values[id]
	return value, ok, nil
}

func (s *catalogProjectionSecretStore) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}

func TestListPresetVoicesUsesCommittedCloudAIConfigDriverTarget(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-audio", "https://example.com", Config{})
	commitCloudAudioSynthesizeAIConfig(t, fixture.service, "user-001", "nimi.desktop", fixture.targetRef)
	response, err := fixture.service.ListPresetVoices(
		scenarioJobUserContext("nimi.desktop", "user-001"),
		&runtimev1.ListPresetVoicesRequest{AppId: "nimi.desktop", SubjectUserId: "user-001"},
	)
	if err != nil {
		t.Fatalf("ListPresetVoices: %v", err)
	}
	if response.GetModelResolved() != "gpt-audio" || len(response.GetVoices()) == 0 {
		t.Fatalf("voice catalog projection = %+v", response)
	}
}

func TestListPresetVoicesCloudDoesNotOpenSecretOrRequireRemoteHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	secrets := &catalogProjectionSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "voice-catalog-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
		Provider: "openai", Endpoint: "https://example.com", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "catalog-secret")
	if err != nil {
		t.Fatal(err)
	}
	connectorService := connector.New(logger, store, nil)
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	descriptor := connectorModelDescriptorForAITest(t, connectorService, ctx, record.ConnectorID, "gpt-audio")
	service, err := newFromProviderConfig(logger, nil, store, Config{}, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	service.remoteMediaHost = nil
	commitCloudAudioSynthesizeAIConfig(t, service, "user-001", "nimi.desktop", cloudScenarioTargetRefForDescriptor(record.ConnectorID, descriptor))
	response, err := service.ListPresetVoices(ctx, &runtimev1.ListPresetVoicesRequest{AppId: "nimi.desktop", SubjectUserId: "user-001"})
	if err != nil || response.GetModelResolved() != "gpt-audio" {
		t.Fatalf("ListPresetVoices = %+v, %v", response, err)
	}
	secrets.mu.Lock()
	readOps := secrets.readOps
	secrets.mu.Unlock()
	if readOps != 0 {
		t.Fatalf("catalog projection opened connector secret %d times", readOps)
	}
}

func TestListPresetVoicesFailsClosedForMissingCloudCompositionStages(t *testing.T) {
	service := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	request := &runtimev1.ListPresetVoicesRequest{AppId: "nimi.desktop", SubjectUserId: "user-001"}

	_, err := service.ListPresetVoices(ctx, request)
	assertVoiceCatalogReason(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)

	validTarget, _ := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "gpt-audio", "remoteModelCatalogId": "missing-current-account-catalog",
	})
	missingImplementation := &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ProviderModelTarget: validTarget,
		}},
	}
	if err := overwriteAIConfigStoreForTest(context.Background(), service.aiConfigStore, "user-001", appAIConfig("nimi.desktop", missingImplementation)); err == nil {
		t.Fatal("AIConfig without CapabilityImplementation was committed")
	}

	missingDriverTarget := &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.audio.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1",
			},
		}},
	}
	if err := overwriteAIConfigStoreForTest(context.Background(), service.aiConfigStore, "user-001", appAIConfig("nimi.desktop", missingDriverTarget)); err == nil {
		t.Fatal("AIConfig without Driver target was committed")
	}

	commitAudioSynthesizeIntent(t, service, "user-001", "nimi.desktop", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.audio.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1",
			},
			ProviderModelTarget: validTarget,
		}},
	})
	_, err = service.ListPresetVoices(ctx, request)
	assertVoiceCatalogReason(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestListPresetVoicesRejectsAuthenticatedOwnerMismatch(t *testing.T) {
	service := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := service.ListPresetVoices(
		scenarioJobUserContext("nimi.desktop", "user-001"),
		&runtimev1.ListPresetVoicesRequest{AppId: "nimi.desktop", SubjectUserId: "user-002"},
	)
	assertVoiceCatalogReason(t, err, codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
}

func TestListPresetVoicesRejectsRetiredCallerRouteWireFields(t *testing.T) {
	service := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, fieldNumber := range []protowire.Number{3, 4, 5} {
		request := &runtimev1.ListPresetVoicesRequest{AppId: "nimi.desktop", SubjectUserId: "user-001"}
		wire, err := proto.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		wire = protowire.AppendTag(wire, fieldNumber, protowire.BytesType)
		wire = protowire.AppendString(wire, "retired-caller-selection")
		request.Reset()
		if err := proto.Unmarshal(wire, request); err != nil {
			t.Fatal(err)
		}

		_, err = service.ListPresetVoices(scenarioJobUserContext("nimi.desktop", "user-001"), request)
		assertVoiceCatalogReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func commitCloudAudioSynthesizeAIConfig(t *testing.T, service *Service, accountID string, appID string, target *runtimeidentity.Target) {
	t.Helper()
	cloud := target.GetCloud()
	rawTarget, err := structpb.NewStruct(map[string]any{
		"provider": cloud.Provider, "providerModelId": cloud.ProviderModelID, "remoteModelCatalogId": cloud.RemoteModelCatalogID,
	})
	if err != nil {
		t.Fatal(err)
	}
	commitAudioSynthesizeIntent(t, service, accountID, appID, &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.audio." + cloud.Provider,
				DriverId:         "nimi.runtime.driver." + cloud.Provider, DriverDialect: "provider/media-v1",
			},
			ProviderModelTarget: rawTarget,
		}},
	})
}

func commitAudioSynthesizeIntent(t *testing.T, service *Service, accountID string, appID string, intent *runtimev1.AIConfigCapabilityIntent) {
	t.Helper()
	if err := overwriteAIConfigStoreForTest(context.Background(), service.aiConfigStore, accountID, appAIConfig(appID, intent)); err != nil {
		t.Fatalf("commit audio.synthesize AIConfig: %v", err)
	}
}

func assertVoiceCatalogReason(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode) {
	t.Helper()
	if status.Code(err) != code {
		t.Fatalf("status code = %v, want %v: %v", status.Code(err), code, err)
	}
	actual, ok := grpcerr.ExtractReasonCode(err)
	if !ok || actual != reason {
		t.Fatalf("reason = %v, want %v: %v", actual, reason, err)
	}
}
