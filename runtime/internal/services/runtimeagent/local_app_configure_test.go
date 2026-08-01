package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/structpb"
)

func newLocalAppConfigureTestAgent(t *testing.T) (*Service, string, string) {
	t.Helper()
	svc := newRuntimeAgentTestService(t)
	source := "local-app-configure-source"
	identityContext := testRuntimeAgentIdentityContext(source)
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: identityContext}); err != nil {
		t.Fatalf("materialize configure test Agent: %v", err)
	}
	svc.SetLocalAppRouteOptionInventory(runtimeAgentAIConfigTestRouteInventory())
	return svc, identityContext.GetLocalAgentRef(), identityContext.GetOwnerUserId()
}

func localAppConfigureContext(operation accountservice.LocalAppOperation, localAgentRef, accountID string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		LocalAppPrincipalID: "principal-configure", LocalAppRecordID: "record-configure",
		AppID: "third.party.configure", AccountID: accountID, LocalAgentID: localAgentRef,
		Operation: operation, OperationCapability: "agents.configure",
	})
}

type localAppRouteOptionInventoryStub struct {
	assets                    []*runtimev1.LocalAssetRecord
	imageComponents           map[string][]localservice.DurableLocalComponentSelection
	componentKinds            map[string]string
	componentPublicIdentities map[string]string
	materializedAssets        map[string]*runtimev1.LocalAssetRecord
	materializeInputs         *[][]localservice.DurableLocalComponentSelection
}

func (s localAppRouteOptionInventoryStub) ListLocalAssets(
	_ context.Context,
	request *runtimev1.ListLocalAssetsRequest,
) (*runtimev1.ListLocalAssetsResponse, error) {
	assets := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, asset := range s.assets {
		if asset != nil &&
			(request.GetStatusFilter() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED ||
				asset.GetStatus() == request.GetStatusFilter()) {
			assets = append(assets, proto.Clone(asset).(*runtimev1.LocalAssetRecord))
		}
	}
	return &runtimev1.ListLocalAssetsResponse{Assets: assets}, nil
}

