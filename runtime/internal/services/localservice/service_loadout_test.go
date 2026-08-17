package localservice

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestLoadoutPrepareCommitSelectAndResolveGemmaModelAsset(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "Gemma primary", asset)
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED || !prepared.GetProposedLoadout().GetModelAxes()[0].GetRecipeCompatible() {
		t.Fatalf("prepared Loadout = %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if committed.GetLoadoutId() == "" || committed.GetRecipeId() != capabilitydriver.LlamaGemma4E2BRecipeID || len(committed.GetRecipeCustody()) != 0 {
		t.Fatalf("committed Loadout = %+v", committed)
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract, LoadoutId: committed.GetLoadoutId()}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("SelectLoadout without confirmation = %v", err)
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.LoadoutID != committed.GetLoadoutId() || resolved.RecipeID != capabilitydriver.LlamaGemma4E2BRecipeID || len(resolved.ExactBindings) != 1 || resolved.ExactBindings[0].ModelAssetID != asset.GetModelAssetId() || !filepath.IsAbs(resolved.ExactBindings[0].AbsolutePath) || resolved.ModelContextWindowTokens != 262144 ||
		resolved.ExecutionTarget == nil || resolved.ExecutionTarget.GetLocalRuntime().GetReadinessRef() != "model-asset://"+asset.GetModelAssetId() {
		t.Fatalf("ResolvedAssembly = %+v", resolved)
	}
}

func TestPrepareLoadoutExplicitContentOnlyAxisSuppressesReceiverRecommendation(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	recipe, ok := svc.localProviderCatalog.LoadoutRecipe(capabilitydriver.LlamaGemma4E2BRecipeID)
	if !ok || len(recipe.SlotMetadata) != 1 || len(recipe.SlotMetadata[0].RecommendedContentIDs) == 0 {
		t.Fatalf("Gemma recipe recommendation = %+v", recipe)
	}
	recommended := &runtimev1.ModelAssetRecord{
		ModelAssetId: "receiver-recommended", ContentId: recipe.SlotMetadata[0].RecommendedContentIDs[0], ContentVerified: true,
	}
	svc.mu.Lock()
	svc.modelAssets[recommended.GetModelAssetId()] = recommended
	svc.mu.Unlock()
	profileContentID := "sha256:" + strings.Repeat("f", 64)
	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		RecipeId:           capabilitydriver.LlamaGemma4E2BRecipeID,
		DisplayName:        "Explicit content-only Profile axis",
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{
			SlotId: capabilitydriver.MainGGUFRequirementID, ExpectedContentId: profileContentID,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	axes := prepared.GetProposedLoadout().GetModelAxes()
	if len(axes) != 1 || axes[0].GetModelAssetId() != "" || axes[0].GetExpectedContentId() != profileContentID ||
		prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNRESOLVED {
		t.Fatalf("explicit content-only axis was replaced by receiver recommendation: %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if committed.GetModelAxes()[0].GetExpectedContentId() != profileContentID {
		t.Fatalf("committed content-only axis = %+v", committed.GetModelAxes())
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true,
	}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED {
		t.Fatalf("content-only SelectLoadout = %v", err)
	}
}

func TestStoredLoadoutSurvivesCatalogRecipeRevisionUpgradeAndRemovalWithoutExecutionCatalogReads(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "custody snapshot", asset)
	fakeRecipe, ok := svc.localProviderCatalog.LoadoutRecipe(capabilitydriver.LlamaGemma4E2BRecipeID)
	if !ok {
		t.Fatal("Gemma recipe fixture is unavailable")
	}
	fakeRecipe.Custody = []catalog.LocalRecipeCustody{{
		File: "loader/config.json", SHA256: "sha256:" + strings.Repeat("a", 64), Source: "test-fixture", Role: "loader-config",
	}}
	held := svc.heldLoadoutPrepares[prepared.GetPrepareId()]
	held.recipe = fakeRecipe
	svc.heldLoadoutPrepares[prepared.GetPrepareId()] = held

	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	currentRecipeRevision := committed.GetRecipeRevision()
	if got := committed.GetRecipeCustody(); len(got) != 1 || got[0].GetCustodyId() != capabilitydriver.LlamaGemma4E2BRecipeID+"/loader/config.json" || got[0].GetExpectedContentId() != "sha256:"+strings.Repeat("a", 64) {
		t.Fatalf("committed recipe custody = %+v", got)
	}
	svc.mu.RLock()
	stored := cloneLoadout(svc.loadouts[committed.GetLoadoutId()])
	svc.mu.RUnlock()
	if !proto.Equal(stored.GetRecipeCustody()[0], committed.GetRecipeCustody()[0]) {
		t.Fatalf("stored Loadout did not retain self-contained custody: %+v", stored)
	}
	// Model a Loadout committed under the previous catalog revision. The stored
	// recipe revision is immutable input; the current catalog must not rewrite it.
	svc.mu.Lock()
	svc.loadouts[committed.GetLoadoutId()].RecipeRevision = "previous-revision"
	persistErr := svc.loadoutStore.Save(svc.loadoutRowsLocked(), svc.loadoutSelectionRowsLocked())
	svc.mu.Unlock()
	if persistErr != nil {
		t.Fatalf("persist previous-revision Loadout: %v", persistErr)
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	svc.localProviderCatalog = nil
	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.RecipeRevision != "previous-revision" {
		t.Fatalf("catalog upgrade rewrote stored recipe revision: %q", resolved.RecipeRevision)
	}
	if got := resolved.RecipeCustody; len(got) != 1 || !proto.Equal(got[0], committed.GetRecipeCustody()[0]) {
		t.Fatalf("resolved frozen recipe custody = %+v", got)
	}

	newSvc, newAsset := loadoutGemmaFixture(t)
	newPrepared := prepareGemmaLoadoutForTest(t, newSvc, context.Background(), "", "current catalog recommendation", newAsset)
	if got := newPrepared.GetProposedLoadout().GetRecipeRevision(); got != currentRecipeRevision || got == "previous-revision" {
		t.Fatalf("new Loadout recipe revision = %q, want current %q", got, currentRecipeRevision)
	}
}

func TestVoxCPMLoadoutDirectoryAssetUsesEntryAndStructuralContract(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	svc := newLoadoutTestService(t, t.TempDir())
	asset := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", voxcpm2SafetensorsLoadoutTestBytes())
	if asset.GetEntry() != "model.safetensors" || len(asset.GetFiles()) < 3 {
		t.Fatalf("VoxCPM directory ModelAsset = %+v", asset)
	}
	prepared := prepareVoxCPMLoadoutForTest(t, svc, "VoxCPM directory", asset)
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("prepared VoxCPM Loadout = %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if committed.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED || len(committed.GetRecipeCustody()) != 0 {
		t.Fatalf("committed VoxCPM Loadout = %+v", committed)
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.AudioSynthesizeContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	projection, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	selections := projection.GetAggregate().GetSelections()
	if len(selections) != 1 || selections[0].GetCapabilityContract() != capabilitydriver.AudioSynthesizeContract || selections[0].GetEffectiveDefaults() != nil {
		t.Fatalf("VoxCPM selection defaults = %+v, want nil", selections)
	}
	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.AudioSynthesizeContract)
	if err != nil {
		t.Fatal(err)
	}
	wantIdentity := (&capabilitydriver.Identity{
		ImplementationID: capabilitydriver.VoxCPMImplementationID,
		DriverID:         capabilitydriver.VoxCPMDriverID,
		DriverDialect:    capabilitydriver.VoxCPMDriverDialect,
	}).Proto()
	if !resolved.Configured || resolved.LoadoutID != committed.GetLoadoutId() ||
		resolved.CapabilityContract != capabilitydriver.AudioSynthesizeContract || resolved.RecipeID != capabilitydriver.VoxCPMRecipeID || resolved.RecipeRevision != "2" ||
		resolved.PortableConfig == nil || len(resolved.PortableConfig.GetFields()) != 0 ||
		!proto.Equal(resolved.DriverIdentity, wantIdentity) || len(resolved.Requirements) != 1 || len(resolved.ExactBindings) != 1 {
		t.Fatalf("resolved VoxCPM execution shape = %+v", resolved)
	}
	svc.mu.RLock()
	wantEntry := filepath.Join(svc.modelAssetDirectories[asset.GetModelAssetId()], "model.safetensors")
	svc.mu.RUnlock()
	if resolved.ExactBindings[0].ModelAssetID != asset.GetModelAssetId() || resolved.ExactBindings[0].AbsolutePath != wantEntry || !filepath.IsAbs(resolved.ExactBindings[0].AbsolutePath) ||
		resolved.ExactBindings[0].BundleDir != filepath.Dir(wantEntry) || len(resolved.ExactBindings[0].DeclaredFiles) != len(asset.GetFiles()) {
		t.Fatalf("resolved VoxCPM axis = %+v, want asset %q entry %q and %d declared files", resolved.ExactBindings, asset.GetModelAssetId(), wantEntry, len(asset.GetFiles()))
	}
	binding := resolved.ExactBindings[0]
	plan, err := (capabilitydriver.VoxCPMDriver{}).PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
		PortableConfig: resolved.PortableConfig,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID: binding.RequirementID, ModelAssetID: binding.ModelAssetID,
			AbsolutePath: binding.AbsolutePath, BundleDir: binding.BundleDir, DeclaredFiles: append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: binding.VerifiedContentID, EntrySHA256: binding.EntrySHA256,
		}},
		Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "live VoxCPM reproduction"},
	})
	if err != nil || plan == nil || plan.ModelAssetID() != asset.GetModelAssetId() {
		t.Fatalf("VoxCPM selected assembly was not executable: plan=%+v err=%v", plan, err)
	}
}

