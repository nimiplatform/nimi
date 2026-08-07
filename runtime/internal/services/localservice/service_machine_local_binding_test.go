package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestManualExactBindingConfiguresIndependentMainAndMMProjRequirements(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, []string{"input.image"}, llamaIdentityForTest())
	mainContent := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	mmprojContent := seedMachineLocalAssetForTest(t, service, "asset-mmproj", 'b', "mmproj")

	main := bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), capabilitydriver.MainGGUFRequirementID, "asset-main", mainContent)
	if main.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED || len(main.GetExactBindings()) != 1 {
		t.Fatalf("main-only binding = %#v", main)
	}
	complete := bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), capabilitydriver.CompanionMMProjRequirementID, "asset-mmproj", mmprojContent)
	if complete.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(complete.GetExactBindings()) != 2 {
		t.Fatalf("complete binding = %#v", complete)
	}
	if complete.GetExactBindings()[0].GetRequirementId() != capabilitydriver.CompanionMMProjRequirementID ||
		complete.GetExactBindings()[1].GetRequirementId() != capabilitydriver.MainGGUFRequirementID {
		t.Fatalf("bindings are not canonically ordered: %#v", complete.GetExactBindings())
	}
	if got := complete.GetExactBindings()[1]; got.GetVerifiedContentId() != "sha256:"+mainContent || got.GetEntrySha256() != mainContent {
		t.Fatalf("main exact identity = %#v", got)
	}
}

func TestStableDiffusionOccurrenceProjectionReprojectBindAndResolve(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	portable := mustStructForTest(t, map[string]any{
		"modelFamily": "z-image",
		"loras": []any{
			map[string]any{"displayLabel": "First style"},
			map[string]any{"displayLabel": "Second style"},
		},
	})
	response, err := service.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		Implementation:     stableDiffusionIdentityForTest(),
		PortableConfig:     portable,
		DisplayName:        "Stable Diffusion test",
	})
	if err != nil {
		t.Fatalf("AddLocalCapabilityConfiguration: %v", err)
	}
	configuration := response.GetConfiguration()
	if len(configuration.GetProjectedRequirements()) != 5 {
		t.Fatalf("projected requirements = %#v", configuration.GetProjectedRequirements())
	}
	firstLoRA := configuration.GetProjectedRequirements()[3]
	secondLoRA := configuration.GetProjectedRequirements()[4]
	if firstLoRA.GetOccurrenceOrdinal() != 1 || firstLoRA.GetDisplayLabel() != "First style" ||
		secondLoRA.GetOccurrenceOrdinal() != 2 || secondLoRA.GetDisplayLabel() != "Second style" {
		t.Fatalf("ordered occurrence presentation = %#v", configuration.GetProjectedRequirements())
	}

	reprojected, err := service.ReprojectLocalCapabilityRequirements(context.Background(), &runtimev1.ReprojectLocalCapabilityRequirementsRequest{ConfigurationId: configuration.GetConfigurationId()})
	if err != nil {
		t.Fatalf("ReprojectLocalCapabilityRequirements: %v", err)
	}
	if !proto.Equal(firstLoRA, reprojected.GetConfiguration().GetProjectedRequirements()[3]) ||
		!proto.Equal(secondLoRA, reprojected.GetConfiguration().GetProjectedRequirements()[4]) {
		t.Fatalf("reprojection changed declared occurrence truth: %#v", reprojected.GetConfiguration().GetProjectedRequirements())
	}

	mainDigest := seedStableDiffusionMachineAssetForTest(t, service, "sd-main", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, "z-image")
	textDigest := seedStableDiffusionMachineAssetForTest(t, service, "sd-text", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, "")
	vaeDigest := seedStableDiffusionMachineAssetForTest(t, service, "sd-vae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, "flux1-vae")
	loraDigest := seedStableDiffusionMachineAssetForTest(t, service, "sd-shared-lora", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA, "z-image")
	bindings := []struct {
		requirementID string
		localAssetID  string
		digest        string
	}{
		{capabilitydriver.StableDiffusionMainRequirementID, "sd-main", mainDigest},
		{capabilitydriver.StableDiffusionTextEncoderRequirementID, "sd-text", textDigest},
		{capabilitydriver.StableDiffusionVAERequirementID, "sd-vae", vaeDigest},
		{capabilitydriver.StableDiffusionLoRARequirementID(1), "sd-shared-lora", loraDigest},
		{capabilitydriver.StableDiffusionLoRARequirementID(2), "sd-shared-lora", loraDigest},
	}
	for _, binding := range bindings {
		configuration = bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), binding.requirementID, binding.localAssetID, binding.digest)
	}
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(configuration.GetExactBindings()) != 5 {
		t.Fatalf("configured Stable Diffusion record = %#v", configuration)
	}
	sharedCount := 0
	for _, binding := range configuration.GetExactBindings() {
		if binding.GetLocalAssetId() == "sd-shared-lora" {
			sharedCount++
		}
	}
	if sharedCount != 2 {
		t.Fatalf("shared LoRA occurrence bindings = %#v", configuration.GetExactBindings())
	}

	if _, err := service.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		ConfigurationId:    configuration.GetConfigurationId(),
	}); err != nil {
		t.Fatalf("SelectLocalCapabilityConfiguration: %v", err)
	}
	resolved, err := service.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionCapabilityContract)
	if err != nil {
		t.Fatalf("ResolveSelectedLocalExecution: %v", err)
	}
	if len(resolved.Requirements) != 5 || len(resolved.ExactBindings) != 5 ||
		resolved.Requirements[3].GetOccurrenceOrdinal() != 1 || resolved.Requirements[3].GetDisplayLabel() != "First style" ||
		resolved.Requirements[4].GetOccurrenceOrdinal() != 2 || resolved.Requirements[4].GetDisplayLabel() != "Second style" {
		t.Fatalf("selected occurrence projection = %#v", resolved)
	}
	projectedOrdinals := map[uint32]string{}
	for _, binding := range resolved.ExactBindings {
		if binding.OccurrenceOrdinal > 0 {
			projectedOrdinals[binding.OccurrenceOrdinal] = binding.DisplayLabel
		}
	}
	if projectedOrdinals[1] != "First style" || projectedOrdinals[2] != "Second style" {
		t.Fatalf("selected exact binding occurrence presentation = %#v", resolved.ExactBindings)
	}
}