func (s localAppRouteOptionInventoryStub) ResolveDurableLocalTarget(
	_ context.Context,
	target *runtimev1.RuntimeDurableLocalTargetRef,
	capability string,
) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error) {
	assets := append([]*runtimev1.LocalAssetRecord(nil), s.assets...)
	if materialized := s.materializedAssets[target.GetProfileBindingId()]; materialized != nil {
		assets = append(assets, materialized)
	}
	for _, asset := range assets {
		if asset == nil || !proto.Equal(asset.GetDurableTargetRef(), target) {
			continue
		}
		if !localAppAssetSupportsCapability(asset, capability) {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return &runtimev1.RuntimeResolvedLocalExecutionBinding{
			LocalAssetId:    asset.GetLocalAssetId(),
			ResolvedModelId: asset.GetLogicalModelId(),
		}, proto.Clone(asset).(*runtimev1.LocalAssetRecord), nil
	}
	return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (s localAppRouteOptionInventoryStub) ResolveDurableLocalComponentTarget(
	_ context.Context,
	target *runtimev1.RuntimeDurableLocalTargetRef,
	componentKind string,
) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error) {
	for _, asset := range s.assets {
		if asset == nil || !proto.Equal(asset.GetDurableTargetRef(), target) {
			continue
		}
		if kind := strings.TrimSpace(s.componentKinds[asset.GetLocalAssetId()]); kind != "" &&
			kind != strings.ToLower(strings.TrimSpace(componentKind)) {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		resolvedModelID := strings.TrimSpace(asset.GetLogicalModelId())
		if publicIdentity := strings.TrimSpace(s.componentPublicIdentities[asset.GetLocalAssetId()]); publicIdentity != "" {
			resolvedModelID = publicIdentity
		}
		return &runtimev1.RuntimeResolvedLocalExecutionBinding{
			LocalAssetId:    asset.GetLocalAssetId(),
			ResolvedModelId: resolvedModelID,
		}, proto.Clone(asset).(*runtimev1.LocalAssetRecord), nil
	}
	return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (s localAppRouteOptionInventoryStub) ValidateDurableLocalImageTargetComponents(
	_ context.Context,
	target *runtimev1.RuntimeDurableLocalTargetRef,
	components []localservice.DurableLocalComponentSelection,
) error {
	var main *runtimev1.LocalAssetRecord
	assets := append([]*runtimev1.LocalAssetRecord(nil), s.assets...)
	if materialized := s.materializedAssets[target.GetProfileBindingId()]; materialized != nil {
		assets = append(assets, materialized)
	}
	for _, asset := range assets {
		if asset != nil &&
			localAppAssetSupportsCapability(asset, aicapabilities.ImageGenerate) &&
			proto.Equal(asset.GetDurableTargetRef(), target) {
			main = asset
			break
		}
	}
	if main == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	expected := s.imageComponents[target.GetProfileBindingId()]
	if len(expected) != len(components) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	for index := range expected {
		left := expected[index]
		right := components[index]
		if err := localservice.ValidateDurableLocalImageComponentMetadata(
			main,
			right.ComponentKind,
			"",
			right.Weight,
			right.Options,
		); err != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		if left.OccurrenceID != right.OccurrenceID ||
			left.Order != right.Order ||
			left.Role != right.Role ||
			left.ComponentKind != right.ComponentKind ||
			left.LogicalModelID != right.LogicalModelID ||
			left.Required != right.Required ||
			left.Weight != right.Weight ||
			!proto.Equal(left.TargetRef, right.TargetRef) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
	}
	return nil
}

func (s localAppRouteOptionInventoryStub) MaterializeDurableLocalImageTarget(
	_ context.Context,
	baseTarget *runtimev1.RuntimeDurableLocalTargetRef,
	components []localservice.DurableLocalComponentSelection,
) (*runtimev1.RuntimeDurableLocalTargetRef, error) {
	expected := s.imageComponents[baseTarget.GetProfileBindingId()]
	if len(expected) != len(components) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	for index := range expected {
		left := expected[index]
		right := components[index]
		if left.OccurrenceID != right.OccurrenceID || left.Order != right.Order ||
			left.Role != right.Role || left.ComponentKind != right.ComponentKind || left.Required != right.Required {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
	}
	if s.materializeInputs != nil {
		cloned := append([]localservice.DurableLocalComponentSelection(nil), components...)
		*s.materializeInputs = append(*s.materializeInputs, cloned)
	}
	bindingID := fmt.Sprintf("test_workflow_binding:v2:materialized-%d", len(s.materializedAssets)+1)
	target := &runtimev1.RuntimeDurableLocalTargetRef{
		Version: "v2",
		Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
			ProfileBindingId: bindingID,
		},
	}
	if s.imageComponents != nil {
		s.imageComponents[bindingID] = append([]localservice.DurableLocalComponentSelection(nil), components...)
	}
	for _, asset := range s.assets {
		if asset == nil || !proto.Equal(asset.GetDurableTargetRef(), baseTarget) ||
			!localAppAssetSupportsCapability(asset, aicapabilities.ImageGenerate) {
			continue
		}
		materialized := proto.Clone(asset).(*runtimev1.LocalAssetRecord)
		materialized.DurableTargetRef = proto.Clone(target).(*runtimev1.RuntimeDurableLocalTargetRef)
		if s.materializedAssets != nil {
			s.materializedAssets[bindingID] = materialized
		}
		return target, nil
	}
	return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (s localAppRouteOptionInventoryStub) MaterializeDurableLocalImageTargetFromCommitted(
	ctx context.Context,
	committedTarget *runtimev1.RuntimeDurableLocalTargetRef,
	mainTarget *runtimev1.RuntimeDurableLocalTargetRef,
	components []localservice.DurableLocalComponentSelection,
) (*runtimev1.RuntimeDurableLocalTargetRef, error) {
	if committedTarget == nil || mainTarget == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	// The test inventory uses the same structural contract as Runtime: the
	// committed binding, not the new main readiness target, owns occurrences.
	expected := s.imageComponents[committedTarget.GetProfileBindingId()]
	if len(expected) != len(components) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	for index := range expected {
		left := expected[index]
		right := components[index]
		if left.OccurrenceID != right.OccurrenceID || left.Order != right.Order || left.Role != right.Role ||
			left.ComponentKind != right.ComponentKind || left.Required != right.Required {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
	}
	if s.materializeInputs != nil {
		cloned := append([]localservice.DurableLocalComponentSelection(nil), components...)
		*s.materializeInputs = append(*s.materializeInputs, cloned)
	}
	bindingID := fmt.Sprintf("test_workflow_binding:v2:materialized-%d", len(s.materializedAssets)+1)
	target := &runtimev1.RuntimeDurableLocalTargetRef{
		Version: "v2",
		Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: bindingID},
	}
	if s.imageComponents != nil {
		s.imageComponents[bindingID] = append([]localservice.DurableLocalComponentSelection(nil), components...)
	}
	for _, asset := range s.assets {
		if asset == nil || !proto.Equal(asset.GetDurableTargetRef(), mainTarget) ||
			!localAppAssetSupportsCapability(asset, aicapabilities.ImageGenerate) {
			continue
		}
		materialized := proto.Clone(asset).(*runtimev1.LocalAssetRecord)
		materialized.DurableTargetRef = proto.Clone(target).(*runtimev1.RuntimeDurableLocalTargetRef)
		if s.materializedAssets != nil {
			s.materializedAssets[bindingID] = materialized
		}
		return target, nil
	}
	_ = ctx
	return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

type localAppCloudRouteOptionInventoryStub struct {
	connectors []*runtimev1.Connector
	models     map[string][]*runtimev1.ConnectorModelDescriptor
}

func (s localAppCloudRouteOptionInventoryStub) ListConnectors(
	_ context.Context,
	request *runtimev1.ListConnectorsRequest,
) (*runtimev1.ListConnectorsResponse, error) {
	connectors := make([]*runtimev1.Connector, 0, len(s.connectors))
	for _, connector := range s.connectors {
		if connector == nil ||
			(request.GetKindFilter() != runtimev1.ConnectorKind_CONNECTOR_KIND_UNSPECIFIED && connector.GetKind() != request.GetKindFilter()) ||
			(request.GetStatusFilter() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED && connector.GetStatus() != request.GetStatusFilter()) ||
			(request.GetProviderFilter() != "" && connector.GetProvider() != request.GetProviderFilter()) {
			continue
		}
		connectors = append(connectors, proto.Clone(connector).(*runtimev1.Connector))
	}
	return &runtimev1.ListConnectorsResponse{Connectors: connectors}, nil
}

func (s localAppCloudRouteOptionInventoryStub) ListConnectorModels(
	_ context.Context,
	request *runtimev1.ListConnectorModelsRequest,
) (*runtimev1.ListConnectorModelsResponse, error) {
	models := s.models[request.GetConnectorId()]
	cloned := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		if model != nil {
			cloned = append(cloned, proto.Clone(model).(*runtimev1.ConnectorModelDescriptor))
		}
	}
	return &runtimev1.ListConnectorModelsResponse{Models: cloned}, nil
}

func newLocalAppComponentTestAgent(
	t *testing.T,
) (*Service, string, string, *localAppRouteOptionInventoryStub, *runtimev1.LocalAppAgentAIConfigProjection) {
	t.Helper()
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	prepared := readyRuntimeAgentAIProfileDescriptorResult()
	inventoryValue := runtimeAgentAIProfileTestRouteInventory(prepared)
	inventoryValue.componentKinds = map[string]string{
		"private-image-vae":          "vae",
		"private-image-text-encoder": "llm",
	}
	inventoryValue.materializedAssets = map[string]*runtimev1.LocalAssetRecord{}
	materializeInputs := make([][]localservice.DurableLocalComponentSelection, 0)
	inventoryValue.materializeInputs = &materializeInputs
	inventory := &inventoryValue
	svc.SetLocalAppRouteOptionInventory(inventory)
	setRuntimeAgentAIProfileDescriptorPreparer(svc, runtimeAgentAIProfileDescriptorPreparerStub{result: prepared})

	applied, err := svc.ApplyLocalAppAgentAIProfile(
		localAppConfigureContext(accountservice.LocalAppOperationAIProfileApply, localAgentRef, accountID),
		&runtimev1.ApplyLocalAppAgentAIProfileRequest{
			AgentHandle:                   "lah_v1_opaque",
			ExpectedConfigurationRevision: 1,
			ProfileJson:                   runtimeAgentAIProfileJSON("local/z-image-turbo"),
			RuntimeDescriptorJson:         []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
		},
	)
	if err != nil {
		t.Fatalf("ApplyLocalAppAgentAIProfile: %v", err)
	}
	if applied.GetProjection().GetConfigurationRevision() != 2 {
		t.Fatalf("applied Local App profile projection = %+v", applied.GetProjection())
	}
	return svc, localAgentRef, accountID, inventory, applied.GetProjection()
}

func localAppComponentTestImageIntent(
	t *testing.T,
	projection *runtimev1.LocalAppAgentAIConfigProjection,
) *runtimev1.LocalAppAgentAIConfigIntent {
	t.Helper()
	for _, intent := range projection.GetIntents() {
		if intent.GetCapability() == runtimeAgentAIConfigCapabilityImageGenerate {
			return intent
		}
	}
	t.Fatal("Local App image.generate intent missing")
	return nil
}

func cloneLocalAppAIConfigIntents(
	projection *runtimev1.LocalAppAgentAIConfigProjection,
) []*runtimev1.LocalAppAgentAIConfigIntent {
	out := make([]*runtimev1.LocalAppAgentAIConfigIntent, 0, len(projection.GetIntents()))
	for _, intent := range projection.GetIntents() {
		out = append(out, proto.Clone(intent).(*runtimev1.LocalAppAgentAIConfigIntent))
	}
	return out
}

func findLocalAppAIConfigIntent(
	intents []*runtimev1.LocalAppAgentAIConfigIntent,
	capability string,
) *runtimev1.LocalAppAgentAIConfigIntent {
	for _, intent := range intents {
		if intent.GetCapability() == capability {
			return intent
		}
	}
	return nil
}

func localAppComponentTestAsset(
	localAssetID string,
	logicalModelID string,
	status runtimev1.LocalAssetStatus,
) *runtimev1.LocalAssetRecord {
	return &runtimev1.LocalAssetRecord{
		LocalAssetId:        localAssetID,
		AssetId:             "private-asset-" + localAssetID,
		LogicalModelId:      logicalModelID,
		Status:              status,
		DurableTargetStatus: status,
		DurableTargetRef: &runtimev1.RuntimeDurableLocalTargetRef{
			Version: "v2",
			Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
				ReadinessRef: "test_runtime_readiness:v2:" + localAssetID,
			},
		},
	}
}

func TestLocalAppAIConfigComponentProjectionIsPublicAndShared(t *testing.T) {
	svc, localAgentRef, accountID, _, appliedProjection := newLocalAppComponentTestAgent(t)
	appliedImage := localAppComponentTestImageIntent(t, appliedProjection)
	if len(appliedImage.GetSelectedComponents()) != 2 {
		t.Fatalf("apply projection components = %+v", appliedImage.GetSelectedComponents())
	}
	var vae *runtimev1.LocalAppAgentAIConfigComponentSelection
	for _, component := range appliedImage.GetSelectedComponents() {
		if component.GetOccurrenceId() == "image-vae" {
			vae = component
			break
		}
	}
	if vae == nil || vae.GetOrder() != 1 || vae.GetRole() != "vae" ||
		vae.GetComponentKind() != "vae" || strings.TrimSpace(vae.GetLogicalModelId()) == "" ||
		!vae.GetRequired() || vae.GetWeight() != "" || len(vae.GetOptions().GetFields()) != 0 {
		t.Fatalf("apply projection public VAE fields = %+v", vae)
	}

	snapshot, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshotImage := localAppComponentTestImageIntent(t, snapshot.GetProjection())
	if !proto.Equal(appliedImage.GetSelectedComponents()[0], snapshotImage.GetSelectedComponents()[0]) ||
		!proto.Equal(appliedImage.GetSelectedComponents()[1], snapshotImage.GetSelectedComponents()[1]) {
		t.Fatalf("snapshot and apply component projections differ: apply=%+v snapshot=%+v", appliedImage, snapshotImage)
	}

	descriptor := vae.ProtoReflect().Descriptor().Fields()
	allowed := map[protoreflect.Name]bool{
		"occurrence_id": true, "order": true, "role": true, "component_kind": true,
		"logical_model_id": true, "required": true, "weight": true, "options": true,
	}
	if descriptor.Len() != len(allowed) {
		t.Fatalf("Local App component field count = %d, want %d", descriptor.Len(), len(allowed))
	}
	for index := 0; index < descriptor.Len(); index++ {
		if !allowed[descriptor.Get(index).Name()] {
			t.Fatalf("Local App component exposes private field %s", descriptor.Get(index).Name())
		}
	}

	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	unsafe := proto.Clone(
		requireAgentAIConfigIntent(t, committed, runtimeAgentAIConfigCapabilityImageGenerate).GetSelectedComponents()[0],
	).(*runtimev1.RuntimeAgentAIConfigComponentSelection)
	unsafe.LogicalModelId = "01JPRIVATELOCALASSETIDENTITY000"
	if projected := svc.localAppAIConfigComponentProjection(context.Background(), unsafe); projected != nil {
		t.Fatalf("unsafe component logical identity was projected: %+v", projected)
	}
	unsafe = proto.Clone(
		requireAgentAIConfigIntent(t, committed, runtimeAgentAIConfigCapabilityImageGenerate).GetSelectedComponents()[0],
	).(*runtimev1.RuntimeAgentAIConfigComponentSelection)
	unsafe.Options, err = structpb.NewStruct(map[string]any{"endpoint": "https://private.invalid"})
	if err != nil {
		t.Fatalf("private component options: %v", err)
	}
	if projected := svc.localAppAIConfigComponentProjection(context.Background(), unsafe); projected != nil {
		t.Fatalf("private component endpoint was projected: %+v", projected)
	}
}

func TestLocalAppAIProfilePreviewProjectsPublicComponents(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	prepared := readyRuntimeAgentAIProfileDescriptorResult()
	inventory := runtimeAgentAIProfileTestRouteInventory(prepared)
	svc.SetLocalAppRouteOptionInventory(&inventory)
	setRuntimeAgentAIProfileDescriptorPreparer(svc, runtimeAgentAIProfileDescriptorPreparerStub{result: prepared})

	preview, err := svc.PreviewLocalAppAgentAIProfile(
		localAppConfigureContext(accountservice.LocalAppOperationAIProfilePreview, localAgentRef, accountID),
		&runtimev1.PreviewLocalAppAgentAIProfileRequest{
			AgentHandle:           "lah_v1_opaque",
			ProfileJson:           runtimeAgentAIProfileJSON("local/z-image-turbo"),
			RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	image := localAppComponentTestImageIntent(t, preview.GetAfter())
	if len(image.GetSelectedComponents()) != 2 ||
		image.GetSelectedComponents()[0].GetOccurrenceId() != "image-text-encoder" ||
		image.GetSelectedComponents()[0].GetOrder() != 0 ||
		image.GetSelectedComponents()[0].GetLogicalModelId() != "local/qwen3-4b-q4_k_m" ||
		image.GetSelectedComponents()[1].GetOccurrenceId() != "image-vae" ||
		image.GetSelectedComponents()[1].GetOrder() != 1 ||
		image.GetSelectedComponents()[1].GetLogicalModelId() != "nimi/component/vae/sha256-"+strings.Repeat("a", 64) {
		t.Fatalf("Local App AIProfile preview components = %+v", image.GetSelectedComponents())
	}
}

func TestLocalAppConfigurationUnchangedComponentsPreserveExactTargets(t *testing.T) {
	svc, localAgentRef, accountID, inventory, projection := newLocalAppComponentTestAgent(t)
	before, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	beforeImage := requireAgentAIConfigIntent(t, before, runtimeAgentAIConfigCapabilityImageGenerate)
	beforeTarget := proto.Clone(beforeImage.GetTargetRef()).(*runtimev1.RuntimeDurableTargetRef)
	beforeComponents := make([]*runtimev1.RuntimeAgentAIConfigComponentSelection, len(beforeImage.GetSelectedComponents()))
	for index, component := range beforeImage.GetSelectedComponents() {
		beforeComponents[index] = proto.Clone(component).(*runtimev1.RuntimeAgentAIConfigComponentSelection)
	}

	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle:                   "lah_v1_opaque",
			ExpectedConfigurationRevision: 2,
			Intents:                       cloneLocalAppAIConfigIntents(projection),
			ProfileOrigin:                 projection.GetProfileOrigin(),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	after, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	afterImage := requireAgentAIConfigIntent(t, after, runtimeAgentAIConfigCapabilityImageGenerate)
	if response.GetProjection().GetConfigurationRevision() != 3 || after.GetRevision() != 3 ||
		!proto.Equal(beforeTarget, afterImage.GetTargetRef()) ||
		!runtimeAgentAIConfigComponentsEqual(beforeComponents, afterImage.GetSelectedComponents()) {
		t.Fatalf("unchanged component commit changed private targets: before=%+v after=%+v", beforeImage, afterImage)
	}
	if len(*inventory.materializeInputs) != 0 {
		t.Fatalf("unchanged components rematerialized: %+v", *inventory.materializeInputs)
	}
}

func TestLocalAppConfigurationChangedComponentMaterializesNewExactBinding(t *testing.T) {
	svc, localAgentRef, accountID, inventory, projection := newLocalAppComponentTestAgent(t)
	alternate := localAppComponentTestAsset("private-image-vae-alt", "local/z-image-vae-alt", runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	inventory.assets = append(inventory.assets, alternate)
	inventory.componentKinds[alternate.GetLocalAssetId()] = "vae"
	intents := cloneLocalAppAIConfigIntents(projection)
	image := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate)
	changedComponentIndex := -1
	for index, component := range image.GetSelectedComponents() {
		if component.GetOccurrenceId() == "image-vae" {
			changedComponentIndex = index
			component.LogicalModelId = alternate.GetLogicalModelId()
			break
		}
	}
	if changedComponentIndex < 0 {
		t.Fatal("committed image VAE occurrence missing")
	}

	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 2, Intents: intents,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	committedImage := requireAgentAIConfigIntent(t, committed, runtimeAgentAIConfigCapabilityImageGenerate)
	if response.GetProjection().GetConfigurationRevision() != 3 || len(*inventory.materializeInputs) != 1 {
		t.Fatalf("changed component did not materialize once: config=%+v calls=%+v", committedImage, *inventory.materializeInputs)
	}
	materializedComponent := (*inventory.materializeInputs)[0][changedComponentIndex]
	if materializedComponent.LogicalModelID != alternate.GetLogicalModelId() ||
		!proto.Equal(materializedComponent.TargetRef, alternate.GetDurableTargetRef()) ||
		committedImage.GetTargetRef().GetLocalRuntime().GetProfileBindingId() ==
			"test_workflow_binding:v2:z-image-turbo" {
		t.Fatalf("changed component was not materialized into a new exact binding: config=%+v calls=%+v", committedImage, *inventory.materializeInputs)
	}
}

func TestLocalAppConfigurationMainModelChangeMaterializesNewExactBinding(t *testing.T) {
	svc, localAgentRef, accountID, inventory, projection := newLocalAppComponentTestAgent(t)
	mainAlternate := localAppComponentTestAsset("private-image-main-alt", "local/z-image-turbo-alt", runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	mainAlternate.Capabilities = []string{runtimeAgentAIConfigCapabilityImageGenerate}
	inventory.assets = append(inventory.assets, mainAlternate)
	beforeImage := localAppComponentTestImageIntent(t, projection)
	beforeBindingID := beforeImage.GetLogicalModelId()
	intents := cloneLocalAppAIConfigIntents(projection)
	image := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate)
	image.LogicalModelId = mainAlternate.GetLogicalModelId()

	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 2, Intents: intents,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	committedImage := requireAgentAIConfigIntent(t, committed, runtimeAgentAIConfigCapabilityImageGenerate)
	if response.GetProjection().GetConfigurationRevision() != 3 || len(*inventory.materializeInputs) != 1 ||
		committedImage.GetModelId() != mainAlternate.GetLogicalModelId() ||
		committedImage.GetModelId() == beforeBindingID ||
		committedImage.GetTargetRef().GetLocalRuntime().GetProfileBindingId() == "test_workflow_binding:v2:z-image-turbo" {
		t.Fatalf("main model change was not materialized into a new exact binding: config=%+v calls=%+v", committedImage, *inventory.materializeInputs)
	}
}

func TestLocalAppComponentMaterializationRejectsCloudRouteWithExistingComponents(t *testing.T) {
	svc, localAgentRef, _, _, _ := newLocalAppComponentTestAgent(t)
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	image := requireAgentAIConfigIntent(t, committed, runtimeAgentAIConfigCapabilityImageGenerate)
	cloud := proto.Clone(image).(*runtimev1.RuntimeAgentAIConfigIntent)
	cloud.RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
	cloud.Provider = "openai"
	cloud.ModelId = "gpt-image-1"
	cloud.TargetRef = runtimeAgentAIConfigTestCloudTarget("cloud-openai", "openai", "gpt-image-1")
	_, err = svc.materializeLocalAppComponentTargets(context.Background(), []*runtimev1.RuntimeAgentAIConfigIntent{cloud})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("cloud route with existing local components code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("cloud route with existing local components reason = %s, present=%v", reason, ok)
	}
}

func TestLocalAppConfigurationComponentLookupFailuresDoNotAdvanceRevision(t *testing.T) {
	svc, localAgentRef, accountID, inventory, projection := newLocalAppComponentTestAgent(t)
	ambiguousModel := "local/z-image-vae-ambiguous"
	for _, id := range []string{"private-ambiguous-a", "private-ambiguous-b"} {
		asset := localAppComponentTestAsset(id, ambiguousModel, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
		inventory.assets = append(inventory.assets, asset)
		inventory.componentKinds[id] = "vae"
	}
	for _, test := range []struct {
		name  string
		model string
	}{
		{name: "missing", model: "local/z-image-vae-missing"},
		{name: "ambiguous", model: ambiguousModel},
		{name: "private-asset-ulid", model: "01JPRIVATEASSETULID0000000000"},
	} {
		t.Run(test.name, func(t *testing.T) {
			intents := cloneLocalAppAIConfigIntents(projection)
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).
				SelectedComponents[0].LogicalModelId = test.model
			_, err := svc.UpdateLocalAppAgentConfiguration(
				localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
				&runtimev1.UpdateLocalAppAgentConfigurationRequest{
					AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 2, Intents: intents,
				},
			)
			if status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("component lookup code = %s, err=%v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
				t.Fatalf("component lookup reason = %s, present=%v", reason, ok)
			}
			committed, commitErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
			if commitErr != nil || committed.GetRevision() != 2 {
				t.Fatalf("failed component lookup advanced revision: config=%+v err=%v", committed, commitErr)
			}
		})
	}
}

func TestLocalAppConfigurationRejectsComponentStructureChangesAndNonImageComponents(t *testing.T) {
	svc, localAgentRef, accountID, _, projection := newLocalAppComponentTestAgent(t)
	mutations := []struct {
		name   string
		mutate func([]*runtimev1.LocalAppAgentAIConfigIntent)
	}{
		{name: "add", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			image := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate)
			image.SelectedComponents = append(image.SelectedComponents, proto.Clone(image.SelectedComponents[0]).(*runtimev1.LocalAppAgentAIConfigComponentSelection))
		}},
		{name: "delete", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			image := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate)
			image.SelectedComponents = image.SelectedComponents[:1]
		}},
		{name: "order", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0].Order = 9
		}},
		{name: "role", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0].Role = "decoder"
		}},
		{name: "kind", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0].ComponentKind = "vae"
		}},
		{name: "required", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0].Required = false
		}},
		{name: "weight", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0].Weight = "0.5"
		}},
		{name: "options", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			component := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0]
			if component.Options == nil {
				component.Options = &structpb.Struct{Fields: map[string]*structpb.Value{}}
			}
			options := component.Options
			options.Fields["precision"] = structpb.NewStringValue("int8")
		}},
		{name: "non-image", mutate: func(intents []*runtimev1.LocalAppAgentAIConfigIntent) {
			text := findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityTextGenerate)
			text.SelectedComponents = []*runtimev1.LocalAppAgentAIConfigComponentSelection{
				proto.Clone(findLocalAppAIConfigIntent(intents, runtimeAgentAIConfigCapabilityImageGenerate).SelectedComponents[0]).(*runtimev1.LocalAppAgentAIConfigComponentSelection),
			}
		}},
	}
	for _, test := range mutations {
		t.Run(test.name, func(t *testing.T) {
			intents := cloneLocalAppAIConfigIntents(projection)
			test.mutate(intents)
			_, err := svc.UpdateLocalAppAgentConfiguration(
				localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
				&runtimev1.UpdateLocalAppAgentConfigurationRequest{
					AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 2, Intents: intents,
				},
			)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("structure mutation code = %s, err=%v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("structure mutation reason = %s, present=%v", reason, ok)
			}
			committed, commitErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
			if commitErr != nil || committed.GetRevision() != 2 {
				t.Fatalf("structure mutation advanced revision: config=%+v err=%v", committed, commitErr)
			}
		})
	}
}