func TestVoxCPMMLXLoadoutUsesDarwinArm64PrivateContract(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	svc := newLoadoutTestService(t, t.TempDir())
	mlxAsset := importVoxCPMModelAssetForLoadoutTest(
		t, svc, "voxcpm2", safetensorsLoadoutTestBytes(map[string][]int64{"model.embed_tokens.weight": {32000, 2048}}),
		"audiovae.pth", "tokenization_voxcpm2.py",
	)
	prepared := prepareVoxCPMLoadoutForTest(t, svc, "VoxCPM MLX", mlxAsset)
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("Darwin/arm64 MLX proposal = %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if committed.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("Darwin/arm64 MLX Loadout = %+v", committed)
	}
}

func TestVoxCPMBackendContractsRejectCrossPostureAssets(t *testing.T) {
	t.Run("standard rejects MLX", func(t *testing.T) {
		setLocalRuntimePlatformForTest(t, "windows", "amd64")
		svc := newLoadoutTestService(t, t.TempDir())
		mlxAsset := importVoxCPMModelAssetForLoadoutTest(
			t, svc, "voxcpm2", safetensorsLoadoutTestBytes(map[string][]int64{"model.embed_tokens.weight": {32000, 2048}}),
			"audiovae.pth", "tokenization_voxcpm2.py",
		)
		_, err := svc.PrepareLoadout(context.Background(), voxCPMLoadoutRequestForTest("MLX on standard", mlxAsset))
		if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED {
			t.Fatalf("standard accepted MLX asset: %v", err)
		}
	})
	t.Run("MLX rejects standard", func(t *testing.T) {
		setLocalRuntimePlatformForTest(t, "darwin", "arm64")
		svc := newLoadoutTestService(t, t.TempDir())
		standardAsset := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", voxcpm2SafetensorsLoadoutTestBytes())
		_, err := svc.PrepareLoadout(context.Background(), voxCPMLoadoutRequestForTest("standard on MLX", standardAsset))
		if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED {
			t.Fatalf("MLX accepted standard asset: %v", err)
		}
	})
}

func TestVoxCPMRecommendationsFollowPrivateHostBackend(t *testing.T) {
	for _, test := range []struct {
		name, goos, goarch, backend string
		wantVariants                int
	}{
		{name: "Windows standard", goos: "windows", goarch: "amd64", backend: capabilitydriver.VoxCPMBackendStandard, wantVariants: 1},
		{name: "Darwin MLX", goos: "darwin", goarch: "arm64", backend: capabilitydriver.VoxCPMBackendMLX, wantVariants: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			setLocalRuntimePlatformForTest(t, test.goos, test.goarch)
			svc := newLoadoutTestService(t, t.TempDir())
			recipe, ok := svc.localProviderCatalog.LoadoutRecipe(capabilitydriver.VoxCPMRecipeID)
			if !ok || len(recipe.SlotMetadata) != 1 {
				t.Fatalf("VoxCPM recipe = %+v", recipe)
			}
			_, requirements, err := svc.projectRecipe(
				recipe.RecipeID, recipe.CapabilityContract,
				(&capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}).Proto(),
				&structpb.Struct{}, nil,
			)
			if err != nil || len(requirements) != 1 || requirements[0].GetCompatibilityConstraints().GetFields()["driver_backend"].GetStringValue() != test.backend {
				t.Fatalf("private VoxCPM projection = %+v err=%v", requirements, err)
			}
			contentIDs := svc.recommendedContentIDsForRequirement(recipe.SlotMetadata[0], requirements[0])
			if len(contentIDs) != test.wantVariants || !strings.HasPrefix(contentIDs[0], "sha256:") {
				t.Fatalf("private VoxCPM recommendations = %+v", contentIDs)
			}
		})
	}
}

func TestResolveLocalEnvironmentPlanForFreshCustomVoxCPMLoadoutUsesConsumerProfileOnly(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	root := t.TempDir()
	svc, err := NewWithProductControlDataRoot(nil, nil, filepath.Join(root, "local-state.json"), 0, filepath.Join(root, "models"), root)
	if err != nil {
		t.Fatalf("construct Product Control-bound local service: %v", err)
	}
	t.Cleanup(svc.Close)
	svc.SetEngineManager(&mockEngineManager{})
	asset := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", voxcpm2SafetensorsLoadoutTestBytes())
	prepared := prepareVoxCPMLoadoutForTest(t, svc, "Fresh custom VoxCPM", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     capabilitydriver.AudioSynthesizeContract,
		LoadoutId:              committed.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatalf("select custom VoxCPM Loadout: %v", err)
	}

	response, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		HostProfile:        localEnvironmentNvidiaProfile(),
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentPlan: %v", err)
	}
	plan := response.GetPlan()
	if plan.GetState() != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("fresh environment plan state = %q, want confirmable setup plan: %+v", plan.GetState(), plan)
	}
	dependenciesByFamily := make(map[string]*runtimev1.LocalEnvironmentPlanDependency)
	for _, dependency := range plan.GetDependencies() {
		if dependency.GetState() == localEnvironmentStateUnsupported {
			t.Fatalf("fresh environment plan contains unsupported dependency: %+v", dependency)
		}
		dependenciesByFamily[dependency.GetDependencyFamily()] = dependency
	}
	for _, family := range []string{
		localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel,
	} {
		dependency := dependenciesByFamily[family]
		if dependency == nil || dependency.GetDependencyId() == "" || dependency.GetEnvironmentKey() == "" || dependency.GetConsumerScope() == "" {
			t.Fatalf("fresh custom plan Python line %s is incomplete: %+v", family, dependency)
		}
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("environment planning mutated ModelAsset inventory: count=%d", len(svc.modelAssets))
	}
}