func TestManualExactBindingRebindAndUnbindRequireExactCurrentBinding(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	contentA := seedMachineLocalAssetForTest(t, service, "asset-a", 'a', "llm")
	contentB := seedMachineLocalAssetForTest(t, service, "asset-b", 'b', "llm")
	bound := bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), capabilitydriver.MainGGUFRequirementID, "asset-a", contentA)
	current := proto.Clone(bound.GetExactBindings()[0]).(*runtimev1.LocalAssetExactBinding)
	stale := proto.Clone(current).(*runtimev1.LocalAssetExactBinding)
	stale.EntrySha256 = contentB

	_, err := service.RebindLocalCapabilityRequirement(context.Background(), &runtimev1.RebindLocalCapabilityRequirementRequest{
		ConfigurationId:        configuration.GetConfigurationId(),
		RequirementId:          capabilitydriver.MainGGUFRequirementID,
		ExpectedCurrentBinding: stale,
		Target:                 exactBindingTarget("asset-b", contentB),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("stale rebind status = %v", err)
	}
	assertGRPCReasonCode(t, err, "RebindLocalCapabilityRequirement(stale)", runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "asset-a")

	rebound, err := service.RebindLocalCapabilityRequirement(context.Background(), &runtimev1.RebindLocalCapabilityRequirementRequest{
		ConfigurationId:        configuration.GetConfigurationId(),
		RequirementId:          capabilitydriver.MainGGUFRequirementID,
		ExpectedCurrentBinding: current,
		Target:                 exactBindingTarget("asset-b", contentB),
	})
	if err != nil {
		t.Fatalf("RebindLocalCapabilityRequirement: %v", err)
	}
	nextCurrent := proto.Clone(rebound.GetConfiguration().GetExactBindings()[0]).(*runtimev1.LocalAssetExactBinding)
	if nextCurrent.GetLocalAssetId() != "asset-b" {
		t.Fatalf("rebound binding = %#v", nextCurrent)
	}

	_, err = service.UnbindLocalCapabilityRequirement(context.Background(), &runtimev1.UnbindLocalCapabilityRequirementRequest{
		ConfigurationId:        configuration.GetConfigurationId(),
		RequirementId:          capabilitydriver.MainGGUFRequirementID,
		ExpectedCurrentBinding: current,
	})
	assertGRPCReasonCode(t, err, "UnbindLocalCapabilityRequirement(stale)", runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "asset-b")

	unbound, err := service.UnbindLocalCapabilityRequirement(context.Background(), &runtimev1.UnbindLocalCapabilityRequirementRequest{
		ConfigurationId:        configuration.GetConfigurationId(),
		RequirementId:          capabilitydriver.MainGGUFRequirementID,
		ExpectedCurrentBinding: nextCurrent,
	})
	if err != nil {
		t.Fatalf("UnbindLocalCapabilityRequirement: %v", err)
	}
	if len(unbound.GetConfiguration().GetExactBindings()) != 0 || unbound.GetConfiguration().GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("unbound configuration = %#v", unbound.GetConfiguration())
	}
}