func TestLocalAppConfigureHandlerDenialPreservesPermissionID(t *testing.T) {
	svc, _, _ := newLocalAppConfigureTestAgent(t)
	_, err := svc.GetLocalAppAgentConfigurationSnapshot(context.Background(), &runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"})
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["permission_id"] != "agents.configure" || metadata["permission_reason"] != "denied" {
		t.Fatalf("direct configure denial metadata = %#v, %v (err=%v)", metadata, ok, err)
	}
}

func TestLocalAppConfigurationSnapshotIsDedicatedTypedProjection(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	response, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	projection := response.GetProjection()
	if projection.GetConfigurationRevision() != 1 || len(projection.GetIntents()) != 0 {
		t.Fatalf("model settings projection = %+v", projection)
	}
	if len(projection.GetCapabilities()) != len(admittedRuntimeAgentAIConfigCapabilities) {
		t.Fatalf("capability projection = %v, want Runtime readiness capabilities %v", projection.GetCapabilities(), admittedRuntimeAgentAIConfigCapabilities)
	}
	foundTranscribe := false
	for _, capability := range projection.GetCapabilities() {
		foundTranscribe = foundTranscribe || capability == aicapabilities.AudioTranscribe
	}
	if !foundTranscribe {
		t.Fatalf("canonical audio.transcribe missing from %v", projection.GetCapabilities())
	}
	if len(projection.GetRouteOptions()) != 8 {
		t.Fatalf("seeded selectable route options = %+v", projection.GetRouteOptions())
	}
}

func TestLocalAppConfigurationSnapshotProjectsOnlyBoundedSelectableRouteOptions(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	targetFor := func(id string) *runtimev1.RuntimeDurableLocalTargetRef {
		return &runtimev1.RuntimeDurableLocalTargetRef{
			Version: "v2",
			Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
				ReadinessRef: "test_runtime_readiness:v2:" + id,
			},
		}
	}
	svc.SetLocalAppRouteOptionInventory(localAppRouteOptionInventoryStub{assets: []*runtimev1.LocalAssetRecord{
		{
			LocalAssetId:        "private-local-asset-id",
			AssetId:             "configured-private-asset-id",
			LogicalModelId:      "local.chat.gemma-test",
			DisplayName:         "Gemma Test",
			Endpoint:            "http://127.0.0.1:9999/private",
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{aicapabilities.TextGenerate},
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetRef:    targetFor("configured"),
		},
		{
			LocalAssetId:        "unconfigured-private-local-asset-id",
			AssetId:             "private-asset-id",
			LogicalModelId:      "local.chat.other",
			DisplayName:         "Other Chat",
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{aicapabilities.TextGenerate},
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetRef:    targetFor("other"),
		},
		{
			LocalAssetId:        "private-embed-local-asset-id",
			LogicalModelId:      "local.embed.test",
			DisplayName:         "Embedding Test",
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Capabilities:        []string{aicapabilities.TextEmbed},
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			DurableTargetRef:    targetFor("embed"),
		},
		{
			LogicalModelId: "local.unhealthy",
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			Capabilities:   []string{aicapabilities.TextGenerate},
		},
	}})
	current, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	historical := proto.Clone(current).(*runtimev1.RuntimeAgentAIConfig)
	historical.Revision = current.GetRevision() + 1
	historical.Intents = []*runtimev1.RuntimeAgentAIConfigIntent{{
		Capability:  aicapabilities.TextGenerate,
		ModelId:     "configured-private-asset-id",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		SelectedParams: func() *structpb.Struct {
			value, _ := structpb.NewStruct(map[string]any{
				"local.asset.id": "private-history",
				"endpoint":       "https://private.invalid",
				"accessKeyId":    "private-history-key",
			})
			return value
		}(),
		TargetRef: &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
				LocalRuntime: targetFor("configured"),
			},
		},
	}}
	historical.UpdatedByAppId = "historical-pre-hard-cut"
	if err := svc.agentAIConfigRepo.commitMutation(localAgentRef, current.GetRevision(), historical); err != nil {
		t.Fatal(err)
	}
	if err := svc.refreshRuntimeAgentAIConfigReadiness(localAgentRef); err != nil {
		t.Fatal(err)
	}
	response, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	options := response.GetProjection().GetRouteOptions()
	if len(options) != 3 {
		t.Fatalf("bounded route options = %+v", options)
	}
	var foundActive, foundOther, foundInstalled bool
	for _, option := range options {
		if option.GetProvider() != "" || option.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			t.Fatalf("local option exposed non-local route material: %+v", option)
		}
		switch option.GetLogicalModelId() {
		case "configured-private-asset-id":
			t.Fatalf("historical private model identity escaped: %+v", option)
		case "local.chat.gemma-test":
			foundActive = option.GetLabel() == "Gemma Test" &&
				option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
		case "local.chat.other":
			foundOther = option.GetLabel() == "Other Chat" &&
				option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
		case "local.embed.test":
			foundInstalled = option.GetLabel() == "Embedding Test" &&
				option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
		case "local.unhealthy", "private-local-asset-id", "unconfigured-private-local-asset-id", "private-asset-id", "http://127.0.0.1:9999/private":
			t.Fatalf("private or unselectable inventory material escaped: %+v", option)
		}
	}
	for _, intent := range response.GetProjection().GetIntents() {
		if intent.GetLogicalModelId() == "configured-private-asset-id" {
			t.Fatalf("historical private model identity escaped intent projection: %+v", intent)
		}
	}
	if !foundActive || !foundOther || !foundInstalled {
		t.Fatalf("selectable inventory candidates missing: %+v", options)
	}
}