func TestLoadoutJobAdmissionRehashesEveryPayloadWhileProjectionUsesCache(t *testing.T) {
	root := t.TempDir()
	svc := newLoadoutTestService(t, root)
	source := filepath.Join(root, "job-admission-gemma")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "model.gguf"), validGemma4TestGGUF(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "tokenizer.json"), []byte(`{"model":"job-admission-fixture"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "Job admission Gemma")
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "Job admission rehash", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     capabilitydriver.LlamaCapabilityContract,
		LoadoutId:              committed.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatal(err)
	}

	hashCalls := 0
	svc.mu.Lock()
	svc.entryHashCache = make(map[string]entryHashCacheState)
	bundleDir := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.entryFileSHA256 = func(path string) (string, error) {
		hashCalls++
		return computeFileSHA256(path)
	}
	svc.mu.Unlock()
	declaredFileCount := len(asset.GetFiles())
	if declaredFileCount == 0 {
		t.Fatal("ModelAsset fixture has no declared payloads")
	}

	firstProjection, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	projected := findLoadout(firstProjection.GetAggregate().GetLoadouts(), committed.GetLoadoutId())
	if projected == nil || projected.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("first cached projection = %+v", projected)
	}
	if hashCalls != declaredFileCount {
		t.Fatalf("first projection hash calls = %d, want %d", hashCalls, declaredFileCount)
	}
	if _, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{}); err != nil {
		t.Fatal(err)
	}
	if hashCalls != declaredFileCount {
		t.Fatalf("second projection reread payloads: calls=%d", hashCalls)
	}

	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if err != nil {
		t.Fatalf("fresh Job admission: %v", err)
	}
	if hashCalls != 2*declaredFileCount {
		t.Fatalf("first Job admission hash calls = %d, want %d", hashCalls, 2*declaredFileCount)
	}
	expectedEntrySHA := ""
	for _, file := range asset.GetFiles() {
		if file.GetRelativePath() == asset.GetEntry() {
			expectedEntrySHA = file.GetSha256()
		}
	}
	if len(resolved.ExactBindings) != 1 || resolved.ExactBindings[0].EntrySHA256 != expectedEntrySHA ||
		len(resolved.ExactBindings[0].DeclaredFiles) != declaredFileCount {
		t.Fatalf("fresh ResolvedAssembly verification = %+v", resolved.ExactBindings)
	}
	if _, err := svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract); err != nil {
		t.Fatalf("second fresh Job admission: %v", err)
	}
	if hashCalls != 3*declaredFileCount {
		t.Fatalf("second Job admission did not reread every payload: calls=%d", hashCalls)
	}

	entryPath := filepath.Join(bundleDir, filepath.FromSlash(asset.GetEntry()))
	originalInfo, err := os.Stat(entryPath)
	if err != nil {
		t.Fatal(err)
	}
	drifted, err := os.ReadFile(entryPath)
	if err != nil {
		t.Fatal(err)
	}
	drifted[len(drifted)-1] ^= 0x01
	if err := os.WriteFile(entryPath, drifted, originalInfo.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(entryPath, originalInfo.ModTime(), originalInfo.ModTime()); err != nil {
		t.Fatal(err)
	}

	cachedProjection, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	projected = findLoadout(cachedProjection.GetAggregate().GetLoadouts(), committed.GetLoadoutId())
	if projected == nil || projected.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("projection did not retain imported identity fact after metadata rollback: %+v", projected)
	}
	if hashCalls != 3*declaredFileCount {
		t.Fatalf("cached projection reread same-size, same-mtime drift: calls=%d", hashCalls)
	}
	_, err = svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH || !strings.Contains(status.Convert(err).Message(), "byte drift") {
		t.Fatalf("Job admission drift rejection = reason:%s err:%v", grpcReasonForTest(err), err)
	}
	if hashCalls != 4*declaredFileCount {
		t.Fatalf("drifted Job admission did not reread every payload: calls=%d", hashCalls)
	}
}

func TestLoadoutJobAdmissionRejectsUndeclaredBundlePayload(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "Gemma undeclared payload", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     capabilitydriver.LlamaCapabilityContract,
		LoadoutId:              committed.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatal(err)
	}
	svc.mu.RLock()
	bundleDir := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	if err := os.WriteFile(filepath.Join(bundleDir, "generation_config.json"), []byte(`{"undeclared":true}`), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := svc.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
		t.Fatalf("undeclared bundle payload admission = reason:%s err:%v", grpcReasonForTest(err), err)
	}
}

func TestQwen3SpeechLoadoutsResolveExecutableSelectedAssembly(t *testing.T) {
	tests := []struct {
		name, contract, recipeID, requirementID string
		identity                                capabilitydriver.Identity
		features                                []string
	}{
		{
			name: "tts", contract: capabilitydriver.AudioSynthesizeContract,
			recipeID: capabilitydriver.Qwen3TTSCustomVoiceRecipeID, requirementID: capabilitydriver.Qwen3TTSModelRequirementID,
			identity: capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3TTSImplementationID, DriverID: capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3TTSDriverDialect},
		},
		{
			name: "voice-clone", contract: capabilitydriver.VoiceCreateContract,
			recipeID: capabilitydriver.Qwen3VoiceCloneRecipeID, requirementID: capabilitydriver.Qwen3VoiceCreateModelRequirementID,
			identity: capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3VoiceCreateImplementationID, DriverID: capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3VoiceCreateDriverDialect},
			features: []string{"input.audio"},
		},
		{
			name: "voice-design", contract: capabilitydriver.VoiceCreateContract,
			recipeID: capabilitydriver.Qwen3VoiceDesignRecipeID, requirementID: capabilitydriver.Qwen3VoiceCreateModelRequirementID,
			identity: capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3VoiceCreateImplementationID, DriverID: capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3VoiceCreateDriverDialect},
			features: []string{"input.text"},
		},
		{
			name: "asr", contract: capabilitydriver.AudioTranscribeContract,
			recipeID: capabilitydriver.Qwen3ASRRecipeID, requirementID: capabilitydriver.Qwen3ASRModelRequirementID,
			identity: capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3ASRImplementationID, DriverID: capabilitydriver.Qwen3ASRDriverID, DriverDialect: capabilitydriver.Qwen3ASRDriverDialect},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newLoadoutTestService(t, t.TempDir())
			asset := importSpeechModelAssetForLoadoutTest(t, svc, test.name)
			prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
				CapabilityContract: test.contract, RecipeId: test.recipeID, Options: &structpb.Struct{}, DisplayName: "Qwen3 " + test.name,
				SupportedFeatures: test.features,
				ModelAxes:         []*runtimev1.LoadoutModelAxisInput{{SlotId: test.requirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
			})
			if err != nil {
				t.Fatalf("PrepareLoadout(%s): %v", test.recipeID, err)
			}
			committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
			if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: test.contract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
				t.Fatalf("SelectLoadout(%s): %v", test.recipeID, err)
			}
			resolved, err := svc.ResolveSelectedLocalExecution(test.contract)
			if err != nil {
				t.Fatalf("ResolveSelectedLocalExecution(%s): %v", test.contract, err)
			}
			if !resolved.Configured || resolved.LoadoutID != committed.GetLoadoutId() || resolved.CapabilityContract != test.contract ||
				resolved.RecipeID != test.recipeID || resolved.RecipeRevision != "1" || resolved.PortableConfig == nil || len(resolved.PortableConfig.GetFields()) != 0 ||
				!proto.Equal(resolved.DriverIdentity, test.identity.Proto()) || len(resolved.Requirements) != 1 || len(resolved.ExactBindings) != 1 ||
				resolved.ExactBindings[0].ModelAssetID != asset.GetModelAssetId() ||
				resolved.ExactBindings[0].BundleDir == "" || len(resolved.ExactBindings[0].DeclaredFiles) != len(asset.GetFiles()) {
				t.Fatalf("resolved %s execution = %+v", test.recipeID, resolved)
			}
			binding := resolved.ExactBindings[0]
			invocationBinding := capabilitydriver.InvocationExactBinding{
				RequirementID: binding.RequirementID, ModelAssetID: binding.ModelAssetID,
				AbsolutePath: binding.AbsolutePath, BundleDir: binding.BundleDir, DeclaredFiles: append([]string(nil), binding.DeclaredFiles...),
				VerifiedContentID: binding.VerifiedContentID, EntrySHA256: binding.EntrySHA256,
			}
			driver, reason := svc.capabilityDrivers.Resolve(test.contract, capabilitydriver.IdentityFromProto(resolved.DriverIdentity))
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
				t.Fatalf("Resolve Driver(%s): driver=%T reason=%s", test.recipeID, driver, reason)
			}
			switch typed := driver.(type) {
			case capabilitydriver.SpeechSynthesizeInvocationDriver:
				plan, planErr := typed.PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
					PortableConfig: resolved.PortableConfig, ExactBindings: []capabilitydriver.InvocationExactBinding{invocationBinding},
					Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Qwen3 TTS reproduction"},
				})
				if planErr != nil || plan == nil || plan.ModelAssetID() != asset.GetModelAssetId() {
					t.Fatalf("PlanSpeechSynthesizeInvocation(%s): plan=%+v err=%v", test.recipeID, plan, planErr)
				}
			case capabilitydriver.SpeechTranscribeInvocationDriver:
				plan, planErr := typed.PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
					PortableConfig: resolved.PortableConfig, ExactBindings: []capabilitydriver.InvocationExactBinding{invocationBinding},
					Request: &runtimev1.SpeechTranscribeScenarioSpec{}, AudioBytes: []byte("RIFF"), MIMEType: "audio/wav",
				})
				if planErr != nil || plan == nil || plan.ModelAssetID() != asset.GetModelAssetId() {
					t.Fatalf("PlanSpeechTranscribeInvocation(%s): plan=%+v err=%v", test.recipeID, plan, planErr)
				}
			case capabilitydriver.VoiceCreateInvocationDriver:
				request := &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "hello"}}}
				if len(test.features) == 1 && test.features[0] == "input.audio" {
					request = &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: []byte("audio"), ReferenceAudioMime: "audio/wav", Text: "hello"}}}
				}
				plan, planErr := typed.PlanVoiceCreateInvocation(capabilitydriver.VoiceCreateInvocationInput{
					PortableConfig: resolved.PortableConfig, ExactBindings: []capabilitydriver.InvocationExactBinding{invocationBinding},
					SupportedFeatures: test.features, Request: request,
				})
				if planErr != nil || plan == nil || plan.ModelAssetID() != asset.GetModelAssetId() {
					t.Fatalf("PlanVoiceCreateInvocation(%s): plan=%+v err=%v", test.recipeID, plan, planErr)
				}
			default:
				t.Fatalf("recipe %s resolved non-speech Driver %T", test.recipeID, driver)
			}
		})
	}
}

func TestVoxCPMLoadoutStructuralContractRejectsWrongFormatHeaderArchitectureAndTensors(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	svc := newLoadoutTestService(t, t.TempDir())
	chat := importModelAssetBytesForLoadoutTest(t, svc, "chat.gguf", validGemma4TestGGUF())
	malformed := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", []byte("not a safetensors header"))
	wrongArchitecture := importVoxCPMModelAssetForLoadoutTest(t, svc, "other", voxcpm2SafetensorsLoadoutTestBytes())
	wrongTensors := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", safetensorsLoadoutTestBytes(map[string][]int64{"unrelated.weight": {1}}))
	missingTokenizer := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", voxcpm2SafetensorsLoadoutTestBytes(), "tokenizer.json")
	missingAudioVAE := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", voxcpm2SafetensorsLoadoutTestBytes(), "audiovae.pth")
	for _, test := range []struct {
		name  string
		asset *runtimev1.ModelAssetRecord
	}{
		{name: "chat GGUF", asset: chat},
		{name: "malformed safetensors header", asset: malformed},
		{name: "wrong architecture", asset: wrongArchitecture},
		{name: "wrong tensor schema", asset: wrongTensors},
		{name: "missing tokenizer layout", asset: missingTokenizer},
		{name: "missing audio VAE", asset: missingAudioVAE},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.PrepareLoadout(context.Background(), voxCPMLoadoutRequestForTest(test.name, test.asset))
			if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED {
				t.Fatalf("VoxCPM structural rejection = %v", err)
			}
		})
	}
}

func TestZImageAndIdeogram4LoadoutsUseExactRecipeModelContracts(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	zMain := importModelAssetBytesForLoadoutTest(t, svc, "z-image.gguf", validImageTestGGUF())
	ideogramMain := importModelAssetBytesForLoadoutTest(t, svc, "ideogram4.gguf", validIdeogram4ImageTestGGUFWithoutMetadata())
	qwenEncoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-encoder.gguf", validTestGGUF())
	qwenVLEncoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vl-encoder.gguf", validQwenVLTestGGUF())
	flux1VAE := importModelAssetBytesForLoadoutTest(t, svc, "flux1-vae.safetensors", fluxVAETestBytes())
	flux2VAE := importModelAssetBytesForLoadoutTest(t, svc, "flux2-vae.safetensors", flux2VAETestBytes())

	zPrepared := prepareImageLoadoutForTest(t, svc, "z-image", "Z-Image", nil, zMain, qwenEncoder, flux1VAE)
	zLoadout := commitLoadoutForTest(t, svc, context.Background(), zPrepared.GetPrepareId(), false)
	ideogramPrepared, err := svc.PrepareLoadout(context.Background(), ideogram4LoadoutRequestForTest("Ideogram4", ideogramMain, qwenVLEncoder, flux2VAE, ideogramMain))
	if err != nil {
		t.Fatal(err)
	}
	ideogramLoadout := commitLoadoutForTest(t, svc, context.Background(), ideogramPrepared.GetPrepareId(), false)
	if zLoadout.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED || ideogramLoadout.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("recipe-specific image contracts: z-image=%+v ideogram4=%+v", zLoadout, ideogramLoadout)
	}
}

func TestQwenImageLoadoutsShareCompanionsAndAdmitCustomMainByStructuralContract(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	generateMain := importModelAssetBytesForLoadoutTest(t, svc, "qwen-generate.gguf", validQwenImageTestGGUF("qwen-generate"))
	editMain := importModelAssetBytesForLoadoutTest(t, svc, "qwen-edit.gguf", validQwenImageTestGGUF("qwen-edit-custom"))
	encoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vl.gguf", validQwenVLTestGGUF())
	vae := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vae.safetensors", qwenImageVAETestBytes())

	generate := prepareImageLoadoutForTest(t, svc, capabilitydriver.StableDiffusionQwenImageRecipeID, "Qwen Generate", nil, generateMain, encoder, vae)
	generateLoadout := commitLoadoutForTest(t, svc, context.Background(), generate.GetPrepareId(), false)
	edit := prepareImageLoadoutForTest(t, svc, capabilitydriver.StableDiffusionQwenImageEditRecipeID, "Qwen Edit custom", []string{"input.image"}, editMain, encoder, vae)
	editLoadout := commitLoadoutForTest(t, svc, context.Background(), edit.GetPrepareId(), false)
	if generateLoadout.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED || editLoadout.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		t.Fatalf("image Loadouts were not configured: generate=%+v edit=%+v", generateLoadout, editLoadout)
	}
	if len(generateLoadout.GetModelAxes()) != 3 || len(editLoadout.GetModelAxes()) != 3 ||
		generateLoadout.GetModelAxes()[1].GetModelAssetId() != editLoadout.GetModelAxes()[1].GetModelAssetId() ||
		generateLoadout.GetModelAxes()[2].GetModelAssetId() != editLoadout.GetModelAxes()[2].GetModelAssetId() {
		t.Fatalf("Qwen shared companion axes = generate=%+v edit=%+v", generateLoadout.GetModelAxes(), editLoadout.GetModelAxes())
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract, LoadoutId: editLoadout.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionCapabilityContract)
	if err != nil || resolved.LoadoutID != editLoadout.GetLoadoutId() || resolved.RecipeID != capabilitydriver.StableDiffusionQwenImageEditRecipeID || len(resolved.ExactBindings) != 3 {
		t.Fatalf("image ResolvedAssembly = %+v err=%v", resolved, err)
	}
	svc.mu.RLock()
	transferCount, assetCount := len(svc.transfers), len(svc.modelAssets)
	svc.mu.RUnlock()
	if transferCount != 0 || assetCount != 4 {
		t.Fatalf("Loadout lifecycle acquired content: transfers=%d assets=%d", transferCount, assetCount)
	}
}

func TestQwenImageLoadoutContractRejectsChatGGUFAndFluxVAE(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	qwenMain := importModelAssetBytesForLoadoutTest(t, svc, "qwen-main.gguf", validQwenImageTestGGUF("qwen-main"))
	encoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vl.gguf", validQwenVLTestGGUF())
	qwenVAE := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vae.safetensors", qwenImageVAETestBytes())
	chat := importModelAssetBytesForLoadoutTest(t, svc, "chat.gguf", validGemma4TestGGUF())
	fluxVAE := importModelAssetBytesForLoadoutTest(t, svc, "flux-vae.safetensors", fluxVAETestBytes())

	for _, test := range []struct {
		name      string
		main, vae *runtimev1.ModelAssetRecord
	}{
		{name: "chat main", main: chat, vae: qwenVAE},
		{name: "flux VAE", main: qwenMain, vae: fluxVAE},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.PrepareLoadout(context.Background(), imageLoadoutRequestForTest(capabilitydriver.StableDiffusionQwenImageRecipeID, test.name, nil, test.main, encoder, test.vae))
			if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED {
				t.Fatalf("contract rejection = %v", err)
			}
		})
	}
}

func TestImageLoadoutRecipeContractsRejectWrongAxesAndMissingIdeogramUncond(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	zMain := importModelAssetBytesForLoadoutTest(t, svc, "z-image.gguf", validImageTestGGUF())
	ideogramMain := importModelAssetBytesForLoadoutTest(t, svc, "ideogram4.gguf", validIdeogram4ImageTestGGUFWithoutMetadata())
	qwenEncoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-encoder.gguf", validTestGGUF())
	qwenVLEncoder := importModelAssetBytesForLoadoutTest(t, svc, "qwen-vl-encoder.gguf", validQwenVLTestGGUF())
	flux1VAE := importModelAssetBytesForLoadoutTest(t, svc, "flux1-vae.safetensors", fluxVAETestBytes())
	flux2VAE := importModelAssetBytesForLoadoutTest(t, svc, "flux2-vae.safetensors", flux2VAETestBytes())

	for _, test := range []struct {
		name    string
		request *runtimev1.PrepareLoadoutRequest
	}{
		{name: "Z-Image main", request: imageLoadoutRequestForTest("z-image", "wrong Z-Image main", nil, ideogramMain, qwenEncoder, flux1VAE)},
		{name: "Z-Image encoder", request: imageLoadoutRequestForTest("z-image", "wrong Z-Image encoder", nil, zMain, qwenVLEncoder, flux1VAE)},
		{name: "Z-Image VAE", request: imageLoadoutRequestForTest("z-image", "wrong Z-Image VAE", nil, zMain, qwenEncoder, flux2VAE)},
		{name: "Ideogram4 main", request: ideogram4LoadoutRequestForTest("wrong Ideogram4 main", zMain, qwenVLEncoder, flux2VAE, ideogramMain)},
		{name: "Ideogram4 encoder", request: ideogram4LoadoutRequestForTest("wrong Ideogram4 encoder", ideogramMain, qwenEncoder, flux2VAE, ideogramMain)},
		{name: "Ideogram4 VAE", request: ideogram4LoadoutRequestForTest("wrong Ideogram4 VAE", ideogramMain, qwenVLEncoder, flux1VAE, ideogramMain)},
		{name: "Ideogram4 uncond", request: ideogram4LoadoutRequestForTest("wrong Ideogram4 uncond", ideogramMain, qwenVLEncoder, flux2VAE, zMain)},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.PrepareLoadout(context.Background(), test.request)
			if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED {
				t.Fatalf("recipe Model Contract rejection = %v", err)
			}
		})
	}

	missingUncond := ideogram4LoadoutRequestForTest("missing Ideogram4 uncond", ideogramMain, qwenVLEncoder, flux2VAE, nil)
	prepared, err := svc.PrepareLoadout(context.Background(), missingUncond)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNRESOLVED {
		t.Fatalf("missing uncond proposal = %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true,
	}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED {
		t.Fatalf("missing uncond SelectLoadout = %v", err)
	}
}

func TestQwenImageLoadoutMissingSlotCommitsUnresolvedWithoutDownloadAndCannotSelect(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		RecipeId:           capabilitydriver.StableDiffusionQwenImageEditRecipeID,
		DisplayName:        "Unresolved Qwen Edit",
		SupportedFeatures:  []string{"input.image"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNRESOLVED || len(prepared.GetProposedLoadout().GetModelAxes()) != 3 {
		t.Fatalf("unresolved proposal = %+v", prepared.GetProposedLoadout())
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED {
		t.Fatalf("unresolved SelectLoadout = %v", err)
	}
	svc.mu.RLock()
	transferCount := len(svc.transfers)
	svc.mu.RUnlock()
	if transferCount != 0 {
		t.Fatalf("unresolved Loadout started %d transfers", transferCount)
	}
}

func TestMiniMaxH3LoadoutCommitsFiveIndependentAxesWithoutCombinationPin(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	strictOptions, err := structpb.NewStruct(map[string]any{
		"fl2vaRequirementPolicy": "strict",
		"fl2vaVerifiedContentId": "sha256:" + strings.Repeat("a", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionVideoCapabilityContract,
		RecipeId:           capabilitydriver.StableDiffusionVideoRecipeID,
		DisplayName:        "caller-pinned MiniMax-H3",
		Options:            strictOptions,
	}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("caller-authored strict content pin was admitted: %v", err)
	}
	ditProbe := []byte("GGUF blocks.0.adaln_proj.linear. condition_proj. audio_patch_proj.")
	fl2va := importModelAssetBytesForLoadoutTest(t, svc, "minimax-fl2va.gguf", append(append([]byte(nil), ditProbe...), []byte(" fl2va")...))
	ref2va := importModelAssetBytesForLoadoutTest(t, svc, "minimax-ref2va.gguf", append(append([]byte(nil), ditProbe...), []byte(" independently-versioned-ref2va")...))
	encoder := importModelAssetBytesForLoadoutTest(t, svc, "minimax-encoder.gguf", []byte("GGUF visual.deepstack_merger_list."))
	videoVAE := importModelAssetBytesForLoadoutTest(t, svc, "minimax-video-vae.safetensors", safetensorsLoadoutTestBytes(map[string][]int64{"decoder.mask_token": {1}}))
	audioVAE := importModelAssetBytesForLoadoutTest(t, svc, "minimax-audio-vae.safetensors", safetensorsLoadoutTestBytes(map[string][]int64{"dec_in_proj.weight": {1}}))
	axis := func(slotID string, asset *runtimev1.ModelAssetRecord) *runtimev1.LoadoutModelAxisInput {
		return &runtimev1.LoadoutModelAxisInput{SlotId: slotID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}
	}
	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionVideoCapabilityContract,
		RecipeId:           capabilitydriver.StableDiffusionVideoRecipeID,
		DisplayName:        "independently versioned MiniMax-H3",
		SupportedFeatures:  []string{"input.image"},
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{
			axis(capabilitydriver.StableDiffusionVideoFL2VARequirementID, fl2va),
			axis(capabilitydriver.StableDiffusionVideoRef2VARequirementID, ref2va),
			axis(capabilitydriver.StableDiffusionVideoEncoderRequirementID, encoder),
			axis(capabilitydriver.StableDiffusionVideoVAERequirementID, videoVAE),
			axis(capabilitydriver.StableDiffusionAudioVAERequirementID, audioVAE),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if committed.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED || len(committed.GetModelAxes()) != 5 {
		t.Fatalf("MiniMax-H3 Loadout = %+v", committed)
	}
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionVideoCapabilityContract,
		LoadoutId:          committed.GetLoadoutId(), ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatal(err)
	}
	resolved, err := svc.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionVideoCapabilityContract)
	if err != nil || len(resolved.ExactBindings) != 5 || resolved.RecipeID != capabilitydriver.StableDiffusionVideoRecipeID {
		t.Fatalf("MiniMax-H3 ResolvedAssembly = %+v err=%v", resolved, err)
	}
}

func TestLoadoutUpdateChangesOneAxisWithoutAcquisitionAndSharesModelAsset(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	first := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "first", asset).GetPrepareId(), false)
	second := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "second", asset).GetPrepareId(), false)
	if first.GetLoadoutId() == second.GetLoadoutId() || first.GetModelAxes()[0].GetModelAssetId() != second.GetModelAxes()[0].GetModelAssetId() {
		t.Fatalf("shared ModelAsset Loadouts = %+v %+v", first, second)
	}
	svc.mu.RLock()
	transferCount := len(svc.transfers)
	assetCount := len(svc.modelAssets)
	svc.mu.RUnlock()
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), first.GetLoadoutId(), "first updated", asset)
	updated := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	svc.mu.RLock()
	afterTransfers := len(svc.transfers)
	afterAssets := len(svc.modelAssets)
	svc.mu.RUnlock()
	if updated.GetLoadoutId() != first.GetLoadoutId() || transferCount != afterTransfers || assetCount != afterAssets {
		t.Fatalf("Update acquired content or changed identity")
	}
}

func TestLoadoutPrepareTTLReplayOwnerRestartAndCAS(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	ownerA := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "user-a", SessionID: "session-a"})
	ownerB := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "user-b", SessionID: "session-b"})
	now := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	svc.loadoutNow = func() time.Time { return now }
	expiring := prepareGemmaLoadoutForTest(t, svc, ownerA, "", "expire", asset)
	now = now.Add(loadoutPrepareTTL + time.Second)
	if _, err := svc.CommitLoadout(ownerA, &runtimev1.CommitLoadoutRequest{PrepareId: expiring.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_PREPARE_EXPIRED {
		t.Fatalf("expired prepare = %v", err)
	}
	now = now.Add(-loadoutPrepareTTL)
	foreign := prepareGemmaLoadoutForTest(t, svc, ownerA, "", "foreign", asset)
	if _, err := svc.CommitLoadout(ownerB, &runtimev1.CommitLoadoutRequest{PrepareId: foreign.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_PREPARE_OWNER_MISMATCH {
		t.Fatalf("foreign prepare = %v", err)
	}
	committed := commitLoadoutForTest(t, svc, ownerA, foreign.GetPrepareId(), false)
	if _, err := svc.CommitLoadout(ownerA, &runtimev1.CommitLoadoutRequest{PrepareId: foreign.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_PREPARE_NOT_FOUND {
		t.Fatalf("replay = %v", err)
	}
	first := prepareGemmaLoadoutForTest(t, svc, ownerA, committed.GetLoadoutId(), "cas-first", asset)
	second := prepareGemmaLoadoutForTest(t, svc, ownerA, committed.GetLoadoutId(), "cas-second", asset)
	_ = commitLoadoutForTest(t, svc, ownerA, first.GetPrepareId(), false)
	if _, err := svc.CommitLoadout(ownerA, &runtimev1.CommitLoadoutRequest{PrepareId: second.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_COMMIT_CONFLICT {
		t.Fatalf("stale CAS = %v", err)
	}
	restarted := restartModelAssetServiceForTest(t, svc.stateStorePath, svc.localModelsPath)
	stale := prepareGemmaLoadoutForTest(t, svc, ownerA, committed.GetLoadoutId(), "restart-stale", asset)
	if _, err := restarted.CommitLoadout(ownerA, &runtimev1.CommitLoadoutRequest{PrepareId: stale.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_PREPARE_NOT_FOUND {
		t.Fatalf("restart-stale = %v", err)
	}
}

func TestLoadoutCommitFailureAndModelAssetDriftDoNotPublish(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	baseline := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "baseline", asset).GetPrepareId(), false)
	prepared := prepareGemmaLoadoutForTest(t, svc, context.Background(), baseline.GetLoadoutId(), "not-published", asset)
	svc.loadoutStore = failingLoadoutStore{err: errors.New("disk full")}
	if _, err := svc.CommitLoadout(context.Background(), &runtimev1.CommitLoadoutRequest{PrepareId: prepared.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_PERSISTENCE_UNAVAILABLE {
		t.Fatalf("persistence failure = %v", err)
	}
	svc.mu.RLock()
	current := cloneLoadout(svc.loadouts[baseline.GetLoadoutId()])
	svc.mu.RUnlock()
	if current.GetDisplayName() != "baseline" {
		t.Fatalf("failed Commit published %+v", current)
	}

	svc.loadoutStore = newDiskLoadoutStore(svc.stateStorePath)
	drift := prepareGemmaLoadoutForTest(t, svc, context.Background(), baseline.GetLoadoutId(), "drift", asset)
	svc.mu.RLock()
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	entry := filepath.Join(directory, filepath.FromSlash(asset.GetEntry()))
	payload, _ := os.ReadFile(entry)
	payload[len(payload)-1] ^= 0xff
	if err := os.WriteFile(entry, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CommitLoadout(context.Background(), &runtimev1.CommitLoadoutRequest{PrepareId: drift.GetPrepareId()}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
		t.Fatalf("drift Commit = %v", err)
	}
}

func TestLoadoutForceRemovedAssetPreservesCommittedAxesAndSelection(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	loadout := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "selected", asset).GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	inspection, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId()})
	if err != nil {
		t.Fatal(err)
	}
	if len(inspection.GetReferencingLoadoutIds()) != 1 || inspection.GetReferencingLoadoutIds()[0] != loadout.GetLoadoutId() {
		t.Fatalf("references = %v", inspection.GetReferencingLoadoutIds())
	}
	if _, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true}); err != nil {
		t.Fatal(err)
	}
	response, err := svc.GetLoadout(context.Background(), &runtimev1.GetLoadoutRequest{LoadoutId: loadout.GetLoadoutId()})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED || response.GetLoadout().GetModelAxes()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("derived missing Loadout = %+v", response.GetLoadout())
	}
	svc.mu.RLock()
	selection := cloneLoadoutSelection(svc.loadoutSelections[capabilitydriver.LlamaCapabilityContract])
	svc.mu.RUnlock()
	if selection.GetLoadoutId() != loadout.GetLoadoutId() {
		t.Fatalf("selection was ambiently cleared")
	}
}

func TestLoadoutStoreRecordAndDocumentIsolation(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	_ = commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "healthy-a", asset).GetPrepareId(), false)
	_ = commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "healthy-b", asset).GetPrepareId(), false)
	path := filepath.Join(filepath.Dir(svc.stateStorePath), loadoutStoreFileName)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	rows := document["loadouts"].([]any)
	document["loadouts"] = append(rows, map[string]any{"loadout_id": "broken"})
	poisoned, _ := json.Marshal(document)
	if err := os.WriteFile(path, poisoned, 0o600); err != nil {
		t.Fatal(err)
	}
	recordRestart := restartModelAssetServiceForTest(t, svc.stateStorePath, svc.localModelsPath)
	recordState, err := recordRestart.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(recordState.GetAggregate().GetLoadouts()) != 2 {
		t.Fatalf("record isolation = loadouts=%d", len(recordState.GetAggregate().GetLoadouts()))
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"loadouts":[`), 0o600); err != nil {
		t.Fatal(err)
	}
	documentRestart := restartModelAssetServiceForTest(t, svc.stateStorePath, svc.localModelsPath)
	documentState, err := documentRestart.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	assets, err := documentRestart.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(documentState.GetAggregate().GetLoadouts()) != 0 || len(assets.GetAssets()) != 1 {
		t.Fatalf("document isolation = loadouts=%d assets=%d", len(documentState.GetAggregate().GetLoadouts()), len(assets.GetAssets()))
	}
}

