// @nimi-authority: rule.nimi.runtime.local-compute.r107
// @nimi-authority: rule.nimi.runtime.local-compute.r028
// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-005
// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-006

package localservice

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const loadoutPrepareTTL = 10 * time.Minute

type heldLoadoutPrepare struct {
	proposal             *runtimev1.Loadout
	recipe               catalog.LocalLoadoutRecipe
	ownerKey             string
	baseCASToken         string
	expiresAt            time.Time
	confirmationRequired bool
}

type resolvedLoadoutAxis struct {
	slot          *runtimev1.LoadoutModelAxis
	requirement   *runtimev1.LocalCapabilityRequirement
	binding       *runtimev1.ModelAssetExactBinding
	descriptor    capabilitydriver.ModelAssetDescriptor
	absolutePath  string
	bundleDir     string
	declaredFiles []string
	entrySHA256   string
	contextWindow uint64
}

type loadoutValidationResult struct {
	state        runtimev1.LoadoutValidationState
	reasons      []runtimev1.ReasonCode
	axisReasons  map[string][]runtimev1.ReasonCode
	axes         []resolvedLoadoutAxis
	requirements []*runtimev1.LocalCapabilityRequirement
	driver       capabilitydriver.Driver
}

func validateLocalCatalogLoadoutRecipes(local *catalog.LocalProviderCatalog, drivers *capabilitydriver.Registry) error {
	return local.ValidateLoadoutRecipeSlots(func(recipe catalog.LocalLoadoutRecipe) ([]string, error) {
		identity := capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}
		driver, reason := drivers.Resolve(recipe.CapabilityContract, identity)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
			return nil, fmt.Errorf("Driver unavailable: %s", reason.String())
		}
		options, err := structpb.NewStruct(recipe.DefaultOptions)
		if err != nil {
			return nil, fmt.Errorf("default_options: %w", err)
		}
		recipeDriver, ok := driver.(capabilitydriver.RecipeDriver)
		if !ok {
			return nil, fmt.Errorf("Driver does not support recipe projection")
		}
		requirements, reason := recipeDriver.ProjectRecipe(recipe.RecipeID, options, recipe.SupportedFeatures)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return nil, fmt.Errorf("recipe projection: %s", reason.String())
		}
		slots := make([]string, 0, len(requirements))
		for _, requirement := range requirements {
			if requirement == nil {
				return nil, fmt.Errorf("Driver projected nil slot")
			}
			slots = append(slots, requirement.GetRequirementId())
		}
		return slots, nil
	})
}

func (s *Service) restoreLoadouts() error {
	loadouts, selections, err := s.loadoutStore.Load()
	if err != nil {
		return err
	}
	if source, ok := s.loadoutStore.(interface {
		TakeIsolationDiagnostics() []stateIsolationDiagnostic
	}); ok {
		s.recordStartupStateIsolationDiagnostics(source.TakeIsolationDiagnostics())
	}
	byID := make(map[string]*runtimev1.Loadout, len(loadouts))
	for _, loadout := range loadouts {
		if err := validateStoredLoadout(loadout); err != nil {
			return err
		}
		byID[loadout.GetLoadoutId()] = cloneLoadout(loadout)
	}
	byContract := make(map[string]*runtimev1.LoadoutSelection, len(selections))
	for _, selection := range selections {
		if err := validateStoredLoadoutSelection(selection, byID); err != nil {
			return err
		}
		byContract[selection.GetCapabilityContract()] = cloneLoadoutSelection(selection)
	}
	s.loadouts = byID
	s.loadoutSelections = byContract
	return nil
}

func (s *Service) ListLoadoutRecipes(_ context.Context, request *runtimev1.ListLoadoutRecipesRequest) (*runtimev1.ListLoadoutRecipesResponse, error) {
	contract := ""
	if request != nil {
		contract = strings.TrimSpace(request.GetCapabilityContract())
	}
	hostProfile := collectDeviceProfile()
	items := make([]*runtimev1.LoadoutRecipeDescriptor, 0)
	for _, recipe := range s.localProviderCatalog.LoadoutRecipes() {
		if contract != "" && recipe.CapabilityContract != contract {
			continue
		}
		recipe = s.projectHostRecommendedLoadoutRecipe(recipe, hostProfile)
		projected, err := projectLoadoutRecipeDescriptor(recipe)
		if err != nil {
			return nil, loadoutError(codes.Internal, runtimev1.ReasonCode_AI_LOADOUT_CATALOG_SCHEMA_INVALID, err.Error(), nil)
		}
		items = append(items, projected)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].GetRecipeId() < items[j].GetRecipeId() })
	return &runtimev1.ListLoadoutRecipesResponse{Recipes: items}, nil
}

func (s *Service) projectHostRecommendedLoadoutRecipe(recipe catalog.LocalLoadoutRecipe, profile *runtimev1.LocalDeviceProfile) catalog.LocalLoadoutRecipe {
	for index := range recipe.SlotMetadata {
		slot := &recipe.SlotMetadata[index]
		variantID, ok := s.localProviderCatalog.RecommendVariantForHost(slot.RecommendedVariantIDs, profile)
		if !ok {
			slot.RecommendedVariantIDs = nil
			slot.RecommendedContentIDs = nil
			continue
		}
		variant, found := s.localCatalogVariant(variantID)
		if !found {
			slot.RecommendedVariantIDs = nil
			slot.RecommendedContentIDs = nil
			continue
		}
		paths := append([]string(nil), variant.Files...)
		sort.Strings(paths)
		files := make([]*runtimev1.ModelAssetFile, 0, len(paths))
		for _, path := range paths {
			files = append(files, &runtimev1.ModelAssetFile{RelativePath: path, Sha256: variant.Hashes[path]})
		}
		contentID := modelAssetContentID(files)
		if contentID == "" {
			slot.RecommendedVariantIDs = nil
			slot.RecommendedContentIDs = nil
			continue
		}
		slot.RecommendedVariantIDs = []string{variantID}
		slot.RecommendedContentIDs = []string{contentID}
	}
	return recipe
}