func TestLocalAppConfigurationSnapshotProjectsSelectableCloudRouteOptions(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	svc.SetLocalAppCloudRouteOptionInventory(localAppCloudRouteOptionInventoryStub{
		connectors: []*runtimev1.Connector{
			{
				ConnectorId: "private-openai-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
				Provider: "openai", Label: "OpenAI", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			},
			{
				ConnectorId: "private-dashscope-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
				Provider: "dashscope", Label: "DashScope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			},
			{
				ConnectorId: "private-disabled-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
				Provider: "disabled", Label: "Disabled", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED,
			},
		},
		models: map[string][]*runtimev1.ConnectorModelDescriptor{
			"private-openai-connector": {{
				ModelId: "gpt-5-mini", ModelLabel: "GPT-5 mini", Available: true,
				Capabilities: []string{aicapabilities.TextGenerate}, RemoteModelCatalogId: "openai/gpt-5-mini",
				ProviderModelId: "gpt-5-mini", Provider: "openai",
			}},
			"private-dashscope-connector": {{
				ModelId: "qwen-plus", ModelLabel: "Qwen Plus", Available: true,
				Capabilities: []string{aicapabilities.TextGenerate}, RemoteModelCatalogId: "dashscope/qwen-plus",
				ProviderModelId: "qwen-plus", Provider: "dashscope",
			}},
		},
	})

	response, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	cloudOptions := make(map[string]*runtimev1.LocalAppAgentRouteOption)
	for _, option := range response.GetProjection().GetRouteOptions() {
		if option.GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
			cloudOptions[option.GetProvider()] = option
		}
	}
	if len(cloudOptions) != 2 ||
		cloudOptions["openai"].GetLogicalModelId() != "gpt-5-mini" ||
		cloudOptions["openai"].GetLabel() != "GPT-5 mini" ||
		cloudOptions["dashscope"].GetLogicalModelId() != "qwen-plus" ||
		cloudOptions["dashscope"].GetLabel() != "Qwen Plus" {
		t.Fatalf("selectable cloud route options = %+v", cloudOptions)
	}
}

