package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalInstallLocalModelRejectsDuplicateAndUsesULID(t *testing.T) {
	svc := newTestService(t)
	first := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID: "local/dup-model",
		engine:  "llama",
	})
	if _, parseErr := ulid.Parse(first.GetLocalAssetId()); parseErr != nil {
		t.Fatalf("local_model_id must be pure ULID: %v", parseErr)
	}

	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:  "local/dup-model",
		engine:   "llama",
		endpoint: managedDefaultEndpointForEngine("llama"),
	})
	if err == nil {
		t.Fatalf("expected duplicate install to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_ASSET_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_ASSET_ALREADY_INSTALLED, got %s", st.Message())
	}
}

func TestLocalInstallLocalModelRejectsCanonicalAliasDuplicate(t *testing.T) {
	svc := newTestService(t)
	if _, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:  "z_image_turbo",
		engine:   "llama",
		endpoint: managedDefaultEndpointForEngine("llama"),
	}); err != nil {
		t.Fatalf("install bare model id: %v", err)
	}

	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:  "local/z_image_turbo",
		engine:   "llama",
		endpoint: managedDefaultEndpointForEngine("llama"),
	})
	if err == nil {
		t.Fatalf("expected canonical alias duplicate install to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
}

func TestListLocalModelsDedupesCanonicalAliasHistory(t *testing.T) {
	svc := newTestService(t)
	svc.assets = map[string]*runtimev1.LocalAssetRecord{
		"legacy-local": {
			LocalAssetId: "legacy-local",
			AssetId:      "local/z_image_turbo",
			Capabilities: []string{"image"},
			Engine:       "llama",
			Entry:        "z_image_turbo-Q4_K_M.gguf",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED,
			InstalledAt:  "2026-03-12T03:22:03.108524Z",
			UpdatedAt:    "2026-03-12T03:29:11.762573Z",
		},
		"current-bare": {
			LocalAssetId: "current-bare",
			AssetId:      "z_image_turbo",
			Capabilities: []string{"image"},
			Engine:       "llama",
			Entry:        "z_image_turbo-Q4_K_M.gguf",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			InstalledAt:  "2026-03-12T03:29:58.769489Z",
			UpdatedAt:    "2026-03-12T03:30:12.73915Z",
		},
	}

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("list local models: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one canonical model row, got %d", len(resp.GetAssets()))
	}
	if resp.GetAssets()[0].GetLocalAssetId() != "current-bare" {
		t.Fatalf("expected latest active alias row to win, got %q", resp.GetAssets()[0].GetLocalAssetId())
	}
	if resp.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active status, got %s", resp.GetAssets()[0].GetStatus())
	}
}

func TestLocalInstallLocalModelRequiresEndpointForSidecar(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/sidecar-model",
		engine:       "sidecar",
		capabilities: []string{"music"},
	})
	if err == nil {
		t.Fatalf("expected sidecar endpoint required error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String() {
		t.Fatalf("expected AI_LOCAL_ENDPOINT_REQUIRED, got %s", st.Message())
	}
}

func TestLocalInstallLocalServiceRequiresExistingLocalModel(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId: "svc-missing-model",
		Engine:    "llama",
	})
	if err == nil {
		t.Fatalf("expected missing local_model_id to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_SERVICE_UNAVAILABLE, got %s", st.Message())
	}

	_, err = svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-model-not-found",
		Engine:       "llama",
		LocalModelId: "01J00000000000000000000000",
	})
	if err == nil {
		t.Fatalf("expected unknown local_model_id to fail")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_SERVICE_UNAVAILABLE, got %s", st.Message())
	}
}

func TestLocalInstallLocalServiceEnforcesModelServiceOneToOne(t *testing.T) {
	svc := newTestService(t)

	model1 := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-bind-1",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	model2 := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-bind-2",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	first, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-1",
		Engine:       "llama",
		LocalModelId: model1.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("install first service: %v", err)
	}
	if first.GetService().GetLocalModelId() != model1.GetLocalAssetId() {
		t.Fatalf("service local_model_id mismatch")
	}

	secondTry, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-2",
		Engine:       "llama",
		LocalModelId: model1.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatalf("expected second service for same model to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_SERVICE_ALREADY_INSTALLED, got %s", st.Message())
	}
	if secondTry != nil {
		t.Fatalf("second install response must be nil on conflict")
	}

	_, err = svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-1",
		Engine:       "llama",
		LocalModelId: model2.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatalf("expected rebinding existing service to another model to fail")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists for rebinding, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_SERVICE_ALREADY_INSTALLED for rebinding, got %s", st.Message())
	}
}