func loadoutRecipeCustodyReferences(recipe catalog.LocalLoadoutRecipe) []*runtimev1.LoadoutRecipeCustodyReference {
	result := make([]*runtimev1.LoadoutRecipeCustodyReference, 0, len(recipe.Custody))
	for _, custody := range recipe.Custody {
		result = append(result, &runtimev1.LoadoutRecipeCustodyReference{
			CustodyId: recipe.RecipeID + "/" + custody.File, ExpectedContentId: custody.SHA256,
		})
	}
	return result
}

func projectLoadoutRecipeDescriptor(recipe catalog.LocalLoadoutRecipe) (*runtimev1.LoadoutRecipeDescriptor, error) {
	options, err := structpb.NewStruct(recipe.DefaultOptions)
	if err != nil {
		return nil, err
	}
	result := &runtimev1.LoadoutRecipeDescriptor{
		RecipeId: recipe.RecipeID, Revision: recipe.Revision, Title: recipe.Title,
		CapabilityContract: recipe.CapabilityContract,
		Implementation:     (&capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}).Proto(),
		DefaultOptions:     options, SupportedFeatures: append([]string(nil), recipe.SupportedFeatures...),
	}
	for _, custody := range recipe.Custody {
		result.Custody = append(result.Custody, &runtimev1.LoadoutRecipeCustodyDescriptor{
			File: custody.File, Sha256: custody.SHA256, Source: custody.Source, Role: custody.Role,
		})
	}
	for _, slot := range recipe.SlotMetadata {
		contract, err := structpb.NewStruct(slot.ModelContract)
		if err != nil {
			return nil, err
		}
		result.Slots = append(result.Slots, &runtimev1.LoadoutRecipeSlotDescriptor{
			SlotId: slot.SlotID, DisplayLabel: slot.DisplayLabel,
			RecommendedContentIds: append([]string(nil), slot.RecommendedContentIDs...), ModelContract: contract,
			RecommendedVariantIds: append([]string(nil), slot.RecommendedVariantIDs...),
		})
	}
	return result, nil
}

func (s *Service) GetMachineLoadouts(_ context.Context, _ *runtimev1.GetMachineLoadoutsRequest) (*runtimev1.GetMachineLoadoutsResponse, error) {
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.mu.RLock()
	stored := make([]*runtimev1.Loadout, 0, len(s.loadouts))
	for _, loadout := range s.loadouts {
		stored = append(stored, cloneLoadout(loadout))
	}
	selections := make([]*runtimev1.LoadoutSelection, 0, len(s.loadoutSelections))
	for _, selection := range s.loadoutSelections {
		selections = append(selections, cloneLoadoutSelection(selection))
	}
	s.mu.RUnlock()
	rows := make([]*runtimev1.Loadout, 0, len(stored))
	for _, loadout := range stored {
		rows = append(rows, s.deriveCurrentLoadout(loadout))
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].GetLoadoutId() < rows[j].GetLoadoutId() })
	sort.Slice(selections, func(i, j int) bool {
		return selections[i].GetCapabilityContract() < selections[j].GetCapabilityContract()
	})
	for _, selection := range selections {
		loadout := findLoadout(rows, selection.GetLoadoutId())
		if loadout == nil {
			continue
		}
		driver, reason := s.capabilityDrivers.Resolve(loadout.GetCapabilityContract(), capabilitydriver.IdentityFromProto(loadout.GetImplementation()))
		if reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED && driver != nil {
			if defaults := driver.EffectiveRequestDefaults(loadout.GetRecipeId(), loadout.GetOptions()); len(defaults) > 0 {
				selection.EffectiveDefaults, _ = structpb.NewStruct(stringMapToAny(defaults))
			}
		}
	}
	return &runtimev1.GetMachineLoadoutsResponse{Aggregate: &runtimev1.MachineLoadouts{Loadouts: rows, Selections: selections}}, nil
}

func (s *Service) GetLoadout(_ context.Context, request *runtimev1.GetLoadoutRequest) (*runtimev1.GetLoadoutResponse, error) {
	loadoutID := strings.TrimSpace(request.GetLoadoutId())
	if loadoutID == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "loadout_id is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.mu.RLock()
	stored := cloneLoadout(s.loadouts[loadoutID])
	s.mu.RUnlock()
	if stored == nil {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "Loadout was not found", map[string]string{"loadout_id": loadoutID})
	}
	return &runtimev1.GetLoadoutResponse{Loadout: s.deriveCurrentLoadout(stored)}, nil
}