func TestLocalAppConfigurationMaterializesSelectedCloudRouteTarget(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	svc.SetLocalAppCloudRouteOptionInventory(localAppCloudRouteOptionInventoryStub{
		connectors: []*runtimev1.Connector{{
			ConnectorId: "private-openai-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			Provider: "openai", Label: "OpenAI", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}},
		models: map[string][]*runtimev1.ConnectorModelDescriptor{
			"private-openai-connector": {{
				ModelId: "gpt-5-mini", ModelLabel: "GPT-5 mini", Available: true,
				Capabilities: []string{aicapabilities.TextGenerate}, RemoteModelCatalogId: "openai/gpt-5-mini",
				ProviderModelId: "gpt-5-mini", Provider: "openai",
			}},
		},
	})

	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle:                   "lah_v1_opaque",
			ExpectedConfigurationRevision: 1,
			Intents: []*runtimev1.LocalAppAgentAIConfigIntent{
				{Capability: aicapabilities.TextGenerate, Provider: "openai", LogicalModelId: "gpt-5-mini", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD},
				{Capability: aicapabilities.TextEmbed, LogicalModelId: runtimeAgentAIConfigTestEmbedModel, RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetProjection().GetConfigurationRevision() != 2 {
		t.Fatalf("configuration revision = %d", response.GetProjection().GetConfigurationRevision())
	}
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	text := requireAgentAIConfigIntent(t, committed, aicapabilities.TextGenerate)
	cloud := text.GetTargetRef().GetCloud()
	if cloud.GetVersion() != "v2" || cloud.GetConnectorId() != "private-openai-connector" ||
		cloud.GetRemoteModelCatalogId() != "openai/gpt-5-mini" || cloud.GetProviderModelId() != "gpt-5-mini" ||
		cloud.GetProvider() != "openai" {
		t.Fatalf("materialized cloud target = %+v", cloud)
	}
	embed := requireAgentAIConfigIntent(t, committed, aicapabilities.TextEmbed)
	if embed.GetModelId() != runtimeAgentAIConfigTestEmbedModel ||
		embed.GetTargetRef().GetLocalRuntime().GetReadinessRef() != "test_runtime_readiness:v2:default-embed" {
		t.Fatalf("materialized local embed target = %+v", embed)
	}
}

func TestLocalAppConfigurationMaterializesInstalledImageTargetAsConfiguredUnverified(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	svc.SetLocalAppRouteOptionInventory(localAppRouteOptionInventoryStub{assets: []*runtimev1.LocalAssetRecord{{
		LocalAssetId:        "private-image-local-asset",
		AssetId:             "private-image-asset",
		LogicalModelId:      "local.image.z-image-turbo",
		DisplayName:         "Z Image Turbo",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Capabilities:        []string{aicapabilities.ImageGenerate},
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		DurableTargetRef: &runtimev1.RuntimeDurableLocalTargetRef{
			Version: "v2",
			Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
				ProfileBindingId: "workflow_binding:profile_workflow:v2:z-image-turbo",
			},
		},
	}}})
	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle:                   "lah_v1_opaque",
			ExpectedConfigurationRevision: 1,
			Intents: []*runtimev1.LocalAppAgentAIConfigIntent{
				{Capability: aicapabilities.ImageGenerate, LogicalModelId: "local.image.z-image-turbo", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	image := requireAgentAIConfigIntent(t, committed, aicapabilities.ImageGenerate)
	if image.GetModelId() != "local.image.z-image-turbo" ||
		image.GetTargetRef().GetLocalRuntime().GetVersion() != "v2" ||
		image.GetTargetRef().GetLocalRuntime().GetProfileBindingId() != "workflow_binding:profile_workflow:v2:z-image-turbo" {
		t.Fatalf("materialized image intent = %+v", image)
	}
	projection := response.GetProjection()
	var imageReadiness *runtimev1.LocalAppAgentCapabilityReadiness
	for _, readiness := range projection.GetReadiness() {
		if readiness.GetCapability() == aicapabilities.ImageGenerate {
			imageReadiness = readiness
			break
		}
	}
	if imageReadiness == nil ||
		imageReadiness.GetState() != runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_CONFIGURED_UNVERIFIED ||
		imageReadiness.GetReason() != agentAIConfigReadinessReasonImageConfiguredUnverified ||
		imageReadiness.GetObservedAt() != nil {
		t.Fatalf("installed image Local App readiness = %+v", imageReadiness)
	}
	for _, intent := range projection.GetIntents() {
		if intent.GetLogicalModelId() == "private-image-local-asset" || intent.GetLogicalModelId() == "private-image-asset" {
			t.Fatalf("private image identity escaped route intent: %+v", intent)
		}
	}
	foundConfiguredImageOption := false
	for _, option := range projection.GetRouteOptions() {
		if option.GetLogicalModelId() == "private-image-local-asset" || option.GetLogicalModelId() == "private-image-asset" {
			t.Fatalf("private image identity escaped route option: %+v", option)
		}
		if option.GetLogicalModelId() == "local.image.z-image-turbo" {
			foundConfiguredImageOption = option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
		}
	}
	if !foundConfiguredImageOption {
		t.Fatalf("installed configured image route option missing: %+v", projection.GetRouteOptions())
	}
}

func TestLocalAppConfigurationRejectsUnselectableOrAmbiguousImageRoute(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		assets []*runtimev1.LocalAssetRecord
	}{
		{
			name: "unhealthy",
			assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId:   "unhealthy-image",
				LogicalModelId: "local.image.z-image-turbo",
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				Capabilities:   []string{aicapabilities.ImageGenerate},
			}},
		},
		{
			name: "ambiguous",
			assets: []*runtimev1.LocalAssetRecord{
				{
					LocalAssetId:        "image-a",
					LogicalModelId:      "local.image.z-image-turbo",
					Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Capabilities:        []string{aicapabilities.ImageGenerate},
					DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					DurableTargetRef: &runtimev1.RuntimeDurableLocalTargetRef{
						Version: "v2",
						Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
							ProfileBindingId: "workflow_binding:profile_workflow:v2:image-a",
						},
					},
				},
				{
					LocalAssetId:        "image-b",
					LogicalModelId:      "local.image.z-image-turbo",
					Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Capabilities:        []string{aicapabilities.ImageGenerate},
					DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					DurableTargetRef: &runtimev1.RuntimeDurableLocalTargetRef{
						Version: "v2",
						Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
							ProfileBindingId: "workflow_binding:profile_workflow:v2:image-b",
						},
					},
				},
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
			svc.SetLocalAppRouteOptionInventory(localAppRouteOptionInventoryStub{assets: testCase.assets})
			_, err := svc.UpdateLocalAppAgentConfiguration(
				localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
				&runtimev1.UpdateLocalAppAgentConfigurationRequest{
					AgentHandle:                   "lah_v1_opaque",
					ExpectedConfigurationRevision: 1,
					Intents: []*runtimev1.LocalAppAgentAIConfigIntent{
						{Capability: aicapabilities.ImageGenerate, LogicalModelId: "local.image.z-image-turbo", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
					},
				},
			)
			if status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("code = %s, err=%v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
				t.Fatalf("reason = %s, %v", reason, ok)
			}
			config, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
			if loadErr != nil || config.GetRevision() != 1 {
				t.Fatalf("rejected image route mutated config = (%+v, %v)", config, loadErr)
			}
		})
	}
}

func TestLocalAppRouteOptionKeepsReadyAvailabilityWhenInstalledInventoryEnrichesLabel(t *testing.T) {
	options := make(map[string]*runtimev1.LocalAppAgentRouteOption)
	addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
		Capability:     aicapabilities.TextGenerate,
		LogicalModelId: "opaque-configured-model",
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Label:          "opaque-configured-model",
		Availability:   runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY,
	})
	addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
		Capability:     aicapabilities.TextGenerate,
		LogicalModelId: "opaque-configured-model",
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Label:          "Gemma 4 26B",
		Availability:   runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED,
	})
	if len(options) != 1 {
		t.Fatalf("merged options = %+v", options)
	}
	for _, option := range options {
		if option.GetAvailability() != runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY {
			t.Fatalf("merged availability = %s", option.GetAvailability())
		}
		if option.GetLabel() != "Gemma 4 26B" {
			t.Fatalf("merged label = %q", option.GetLabel())
		}
	}
}