func TestLoadoutStoreRejectsNonCanonicalPersistedRow(t *testing.T) {
	svc, asset := loadoutGemmaFixture(t)
	first := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "canonical-a", asset).GetPrepareId(), false)
	second := commitLoadoutForTest(t, svc, context.Background(), prepareGemmaLoadoutForTest(t, svc, context.Background(), "", "canonical-b", asset).GetPrepareId(), false)
	path := filepath.Join(filepath.Dir(svc.stateStorePath), loadoutStoreFileName)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	for _, raw := range document["loadouts"].([]any) {
		row := raw.(map[string]any)
		if row["loadout_id"] == first.GetLoadoutId() {
			row["display_name"] = "  canonical-a  "
		}
	}
	poisoned, _ := json.Marshal(document)
	if err := os.WriteFile(path, poisoned, 0o600); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, svc.stateStorePath, svc.localModelsPath)
	state, err := restarted.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	loadouts := state.GetAggregate().GetLoadouts()
	if len(loadouts) != 1 || loadouts[0].GetLoadoutId() != second.GetLoadoutId() {
		t.Fatalf("non-canonical row isolation = loadouts=%+v", loadouts)
	}
}

func TestLoadoutBlockedValidationDominatesLaterUnresolvedAxis(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	contentID := "sha256:" + strings.Repeat("a", 64)
	loadout := &runtimev1.Loadout{ModelAxes: []*runtimev1.LoadoutModelAxis{
		{SlotId: "blocked", ModelAssetId: "missing", ExpectedContentId: contentID},
		{SlotId: "unresolved"},
	}}
	requirements := []*runtimev1.LocalCapabilityRequirement{
		{RequirementId: "blocked"},
		{RequirementId: "unresolved"},
	}
	result := svc.validateLoadoutWithAxisResolver(loadout, capabilitydriver.LlamaTextDriver{}, requirements,
		func(_ *runtimev1.Loadout, _ capabilitydriver.Driver, requirement *runtimev1.LocalCapabilityRequirement, _ *runtimev1.LoadoutModelAxis) (resolvedLoadoutAxis, runtimev1.ReasonCode) {
			if requirement.GetRequirementId() == "blocked" {
				return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_NOT_FOUND
			}
			return resolvedLoadoutAxis{}, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
		})
	if result.state != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED {
		t.Fatalf("validation state = %s, reasons=%v", result.state, result.reasons)
	}
	if len(result.reasons) != 2 || result.reasons[0] != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_NOT_FOUND || result.reasons[1] != runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED {
		t.Fatalf("validation reasons = %v", result.reasons)
	}
	applyLoadoutValidation(loadout, result)
	if got := loadout.GetModelAxes()[0].GetReasons(); len(got) != 1 || got[0] != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_NOT_FOUND {
		t.Fatalf("blocked axis reasons = %v, want only AI_LOADOUT_MODEL_ASSET_NOT_FOUND", got)
	}
	if got := loadout.GetModelAxes()[1].GetReasons(); len(got) != 1 || got[0] != runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED {
		t.Fatalf("unresolved axis reasons = %v, want only AI_LOADOUT_NOT_CONFIGURED", got)
	}
}