func (s *Service) PrepareLoadout(ctx context.Context, request *runtimev1.PrepareLoadoutRequest) (*runtimev1.PrepareLoadoutResponse, error) {
	if request == nil {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "request is required", nil)
	}
	recipeID := strings.TrimSpace(request.GetRecipeId())
	recipe, ok := s.localProviderCatalog.LoadoutRecipe(recipeID)
	if !ok {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_RECIPE_NOT_FOUND, "Loadout recipe was not found", map[string]string{"recipe_id": recipeID})
	}
	contract := strings.TrimSpace(request.GetCapabilityContract())
	if contract == "" || contract != recipe.CapabilityContract || !aicapabilities.IsCanonicalCatalogCapability(contract) {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH, "capability_contract does not match the recipe", nil)
	}
	displayName := strings.TrimSpace(request.GetDisplayName())
	if displayName == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "display_name is required", nil)
	}

	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	now := s.loadoutTime()
	pruneHeldLoadoutPrepares(s.heldLoadoutPrepares, now)
	s.mu.RLock()
	existing := cloneLoadout(s.loadouts[strings.TrimSpace(request.GetLoadoutId())])
	baseCAS := s.loadoutCASToken
	s.mu.RUnlock()
	if request.GetLoadoutId() != "" && existing == nil {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "Loadout was not found", nil)
	}
	if existing != nil && existing.GetCapabilityContract() != contract {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH, "Loadout capability cannot change", nil)
	}
	options := cloneStruct(request.GetOptions())
	if options == nil {
		options, _ = structpb.NewStruct(recipe.DefaultOptions)
	}
	features := normalizeStableStringSet(request.GetSupportedFeatures())
	if request.SupportedFeatures == nil {
		features = normalizeStableStringSet(recipe.SupportedFeatures)
	}
	driver, requirements, err := s.projectRecipe(recipeID, contract, (&capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}).Proto(), options, features)
	if err != nil {
		return nil, err
	}
	metadataBySlot := make(map[string]catalog.LocalRecipeSlotMetadata, len(recipe.SlotMetadata))
	for _, slot := range recipe.SlotMetadata {
		metadataBySlot[slot.SlotID] = slot
	}
	inputs := make(map[string]*runtimev1.LoadoutModelAxisInput, len(request.GetModelAxes()))
	for _, axis := range request.GetModelAxes() {
		if axis == nil || strings.TrimSpace(axis.GetSlotId()) == "" || inputs[axis.GetSlotId()] != nil {
			return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "model_axes contain an invalid or duplicate slot", nil)
		}
		inputs[axis.GetSlotId()] = axis
	}
	loadoutID := "loadout_" + ulid.Make().String()
	createdAt := now.Format(time.RFC3339Nano)
	if existing != nil {
		loadoutID, createdAt = existing.GetLoadoutId(), existing.GetCreatedAt()
	}
	proposal := &runtimev1.Loadout{
		LoadoutId: loadoutID, CapabilityContract: contract,
		Implementation: (&capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}).Proto(),
		RecipeId:       recipe.RecipeID, RecipeRevision: recipe.Revision, Options: options,
		SupportedFeatures: features, DisplayName: displayName, Provenance: cloneStruct(request.GetProvenance()),
		CreatedAt: createdAt, UpdatedAt: now.Format(time.RFC3339Nano),
		RecipeCustody: loadoutRecipeCustodyReferences(recipe),
	}
	for _, requirement := range requirements {
		metadata, exists := metadataBySlot[requirement.GetRequirementId()]
		if !exists {
			return nil, loadoutError(codes.Internal, runtimev1.ReasonCode_AI_LOADOUT_CATALOG_SCHEMA_INVALID, "recipe slot metadata is incomplete", nil)
		}
		axis := &runtimev1.LoadoutModelAxis{SlotId: requirement.GetRequirementId(), DisplayLabel: metadata.DisplayLabel}
		input := inputs[requirement.GetRequirementId()]
		if input != nil {
			axis.ModelAssetId = strings.TrimSpace(input.GetModelAssetId())
			axis.ExpectedContentId = strings.TrimSpace(input.GetExpectedContentId())
			delete(inputs, requirement.GetRequirementId())
		} else if candidate := s.uniqueRecommendedModelAsset(s.recommendedContentIDsForRequirement(metadata, requirement)); candidate != nil {
			axis.ModelAssetId, axis.ExpectedContentId = candidate.GetModelAssetId(), candidate.GetContentId()
		}
		proposal.ModelAxes = append(proposal.ModelAxes, axis)
	}
	if len(inputs) != 0 {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "model_axes reference a slot outside the Driver projection", nil)
	}
	validation := s.validateLoadoutCurrent(proposal, driver, requirements)
	applyLoadoutValidation(proposal, validation)
	for _, axis := range proposal.GetModelAxes() {
		if axis.GetModelAssetId() != "" && !axis.GetRecipeCompatible() {
			return nil, loadoutValidationError(validation, proposal.GetLoadoutId())
		}
	}
	if err := validateStoredLoadout(proposal); err != nil {
		return nil, loadoutError(codes.Internal, runtimev1.ReasonCode_AI_CONFIG_INVALID, err.Error(), nil)
	}
	confirmationRequired := existing != nil && s.isSelectedLoadout(existing.GetLoadoutId()) && loadoutExecutionIdentityChanged(existing, proposal)
	prepareID := "prepare_" + ulid.Make().String()
	held := heldLoadoutPrepare{
		proposal: cloneLoadout(proposal), recipe: recipe,
		ownerKey: modelInstallPlanOwnerKey(ctx), baseCASToken: baseCAS, expiresAt: now.Add(loadoutPrepareTTL), confirmationRequired: confirmationRequired,
	}
	s.heldLoadoutPrepares[prepareID] = held
	return &runtimev1.PrepareLoadoutResponse{
		PrepareId: prepareID, ProposedLoadout: cloneLoadout(proposal), ExpiresAt: held.expiresAt.Format(time.RFC3339Nano),
		Impact: &runtimev1.LoadoutImpactProjection{CapabilityContract: contract, LoadoutId: loadoutID, ChangesFutureLocalExecution: confirmationRequired, ConfirmationRequired: confirmationRequired},
	}, nil
}

