package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	testMainContentA  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testMainContentB  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	testMMProjContent = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
)

func TestMachineLocalConfigurationAddProjectsTextAndImageIntent(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())

	text := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	if text.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_INTERPRETABLE ||
		text.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("text state = %s/%s", text.GetInterpretability(), text.GetRequirementResolution())
	}
	if len(text.GetProjectedRequirements()) != 1 || text.GetProjectedRequirements()[0].GetRequirementId() != capabilitydriver.MainGGUFRequirementID || len(text.GetExactBindings()) != 0 {
		t.Fatalf("text projection = %#v", text)
	}
	assertLocalCapabilityReason(t, text, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING)

	image := addMachineLocalConfigurationForTest(t, service, nil, []string{" input.image ", "input.image"}, llamaIdentityForTest())
	if len(image.GetProjectedRequirements()) != 2 ||
		image.GetProjectedRequirements()[0].GetRequirementId() != capabilitydriver.MainGGUFRequirementID ||
		image.GetProjectedRequirements()[1].GetRequirementId() != capabilitydriver.CompanionMMProjRequirementID {
		t.Fatalf("image projection = %#v", image.GetProjectedRequirements())
	}
	if len(image.GetSupportedFeatures()) != 1 || image.GetSupportedFeatures()[0] != "input.image" {
		t.Fatalf("normalized features = %#v", image.GetSupportedFeatures())
	}

	aggregate, err := service.GetMachineLocalAIConfiguration(context.Background(), &runtimev1.GetMachineLocalAIConfigurationRequest{})
	if err != nil {
		t.Fatalf("GetMachineLocalAIConfiguration: %v", err)
	}
	if len(aggregate.GetAggregate().GetConfigurations()) != 2 {
		t.Fatalf("aggregate configurations = %d", len(aggregate.GetAggregate().GetConfigurations()))
	}
}

func TestMachineLocalConfigurationUpdateContextCapacityPreservesBindingAndSelection(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	created := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	bound, err := service.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: created.GetConfigurationId(),
		RequirementId:   capabilitydriver.MainGGUFRequirementID,
		Target: &runtimev1.LocalAssetExactBindingTarget{
			LocalAssetId:              "asset-main",
			ExpectedVerifiedContentId: "sha256:" + contentID,
		},
	})
	if err != nil {
		t.Fatalf("BindLocalCapabilityRequirement: %v", err)
	}
	if _, err := service.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		ConfigurationId:    created.GetConfigurationId(),
	}); err != nil {
		t.Fatalf("SelectLocalCapabilityConfiguration: %v", err)
	}

	updated, err := service.UpdateLocalCapabilityConfiguration(context.Background(), &runtimev1.UpdateLocalCapabilityConfigurationRequest{
		ConfigurationId:   created.GetConfigurationId(),
		PortableConfig:    mustStructForTest(t, map[string]any{"contextSize": 8192}),
		SupportedFeatures: created.GetSupportedFeatures(),
		DisplayName:       "Test llama configuration",
		Provenance:        created.GetProvenance(),
	})
	if err != nil {
		t.Fatalf("UpdateLocalCapabilityConfiguration: %v", err)
	}
	configuration := updated.GetConfiguration()
	if configuration.GetPortableConfig().GetFields()["contextSize"].GetNumberValue() != 8192 {
		t.Fatalf("updated portable config = %#v", configuration.GetPortableConfig())
	}
	if !proto.Equal(bound.GetConfiguration().GetExactBindings()[0], configuration.GetExactBindings()[0]) {
		t.Fatalf("update changed exact binding: before=%#v after=%#v", bound.GetConfiguration().GetExactBindings(), configuration.GetExactBindings())
	}
	aggregate, err := service.GetMachineLocalAIConfiguration(context.Background(), &runtimev1.GetMachineLocalAIConfigurationRequest{})
	if err != nil {
		t.Fatalf("GetMachineLocalAIConfiguration: %v", err)
	}
	if len(aggregate.GetAggregate().GetConfigurations()) != 1 || len(aggregate.GetAggregate().GetSelections()) != 1 ||
		aggregate.GetAggregate().GetSelections()[0].GetConfigurationId() != created.GetConfigurationId() {
		t.Fatalf("update changed record or selection identity: %#v", aggregate.GetAggregate())
	}
}