func TestManualExactBindingStrictRequirementRejectsDifferentVerifiedContent(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	preferred := testMachineLocalContentSHA256('a')
	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainRequirementPolicy": "strict",
		"mainVerifiedContentId": "sha256:" + preferred,
	}), nil, llamaIdentityForTest())
	other := seedMachineLocalAssetForTest(t, service, "asset-other", 'b', "llm")

	_, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configuration.GetConfigurationId(),
		RequirementId:   capabilitydriver.MainGGUFRequirementID,
		Target:          exactBindingTarget("asset-other", other),
	})
	assertGRPCReasonCode(t, err, "BindLocalCapabilityRequirement(strict mismatch)", runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "")
}

func TestManualExactBindingRejectsDeclaredIdentityAfterByteDrift(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	content := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	if err := os.WriteFile(machineLocalAssetEntryPathForTest(t, service, "asset-main"), testMachineLocalGGUFBytes('b'), 0o600); err != nil {
		t.Fatalf("drift LocalAsset bytes: %v", err)
	}

	_, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configuration.GetConfigurationId(),
		RequirementId:   capabilitydriver.MainGGUFRequirementID,
		Target:          exactBindingTarget("asset-main", content),
	})
	assertGRPCReasonCode(t, err, "BindLocalCapabilityRequirement(byte mismatch)", runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "")
}

func TestManualExactBindingStoreFailureDoesNotPublishMemory(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	content := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	service.machineLocalConfigurationStore = failingMachineLocalConfigurationStore{err: errors.New("disk full")}

	_, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configuration.GetConfigurationId(),
		RequirementId:   capabilitydriver.MainGGUFRequirementID,
		Target:          exactBindingTarget("asset-main", content),
	})
	assertGRPCReasonCode(t, err, "BindLocalCapabilityRequirement(store failure)", runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "")
}

func TestManualExactBindingSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	service := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	content := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	bound := bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), capabilitydriver.MainGGUFRequirementID, "asset-main", content)
	want := proto.Clone(bound.GetExactBindings()[0]).(*runtimev1.LocalAssetExactBinding)
	service.Close()

	restarted := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	defer restarted.Close()
	response, err := restarted.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: configuration.GetConfigurationId()})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration after restart: %v", err)
	}
	if len(response.GetConfiguration().GetExactBindings()) != 1 || !equalLocalCapabilityExactBinding(response.GetConfiguration().GetExactBindings()[0], want) {
		t.Fatalf("restored exact binding = %#v", response.GetConfiguration().GetExactBindings())
	}
}

func TestManualExactBindingRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink setup requires platform privileges on Windows")
	}
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	payload := testMachineLocalGGUFBytes('a')
	content := testMachineLocalContentSHA256('a')
	outside := filepath.Join(t.TempDir(), "outside.gguf")
	if err := os.WriteFile(outside, payload, 0o600); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}
	logicalModelID := "test/symlink-escape"
	entryPath := filepath.Join(service.localModelsPath, "resolved", filepath.FromSlash(logicalModelID), "weights.gguf")
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create managed fixture directory: %v", err)
	}
	if err := os.Symlink(outside, entryPath); err != nil {
		t.Fatalf("create symlink fixture: %v", err)
	}
	service.mu.Lock()
	service.assets["asset-symlink"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-symlink", AssetId: "catalog-independent-symlink", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine: "llama", Entry: "weights.gguf", Files: []string{"weights.gguf"}, Hashes: map[string]string{"weights.gguf": "sha256:" + content},
		LogicalModelId: logicalModelID, Source: &runtimev1.LocalAssetSource{Repo: "test-fixture", Revision: "1"}, ArtifactRoles: []string{"llm"},
	}
	service.mu.Unlock()

	_, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configuration.GetConfigurationId(), RequirementId: capabilitydriver.MainGGUFRequirementID,
		Target: exactBindingTarget("asset-symlink", content),
	})
	assertGRPCReasonCode(t, err, "BindLocalCapabilityRequirement(symlink escape)", runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_UNVERIFIED)
	assertMachineLocalBindingAsset(t, service, configuration.GetConfigurationId(), "")
}