func TestLocalAppConfigurationRouteOnlyUpdatePreservesRuntimeOwnedIntentFields(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	svc.SetLocalAppRouteOptionInventory(localAppRouteOptionInventoryStub{assets: []*runtimev1.LocalAssetRecord{{
		LocalAssetId:        "runtime-owned-local-asset",
		LogicalModelId:      "local.image.z-image-turbo",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{aicapabilities.ImageGenerate},
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetRef: &runtimev1.RuntimeDurableLocalTargetRef{
			Version: "v2",
			Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
				ProfileBindingId: "workflow_binding:profile_workflow:v2:runtime-owned",
			},
		},
	}}})
	entry, err := svc.agentByID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	current, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	intents := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(current.GetIntents())+1)
	for _, intent := range current.GetIntents() {
		intents = append(intents, proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent))
	}
	intents = append(intents, &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:        aicapabilities.ImageGenerate,
		ModelId:           "local.image.z-image-turbo",
		RoutePolicy:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ConnectorId:       "runtime-owned-connector",
		VoiceReferenceRef: "runtime-owned-voice",
		ImagePolicyRef:    "runtime-owned-image-policy",
		TargetRef: &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
				LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
					Version: "v2",
					Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
						ProfileBindingId: "workflow_binding:profile_workflow:v2:runtime-owned",
					},
				},
			},
		},
	})
	seeded, err := svc.upsertRuntimeAgentAIConfig(&runtimev1.AgentRequestContext{
		AppId:            "desktop.app",
		SubjectUserId:    accountID,
		OwnerUserId:      accountID,
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(),
		LocalAgentRef:    localAgentRef,
	}, current.GetRevision(), intents, current.GetProfileOrigin())
	if err != nil {
		t.Fatal(err)
	}

	routeIntents := make([]*runtimev1.LocalAppAgentAIConfigIntent, 0, len(seeded.GetIntents()))
	for _, intent := range seeded.GetIntents() {
		model := intent.GetModelId()
		provider := intent.GetProvider()
		if cloud := intent.GetTargetRef().GetCloud(); cloud != nil {
			if cloud.GetProviderModelId() != "" {
				model = cloud.GetProviderModelId()
			}
			if provider == "" {
				provider = cloud.GetProvider()
			}
		}
		routeIntents = append(routeIntents, &runtimev1.LocalAppAgentAIConfigIntent{
			Capability:     intent.GetCapability(),
			LogicalModelId: model,
			Provider:       provider,
			RoutePolicy:    intent.GetRoutePolicy(),
		})
	}
	response, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle:                   "lah_v1_opaque",
			ExpectedConfigurationRevision: seeded.GetRevision(),
			Intents:                       routeIntents,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	var image *runtimev1.RuntimeAgentAIConfigIntent
	for _, intent := range committed.GetIntents() {
		if intent.GetCapability() == aicapabilities.ImageGenerate {
			image = intent
			break
		}
	}
	if image == nil ||
		image.GetConnectorId() != "runtime-owned-connector" ||
		image.GetVoiceReferenceRef() != "runtime-owned-voice" ||
		image.GetImagePolicyRef() != "runtime-owned-image-policy" ||
		image.GetTargetRef().GetLocalRuntime().GetProfileBindingId() != "workflow_binding:profile_workflow:v2:runtime-owned" ||
		response.GetProjection().GetConfigurationRevision() != committed.GetRevision() {
		t.Fatalf("route-only update discarded Runtime-owned intent fields: %+v", image)
	}
}