func TestMachineLocalConfigurationLegacyLlamaOccurrenceDefaultsAreLossless(t *testing.T) {
	binding := &runtimev1.LocalAssetExactBinding{
		RequirementId:     capabilitydriver.MainGGUFRequirementID,
		LocalAssetId:      "legacy-main",
		VerifiedContentId: "sha256:" + testMainContentA,
		EntrySha256:       testMainContentA,
	}
	configuration := &runtimev1.LocalCapabilityConfiguration{
		ConfigurationId:    "lcc_legacy",
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Implementation:     llamaIdentityForTest(),
		ProjectedRequirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.MainGGUFRequirementID,
			Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			ResourceKind:  "gguf",
			Policy:        runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		}},
		ExactBindings: []*runtimev1.LocalAssetExactBinding{proto.Clone(binding).(*runtimev1.LocalAssetExactBinding)},
	}
	canonicalizeStoredConfiguration(configuration)
	requirement := configuration.GetProjectedRequirements()[0]
	if requirement.GetOccurrenceOrdinal() != 0 || requirement.GetDisplayLabel() != capabilitydriver.MainGGUFRequirementID {
		t.Fatalf("legacy occurrence defaults = %#v", requirement)
	}
	if !proto.Equal(configuration.GetExactBindings()[0], binding) || configuration.GetCapabilityContract() != capabilitydriver.LlamaCapabilityContract ||
		!proto.Equal(configuration.GetImplementation(), llamaIdentityForTest()) {
		t.Fatalf("legacy llama intent or exact binding changed: %#v", configuration)
	}
}

func TestMachineLocalConfigurationAutoBindsExactMainAndMMProj(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	mainContentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	mmprojContentID := seedMachineLocalAssetForTest(t, service, "asset-mmproj", 'c', "mmproj")
	portable := mustStructForTest(t, map[string]any{
		"mainVerifiedContentId":   "sha256:" + mainContentID,
		"mmprojVerifiedContentId": "sha256:" + mmprojContentID,
	})
	configuration := addMachineLocalConfigurationForTest(t, service, portable, []string{"input.image"}, llamaIdentityForTest())
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(configuration.GetExactBindings()) != 2 {
		t.Fatalf("image exact configuration = %#v", configuration)
	}
	if configuration.GetExactBindings()[0].GetLocalAssetId() != "asset-main" || configuration.GetExactBindings()[1].GetLocalAssetId() != "asset-mmproj" {
		t.Fatalf("image exact bindings = %#v", configuration.GetExactBindings())
	}
}