func TestManualExactBindingRejectsEntryTargetSwapAfterOpen(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink setup requires platform privileges on Windows")
	}
	root := t.TempDir()
	entryPath := filepath.Join(root, "weights.gguf")
	if err := os.WriteFile(entryPath, testMachineLocalGGUFBytes('a'), 0o600); err != nil {
		t.Fatalf("write original entry: %v", err)
	}
	opened, err := os.Open(entryPath)
	if err != nil {
		t.Fatalf("open original entry: %v", err)
	}
	defer func() { _ = opened.Close() }()
	openedInfo, err := opened.Stat()
	if err != nil {
		t.Fatalf("stat original entry: %v", err)
	}
	replacement := filepath.Join(root, "replacement.gguf")
	if err := os.WriteFile(replacement, testMachineLocalGGUFBytes('b'), 0o600); err != nil {
		t.Fatalf("write replacement entry: %v", err)
	}
	if err := os.Remove(entryPath); err != nil {
		t.Fatalf("remove original entry path: %v", err)
	}
	if err := os.Symlink(replacement, entryPath); err != nil {
		t.Fatalf("replace entry path with symlink: %v", err)
	}
	if err := validateOpenLocalCapabilityAssetEntry(root, entryPath, openedInfo); err == nil {
		t.Fatal("entry target swap passed open-file identity validation")
	}
}

func TestManualExactBindingValidatesGGUFStructureOnOpenedFile(t *testing.T) {
	root := t.TempDir()
	entryPath := filepath.Join(root, "weights.gguf")
	if err := os.WriteFile(entryPath, testMachineLocalGGUFBytes('a'), 0o600); err != nil {
		t.Fatalf("write valid entry: %v", err)
	}
	verifiedEntryPath, err := resolveLocalCapabilityAssetPathWithinRoot(root, entryPath)
	if err != nil {
		t.Fatalf("resolve valid entry: %v", err)
	}
	invalidPayload := make([]byte, minManagedGGUFSizeBytes)
	copy(invalidPayload, []byte("NOPE"))
	if err := os.WriteFile(entryPath, invalidPayload, 0o600); err != nil {
		t.Fatalf("replace entry with invalid GGUF: %v", err)
	}
	opened, err := os.Open(verifiedEntryPath)
	if err != nil {
		t.Fatalf("open replaced entry: %v", err)
	}
	defer func() { _ = opened.Close() }()
	info, err := opened.Stat()
	if err != nil {
		t.Fatalf("stat replaced entry: %v", err)
	}
	if err := validateManagedModelEntryOpenFile(verifiedEntryPath, opened, info); err == nil {
		t.Fatal("invalid GGUF passed same-file structure validation")
	}
}

func TestManualExactBindingByteDriftDoesNotAmbientlyClearCommittedBinding(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	content := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	bound := bindMachineLocalRequirementForTest(t, service, configuration.GetConfigurationId(), capabilitydriver.MainGGUFRequirementID, "asset-main", content)
	want := proto.Clone(bound.GetExactBindings()[0]).(*runtimev1.LocalAssetExactBinding)
	if err := os.WriteFile(machineLocalAssetEntryPathForTest(t, service, "asset-main"), testMachineLocalGGUFBytes('b'), 0o600); err != nil {
		t.Fatalf("drift bound bytes: %v", err)
	}

	response, err := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: configuration.GetConfigurationId()})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", err)
	}
	got := response.GetConfiguration()
	if got.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(got.GetExactBindings()) != 1 || !equalLocalCapabilityExactBinding(got.GetExactBindings()[0], want) {
		t.Fatalf("byte drift ambiently changed committed binding: %#v", got)
	}
}