func TestListLoadoutRecipesProjectsSpeechCatalogAndCustody(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	list := func(contract string) []*runtimev1.LoadoutRecipeDescriptor {
		t.Helper()
		response, err := svc.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{CapabilityContract: contract})
		if err != nil {
			t.Fatalf("ListLoadoutRecipes(%q): %v", contract, err)
		}
		return response.GetRecipes()
	}

	all := list("")
	if len(all) != 16 {
		t.Fatalf("all Loadout recipes = %d, want 16", len(all))
	}
	byID := make(map[string]*runtimev1.LoadoutRecipeDescriptor, len(all))
	for _, recipe := range all {
		byID[recipe.GetRecipeId()] = recipe
	}
	for _, recipeID := range []string{
		capabilitydriver.LlamaGemma4E2BRecipeID,
		capabilitydriver.LlamaGemma426BRecipeID,
		capabilitydriver.LlamaEmbedGGUFRecipeID,
		capabilitydriver.StableDiffusionQwenImageRecipeID,
		capabilitydriver.StableDiffusionQwenImageEditRecipeID,
		"z-image",
		"ideogram4",
		capabilitydriver.StableDiffusionVideoRecipeID,
	} {
		if byID[recipeID] == nil {
			t.Fatalf("existing Loadout recipe %q regressed", recipeID)
		}
	}
	video := list(capabilitydriver.StableDiffusionVideoCapabilityContract)
	if len(video) != 1 || video[0].GetRecipeId() != capabilitydriver.StableDiffusionVideoRecipeID || len(video[0].GetSlots()) != 5 {
		t.Fatalf("video recipes = %+v", video)
	}
	for index, slotID := range []string{
		capabilitydriver.StableDiffusionVideoFL2VARequirementID,
		capabilitydriver.StableDiffusionVideoRef2VARequirementID,
		capabilitydriver.StableDiffusionVideoEncoderRequirementID,
		capabilitydriver.StableDiffusionVideoVAERequirementID,
		capabilitydriver.StableDiffusionAudioVAERequirementID,
	} {
		if video[0].GetSlots()[index].GetSlotId() != slotID || len(video[0].GetSlots()[index].GetRecommendedContentIds()) != 1 {
			t.Fatalf("video slot[%d] = %+v", index, video[0].GetSlots()[index])
		}
	}

	synthesize := list(capabilitydriver.AudioSynthesizeContract)
	transcribe := list(capabilitydriver.AudioTranscribeContract)
	voiceCreate := list(capabilitydriver.VoiceCreateContract)
	if len(synthesize) != 4 || len(transcribe) != 2 || len(voiceCreate) != 2 {
		t.Fatalf("speech capability filters = synthesize:%d transcribe:%d voice.create:%d, want 4/2/2", len(synthesize), len(transcribe), len(voiceCreate))
	}
	for _, recipeID := range []string{"voxcpm2", "qwen3-tts-customvoice", "qwen3-tts-base", "qwen3-tts-voicedesign"} {
		recipe := byID[recipeID]
		wantRevision := "1"
		if recipeID == capabilitydriver.VoxCPMRecipeID {
			wantRevision = "2"
		}
		if recipe == nil || recipe.GetRevision() != wantRevision || recipe.GetCapabilityContract() != capabilitydriver.AudioSynthesizeContract || len(recipe.GetSlots()) != 1 || recipe.GetSlots()[0].GetSlotId() != "tts.model" || len(recipe.GetSupportedFeatures()) != 0 || len(recipe.GetDefaultOptions().GetFields()) != 0 {
			t.Fatalf("synthesis recipe %q = %+v", recipeID, recipe)
		}
	}
	for _, recipeID := range []string{"qwen3-asr", "qwen3-asr-transformers"} {
		recipe := byID[recipeID]
		if recipe == nil || recipe.GetRevision() != "1" || recipe.GetCapabilityContract() != capabilitydriver.AudioTranscribeContract || len(recipe.GetSlots()) != 1 || recipe.GetSlots()[0].GetSlotId() != "stt.model" || len(recipe.GetSupportedFeatures()) != 0 || len(recipe.GetDefaultOptions().GetFields()) != 0 {
			t.Fatalf("transcription recipe %q = %+v", recipeID, recipe)
		}
	}
	for _, test := range []struct {
		recipeID string
		feature  string
		variant  string
	}{
		{recipeID: capabilitydriver.Qwen3VoiceCloneRecipeID, feature: "input.audio", variant: "local.voice.qwen3-tts-base-0.6b.safetensors"},
		{recipeID: capabilitydriver.Qwen3VoiceDesignRecipeID, feature: "input.text", variant: "local.voice.qwen3-tts-voicedesign-1.7b.safetensors"},
	} {
		recipe := byID[test.recipeID]
		if recipe == nil || recipe.GetRevision() != "1" || recipe.GetCapabilityContract() != capabilitydriver.VoiceCreateContract ||
			len(recipe.GetSlots()) != 1 || recipe.GetSlots()[0].GetSlotId() != capabilitydriver.Qwen3VoiceCreateModelRequirementID ||
			len(recipe.GetSupportedFeatures()) != 1 || recipe.GetSupportedFeatures()[0] != test.feature ||
			len(recipe.GetSlots()[0].GetRecommendedVariantIds()) != 1 || recipe.GetSlots()[0].GetRecommendedVariantIds()[0] != test.variant {
			t.Fatalf("voice.create recipe %q = %+v", test.recipeID, recipe)
		}
	}
	voxcpm := byID["voxcpm2"]
	if len(voxcpm.GetCustody()) != 0 {
		t.Fatalf("VoxCPM custody = %+v, want empty", voxcpm.GetCustody())
	}
	contract := voxcpm.GetSlots()[0].GetModelContract().AsMap()
	backendContracts, _ := contract["backend_contracts"].(map[string]any)
	standardContract, _ := backendContracts[capabilitydriver.VoxCPMBackendStandard].(map[string]any)
	mlxContract, _ := backendContracts[capabilitydriver.VoxCPMBackendMLX].(map[string]any)
	if contract["format"] != "safetensors" || contract["architecture"] != "voxcpm2" || contract["artifact_role"] != "tts_model" ||
		standardContract["tensor_contract"] != "voxcpm2-main-v1" || mlxContract["tensor_contract"] != "voxcpm2-mlx-bundle-v1" {
		t.Fatalf("VoxCPM Model Contract = %+v", contract)
	}
	gotRecommendation := voxcpm.GetSlots()[0].GetRecommendedVariantIds()
	if len(gotRecommendation) != 1 {
		t.Fatalf("VoxCPM host-projected recommendation = %v", gotRecommendation)
	}
	switch gotRecommendation[0] {
	case "local.tts.voxcpm2.standard.cuda", "local.tts.voxcpm2.standard.cpu", "local.tts.voxcpm2.mlx.metal":
	default:
		t.Fatalf("VoxCPM host-projected recommendation = %v", gotRecommendation)
	}
	for _, recipeID := range []string{"voxcpm2", "qwen3-tts-customvoice", "qwen3-tts-base", "qwen3-tts-voicedesign", capabilitydriver.Qwen3VoiceCloneRecipeID, capabilitydriver.Qwen3VoiceDesignRecipeID, "qwen3-asr", "qwen3-asr-transformers"} {
		if len(byID[recipeID].GetCustody()) != 0 {
			t.Fatalf("recipe %q unexpectedly projects custody", recipeID)
		}
	}
}