func TestMachineLocalConfigurationAutoBindsCanonicalBundleDigestAndRejectsDrift(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	logicalModelID := "test/sd-bundle-main"
	mainEntry := "main.gguf"
	shardEntry := "weights-00002.data"
	mainPayload := testMachineLocalGGUFBytes('m')
	shardPayload := []byte("stable-diffusion-shard")
	mainDigest := computeSHA256Bytes(mainPayload)
	shardDigest := computeSHA256Bytes(shardPayload)
	bundleEntries := []capabilitydriver.BundleEntryDescriptor{
		{Ordinal: 1, SHA256: mainDigest},
		{Ordinal: 2, SHA256: shardDigest},
	}
	bundleDigest, err := capabilitydriver.CanonicalBundleSHA256(bundleEntries)
	if err != nil {
		t.Fatal(err)
	}
	bundleDir := filepath.Join(service.localModelsPath, "resolved", filepath.FromSlash(logicalModelID))
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("create bundle fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleDir, mainEntry), mainPayload, 0o600); err != nil {
		t.Fatalf("write bundle main: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleDir, shardEntry), shardPayload, 0o600); err != nil {
		t.Fatalf("write bundle shard: %v", err)
	}
	service.mu.Lock()
	service.assets["sd-bundle-main"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "sd-bundle-main",
		AssetId:      "test/sd-bundle-main",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Engine:       "media",
		Entry:        mainEntry,
		Files:        []string{mainEntry, shardEntry},
		Hashes: map[string]string{
			mainEntry:  "sha256:" + mainDigest,
			shardEntry: "sha256:" + shardDigest,
		},
		Capabilities:   []string{capabilitydriver.StableDiffusionCapabilityContract},
		LogicalModelId: logicalModelID,
		Family:         "z-image",
		Source:         &runtimev1.LocalAssetSource{Repo: "test-fixture", Revision: "1"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		BundleEntries: []*runtimev1.LocalBundleEntryDigest{
			{Ordinal: 1, RelativePath: mainEntry, Sha256: mainDigest},
			{Ordinal: 2, RelativePath: shardEntry, Sha256: shardDigest},
		},
	}
	service.mu.Unlock()
	portable := mustStructForTest(t, map[string]any{
		"modelFamily":           "z-image",
		"mainVerifiedContentId": "sha256:" + bundleDigest,
	})
	response, err := service.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		Implementation:     stableDiffusionIdentityForTest(),
		PortableConfig:     portable,
	})
	if err != nil {
		t.Fatalf("AddLocalCapabilityConfiguration: %v", err)
	}
	configuration := response.GetConfiguration()
	if len(configuration.GetExactBindings()) != 1 || configuration.GetExactBindings()[0].GetVerifiedContentId() != "sha256:"+bundleDigest ||
		configuration.GetExactBindings()[0].GetEntrySha256() != bundleDigest {
		t.Fatalf("canonical bundle exact binding = %#v", configuration.GetExactBindings())
	}
	if err := os.WriteFile(filepath.Join(bundleDir, shardEntry), []byte("drifted"), 0o600); err != nil {
		t.Fatalf("drift bundle shard: %v", err)
	}
	reprojected, err := service.ReprojectLocalCapabilityRequirements(context.Background(), &runtimev1.ReprojectLocalCapabilityRequirementsRequest{ConfigurationId: configuration.GetConfigurationId()})
	if err != nil {
		t.Fatalf("ReprojectLocalCapabilityRequirements: %v", err)
	}
	if len(reprojected.GetConfiguration().GetExactBindings()) != 0 {
		t.Fatalf("drifted bundle retained binding: %#v", reprojected.GetConfiguration().GetExactBindings())
	}
	assertLocalCapabilityReason(t, reprojected.GetConfiguration(), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH)
}

func TestMachineLocalConfigurationKeepsDriverMismatchReason(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-wrong-role", 'a', "mmproj")
	portable := mustStructForTest(t, map[string]any{"mainVerifiedContentId": "sha256:" + contentID})
	configuration := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 0 {
		t.Fatalf("incompatible exact content was bound: %#v", configuration.GetExactBindings())
	}
	assertLocalCapabilityReason(t, configuration, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE)
}

func TestMachineLocalConfigurationLeavesCrossOccurrenceCompatibilityToDriver(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-combined", 'a', "llm", "mmproj")
	portable := mustStructForTest(t, map[string]any{
		"mainVerifiedContentId":   "sha256:" + contentID,
		"mmprojVerifiedContentId": "sha256:" + contentID,
	})
	configuration := addMachineLocalConfigurationForTest(t, service, portable, []string{"input.image"}, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 2 {
		t.Fatalf("structurally exact bindings = %#v", configuration.GetExactBindings())
	}
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED {
		t.Fatalf("resolution = %s", configuration.GetRequirementResolution())
	}
}

func TestMachineLocalConfigurationCurrentRegistryControlsDerivedInterpretability(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	created := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	if created.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_INTERPRETABLE ||
		created.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED {
		t.Fatalf("created state = %s/%s", created.GetInterpretability(), created.GetRequirementResolution())
	}

	emptyRegistry, err := capabilitydriver.NewRegistry(nil)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	service.capabilityDrivers = emptyRegistry
	response, err := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: created.GetConfigurationId()})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", err)
	}
	derived := response.GetConfiguration()
	if derived.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNAVAILABLE {
		t.Fatalf("interpretability = %s, want unavailable", derived.GetInterpretability())
	}
	if derived.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(derived.GetExactBindings()) != 1 {
		t.Fatalf("driver loss changed persisted resolution: %#v", derived)
	}
	assertLocalCapabilityReason(t, derived, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED)
}

