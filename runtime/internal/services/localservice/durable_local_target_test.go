package localservice

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDurableLocalTargetReadinessRefResolvesOneExactAsset(t *testing.T) {
	t.Parallel()
	svc := &Service{
		assets: map[string]*runtimev1.LocalAssetRecord{
			"local-chat-a": {
				LocalAssetId:   "local-chat-a",
				AssetId:        "catalog/chat-a",
				LogicalModelId: "chat/a",
				Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Capabilities:   []string{"text.generate"},
			},
			"local-chat-b": {
				LocalAssetId:   "local-chat-b",
				AssetId:        "catalog/chat-b",
				LogicalModelId: "chat/b",
				Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Capabilities:   []string{"text.generate"},
			},
		},
		managedImageProfiles: map[string]managedImageProfileState{},
	}
	target, status, _ := svc.projectDurableLocalTargetForAsset(svc.assets["local-chat-a"])
	if target == nil || target.GetReadinessRef() == "" {
		t.Fatal("expected Runtime-issued readiness target")
	}
	if strings.Contains(target.GetReadinessRef(), "local-chat-a") {
		t.Fatalf("readiness ref leaked local asset identity: %q", target.GetReadinessRef())
	}
	if status != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("target status = %s, want ACTIVE", status)
	}

	binding, asset, err := svc.ResolveDurableLocalTarget(context.Background(), target, "text.generate")
	if err != nil {
		t.Fatalf("ResolveDurableLocalTarget: %v", err)
	}
	if binding.GetLocalAssetId() != "local-chat-a" || asset.GetLogicalModelId() != "chat/a" {
		t.Fatalf("resolved wrong exact asset: binding=%v asset=%v", binding, asset)
	}
	if _, _, err := svc.ResolveDurableLocalTarget(context.Background(), target, "text.embed"); !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
		t.Fatalf("capability mismatch error = %v", err)
	}
}