func TestManualExactBindingFenceTracksOnlySelectedAssetRecord(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	seedMachineLocalAssetForTest(t, service, "asset-selected", 'a', "llm")
	seedMachineLocalAssetForTest(t, service, "asset-unrelated", 'b', "llm")
	inventory := service.snapshotLocalCapabilityAssetInventory()

	service.mu.Lock()
	service.assets["asset-unrelated"].DisplayName = "changed"
	if !inventory.exactAssetStillMatchesLocked(service, "asset-selected") {
		service.mu.Unlock()
		t.Fatal("unrelated asset mutation invalidated selected asset fence")
	}
	service.assets["asset-selected"].ArtifactRoles = []string{"mmproj"}
	if inventory.exactAssetStillMatchesLocked(service, "asset-selected") {
		service.mu.Unlock()
		t.Fatal("selected asset mutation passed exact fingerprint fence")
	}
	service.mu.Unlock()
}

func bindMachineLocalRequirementForTest(t *testing.T, service *Service, configurationID, requirementID, localAssetID, contentSHA256 string) *runtimev1.LocalCapabilityConfiguration {
	t.Helper()
	response, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configurationID,
		RequirementId:   requirementID,
		Target:          exactBindingTarget(localAssetID, contentSHA256),
	})
	if err != nil {
		t.Fatalf("BindLocalCapabilityRequirement: %v", err)
	}
	return response.GetConfiguration()
}

func stableDiffusionIdentityForTest() *runtimev1.CapabilityImplementationIdentity {
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.StableDiffusionImplementationID,
		DriverId:         capabilitydriver.StableDiffusionDriverID,
		DriverDialect:    capabilitydriver.StableDiffusionDriverDialect,
	}
}

func seedStableDiffusionMachineAssetForTest(
	t *testing.T,
	service *Service,
	localAssetID string,
	kind runtimev1.LocalAssetKind,
	family string,
) string {
	t.Helper()
	entry := "weights.gguf"
	payload := testMachineLocalGGUFBytes(localAssetID[0])
	digest := computeSHA256Bytes(payload)
	assetID := "test/" + localAssetID
	logicalModelID := ""
	var entryPath string
	if isRunnableKind(kind) {
		logicalModelID = "test/" + localAssetID
		entryPath = filepath.Join(service.localModelsPath, "resolved", filepath.FromSlash(logicalModelID), entry)
	} else {
		entryPath = filepath.Join(service.localModelsPath, slugifyLocalModelID(assetID), entry)
	}
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create Stable Diffusion asset directory: %v", err)
	}
	if err := os.WriteFile(entryPath, payload, 0o600); err != nil {
		t.Fatalf("write Stable Diffusion asset: %v", err)
	}
	capabilities := []string(nil)
	engine := "media"
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		capabilities = []string{capabilitydriver.StableDiffusionCapabilityContract}
	}
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		capabilities = []string{capabilitydriver.LlamaCapabilityContract}
		engine = "llama"
	}
	service.mu.Lock()
	service.assets[localAssetID] = &runtimev1.LocalAssetRecord{
		LocalAssetId:   localAssetID,
		AssetId:        assetID,
		Kind:           kind,
		Engine:         engine,
		Entry:          entry,
		Files:          []string{entry},
		Hashes:         map[string]string{entry: "sha256:" + digest},
		Capabilities:   capabilities,
		Family:         family,
		LogicalModelId: logicalModelID,
		Source:         &runtimev1.LocalAssetSource{Repo: "test-fixture", Revision: "1"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	service.mu.Unlock()
	return digest
}

func computeSHA256Bytes(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func exactBindingTarget(localAssetID, contentSHA256 string) *runtimev1.LocalAssetExactBindingTarget {
	return &runtimev1.LocalAssetExactBindingTarget{LocalAssetId: localAssetID, ExpectedVerifiedContentId: "sha256:" + contentSHA256}
}

func assertMachineLocalBindingAsset(t *testing.T, service *Service, configurationID, wantAssetID string) {
	t.Helper()
	response, err := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: configurationID})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", err)
	}
	bindings := response.GetConfiguration().GetExactBindings()
	if wantAssetID == "" {
		if len(bindings) != 0 {
			t.Fatalf("bindings = %#v, want none", bindings)
		}
		return
	}
	if len(bindings) != 1 || bindings[0].GetLocalAssetId() != wantAssetID {
		t.Fatalf("bindings = %#v, want asset %q", bindings, wantAssetID)
	}
}