func TestMachineLocalConfigurationPersistsMissingDriverIntentAcrossRestart(t *testing.T) {
	root := t.TempDir()
	service := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	identity := llamaIdentityForTest()
	identity.DriverId = "nimi.runtime.driver.missing"
	created := addMachineLocalConfigurationForTest(t, service, nil, nil, identity)
	if created.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNAVAILABLE {
		t.Fatalf("interpretability = %s", created.GetInterpretability())
	}
	assertLocalCapabilityReason(t, created, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND)
	configurationID := created.GetConfigurationId()
	service.Close()

	restarted := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	defer restarted.Close()
	response, err := restarted.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: configurationID})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration after restart: %v", err)
	}
	restored := response.GetConfiguration()
	if restored.GetImplementation().GetDriverId() != identity.GetDriverId() || restored.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNAVAILABLE {
		t.Fatalf("restored configuration = %#v", restored)
	}
	assertLocalCapabilityReason(t, restored, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND)
}

func TestMachineLocalConfigurationAutoBindsOnlyPreferredExactVerifiedContent(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	mainContentID := seedMachineLocalAssetForTest(t, service, "asset-z", 'a', "llm")
	duplicateContentID := seedMachineLocalAssetForTest(t, service, "asset-a", 'a', "llm")
	seedMachineLocalAssetForTest(t, service, "asset-other", 'b', "llm")
	if duplicateContentID != mainContentID {
		t.Fatalf("identical fixture bytes produced different content identity")
	}

	portable := mustStructForTest(t, map[string]any{"mainVerifiedContentId": "sha256:" + mainContentID})
	configuration := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED {
		t.Fatalf("resolution = %s reasons=%v", configuration.GetRequirementResolution(), configuration.GetReasons())
	}
	if len(configuration.GetExactBindings()) != 1 {
		t.Fatalf("bindings = %#v", configuration.GetExactBindings())
	}
	binding := configuration.GetExactBindings()[0]
	if binding.GetLocalAssetId() != "asset-a" || binding.GetVerifiedContentId() != "sha256:"+mainContentID || binding.GetEntrySha256() != mainContentID {
		t.Fatalf("exact binding = %#v", binding)
	}
}

func TestMachineLocalConfigurationDoesNotAutoBindWithoutPreferredIdentity(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	seedMachineLocalAssetForTest(t, service, "asset-a", 'a', "llm")
	seedMachineLocalAssetForTest(t, service, "asset-b", 'b', "llm")

	configuration := addMachineLocalConfigurationForTest(t, service, nil, nil, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 0 || configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("constraint-only inventory was auto-bound: %#v", configuration)
	}
}

func TestMachineLocalConfigurationInventoryChangeRequiresExplicitReprojection(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	mainContentID := testMachineLocalContentSHA256('a')
	portable := mustStructForTest(t, map[string]any{"mainVerifiedContentId": "sha256:" + mainContentID})
	created := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	if len(created.GetExactBindings()) != 0 {
		t.Fatalf("initial bindings = %#v", created.GetExactBindings())
	}

	seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	read, err := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: created.GetConfigurationId()})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", err)
	}
	if len(read.GetConfiguration().GetExactBindings()) != 0 {
		t.Fatalf("inventory change ambiently mutated bindings: %#v", read.GetConfiguration().GetExactBindings())
	}

	reprojected, err := service.ReprojectLocalCapabilityRequirements(context.Background(), &runtimev1.ReprojectLocalCapabilityRequirementsRequest{ConfigurationId: created.GetConfigurationId()})
	if err != nil {
		t.Fatalf("ReprojectLocalCapabilityRequirements: %v", err)
	}
	if len(reprojected.GetConfiguration().GetExactBindings()) != 1 || reprojected.GetConfiguration().GetExactBindings()[0].GetLocalAssetId() != "asset-main" {
		t.Fatalf("reprojected bindings = %#v", reprojected.GetConfiguration().GetExactBindings())
	}
}