func (s *Service) CommitLoadout(ctx context.Context, request *runtimev1.CommitLoadoutRequest) (*runtimev1.CommitLoadoutResponse, error) {
	prepareID := strings.TrimSpace(request.GetPrepareId())
	if prepareID == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOADOUT_PREPARE_NOT_FOUND, "prepare_id is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	now := s.loadoutTime()
	held, ok := s.heldLoadoutPrepares[prepareID]
	if !ok {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_PREPARE_NOT_FOUND, "Loadout prepare is unknown or already consumed", nil)
	}
	if !held.expiresAt.After(now) {
		delete(s.heldLoadoutPrepares, prepareID)
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_PREPARE_EXPIRED, "Loadout prepare expired", nil)
	}
	if held.ownerKey != modelInstallPlanOwnerKey(ctx) {
		return nil, loadoutError(codes.PermissionDenied, runtimev1.ReasonCode_AI_LOADOUT_PREPARE_OWNER_MISMATCH, "Loadout prepare belongs to another owner or session", nil)
	}
	delete(s.heldLoadoutPrepares, prepareID)
	s.mu.RLock()
	currentCAS := s.loadoutCASToken
	s.mu.RUnlock()
	if held.baseCASToken != currentCAS {
		return nil, loadoutError(codes.Aborted, runtimev1.ReasonCode_AI_LOADOUT_COMMIT_CONFLICT, "Loadout store changed after Prepare", nil)
	}
	if held.confirmationRequired && !request.GetConfirmedMachineImpact() {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_CONFIRMATION_REQUIRED, "machine-wide impact confirmation is required", nil)
	}
	held.proposal.RecipeCustody = loadoutRecipeCustodyReferences(held.recipe)
	driver, requirements, err := s.projectStoredLoadout(held.proposal)
	if err != nil {
		return nil, err
	}
	validation := s.validateLoadoutCurrent(held.proposal, driver, requirements)
	applyLoadoutValidation(held.proposal, validation)
	for _, axis := range held.proposal.GetModelAxes() {
		if axis.GetModelAssetId() != "" && !axis.GetRecipeCompatible() {
			return nil, loadoutValidationError(validation, held.proposal.GetLoadoutId())
		}
	}
	held.proposal.UpdatedAt = now.Format(time.RFC3339Nano)
	if err := validateStoredLoadout(held.proposal); err != nil {
		return nil, loadoutError(codes.Internal, runtimev1.ReasonCode_AI_CONFIG_INVALID, err.Error(), nil)
	}
	s.mu.Lock()
	next := s.loadoutRowsReplacingLocked(held.proposal)
	selections := s.loadoutSelectionRowsLocked()
	if err := s.loadoutStore.Save(next, selections); err != nil {
		s.mu.Unlock()
		return nil, loadoutPersistenceError(err)
	}
	s.loadouts[held.proposal.GetLoadoutId()] = cloneLoadout(held.proposal)
	s.loadoutCASToken = "loadout-cas_" + ulid.Make().String()
	s.mu.Unlock()
	return &runtimev1.CommitLoadoutResponse{Loadout: cloneLoadout(held.proposal)}, nil
}

func (s *Service) UpdateLoadout(ctx context.Context, request *runtimev1.UpdateLoadoutRequest) (*runtimev1.UpdateLoadoutResponse, error) {
	if request == nil {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "request is required", nil)
	}
	prepared, err := s.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		LoadoutId: request.GetLoadoutId(), CapabilityContract: request.GetCapabilityContract(), RecipeId: request.GetRecipeId(),
		Options: request.GetOptions(), SupportedFeatures: request.GetSupportedFeatures(), ModelAxes: request.GetModelAxes(),
		DisplayName: request.GetDisplayName(), Provenance: request.GetProvenance(),
	})
	if err != nil {
		return nil, err
	}
	committed, err := s.CommitLoadout(ctx, &runtimev1.CommitLoadoutRequest{PrepareId: prepared.GetPrepareId(), ConfirmedMachineImpact: request.GetConfirmedMachineImpact()})
	if err != nil {
		return nil, err
	}
	return &runtimev1.UpdateLoadoutResponse{Loadout: committed.GetLoadout()}, nil
}

func (s *Service) SelectLoadout(_ context.Context, request *runtimev1.SelectLoadoutRequest) (*runtimev1.SelectLoadoutResponse, error) {
	contract := strings.TrimSpace(request.GetCapabilityContract())
	loadoutID := strings.TrimSpace(request.GetLoadoutId())
	if contract == "" || !aicapabilities.IsCanonicalCatalogCapability(contract) {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID, "capability_contract is required and canonical", nil)
	}
	if !request.GetConfirmedMachineImpact() {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_CONFIRMATION_REQUIRED, "machine-wide impact confirmation is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.mu.RLock()
	loadout := cloneLoadout(s.loadouts[loadoutID])
	s.mu.RUnlock()
	var selection *runtimev1.LoadoutSelection
	if loadoutID != "" {
		if loadout == nil {
			return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "Loadout was not found", nil)
		}
		if loadout.GetCapabilityContract() != contract {
			return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH, "Loadout capability does not match selection", nil)
		}
		driver, requirements, err := s.projectStoredLoadout(loadout)
		if err != nil {
			return nil, err
		}
		validation := s.validateLoadoutCurrent(loadout, driver, requirements)
		applyLoadoutValidation(loadout, validation)
		if validation.state != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
			return nil, loadoutValidationError(validation, loadoutID)
		}
		selection = &runtimev1.LoadoutSelection{CapabilityContract: contract, LoadoutId: loadoutID}
	}
	s.mu.Lock()
	nextSelections := s.loadoutSelectionRowsExcludingLocked(contract, "")
	if selection != nil {
		nextSelections = append(nextSelections, cloneLoadoutSelection(selection))
	}
	if err := s.loadoutStore.Save(s.loadoutRowsLocked(), nextSelections); err != nil {
		s.mu.Unlock()
		return nil, loadoutPersistenceError(err)
	}
	if selection == nil {
		delete(s.loadoutSelections, contract)
	} else {
		s.loadoutSelections[contract] = cloneLoadoutSelection(selection)
	}
	s.loadoutCASToken = "loadout-cas_" + ulid.Make().String()
	s.mu.Unlock()
	return &runtimev1.SelectLoadoutResponse{Selection: selection}, nil
}

func (s *Service) DeleteLoadout(_ context.Context, request *runtimev1.DeleteLoadoutRequest) (*runtimev1.DeleteLoadoutResponse, error) {
	loadoutID := strings.TrimSpace(request.GetLoadoutId())
	if loadoutID == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "loadout_id is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadouts[loadoutID] == nil {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "Loadout was not found", nil)
	}
	selected := s.selectedContractForLoadoutLocked(loadoutID)
	if selected != "" && !request.GetConfirmedMachineImpact() {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_CONFIRMATION_REQUIRED, "machine-wide impact confirmation is required", nil)
	}
	nextRows := s.loadoutRowsExcludingLocked(loadoutID)
	nextSelections := s.loadoutSelectionRowsExcludingLocked("", loadoutID)
	if err := s.loadoutStore.Save(nextRows, nextSelections); err != nil {
		return nil, loadoutPersistenceError(err)
	}
	delete(s.loadouts, loadoutID)
	if selected != "" {
		delete(s.loadoutSelections, selected)
	}
	s.loadoutCASToken = "loadout-cas_" + ulid.Make().String()
	return &runtimev1.DeleteLoadoutResponse{}, nil
}