func TestLocalAppConfigurationRejectsWorkflowDefinitionsInSelectedParamsWithoutRevisionAdvance(t *testing.T) {
	for _, reservedKey := range runtimeAgentAIConfigReservedSelectedParamKeys {
		t.Run(reservedKey, func(t *testing.T) {
			svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
			selectedParams, err := structpb.NewStruct(map[string]any{reservedKey: map[string]any{"caller": "workflow"}})
			if err != nil {
				t.Fatalf("selected params: %v", err)
			}
			_, err = svc.UpdateLocalAppAgentConfiguration(
				localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
				&runtimev1.UpdateLocalAppAgentConfigurationRequest{
					AgentHandle:                   "lah_v1_opaque",
					ExpectedConfigurationRevision: 1,
					Intents: []*runtimev1.LocalAppAgentAIConfigIntent{{
						Capability:     aicapabilities.TextGenerate,
						LogicalModelId: "local/default",
						RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
						SelectedParams: selectedParams,
					}},
				},
			)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("reason = %s, present=%v; want PROTOCOL_ENVELOPE_INVALID", reason, ok)
			}
			committed, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
			if loadErr != nil || committed.GetRevision() != 1 || len(committed.GetIntents()) != 0 {
				t.Fatalf("rejected selected params advanced config: config=%+v err=%v", committed, loadErr)
			}
		})
	}
}