func TestMachineLocalConfigurationVerificationMismatchRemainsUnresolved(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	declaredContentID := testMachineLocalContentSHA256('b')
	service.mu.Lock()
	service.assets["asset-main"].Hashes["weights.gguf"] = "sha256:" + declaredContentID
	service.mu.Unlock()

	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + declaredContentID,
	}), nil, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 0 || configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("mismatched bytes were bound: %#v", configuration)
	}
	assertLocalCapabilityReason(t, configuration, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH)
}

func TestMachineLocalConfigurationMissingExactBytesRemainUnresolved(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	entryPath := machineLocalAssetEntryPathForTest(t, service, "asset-main")
	if err := os.Remove(entryPath); err != nil {
		t.Fatalf("remove LocalAsset fixture: %v", err)
	}

	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 0 || configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("missing bytes were bound: %#v", configuration)
	}
	assertLocalCapabilityReason(t, configuration, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND)
}

func TestMachineLocalConfigurationByteDriftRequiresExplicitReprojection(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	created := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	if created.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED {
		t.Fatalf("initial resolution = %s", created.GetRequirementResolution())
	}
	entryPath := machineLocalAssetEntryPathForTest(t, service, "asset-main")
	if err := os.WriteFile(entryPath, testMachineLocalGGUFBytes('b'), 0o600); err != nil {
		t.Fatalf("replace LocalAsset fixture bytes: %v", err)
	}

	read, err := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: created.GetConfigurationId()})
	if err != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", err)
	}
	if read.GetConfiguration().GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(read.GetConfiguration().GetExactBindings()) != 1 {
		t.Fatalf("byte drift ambiently changed committed binding: %#v", read.GetConfiguration())
	}

	reprojected, err := service.ReprojectLocalCapabilityRequirements(context.Background(), &runtimev1.ReprojectLocalCapabilityRequirementsRequest{ConfigurationId: created.GetConfigurationId()})
	if err != nil {
		t.Fatalf("ReprojectLocalCapabilityRequirements: %v", err)
	}
	if reprojected.GetConfiguration().GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED || len(reprojected.GetConfiguration().GetExactBindings()) != 0 {
		t.Fatalf("explicit reprojection retained drifted binding: %#v", reprojected.GetConfiguration())
	}
	assertLocalCapabilityReason(t, reprojected.GetConfiguration(), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH)
}

func TestMachineLocalConfigurationAttachedOnlyRecordCannotAutoBind(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	contentID := testMachineLocalContentSHA256('a')
	service.mu.Lock()
	service.assets["asset-attached"] = &runtimev1.LocalAssetRecord{
		LocalAssetId:  "asset-attached",
		AssetId:       "remote-only",
		Kind:          runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:        "llama",
		Entry:         "weights.gguf",
		Files:         []string{"weights.gguf"},
		Hashes:        map[string]string{"weights.gguf": "sha256:" + contentID},
		Source:        &runtimev1.LocalAssetSource{Repo: "https://example.invalid/model", Revision: "main"},
		ArtifactRoles: []string{"llm"},
	}
	service.mu.Unlock()

	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	if len(configuration.GetExactBindings()) != 0 || configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("attached-only record was bound: %#v", configuration)
	}
}

func TestMachineLocalConfigurationStoreFailureRollsBackMemory(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	portable := mustStructForTest(t, map[string]any{"mainVerifiedContentId": "sha256:" + testMachineLocalContentSHA256('a')})
	baseline := addMachineLocalConfigurationForTest(t, service, portable, nil, llamaIdentityForTest())
	seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")
	service.machineLocalConfigurationStore = failingMachineLocalConfigurationStore{err: errors.New("disk full")}

	_, err := service.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Implementation:     llamaIdentityForTest(),
	})
	if status.Code(err) != codes.Internal {
		t.Fatalf("AddLocalCapabilityConfiguration error = %v", err)
	}
	aggregate, getErr := service.GetMachineLocalAIConfiguration(context.Background(), &runtimev1.GetMachineLocalAIConfigurationRequest{})
	if getErr != nil {
		t.Fatalf("GetMachineLocalAIConfiguration: %v", getErr)
	}
	configurations := aggregate.GetAggregate().GetConfigurations()
	if len(configurations) != 1 || configurations[0].GetConfigurationId() != baseline.GetConfigurationId() {
		t.Fatalf("memory changed after failed write: %#v", configurations)
	}
	_, err = service.ReprojectLocalCapabilityRequirements(context.Background(), &runtimev1.ReprojectLocalCapabilityRequirementsRequest{ConfigurationId: baseline.GetConfigurationId()})
	if status.Code(err) != codes.Internal {
		t.Fatalf("ReprojectLocalCapabilityRequirements error = %v", err)
	}
	read, getErr := service.GetLocalCapabilityConfiguration(context.Background(), &runtimev1.GetLocalCapabilityConfigurationRequest{ConfigurationId: baseline.GetConfigurationId()})
	if getErr != nil {
		t.Fatalf("GetLocalCapabilityConfiguration: %v", getErr)
	}
	if len(read.GetConfiguration().GetExactBindings()) != 0 {
		t.Fatalf("failed reproject changed memory: %#v", read.GetConfiguration().GetExactBindings())
	}
}