func TestCatalogLoadoutRecipeSlotValidatorUsesLiveDriverProjection(t *testing.T) {
	local, err := catalog.LoadBuiltInLocalProviderCatalog()
	if err != nil {
		t.Fatal(err)
	}
	registry := capabilitydriver.NewProductionRegistry()
	project := func(recipe catalog.LocalLoadoutRecipe) ([]string, error) {
		driver, reason := registry.Resolve(recipe.CapabilityContract, capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect})
		if reason != 0 {
			return nil, errors.New(reason.String())
		}
		recipeDriver, ok := driver.(capabilitydriver.RecipeDriver)
		if !ok {
			return nil, errors.New("Driver does not support recipe projection")
		}
		options, _ := structpb.NewStruct(recipe.DefaultOptions)
		requirements, reason := recipeDriver.ProjectRecipe(recipe.RecipeID, options, recipe.SupportedFeatures)
		if reason != 0 {
			return nil, errors.New(reason.String())
		}
		ids := make([]string, 0, len(requirements))
		for _, requirement := range requirements {
			ids = append(ids, requirement.GetRequirementId())
		}
		return ids, nil
	}
	if err := local.ValidateLoadoutRecipeSlots(project); err != nil {
		t.Fatalf("exact catalog: %v", err)
	}
	if err := local.ValidateLoadoutRecipeSlots(func(recipe catalog.LocalLoadoutRecipe) ([]string, error) {
		ids, err := project(recipe)
		return append(ids, "missing.from.metadata"), err
	}); err == nil {
		t.Fatal("missing metadata slot was admitted")
	}
	if err := local.ValidateLoadoutRecipeSlots(func(recipe catalog.LocalLoadoutRecipe) ([]string, error) { return nil, nil }); err == nil {
		t.Fatal("extra metadata slot was admitted")
	}
	if err := local.ValidateLoadoutRecipeSlots(func(recipe catalog.LocalLoadoutRecipe) ([]string, error) {
		ids, err := project(recipe)
		if len(ids) > 0 {
			ids = append(ids, ids[0])
		}
		return ids, err
	}); err == nil {
		t.Fatal("duplicate Driver slot was admitted")
	}
}