func TestLocalAppConfigurationUpdateReturnsTypedCASConflict(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID)
	intents := []*runtimev1.LocalAppAgentAIConfigIntent{
		{Capability: aicapabilities.TextGenerate, LogicalModelId: "local/default", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
	}
	response, err := svc.UpdateLocalAppAgentConfiguration(ctx, &runtimev1.UpdateLocalAppAgentConfigurationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1, Intents: intents,
	})
	if err != nil || response.GetProjection().GetConfigurationRevision() != 2 {
		t.Fatalf("configuration update = (%+v, %v)", response, err)
	}
	_, err = svc.UpdateLocalAppAgentConfiguration(ctx, &runtimev1.UpdateLocalAppAgentConfigurationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1, Intents: intents,
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale config update code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT {
		t.Fatalf("stale config reason = %s, %v", reason, ok)
	}
}

func TestLocalAppConfigurationRejectsUnsupportedCanonicalRouteWithoutMutation(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	_, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1,
			Intents: []*runtimev1.LocalAppAgentAIConfigIntent{{Capability: aicapabilities.ImageEdit, LogicalModelId: "local/editor", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}},
		},
	)
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("unsupported typed route code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unsupported typed route reason = %s, %v", reason, ok)
	}
	config, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil || config.GetRevision() != 1 {
		t.Fatalf("unsupported route mutated config = (%+v, %v)", config, err)
	}
}

func TestLocalAppAutonomyUpdateIsAtomicCAS(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	snapshot, err := svc.GetLocalAppAgentAutonomySnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationAutonomySnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	revision := snapshot.GetProjection().GetAutonomyRevision()
	ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateAutonomy, localAgentRef, accountID)
	response, err := svc.UpdateLocalAppAgentAutonomy(ctx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: "lah_v1_opaque", ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(true), Config: &runtimev1.LocalAppAgentAutonomyConfig{
			Mode: runtimev1.LocalAppAgentAutonomyMode_LOCAL_APP_AGENT_AUTONOMY_MODE_LOW, DailyTokenBudget: 1000, MaxTokensPerHook: 100,
		}},
	})
	if err != nil || !response.GetProjection().GetEnabled() || response.GetProjection().GetAutonomyRevision() != revision+1 {
		t.Fatalf("autonomy CAS update = (%+v, %v)", response, err)
	}
	_, err = svc.UpdateLocalAppAgentAutonomy(ctx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: "lah_v1_opaque", ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(false)},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale autonomy update code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AUTONOMY_REVISION_CONFLICT {
		t.Fatalf("stale autonomy reason = %s, %v", reason, ok)
	}
}

func TestLocalAppFirstPresentationCommitAcceptsInitialRevisionZeroAndRejectsStaleRevision(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	before, err := svc.GetLocalAppAgentPresentationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationPresentationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if before.GetProjection().GetPresentationRevision() != 0 || before.GetProjection().GetProfile() != nil {
		t.Fatalf("fresh presentation projection = %+v, want revision zero without profile", before.GetProjection())
	}
	intent := &runtimev1.LocalAppAgentPresentationIntent{
		BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
	}
	commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, localAgentRef, accountID)
	committed, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if err != nil || committed.GetProjection().GetPresentationRevision() != 1 {
		t.Fatalf("initial presentation commit = (%+v, %v)", committed, err)
	}
	_, err = svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale presentation commit code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT {
		t.Fatalf("stale presentation reason = %s, %v", reason, ok)
	}
}

func TestLocalAppConfigureProtoTypesExposeNoRawIdentityFields(t *testing.T) {
	file := runtimev1.File_runtime_v1_agent_configure_proto
	forbidden := map[protoreflect.Name]bool{
		"owner_user_id": true, "runtime_source_ref": true, "local_agent_ref": true,
		"subject_user_id": true, "account_id": true, "principal_id": true, "session_id": true,
		"endpoint": true, "credential": true, "has_credential": true,
		"local_asset_id": true, "connector_id": true, "remote_model_catalog_id": true,
		"snapshot_id": true, "profile_binding_id": true, "readiness_ref": true,
		"render_evidence": true, "visible_pixel_evidence": true, "renderer_success": true, "render_failure": true,
	}
	var inspectMessages func(protoreflect.MessageDescriptors)
	inspectMessages = func(messages protoreflect.MessageDescriptors) {
		for index := 0; index < messages.Len(); index++ {
			message := messages.Get(index)
			for fieldIndex := 0; fieldIndex < message.Fields().Len(); fieldIndex++ {
				field := message.Fields().Get(fieldIndex)
				if forbidden[field.Name()] {
					t.Fatalf("local-app configure carrier %s exposes forbidden field %s", message.FullName(), field.Name())
				}
			}
			inspectMessages(message.Messages())
		}
	}
	inspectMessages(file.Messages())
}