func (s *Service) projectRecipe(recipeID, contract string, implementation *runtimev1.CapabilityImplementationIdentity, options *structpb.Struct, features []string) (capabilitydriver.Driver, []*runtimev1.LocalCapabilityRequirement, error) {
	driver, reason := s.capabilityDrivers.Resolve(contract, capabilitydriver.IdentityFromProto(implementation))
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_DRIVER_UNAVAILABLE, "Loadout Driver is unavailable", map[string]string{"local_reason": reason.String()})
	}
	recipeDriver, ok := driver.(capabilitydriver.RecipeDriver)
	if !ok {
		return nil, nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_DRIVER_UNAVAILABLE, "Loadout Driver does not support recipe projection", nil)
	}
	var requirements []*runtimev1.LocalCapabilityRequirement
	if hostDriver, ok := driver.(capabilitydriver.HostPlatformRecipeDriver); ok {
		platformTuple := strings.ToLower(strings.TrimSpace(localRuntimeGOOS)) + "/" + strings.ToLower(strings.TrimSpace(localRuntimeGOARCH))
		requirements, reason = hostDriver.ProjectRecipeForHost(recipeID, options, features, platformTuple)
	} else {
		requirements, reason = recipeDriver.ProjectRecipe(recipeID, options, features)
	}
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) == 0 {
		if reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			return nil, nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "Loadout options are not valid for the selected recipe", map[string]string{"local_reason": reason.String()})
		}
		return nil, nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_DRIVER_UNAVAILABLE, "Loadout recipe is not interpretable by its exact Driver dialect", map[string]string{"local_reason": reason.String()})
	}
	return driver, cloneLocalCapabilityRequirements(requirements), nil
}

func (s *Service) projectStoredLoadout(loadout *runtimev1.Loadout) (capabilitydriver.Driver, []*runtimev1.LocalCapabilityRequirement, error) {
	return s.projectRecipe(loadout.GetRecipeId(), loadout.GetCapabilityContract(), loadout.GetImplementation(), loadout.GetOptions(), loadout.GetSupportedFeatures())
}

type loadoutModelAxisResolver func(*runtimev1.Loadout, capabilitydriver.Driver, *runtimev1.LocalCapabilityRequirement, *runtimev1.LoadoutModelAxis) (resolvedLoadoutAxis, runtimev1.ReasonCode)

type loadoutFileSHA256Resolver func(string, os.FileInfo, string) (string, error)

func (s *Service) validateLoadoutCurrent(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirements []*runtimev1.LocalCapabilityRequirement) loadoutValidationResult {
	return s.validateLoadoutWithAxisResolver(loadout, driver, requirements, s.resolveLoadoutModelAxis)
}

// validateLoadoutForJobAdmission is intentionally separate from projection
// validation: its axis resolver rereads every declared payload byte.
func (s *Service) validateLoadoutForJobAdmission(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirements []*runtimev1.LocalCapabilityRequirement) loadoutValidationResult {
	return s.validateLoadoutWithAxisResolver(loadout, driver, requirements, s.resolveLoadoutModelAxisForAdmission)
}

func (s *Service) validateLoadoutWithAxisResolver(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirements []*runtimev1.LocalCapabilityRequirement, resolveAxis loadoutModelAxisResolver) loadoutValidationResult {
	result := loadoutValidationResult{
		state:        runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
		axisReasons:  make(map[string][]runtimev1.ReasonCode, len(requirements)),
		driver:       driver,
		requirements: requirements,
	}
	if loadout == nil || driver == nil || len(requirements) == 0 {
		result.state = runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED
		result.reasons = append(result.reasons, runtimev1.ReasonCode_AI_LOADOUT_DRIVER_UNAVAILABLE)
		return result
	}
	axisBySlot := make(map[string]*runtimev1.LoadoutModelAxis, len(loadout.GetModelAxes()))
	for _, axis := range loadout.GetModelAxes() {
		if axis != nil {
			axisBySlot[axis.GetSlotId()] = axis
		}
	}
	for _, requirement := range requirements {
		slotID := requirement.GetRequirementId()
		axis := axisBySlot[slotID]
		if axis == nil || axis.GetModelAssetId() == "" || axis.GetExpectedContentId() == "" {
			if result.state != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED {
				result.state = runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNRESOLVED
			}
			result.reasons = appendReasonCode(result.reasons, runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED)
			result.axisReasons[slotID] = appendReasonCode(result.axisReasons[slotID], runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED)
			continue
		}
		resolved, reason := resolveAxis(loadout, driver, requirement, axis)
		if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			result.state = runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED
			result.reasons = appendReasonCode(result.reasons, reason)
			result.axisReasons[slotID] = appendReasonCode(result.axisReasons[slotID], reason)
			continue
		}
		result.axes = append(result.axes, resolved)
	}
	if result.state == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		bindings := make([]*runtimev1.ModelAssetExactBinding, 0, len(result.axes))
		descriptors := make([]capabilitydriver.ModelAssetDescriptor, 0, len(result.axes))
		for _, axis := range result.axes {
			bindings = append(bindings, axis.binding)
			descriptors = append(descriptors, axis.descriptor)
		}
		if reason := driver.ValidateCombination(cloneLocalCapabilityRequirements(requirements), cloneModelAssetExactBindings(bindings), cloneCapabilityDriverModelAssetDescriptors(descriptors)); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			result.state = runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED
			result.reasons = appendReasonCode(result.reasons, runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED)
		}
	}
	return result
}

func (s *Service) resolveLoadoutModelAxis(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirement *runtimev1.LocalCapabilityRequirement, axis *runtimev1.LoadoutModelAxis) (resolvedLoadoutAxis, runtimev1.ReasonCode) {
	return s.resolveLoadoutModelAxisWithHasher(loadout, driver, requirement, axis, s.cachedFileSHA256)
}