func TestDurableLocalImageTargetMaterializationAllowsInstalledCompanion(t *testing.T) {
	t.Parallel()
	const (
		bindingID = "workflow_binding:profile_workflow:installed-companion"
		mainLocal = "local-image-main"
		mainAsset = "catalog/image-main"
		vaeLocal  = "local-image-vae"
		vaeAsset  = "catalog/image-vae"
	)
	vaeIdentity := "nimi/component/vae/sha256-" + strings.Repeat("a", 64)
	mainConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{
		assets: map[string]*runtimev1.LocalAssetRecord{
			mainLocal: {
				LocalAssetId: mainLocal, AssetId: mainAsset, LogicalModelId: "image/main",
				Family: "z-image", Engine: "media", EngineConfig: mainConfig,
				Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Capabilities: []string{"image.generate"},
			},
			vaeLocal: {
				LocalAssetId: vaeLocal, AssetId: vaeAsset,
				Family: "flux2-vae", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Entry: "ae.safetensors", Hashes: map[string]string{"ae.safetensors": "sha256:" + strings.Repeat("a", 64)},
			},
		},
		managedImageProfiles: map[string]managedImageProfileState{},
		managedImageProfileBindings: map[string]managedImageProfileState{
			bindingID: {
				BindingID: bindingID, MainLocalAssetID: mainLocal,
				Alias: profileRuntimeMaterializationKeyPrefix + "installed-companion", MaterializationResolved: true,
				MaterializationBindings: []managedMediaProfileMaterializationBinding{
					{AssetID: mainAsset, LocalAssetID: mainLocal},
					{
						AssetID: mainAsset, LocalAssetID: mainLocal, OccurrenceID: "vae-1", Order: 0,
						Role: "vae", LogicalModelID: vaeIdentity, Required: true,
						CompanionKind: "vae", EngineSlot: "vae_path", CompanionAssetID: vaeAsset,
						CompanionLocalAssetID: vaeLocal, ParentAssetID: mainAsset,
					},
				},
			},
		},
	}
	baseTarget := durableLocalWorkflowBindingTargetRef(bindingID)
	if got := effectiveLocalComponentPublicIdentity(svc.assets[vaeLocal]); got != vaeIdentity {
		t.Fatalf("passive VAE public identity = %q, want %q", got, vaeIdentity)
	}
	vaeTarget := svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[vaeLocal])
	if vaeTarget == nil || svc.durableLocalTargetRefForAssetLocked(svc.assets[vaeLocal]) != nil {
		t.Fatalf("passive VAE target split failed: component=%v main=%v", vaeTarget, svc.durableLocalTargetRefForAssetLocked(svc.assets[vaeLocal]))
	}
	components := []DurableLocalComponentSelection{{
		OccurrenceID: "vae-1", Order: 0, Role: "vae", ComponentKind: "vae",
		LogicalModelID: vaeIdentity, TargetRef: vaeTarget, Required: true,
	}}
	_, resolvedMain, err := svc.ResolveDurableLocalTarget(context.Background(), baseTarget, "image.generate")
	if err != nil || !profileEntryStaticConfigAssetUsable(resolvedMain) {
		t.Fatalf("resolve installed composition main: asset=%+v err=%v", resolvedMain, err)
	}
	resolvedBinding, resolvedVAE, err := svc.ResolveDurableLocalComponentTarget(context.Background(), components[0].TargetRef, "vae")
	if err != nil || !profileEntryStaticConfigAssetUsable(resolvedVAE) {
		t.Fatalf("resolve installed companion: asset=%+v err=%v", resolvedVAE, err)
	}
	if resolvedBinding.GetResolvedModelId() != vaeIdentity || resolvedVAE.GetLogicalModelId() != "" {
		t.Fatalf("passive VAE public resolution: binding=%+v asset=%+v", resolvedBinding, resolvedVAE)
	}
	listed, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalAssets passive VAE projection: %v", err)
	}
	var projectedVAE *runtimev1.LocalAssetRecord
	for _, asset := range listed.GetAssets() {
		if asset.GetLocalAssetId() == vaeLocal {
			projectedVAE = asset
			break
		}
	}
	if projectedVAE == nil || projectedVAE.GetLogicalModelId() != "" ||
		projectedVAE.GetMetadata().GetFields()[localAssetEffectivePublicComponentIdentityField].GetStringValue() != vaeIdentity ||
		!proto.Equal(projectedVAE.GetDurableTargetRef(), vaeTarget) ||
		projectedVAE.GetDurableTargetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("passive VAE Desktop projection = %+v", projectedVAE)
	}
	if err := validateDurableLocalImageComponentCompatibility(resolvedMain, "vae_path", resolvedVAE); err != nil {
		t.Fatalf("installed companion static compatibility: %v", err)
	}
	beforeBindings := len(svc.managedImageProfileBindings)
	materialized, err := svc.MaterializeDurableLocalImageTarget(context.Background(), baseTarget, components)
	if err != nil {
		t.Fatalf("installed companion materialization error = %v", err)
	}
	if materialized == nil || strings.TrimSpace(materialized.GetProfileBindingId()) == "" ||
		len(svc.managedImageProfileBindings) != beforeBindings+1 {
		t.Fatalf("installed companion did not produce a distinct binding: target=%v bindings=%d", materialized, len(svc.managedImageProfileBindings))
	}
	if err := svc.ValidateDurableLocalImageTargetComponents(context.Background(), materialized, components); err != nil {
		t.Fatalf("validate installed companion binding: %v", err)
	}
}