type failingLoadoutStore struct{ err error }

func (store failingLoadoutStore) Load() ([]*runtimev1.Loadout, []*runtimev1.LoadoutSelection, error) {
	return nil, nil, store.err
}
func (store failingLoadoutStore) Save([]*runtimev1.Loadout, []*runtimev1.LoadoutSelection) error {
	return store.err
}

func loadoutGemmaFixture(t *testing.T) (*Service, *runtimev1.ModelAssetRecord) {
	t.Helper()
	root := t.TempDir()
	svc := newLoadoutTestService(t, root)
	source := filepath.Join(root, "community-gemma.gguf")
	if err := os.WriteFile(source, validGemma4TestGGUF(), 0o600); err != nil {
		t.Fatal(err)
	}
	return svc, importModelAssetForTest(t, svc, source, "Community Gemma")
}

func prepareGemmaLoadoutForTest(t *testing.T, svc *Service, ctx context.Context, loadoutID, displayName string, asset *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutResponse {
	t.Helper()
	response, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{LoadoutId: loadoutID, CapabilityContract: capabilitydriver.LlamaCapabilityContract, RecipeId: capabilitydriver.LlamaGemma4E2BRecipeID, DisplayName: displayName, ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.MainGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}}})
	if err != nil {
		t.Fatalf("PrepareLoadout: %v", err)
	}
	return response
}
func commitLoadoutForTest(t *testing.T, svc *Service, ctx context.Context, prepareID string, confirmed bool) *runtimev1.Loadout {
	t.Helper()
	response, err := svc.CommitLoadout(ctx, &runtimev1.CommitLoadoutRequest{PrepareId: prepareID, ConfirmedMachineImpact: confirmed})
	if err != nil {
		t.Fatalf("CommitLoadout: %v", err)
	}
	return response.GetLoadout()
}
func importModelAssetBytesForLoadoutTest(t *testing.T, svc *Service, name string, content []byte) *runtimev1.ModelAssetRecord {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	return importModelAssetForTest(t, svc, path, name)
}