type failingMachineLocalConfigurationStore struct {
	err error
}

func (failingMachineLocalConfigurationStore) Load() ([]*storedLocalCapabilityConfiguration, []*runtimev1.LocalCapabilitySelection, error) {
	return nil, nil, nil
}

func (store failingMachineLocalConfigurationStore) Save([]*storedLocalCapabilityConfiguration, []*runtimev1.LocalCapabilitySelection) error {
	return store.err
}

func newMachineLocalConfigurationTestService(t *testing.T, root string) *Service {
	t.Helper()
	service := newMachineLocalConfigurationTestServiceWithoutCleanup(t, root)
	t.Cleanup(service.Close)
	return service
}

func newMachineLocalConfigurationTestServiceWithoutCleanup(t *testing.T, root string) *Service {
	t.Helper()
	service, err := New(nil, nil, filepath.Join(root, "local-state.json"), 0, filepath.Join(root, "models"))
	if err != nil {
		t.Fatalf("New local service: %v", err)
	}
	return service
}

func addMachineLocalConfigurationForTest(t *testing.T, service *Service, portable *structpb.Struct, features []string, identity *runtimev1.CapabilityImplementationIdentity) *runtimev1.LocalCapabilityConfiguration {
	t.Helper()
	response, err := service.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Implementation:     identity,
		PortableConfig:     portable,
		SupportedFeatures:  features,
		DisplayName:        "Test llama configuration",
	})
	if err != nil {
		t.Fatalf("AddLocalCapabilityConfiguration: %v", err)
	}
	return response.GetConfiguration()
}

func llamaIdentityForTest() *runtimev1.CapabilityImplementationIdentity {
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.LlamaImplementationID,
		DriverId:         capabilitydriver.LlamaDriverID,
		DriverDialect:    capabilitydriver.LlamaDriverDialect,
	}
}

func seedMachineLocalAssetForTest(t *testing.T, service *Service, localAssetID string, marker byte, artifactRoles ...string) string {
	t.Helper()
	logicalModelID := "test/" + localAssetID
	entry := "weights.gguf"
	payload := testMachineLocalGGUFBytes(marker)
	sum := sha256.Sum256(payload)
	entrySHA256 := hex.EncodeToString(sum[:])
	entryPath := filepath.Join(service.localModelsPath, "resolved", filepath.FromSlash(logicalModelID), entry)
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create LocalAsset fixture directory: %v", err)
	}
	if err := os.WriteFile(entryPath, payload, 0o600); err != nil {
		t.Fatalf("write LocalAsset fixture: %v", err)
	}
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:   localAssetID,
		AssetId:        "catalog-independent-" + localAssetID,
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          entry,
		Files:          []string{entry},
		Hashes:         map[string]string{entry: "sha256:" + entrySHA256},
		Capabilities:   []string{capabilitydriver.LlamaCapabilityContract},
		LogicalModelId: logicalModelID,
		Source:         &runtimev1.LocalAssetSource{Repo: "test-fixture", Revision: "1"},
		ArtifactRoles:  append([]string(nil), artifactRoles...),
	}
	service.mu.Lock()
	service.assets[localAssetID] = asset
	service.mu.Unlock()
	return entrySHA256
}