func TestDurableLocalImageTargetMaterializationRejectsUnsupportedComponentMetadataBeforeCaching(t *testing.T) {
	t.Parallel()
	const (
		bindingID = "workflow_binding:profile_workflow:metadata-admission"
		mainLocal = "local-image-main-metadata"
		mainAsset = "catalog/image-main-metadata"
		vaeLocal  = "local-image-vae-metadata"
		vaeAsset  = "catalog/image-vae-metadata"
	)
	mainConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{
		assets: map[string]*runtimev1.LocalAssetRecord{
			mainLocal: {
				LocalAssetId: mainLocal, AssetId: mainAsset, LogicalModelId: "image/main",
				Family: "z-image", Engine: "media", EngineConfig: mainConfig,
				Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, Capabilities: []string{"image.generate"},
			},
			vaeLocal: {
				LocalAssetId: vaeLocal, AssetId: vaeAsset, LogicalModelId: "image/vae",
				Family: "flux2-vae", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			},
		},
		managedImageProfiles: map[string]managedImageProfileState{},
		managedImageProfileBindings: map[string]managedImageProfileState{
			bindingID: {
				BindingID: bindingID, MainLocalAssetID: mainLocal,
				Alias: profileRuntimeMaterializationKeyPrefix + "metadata-admission", MaterializationResolved: true,
				MaterializationBindings: []managedMediaProfileMaterializationBinding{
					{AssetID: mainAsset, LocalAssetID: mainLocal},
					{
						AssetID: mainAsset, LocalAssetID: mainLocal, OccurrenceID: "vae-1", Order: 0,
						Role: "vae", LogicalModelID: "image/vae", Required: true,
						CompanionKind: "vae", EngineSlot: "vae_path", CompanionAssetID: vaeAsset,
						CompanionLocalAssetID: vaeLocal, ParentAssetID: mainAsset,
					},
				},
			},
		},
	}
	components := []DurableLocalComponentSelection{{
		OccurrenceID: "vae-1", Order: 0, Role: "vae", ComponentKind: "vae", LogicalModelID: "image/vae",
		TargetRef: svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[vaeLocal]), Required: true,
		Weight: "0.75", Options: map[string]any{"precision": "fp16"},
	}}
	mainTarget := svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[mainLocal])
	beforeBindings := len(svc.managedImageProfileBindings)
	materialized, err := svc.MaterializeDurableLocalImageTargetFromCommitted(
		context.Background(), durableLocalWorkflowBindingTargetRef(bindingID), mainTarget, components,
	)
	if !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
		t.Fatalf("unsupported component metadata error = %v, want capability mismatch", err)
	}
	if materialized != nil || len(svc.managedImageProfileBindings) != beforeBindings {
		t.Fatalf("unsupported component metadata cached a binding: target=%v bindings=%d", materialized, len(svc.managedImageProfileBindings))
	}
}

func TestDurableLocalImageMainRebindRequiresBackendAndFamilyFacts(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		previous *runtimev1.LocalAssetRecord
		next     *runtimev1.LocalAssetRecord
	}{
		{name: "both facts missing", previous: &runtimev1.LocalAssetRecord{}, next: &runtimev1.LocalAssetRecord{}},
		{name: "public engine is not backend fact", previous: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}, next: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}},
		{name: "previous backend missing", previous: &runtimev1.LocalAssetRecord{Family: "z-image"}, next: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}},
		{name: "next family missing", previous: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}, next: &runtimev1.LocalAssetRecord{Engine: "media"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateDurableLocalImageMainRebindCompatibility(testCase.previous, testCase.next); !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
				t.Fatalf("unknown compatibility facts error = %v, want capability mismatch", err)
			}
		})
	}
}