func TestLocalListLocalModelsSortByCategoryThenModelID(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "z-chat",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     managedDefaultEndpointForEngine("llama"),
	})
	if err != nil {
		t.Fatalf("install chat model: %v", err)
	}
	_, err = svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "a-custom",
		capabilities: []string{"custom"},
		engine:       "llama",
		endpoint:     managedDefaultEndpointForEngine("llama"),
	})
	if err != nil {
		t.Fatalf("install custom model: %v", err)
	}
	_, err = svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "a-chat",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     managedDefaultEndpointForEngine("llama"),
	})
	if err != nil {
		t.Fatalf("install second chat model: %v", err)
	}

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("list local models: %v", err)
	}
	if len(resp.GetAssets()) != 3 {
		t.Fatalf("expected 3 models, got %d", len(resp.GetAssets()))
	}
	if resp.GetAssets()[0].GetAssetId() != "a-custom" {
		t.Fatalf("expected custom category first, got %s", resp.GetAssets()[0].GetAssetId())
	}
	if resp.GetAssets()[1].GetAssetId() != "a-chat" || resp.GetAssets()[2].GetAssetId() != "z-chat" {
		t.Fatalf("expected llm models ordered by model_id asc, got [%s, %s]", resp.GetAssets()[1].GetAssetId(), resp.GetAssets()[2].GetAssetId())
	}
}

func TestLocalListLocalServicesSortByServiceID(t *testing.T) {
	svc := newTestService(t)

	modelA := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-sort-a",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	modelB := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-sort-b",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-z",
		Engine:       "llama",
		LocalModelId: modelA.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install svc-z: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-a",
		Engine:       "llama",
		LocalModelId: modelB.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install svc-a: %v", err)
	}

	resp, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list local services: %v", err)
	}
	if len(resp.GetServices()) != 2 {
		t.Fatalf("expected 2 services, got %d", len(resp.GetServices()))
	}
	if resp.GetServices()[0].GetServiceId() != "svc-a" || resp.GetServices()[1].GetServiceId() != "svc-z" {
		t.Fatalf("services should be sorted by service_id asc, got [%s, %s]", resp.GetServices()[0].GetServiceId(), resp.GetServices()[1].GetServiceId())
	}
}

func TestLocalRemoveModelRejectedWhenServiceBound(t *testing.T) {
	svc := newTestService(t)

	model := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/remove-guard",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-remove-guard",
		Engine:       "llama",
		LocalModelId: model.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install service: %v", err)
	}

	_, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatalf("expected remove model to fail while service is bound")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_INVALID_TRANSITION, got %s", st.Message())
	}
}

func TestLocalResolveExecutionPlanRejectsServiceWithoutModelID(t *testing.T) {
	newTestService(t)

	plan := resolveExecutionPlan(&executionResolveRequest{
		targetID:   "world.nimi.service-without-model",
		capability: "chat",
		entries: &runtimev1.LocalExecutionDeclarationDescriptor{
			Required: []*runtimev1.LocalExecutionOptionDescriptor{
				{
					EntryId:    "dep.chat.service",
					Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_SERVICE,
					ServiceId:  "svc-chat",
					Capability: "chat",
					Engine:     "llama",
				},
			},
		},
	})
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetEntries()) != 1 {
		t.Fatalf("expected one dependency in plan")
	}
	dep := plan.GetEntries()[0]
	if dep.GetSelected() {
		t.Fatalf("service dependency without modelId must not be selected")
	}
	if dep.GetReasonCode() != "LOCAL_DEPENDENCY_MODEL_ID_REQUIRED" {
		t.Fatalf("unexpected dependency reason code: %s", dep.GetReasonCode())
	}
}

func TestLocalInstallVerifiedModelTemplateNotFound(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.InstallVerifiedAsset(context.Background(), &runtimev1.InstallVerifiedAssetRequest{
		TemplateId: "verified.missing-template",
	})
	if err == nil {
		t.Fatalf("expected missing template error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND.String() {
		t.Fatalf("expected AI_LOCAL_TEMPLATE_NOT_FOUND, got %s", st.Message())
	}
}