func testMachineLocalGGUFBytes(marker byte) []byte {
	payload := bytes.Repeat([]byte{marker}, minManagedGGUFSizeBytes)
	copy(payload, []byte(ggufMagicHeader))
	return payload
}

func testMachineLocalContentSHA256(marker byte) string {
	sum := sha256.Sum256(testMachineLocalGGUFBytes(marker))
	return hex.EncodeToString(sum[:])
}

func machineLocalAssetEntryPathForTest(t *testing.T, service *Service, localAssetID string) string {
	t.Helper()
	service.mu.RLock()
	asset := cloneLocalAsset(service.assets[localAssetID])
	modelsRoot := service.localModelsPath
	service.mu.RUnlock()
	path, err := resolveManagedModelEntryAbsolutePath(modelsRoot, asset)
	if err != nil {
		t.Fatalf("resolve LocalAsset fixture entry: %v", err)
	}
	return path
}

func TestMachineLocalConfigurationDoesNotInferEntryHashFromUnrelatedSoleFile(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	service.mu.Lock()
	service.assets["asset_malformed"] = &runtimev1.LocalAssetRecord{
		LocalAssetId:  "asset_malformed",
		Engine:        "llama",
		Entry:         "expected.gguf",
		Files:         []string{"different.gguf"},
		Hashes:        map[string]string{"different.gguf": "sha256:" + testMainContentA},
		ArtifactRoles: []string{"llm"},
	}
	service.mu.Unlock()

	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + testMainContentA,
	}), nil, llamaIdentityForTest())
	if got := len(configuration.GetExactBindings()); got != 0 {
		t.Fatalf("exact bindings = %d, want 0", got)
	}
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED {
		t.Fatalf("requirement resolution = %s, want unresolved", configuration.GetRequirementResolution())
	}
}

func TestMachineLocalConfigurationDriverCannotMutateCanonicalProjection(t *testing.T) {
	service := newMachineLocalConfigurationTestService(t, t.TempDir())
	registry, err := capabilitydriver.NewRegistry(map[capabilitydriver.RegistrationKey]capabilitydriver.Driver{
		{
			CapabilityContract: capabilitydriver.LlamaCapabilityContract,
			Identity: capabilitydriver.Identity{
				ImplementationID: capabilitydriver.LlamaImplementationID,
				DriverID:         capabilitydriver.LlamaDriverID,
				DriverDialect:    capabilitydriver.LlamaDriverDialect,
			},
		}: mutatingBindingDriver{},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	service.capabilityDrivers = registry
	contentID := seedMachineLocalAssetForTest(t, service, "asset-main", 'a', "llm")

	configuration := addMachineLocalConfigurationForTest(t, service, mustStructForTest(t, map[string]any{
		"mainVerifiedContentId": "sha256:" + contentID,
	}), nil, llamaIdentityForTest())
	if configuration.GetProjectedRequirements()[0].GetRequirementId() != capabilitydriver.MainGGUFRequirementID {
		t.Fatalf("driver mutated canonical requirement: %#v", configuration.GetProjectedRequirements())
	}
	if configuration.GetExactBindings()[0].GetLocalAssetId() != "asset-main" {
		t.Fatalf("driver mutated canonical binding: %#v", configuration.GetExactBindings())
	}
}

type mutatingBindingDriver struct {
	capabilitydriver.LlamaTextDriver
}

func (driver mutatingBindingDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset capabilitydriver.AssetDescriptor) runtimev1.LocalCapabilityReason {
	reason := driver.LlamaTextDriver.ValidateBinding(requirement, binding, asset)
	requirement.RequirementId = "mutated.requirement"
	binding.LocalAssetId = "mutated-asset"
	if len(asset.ArtifactRoles) > 0 {
		asset.ArtifactRoles[0] = "mutated-role"
	}
	return reason
}

func mustStructForTest(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(fields)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return value
}

func assertLocalCapabilityReason(t *testing.T, configuration *runtimev1.LocalCapabilityConfiguration, wanted runtimev1.LocalCapabilityReason) {
	t.Helper()
	for _, reason := range configuration.GetReasons() {
		if reason == wanted {
			return
		}
	}
	t.Fatalf("reasons = %v, want %s", configuration.GetReasons(), wanted)
}