func (s *Service) resolveLoadoutModelAxisForAdmission(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirement *runtimev1.LocalCapabilityRequirement, axis *runtimev1.LoadoutModelAxis) (resolvedLoadoutAxis, runtimev1.ReasonCode) {
	return s.resolveLoadoutModelAxisWithHasher(loadout, driver, requirement, axis, s.freshFileSHA256)
}

func (s *Service) resolveLoadoutModelAxisWithHasher(loadout *runtimev1.Loadout, driver capabilitydriver.Driver, requirement *runtimev1.LocalCapabilityRequirement, axis *runtimev1.LoadoutModelAxis, fileSHA256 loadoutFileSHA256Resolver) (resolvedLoadoutAxis, runtimev1.ReasonCode) {
	s.mu.RLock()
	asset := cloneModelAsset(s.modelAssets[axis.GetModelAssetId()])
	directory := s.modelAssetDirectories[axis.GetModelAssetId()]
	s.mu.RUnlock()
	if asset == nil || directory == "" {
		return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_NOT_FOUND
	}
	if asset.GetContentId() != axis.GetExpectedContentId() || normalizeVerifiedContentID(axis.GetExpectedContentId()) != axis.GetExpectedContentId() {
		return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH
	}
	files := make([]*runtimev1.ModelAssetFile, 0, len(asset.GetFiles()))
	declaredFiles := make([]string, 0, len(asset.GetFiles()))
	projectionFiles := make([]capabilitydriver.ModelAssetFileFact, 0, len(asset.GetFiles()))
	var entryFact capabilitydriver.ModelAssetFileFact
	entrySHA, entryPath := "", ""
	contentMismatch := false
	for _, declared := range asset.GetFiles() {
		if declared == nil || !safeModelAssetRelativePath(declared.GetRelativePath()) {
			return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH
		}
		absolute := filepath.Join(directory, filepath.FromSlash(declared.GetRelativePath()))
		if !pathWithinBase(directory, absolute, false) {
			return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH
		}
		info, err := os.Lstat(absolute)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH
		}
		if info.Size() != declared.GetSizeBytes() {
			contentMismatch = true
		}
		generationDigest := modelAssetFileVerificationGeneration(asset, declared)
		digest, err := fileSHA256(absolute, info, generationDigest)
		if err != nil {
			contentMismatch = true
			continue
		}
		if !strings.EqualFold(digest, declared.GetSha256()) {
			contentMismatch = true
		}
		files = append(files, &runtimev1.ModelAssetFile{RelativePath: declared.GetRelativePath(), Sha256: digest, SizeBytes: info.Size(), NonExecutableContent: declared.GetNonExecutableContent()})
		declaredFiles = append(declaredFiles, declared.GetRelativePath())
		opened, openErr := os.Open(absolute)
		if openErr != nil {
			contentMismatch = true
			continue
		}
		probe, readErr := io.ReadAll(io.LimitReader(opened, capabilitydriver.MaxAssetFormatProbeBytes))
		closeErr := opened.Close()
		if readErr != nil || closeErr != nil {
			contentMismatch = true
			continue
		}
		fact := capabilitydriver.ModelAssetFileFact{RelativePath: declared.GetRelativePath(), SizeBytes: info.Size(), FormatProbe: probe}
		projectionFiles = append(projectionFiles, fact)
		if declared.GetRelativePath() == asset.GetEntry() {
			entrySHA, entryPath = digest, absolute
			entryFact = fact
		}
	}
	if contentMismatch || modelAssetContentID(files) != axis.GetExpectedContentId() || entrySHA == "" || entryPath == "" {
		return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: requirement.GetRequirementId(), ModelAssetId: asset.GetModelAssetId(), VerifiedContentId: asset.GetContentId(), EntrySha256: entrySHA}
	projection, reason := driver.ProjectModelAssetBinding(capabilitydriver.ModelAssetBindingInput{
		RecipeID: loadout.GetRecipeId(), Requirement: cloneLocalCapabilityRequirement(requirement), Binding: cloneModelAssetExactBinding(binding),
		Entry: entryFact, Files: projectionFiles,
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_CONTRACT_FAILED
	}
	return resolvedLoadoutAxis{
		slot: cloneLoadoutAxis(axis), requirement: cloneLocalCapabilityRequirement(requirement), binding: binding, descriptor: projection.Descriptor,
		absolutePath: filepath.Clean(entryPath), bundleDir: filepath.Clean(directory), declaredFiles: append([]string(nil), declaredFiles...),
		entrySHA256: entrySHA, contextWindow: projection.ModelContextWindowTokens,
	}, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func applyLoadoutValidation(loadout *runtimev1.Loadout, validation loadoutValidationResult) {
	if loadout == nil {
		return
	}
	loadout.ValidationState = validation.state
	loadout.Reasons = append([]runtimev1.ReasonCode(nil), validation.reasons...)
	resolved := make(map[string]struct{}, len(validation.axes))
	for _, axis := range validation.axes {
		resolved[axis.slot.GetSlotId()] = struct{}{}
	}
	for _, axis := range loadout.GetModelAxes() {
		if axis == nil {
			continue
		}
		_, axis.RecipeCompatible = resolved[axis.GetSlotId()]
		axis.Reasons = append([]runtimev1.ReasonCode(nil), validation.axisReasons[axis.GetSlotId()]...)
		if axis.GetModelAssetId() == "" && len(axis.GetReasons()) == 0 {
			axis.Reasons = []runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED}
		}
	}
}

func (s *Service) deriveCurrentLoadout(stored *runtimev1.Loadout) *runtimev1.Loadout {
	loadout := cloneLoadout(stored)
	if loadout == nil {
		return nil
	}
	driver, requirements, err := s.projectStoredLoadout(loadout)
	if err != nil {
		loadout.ValidationState = runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED
		loadout.Reasons = []runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOADOUT_DRIVER_UNAVAILABLE}
		return loadout
	}
	applyLoadoutValidation(loadout, s.validateLoadoutCurrent(loadout, driver, requirements))
	return loadout
}