func prepareVoxCPMLoadoutForTest(t *testing.T, svc *Service, name string, asset *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutResponse {
	t.Helper()
	response, err := svc.PrepareLoadout(context.Background(), voxCPMLoadoutRequestForTest(name, asset))
	if err != nil {
		t.Fatalf("PrepareLoadout(VoxCPM): %v", err)
	}
	return response
}

func voxCPMLoadoutRequestForTest(name string, asset *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutRequest {
	return &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		RecipeId:           capabilitydriver.VoxCPMRecipeID,
		Options:            &structpb.Struct{},
		DisplayName:        name,
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{
			SlotId: capabilitydriver.VoxCPMModelRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId(),
		}},
	}
}

func importVoxCPMModelAssetForLoadoutTest(t *testing.T, svc *Service, architecture string, model []byte, omitted ...string) *runtimev1.ModelAssetRecord {
	t.Helper()
	source := t.TempDir()
	files := map[string][]byte{
		"audiovae.pth":            []byte("captured-audio-vae"),
		"config.json":             []byte(`{"architecture":"` + architecture + `"}`),
		"model.safetensors":       model,
		"tokenization_voxcpm2.py": []byte("raise RuntimeError('non-executable fixture')\n"),
		"tokenizer.json":          []byte(`{"version":"1.0"}`),
		"tokenizer_config.json":   []byte(`{"tokenizer_class":"LlamaTokenizerFast"}`),
	}
	for _, relativePath := range omitted {
		delete(files, relativePath)
	}
	for relativePath, content := range files {
		if err := os.WriteFile(filepath.Join(source, relativePath), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return importModelAssetForTest(t, svc, source, "VoxCPM "+architecture+" "+ulidSuffixForTest(t))
}

func importSpeechModelAssetForLoadoutTest(t *testing.T, svc *Service, family string) *runtimev1.ModelAssetRecord {
	t.Helper()
	source := t.TempDir()
	files := map[string][]byte{
		"config.json":       []byte(`{"model_type":"` + family + `"}`),
		"model.safetensors": safetensorsLoadoutTestBytes(map[string][]int64{"model.weight": {1}}),
	}
	for relativePath, content := range files {
		if err := os.WriteFile(filepath.Join(source, relativePath), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return importModelAssetForTest(t, svc, source, "Qwen3 "+family+" "+ulidSuffixForTest(t))
}

func prepareImageLoadoutForTest(t *testing.T, svc *Service, recipeID, name string, features []string, main, encoder, vae *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutResponse {
	t.Helper()
	response, err := svc.PrepareLoadout(context.Background(), imageLoadoutRequestForTest(recipeID, name, features, main, encoder, vae))
	if err != nil {
		t.Fatalf("PrepareLoadout: %v", err)
	}
	return response
}

func imageLoadoutRequestForTest(recipeID, name string, features []string, main, encoder, vae *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutRequest {
	axis := func(slotID string, asset *runtimev1.ModelAssetRecord) *runtimev1.LoadoutModelAxisInput {
		return &runtimev1.LoadoutModelAxisInput{SlotId: slotID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}
	}
	return &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		RecipeId:           recipeID,
		DisplayName:        name,
		SupportedFeatures:  append([]string(nil), features...),
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{
			axis(capabilitydriver.StableDiffusionMainRequirementID, main),
			axis(capabilitydriver.StableDiffusionTextEncoderRequirementID, encoder),
			axis(capabilitydriver.StableDiffusionVAERequirementID, vae),
		},
	}
}

func ideogram4LoadoutRequestForTest(name string, main, encoder, vae, uncond *runtimev1.ModelAssetRecord) *runtimev1.PrepareLoadoutRequest {
	axis := func(slotID string, asset *runtimev1.ModelAssetRecord) *runtimev1.LoadoutModelAxisInput {
		return &runtimev1.LoadoutModelAxisInput{SlotId: slotID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}
	}
	axes := []*runtimev1.LoadoutModelAxisInput{
		axis(capabilitydriver.StableDiffusionMainRequirementID, main),
		axis(capabilitydriver.StableDiffusionTextEncoderRequirementID, encoder),
		axis(capabilitydriver.StableDiffusionVAERequirementID, vae),
	}
	if uncond != nil {
		axes = append(axes, axis(capabilitydriver.StableDiffusionUncondDiffusionRequirementID, uncond))
	}
	return &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		RecipeId:           "ideogram4",
		DisplayName:        name,
		ModelAxes:          axes,
	}
}

func voxcpm2SafetensorsLoadoutTestBytes() []byte {
	return safetensorsLoadoutTestBytes(map[string][]int64{
		"base_lm.embed_tokens.weight": {73448, 2048},
		"feat_encoder.in_proj.weight": {1024, 64},
		"fsq_layer.in_proj.weight":    {512, 2048},
		"stop_head.weight":            {2, 2048},
	})
}

func qwenImageVAETestBytes() []byte {
	return safetensorsLoadoutTestBytes(map[string][]int64{
		"decoder.conv1.weight":  {384, 16, 3, 3, 3},
		"decoder.head.2.weight": {3, 96, 3, 3, 3},
	})
}

func fluxVAETestBytes() []byte {
	return safetensorsLoadoutTestBytes(map[string][]int64{
		"decoder.conv1.weight":  {384, 16, 3, 3},
		"decoder.head.2.weight": {3, 96, 3, 3},
	})
}

func flux2VAETestBytes() []byte {
	return safetensorsLoadoutTestBytes(map[string][]int64{
		"decoder.conv1.weight":  {384, 32, 3, 3},
		"decoder.head.2.weight": {3, 96, 3, 3},
	})
}

func safetensorsLoadoutTestBytes(shapes map[string][]int64) []byte {
	header := make(map[string]any, len(shapes))
	offset := int64(0)
	for name, shape := range shapes {
		header[name] = map[string]any{"dtype": "F32", "shape": shape, "data_offsets": []int64{offset, offset + 4}}
		offset += 4
	}
	payload, _ := json.Marshal(header)
	result := make([]byte, 8+len(payload)+int(offset))
	binary.LittleEndian.PutUint64(result[:8], uint64(len(payload)))
	copy(result[8:], payload)
	return result
}

func grpcReasonForTest(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
func protoEqualForTest(left, right proto.Message) bool { return proto.Equal(left, right) }