func TestDurableLocalImageTargetRebindRejectsMainBackendAndFamilyMismatch(t *testing.T) {
	t.Parallel()
	const (
		bindingID  = "workflow_binding:profile_workflow:compatibility"
		mainLocal  = "local-image-main"
		mainAsset  = "catalog/image-main"
		vaeLocal   = "local-image-vae"
		vaeAsset   = "catalog/image-vae"
		otherLocal = "local-image-other"
		otherAsset = "catalog/image-other"
	)
	mainConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatal(err)
	}
	otherConfig, err := structpb.NewStruct(map[string]any{"backend": "diffusers"})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{
		assets: map[string]*runtimev1.LocalAssetRecord{
			mainLocal: {
				LocalAssetId: mainLocal, AssetId: mainAsset, LogicalModelId: "image/main",
				Family: "z-image", Engine: "media", EngineConfig: mainConfig,
				Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, Capabilities: []string{"image.generate"},
			},
			vaeLocal: {
				LocalAssetId: vaeLocal, AssetId: vaeAsset, LogicalModelId: "image/vae",
				Family: "flux2-vae", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			},
			otherLocal: {
				LocalAssetId: otherLocal, AssetId: otherAsset, LogicalModelId: "image/other",
				Family: "other-family", Engine: "media", EngineConfig: otherConfig,
				Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, Capabilities: []string{"image.generate"},
			},
		},
		managedImageProfiles: map[string]managedImageProfileState{},
		managedImageProfileBindings: map[string]managedImageProfileState{
			bindingID: {
				BindingID: bindingID, MainLocalAssetID: mainLocal,
				Alias: profileRuntimeMaterializationKeyPrefix + "compatibility", MaterializationResolved: true,
				MaterializationBindings: []managedMediaProfileMaterializationBinding{
					{AssetID: mainAsset, LocalAssetID: mainLocal},
					{
						AssetID: mainAsset, LocalAssetID: mainLocal, OccurrenceID: "vae-1", Order: 0,
						Role: "vae", LogicalModelID: "image/vae", Required: true,
						CompanionKind: "vae", EngineSlot: "vae_path", CompanionAssetID: vaeAsset,
						CompanionLocalAssetID: vaeLocal, ParentAssetID: mainAsset,
					},
				},
			},
		},
	}
	components := []DurableLocalComponentSelection{{
		OccurrenceID: "vae-1", Order: 0, Role: "vae", ComponentKind: "vae", LogicalModelID: "image/vae",
		TargetRef: svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[vaeLocal]), Required: true, Options: map[string]any{},
	}}
	mainTarget := svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[otherLocal])
	_, err = svc.MaterializeDurableLocalImageTargetFromCommitted(
		context.Background(),
		durableLocalWorkflowBindingTargetRef(bindingID),
		mainTarget,
		components,
	)
	if !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
		t.Fatalf("incompatible main rebind error = %v, want capability mismatch", err)
	}
	svc.assets[otherLocal].Family = "z-image"
	svc.assets[otherLocal].EngineConfig = mainConfig
	materialized, err := svc.MaterializeDurableLocalImageTargetFromCommitted(
		context.Background(),
		durableLocalWorkflowBindingTargetRef(bindingID),
		mainTarget,
		components,
	)
	if err != nil || materialized == nil {
		t.Fatalf("compatible main rebind error = %v target=%v", err, materialized)
	}
	state, ok := svc.cachedManagedMediaImageProfileBinding(materialized.GetProfileBindingId())
	if !ok || state.MainLocalAssetID != otherLocal {
		t.Fatalf("compatible main rebind state = %+v, ok=%v", state, ok)
	}
}