func validateStoredLoadout(loadout *runtimev1.Loadout) error {
	if loadout == nil {
		return fmt.Errorf("Loadout is required")
	}
	for _, value := range []string{loadout.GetLoadoutId(), loadout.GetCapabilityContract(), loadout.GetRecipeId(), loadout.GetRecipeRevision(), loadout.GetDisplayName(), loadout.GetCreatedAt(), loadout.GetUpdatedAt()} {
		if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value {
			return fmt.Errorf("Loadout identity and display fields are required and canonical")
		}
	}
	if !aicapabilities.IsCanonicalCatalogCapability(loadout.GetCapabilityContract()) {
		return fmt.Errorf("Loadout capability_contract is not canonical")
	}
	identity := loadout.GetImplementation()
	if identity == nil || strings.TrimSpace(identity.GetImplementationId()) == "" || strings.TrimSpace(identity.GetDriverId()) == "" || strings.TrimSpace(identity.GetDriverDialect()) == "" {
		return fmt.Errorf("Loadout implementation identity is incomplete")
	}
	seenCustody := make(map[string]struct{}, len(loadout.GetRecipeCustody()))
	for _, custody := range loadout.GetRecipeCustody() {
		if custody == nil || !strings.HasPrefix(custody.GetCustodyId(), loadout.GetRecipeId()+"/") || strings.TrimSpace(custody.GetCustodyId()) != custody.GetCustodyId() || normalizeVerifiedContentID(custody.GetExpectedContentId()) != custody.GetExpectedContentId() {
			return fmt.Errorf("Loadout recipe custody is invalid")
		}
		if _, duplicate := seenCustody[custody.GetCustodyId()]; duplicate {
			return fmt.Errorf("Loadout contains duplicate recipe custody %q", custody.GetCustodyId())
		}
		seenCustody[custody.GetCustodyId()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(loadout.GetModelAxes()))
	for _, axis := range loadout.GetModelAxes() {
		if axis == nil || strings.TrimSpace(axis.GetSlotId()) == "" || strings.TrimSpace(axis.GetDisplayLabel()) == "" {
			return fmt.Errorf("Loadout model axis is invalid")
		}
		if _, duplicate := seen[axis.GetSlotId()]; duplicate {
			return fmt.Errorf("Loadout contains duplicate slot %q", axis.GetSlotId())
		}
		seen[axis.GetSlotId()] = struct{}{}
		modelAssetID := strings.TrimSpace(axis.GetModelAssetId())
		expectedContentID := strings.TrimSpace(axis.GetExpectedContentId())
		if expectedContentID != "" && normalizeVerifiedContentID(expectedContentID) != expectedContentID {
			return fmt.Errorf("Loadout slot %q expected content identity is invalid", axis.GetSlotId())
		}
		if modelAssetID != "" && expectedContentID == "" {
			return fmt.Errorf("Loadout slot %q binding is not exact", axis.GetSlotId())
		}
	}
	if len(loadout.GetModelAxes()) == 0 {
		return fmt.Errorf("Loadout has no Driver-projected model axes")
	}
	return nil
}

func canonicalizeLoadout(loadout *runtimev1.Loadout) {
	if loadout == nil {
		return
	}
	loadout.LoadoutId = strings.TrimSpace(loadout.GetLoadoutId())
	loadout.CapabilityContract = strings.TrimSpace(loadout.GetCapabilityContract())
	loadout.RecipeId = strings.TrimSpace(loadout.GetRecipeId())
	loadout.RecipeRevision = strings.TrimSpace(loadout.GetRecipeRevision())
	loadout.DisplayName = strings.TrimSpace(loadout.GetDisplayName())
	loadout.SupportedFeatures = normalizeStableStringSet(loadout.GetSupportedFeatures())
	for _, axis := range loadout.GetModelAxes() {
		if axis != nil {
			axis.SlotId = strings.TrimSpace(axis.GetSlotId())
			axis.DisplayLabel = strings.TrimSpace(axis.GetDisplayLabel())
			axis.ModelAssetId = strings.TrimSpace(axis.GetModelAssetId())
			axis.ExpectedContentId = strings.TrimSpace(axis.GetExpectedContentId())
		}
	}
	sort.Slice(loadout.ModelAxes, func(i, j int) bool { return loadout.ModelAxes[i].GetSlotId() < loadout.ModelAxes[j].GetSlotId() })
}

func validateStoredLoadoutSelection(selection *runtimev1.LoadoutSelection, loadouts map[string]*runtimev1.Loadout) error {
	if selection == nil || strings.TrimSpace(selection.GetCapabilityContract()) == "" || strings.TrimSpace(selection.GetLoadoutId()) == "" {
		return fmt.Errorf("Loadout selection identity is incomplete")
	}
	loadout := loadouts[selection.GetLoadoutId()]
	if loadout == nil || loadout.GetCapabilityContract() != selection.GetCapabilityContract() {
		return fmt.Errorf("Loadout selection target is missing or mismatched")
	}
	return nil
}
func canonicalizeLoadoutSelection(selection *runtimev1.LoadoutSelection) {
	if selection != nil {
		selection.CapabilityContract = strings.TrimSpace(selection.GetCapabilityContract())
		selection.LoadoutId = strings.TrimSpace(selection.GetLoadoutId())
		selection.EffectiveDefaults = nil
	}
}

func (s *Service) recommendedContentIDsForRequirement(metadata catalog.LocalRecipeSlotMetadata, requirement *runtimev1.LocalCapabilityRequirement) []string {
	backend := ""
	if requirement != nil && requirement.GetCompatibilityConstraints() != nil {
		backend = strings.TrimSpace(requirement.GetCompatibilityConstraints().GetFields()["driver_backend"].GetStringValue())
	}
	if backend == "" {
		return append([]string(nil), metadata.RecommendedContentIDs...)
	}
	result := make([]string, 0, len(metadata.RecommendedVariantIDs))
	for _, variantID := range metadata.RecommendedVariantIDs {
		variant, ok := s.localCatalogVariant(variantID)
		if !ok || strings.TrimSpace(variant.DriverBackend) != backend {
			continue
		}
		paths := append([]string(nil), variant.Files...)
		sort.Strings(paths)
		files := make([]*runtimev1.ModelAssetFile, 0, len(paths))
		for _, path := range paths {
			files = append(files, &runtimev1.ModelAssetFile{RelativePath: path, Sha256: variant.Hashes[path]})
		}
		result = append(result, modelAssetContentID(files))
	}
	return normalizeStableStringSet(result)
}

func (s *Service) localCatalogVariant(variantID string) (catalog.LocalPlaneVariant, bool) {
	if s.localProviderCatalog == nil {
		return catalog.LocalPlaneVariant{}, false
	}
	for _, model := range s.localProviderCatalog.LocalPlaneModels() {
		for _, variant := range model.Variants {
			if variant.VariantID == variantID {
				return variant, true
			}
		}
	}
	return catalog.LocalPlaneVariant{}, false
}

func (s *Service) uniqueRecommendedModelAsset(contentIDs []string) *runtimev1.ModelAssetRecord {
	if len(contentIDs) == 0 {
		return nil
	}
	wanted := make(map[string]struct{}, len(contentIDs))
	for _, id := range contentIDs {
		wanted[id] = struct{}{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result *runtimev1.ModelAssetRecord
	for _, asset := range s.modelAssets {
		if asset == nil {
			continue
		}
		if _, ok := wanted[asset.GetContentId()]; !ok {
			continue
		}
		if result != nil {
			return nil
		}
		result = cloneModelAsset(asset)
	}
	return result
}

func (s *Service) loadoutRowsLocked() []*runtimev1.Loadout {
	rows := make([]*runtimev1.Loadout, 0, len(s.loadouts))
	for _, row := range s.loadouts {
		rows = append(rows, cloneLoadout(row))
	}
	return rows
}
func (s *Service) loadoutRowsReplacingLocked(replacement *runtimev1.Loadout) []*runtimev1.Loadout {
	rows := s.loadoutRowsExcludingLocked(replacement.GetLoadoutId())
	return append(rows, cloneLoadout(replacement))
}
func (s *Service) loadoutRowsExcludingLocked(loadoutID string) []*runtimev1.Loadout {
	rows := make([]*runtimev1.Loadout, 0, len(s.loadouts))
	for id, row := range s.loadouts {
		if id != loadoutID {
			rows = append(rows, cloneLoadout(row))
		}
	}
	return rows
}
func (s *Service) loadoutSelectionRowsLocked() []*runtimev1.LoadoutSelection {
	rows := make([]*runtimev1.LoadoutSelection, 0, len(s.loadoutSelections))
	for _, row := range s.loadoutSelections {
		rows = append(rows, cloneLoadoutSelection(row))
	}
	return rows
}
func (s *Service) loadoutSelectionRowsExcludingLocked(contract, loadoutID string) []*runtimev1.LoadoutSelection {
	rows := make([]*runtimev1.LoadoutSelection, 0, len(s.loadoutSelections))
	for current, row := range s.loadoutSelections {
		if current != contract && row.GetLoadoutId() != loadoutID {
			rows = append(rows, cloneLoadoutSelection(row))
		}
	}
	return rows
}
func (s *Service) isSelectedLoadout(loadoutID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.selectedContractForLoadoutLocked(loadoutID) != ""
}
func (s *Service) selectedContractForLoadoutLocked(loadoutID string) string {
	for contract, selection := range s.loadoutSelections {
		if selection.GetLoadoutId() == loadoutID {
			return contract
		}
	}
	return ""
}
func (s *Service) loadoutTime() time.Time {
	if s != nil && s.loadoutNow != nil {
		return s.loadoutNow().UTC()
	}
	return time.Now().UTC()
}
func pruneHeldLoadoutPrepares(prepares map[string]heldLoadoutPrepare, now time.Time) {
	for id, held := range prepares {
		if !held.expiresAt.After(now) {
			delete(prepares, id)
		}
	}
}
func loadoutExecutionIdentityChanged(left, right *runtimev1.Loadout) bool {
	if left == nil || right == nil {
		return true
	}
	a := cloneLoadout(left)
	b := cloneLoadout(right)
	for _, item := range []*runtimev1.Loadout{a, b} {
		item.DisplayName = ""
		item.Provenance = nil
		item.CreatedAt = ""
		item.UpdatedAt = ""
		item.ValidationState = 0
		item.Reasons = nil
		for _, axis := range item.ModelAxes {
			axis.RecipeCompatible = false
			axis.Reasons = nil
		}
	}
	return !proto.Equal(a, b)
}
func findLoadout(loadouts []*runtimev1.Loadout, id string) *runtimev1.Loadout {
	for _, loadout := range loadouts {
		if loadout.GetLoadoutId() == id {
			return loadout
		}
	}
	return nil
}
func cloneLoadoutAxis(input *runtimev1.LoadoutModelAxis) *runtimev1.LoadoutModelAxis {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.LoadoutModelAxis)
}
func loadoutContainsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
func appendReasonCode(values []runtimev1.ReasonCode, reason runtimev1.ReasonCode) []runtimev1.ReasonCode {
	for _, value := range values {
		if value == reason {
			return values
		}
	}
	return append(values, reason)
}
func stringMapToAny(values map[string]string) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
func loadoutValidationError(validation loadoutValidationResult, loadoutID string) error {
	reason := runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED
	code := codes.FailedPrecondition
	if len(validation.reasons) > 0 {
		reason = validation.reasons[0]
	}
	if reason == runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_NOT_FOUND {
		code = codes.NotFound
	}
	return loadoutError(code, reason, "Loadout is not fully configured against current ModelAsset content", map[string]string{"loadout_id": loadoutID})
}
func loadoutPersistenceError(cause error) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOADOUT_PERSISTENCE_UNAVAILABLE, cause, grpcerr.ReasonOptions{Message: "Loadout store could not be persisted"})
}
func loadoutError(code codes.Code, reason runtimev1.ReasonCode, message string, metadata map[string]string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Message: message, Metadata: metadata})
}