func TestDurableLocalImageWorkflowTargetRetainsIdentityAcrossCompanionFailureAndRecovery(t *testing.T) {
	t.Parallel()
	const (
		bindingID = "workflow_binding:profile_workflow:z-image"
		mainLocal = "local-z-image"
		mainAsset = "catalog/z-image-turbo"
		vaeLocal  = "local-z-image-vae"
		vaeAsset  = "catalog/z-image-vae"
		llmLocal  = "local-qwen3-4b"
		llmAsset  = "catalog/qwen3-4b-q4"
	)
	svc := &Service{
		assets: map[string]*runtimev1.LocalAssetRecord{
			mainLocal: {
				LocalAssetId:   mainLocal,
				AssetId:        mainAsset,
				LogicalModelId: "image/z-image-turbo",
				Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Capabilities:   []string{"image.generate"},
			},
			vaeLocal: {
				LocalAssetId:   vaeLocal,
				AssetId:        vaeAsset,
				LogicalModelId: "image/z-image-vae",
				Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			},
			llmLocal: {
				LocalAssetId:   llmLocal,
				AssetId:        llmAsset,
				LogicalModelId: "image/qwen3-4b",
				Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
				Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			},
		},
		managedImageProfileBindings: map[string]managedImageProfileState{
			bindingID: {
				BindingID:               bindingID,
				MainLocalAssetID:        mainLocal,
				Alias:                   profileRuntimeMaterializationKeyPrefix + "z-image",
				MaterializationResolved: true,
				MaterializationBindings: []managedMediaProfileMaterializationBinding{
					{AssetID: mainAsset, LocalAssetID: mainLocal},
					{
						AssetID: mainAsset, LocalAssetID: mainLocal, OccurrenceID: "vae-1", Order: 0,
						Role: "vae", LogicalModelID: "image/z-image-vae", Required: true,
						CompanionKind: "vae", EngineSlot: "vae",
						CompanionAssetID: vaeAsset, CompanionLocalAssetID: vaeLocal, ParentAssetID: mainAsset,
					},
					{
						AssetID: mainAsset, LocalAssetID: mainLocal, OccurrenceID: "llm-1", Order: 1,
						Role: "prompt_encoder", LogicalModelID: "image/qwen3-4b", Required: true,
						CompanionKind: "auxiliary", EngineSlot: "llm",
						CompanionAssetID: llmAsset, CompanionLocalAssetID: llmLocal, ParentAssetID: mainAsset,
					},
				},
			},
		},
	}

	target := durableLocalWorkflowBindingTargetRef(bindingID)
	if target == nil || target.GetProfileBindingId() != bindingID {
		t.Fatalf("workflow target = %v", target)
	}
	components := []DurableLocalComponentSelection{
		{
			OccurrenceID: "vae-1", Order: 0, Role: "vae", ComponentKind: "vae", LogicalModelID: "image/z-image-vae",
			TargetRef: svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[vaeLocal]), Required: true, Options: map[string]any{},
		},
		{
			OccurrenceID: "llm-1", Order: 1, Role: "prompt_encoder", ComponentKind: "auxiliary", LogicalModelID: "image/qwen3-4b",
			TargetRef: svc.durableLocalAssetSelectionRefForAssetLocked(svc.assets[llmLocal]), Required: true, Options: map[string]any{},
		},
	}
	for _, component := range components {
		resolved, asset, err := svc.ResolveDurableLocalComponentTarget(context.Background(), component.TargetRef, component.ComponentKind)
		if err != nil || resolved.GetResolvedModelId() != component.LogicalModelID || asset == nil {
			t.Fatalf("resolve active component %q: binding=%+v asset=%+v err=%v", component.OccurrenceID, resolved, asset, err)
		}
	}
	if err := svc.ValidateDurableLocalImageTargetComponents(context.Background(), target, components); err != nil {
		t.Fatalf("validate active committed binding: %v; expected=%+v actual=%+v", err, durableLocalImageComponentBindings(svc.managedImageProfileBindings[bindingID]), components)
	}
	committedVersion := target.GetVersion()
	committedProfile := svc.managedImageProfileBindings[bindingID]
	status, reason := svc.durableLocalTargetReadinessLocked(svc.assets[mainLocal], target)
	if status != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED || reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Fatalf("configured-unverified status = %s/%s", status, reason)
	}

	svc.assets[vaeLocal].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	if err := svc.ValidateDurableLocalImageTargetComponents(context.Background(), target, components); !errors.Is(err, ErrDurableLocalTargetUnavailable) {
		t.Fatalf("unhealthy exact component error = %v, want typed target unavailable", err)
	}
	degradedBinding, degradedAsset, err := svc.ResolveDurableLocalTarget(context.Background(), target, "image.generate")
	if err != nil {
		t.Fatalf("resolve degraded committed binding: %v", err)
	}
	degradedStatus, degradedReason := degradedAsset.GetDurableTargetStatus(), degradedAsset.GetDurableTargetReasonCode()
	if degradedStatus != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY ||
		degradedReason != runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING {
		t.Fatalf("degraded status = %s/%s", degradedStatus, degradedReason)
	}
	retainedProfile := svc.managedImageProfileBindings[bindingID]
	if degradedBinding.GetProfileBindingId() != bindingID || target.GetVersion() != committedVersion ||
		retainedProfile.BindingID != committedProfile.BindingID || retainedProfile.Alias != committedProfile.Alias ||
		len(retainedProfile.MaterializationBindings) != len(committedProfile.MaterializationBindings) {
		t.Fatalf("degradation changed committed binding/version: target=%v profile=%+v", target, retainedProfile)
	}

	svc.assets[vaeLocal].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
	if err := svc.ValidateDurableLocalImageTargetComponents(context.Background(), target, components); err != nil {
		t.Fatalf("recovered exact component validation: %v", err)
	}
	recoveredBinding, recoveredAsset, err := svc.ResolveDurableLocalTarget(context.Background(), target, "image.generate")
	if err != nil {
		t.Fatalf("resolve recovered committed binding: %v", err)
	}
	if recoveredAsset.GetDurableTargetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED ||
		recoveredBinding.GetProfileBindingId() != bindingID || target.GetVersion() != committedVersion {
		t.Fatalf("same binding/version did not recover: binding=%+v asset=%+v target=%+v", recoveredBinding, recoveredAsset, target)
	}
}
