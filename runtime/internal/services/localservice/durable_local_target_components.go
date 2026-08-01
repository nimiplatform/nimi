package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type DurableLocalComponentSelection struct {
	OccurrenceID   string
	Order          int
	Role           string
	ComponentKind  string
	LogicalModelID string
	TargetRef      *runtimev1.RuntimeDurableLocalTargetRef
	Required       bool
	Weight         string
	Options        map[string]any
}

type durableLocalImageComponentMetadataSchema struct {
	allowWeight bool
	allowedKeys map[string]struct{}
}

// The stable-diffusion.cpp carrier currently admits the same empty public
// metadata schema for each image companion kind. Keeping the schema keyed by
// backend and component kind makes an options addition an explicit backend
// contract change instead of an accidental projection/serialization pass.
var durableLocalImageComponentMetadataSchemas = map[string]map[string]durableLocalImageComponentMetadataSchema{
	"stablediffusion-ggml": {
		"image":        {},
		"chat":         {},
		"llm":          {},
		"text_encoder": {},
		"clip":         {},
		"vae":          {},
		"lora":         {},
		"auxiliary":    {},
		"embedding":    {},
	},
	"stable-diffusion-cpp": {
		"image":        {},
		"chat":         {},
		"llm":          {},
		"text_encoder": {},
		"clip":         {},
		"vae":          {},
		"lora":         {},
		"auxiliary":    {},
		"embedding":    {},
	},
}

func (s *Service) ValidateDurableLocalImageTargetComponents(
	ctx context.Context,
	target *runtimev1.RuntimeDurableLocalTargetRef,
	components []DurableLocalComponentSelection,
) error {
	state, err := s.durableLocalImageBindingState(target)
	if err != nil {
		return err
	}
	main := s.localAssetByID(strings.TrimSpace(state.MainLocalAssetID))
	if !profileEntryStaticConfigAssetUsable(main) {
		return durableLocalTargetUnavailableError()
	}
	expected := durableLocalImageComponentBindings(state)
	actual := append([]DurableLocalComponentSelection(nil), components...)
	sort.SliceStable(actual, func(i, j int) bool { return actual[i].Order < actual[j].Order })
	if len(expected) != len(actual) {
		return durableLocalTargetCapabilityMismatchError()
	}
	for index, selection := range actual {
		binding := expected[index]
		if strings.TrimSpace(selection.OccurrenceID) == "" ||
			strings.TrimSpace(selection.OccurrenceID) != strings.TrimSpace(binding.OccurrenceID) ||
			selection.Order != binding.Order ||
			strings.TrimSpace(selection.Role) != strings.TrimSpace(binding.Role) ||
			strings.ToLower(strings.TrimSpace(selection.ComponentKind)) != strings.ToLower(strings.TrimSpace(binding.CompanionKind)) ||
			selection.Required != binding.Required ||
			strings.TrimSpace(selection.Weight) != strings.TrimSpace(binding.Weight) ||
			!durableLocalComponentOptionsEqual(selection.Options, binding.Options) {
			return durableLocalTargetCapabilityMismatchError()
		}
		if err := ValidateDurableLocalImageComponentMetadata(
			main,
			selection.ComponentKind,
			binding.EngineSlot,
			selection.Weight,
			selection.Options,
		); err != nil {
			return err
		}
		resolved, asset, resolveErr := s.ResolveDurableLocalComponentTarget(ctx, selection.TargetRef, selection.ComponentKind)
		if resolveErr != nil {
			return resolveErr
		}
		if resolved == nil || asset == nil ||
			strings.TrimSpace(resolved.GetResolvedModelId()) != strings.TrimSpace(selection.LogicalModelID) ||
			strings.TrimSpace(asset.GetLocalAssetId()) != strings.TrimSpace(binding.CompanionLocalAssetID) {
			return durableLocalTargetCapabilityMismatchError()
		}
		if !profileEntryStaticConfigAssetUsable(asset) {
			return durableLocalTargetUnavailableError()
		}
	}
	return nil
}

func (s *Service) MaterializeDurableLocalImageTarget(
	ctx context.Context,
	baseTarget *runtimev1.RuntimeDurableLocalTargetRef,
	components []DurableLocalComponentSelection,
) (*runtimev1.RuntimeDurableLocalTargetRef, error) {
	return s.materializeDurableLocalImageTargetWithStructure(ctx, baseTarget, baseTarget, components)
}

// MaterializeDurableLocalImageTargetFromCommitted creates a new composition
// binding when the main image target changes. The committed binding supplies
// the immutable occurrence/slot structure; mainTarget supplies the newly
// selected exact main asset. Keeping those inputs separate prevents a
// readiness reference from being misused as a profile structure template.
func (s *Service) MaterializeDurableLocalImageTargetFromCommitted(
	ctx context.Context,
	committedTarget *runtimev1.RuntimeDurableLocalTargetRef,
	mainTarget *runtimev1.RuntimeDurableLocalTargetRef,
	components []DurableLocalComponentSelection,
) (*runtimev1.RuntimeDurableLocalTargetRef, error) {
	return s.materializeDurableLocalImageTargetWithStructure(ctx, committedTarget, mainTarget, components)
}

func (s *Service) materializeDurableLocalImageTargetWithStructure(
	ctx context.Context,
	structureTarget *runtimev1.RuntimeDurableLocalTargetRef,
	mainTarget *runtimev1.RuntimeDurableLocalTargetRef,
	components []DurableLocalComponentSelection,
) (*runtimev1.RuntimeDurableLocalTargetRef, error) {
	base, err := s.durableLocalImageBindingState(structureTarget)
	if err != nil {
		return nil, err
	}
	_, main, err := s.ResolveDurableLocalTarget(ctx, mainTarget, "image.generate")
	if err != nil {
		return nil, err
	}
	if !profileEntryStaticConfigAssetUsable(main) {
		return nil, durableLocalTargetUnavailableError()
	}
	baseComponents := durableLocalImageComponentBindings(base)
	baseMainLocalAssetID := strings.TrimSpace(base.MainLocalAssetID)
	baseMain := s.localAssetByID(baseMainLocalAssetID)
	if baseMain == nil || strings.TrimSpace(baseMain.GetAssetId()) == "" {
		return nil, durableLocalTargetUnavailableError()
	}
	if err := validateDurableLocalImageMainRebindCompatibility(baseMain, main); err != nil {
		return nil, err
	}
	byOccurrence := make(map[string]managedMediaProfileMaterializationBinding, len(baseComponents))
	for _, binding := range baseComponents {
		byOccurrence[strings.TrimSpace(binding.OccurrenceID)] = binding
	}
	ordered := append([]DurableLocalComponentSelection(nil), components...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Order < ordered[j].Order })
	if len(ordered) != len(baseComponents) {
		return nil, durableLocalTargetCapabilityMismatchError()
	}
	mainLocalAssetID := strings.TrimSpace(main.GetLocalAssetId())
	mainAssetID := strings.TrimSpace(main.GetAssetId())
	if mainLocalAssetID == "" || mainAssetID == "" {
		return nil, durableLocalTargetUnavailableError()
	}
	materialized := []managedMediaProfileMaterializationBinding{{
		AssetID:      mainAssetID,
		LocalAssetID: mainLocalAssetID,
	}}
	seenOccurrences := make(map[string]struct{}, len(ordered))
	for _, selection := range ordered {
		occurrenceID := strings.TrimSpace(selection.OccurrenceID)
		baseBinding, ok := byOccurrence[occurrenceID]
		if !ok {
			return nil, durableLocalTargetCapabilityMismatchError()
		}
		if _, duplicate := seenOccurrences[occurrenceID]; duplicate {
			return nil, durableLocalTargetCapabilityMismatchError()
		}
		seenOccurrences[occurrenceID] = struct{}{}
		if selection.Order != baseBinding.Order ||
			strings.TrimSpace(selection.Role) != strings.TrimSpace(baseBinding.Role) ||
			strings.ToLower(strings.TrimSpace(selection.ComponentKind)) != strings.ToLower(strings.TrimSpace(baseBinding.CompanionKind)) ||
			selection.Required != baseBinding.Required {
			return nil, durableLocalTargetCapabilityMismatchError()
		}
		resolved, asset, resolveErr := s.ResolveDurableLocalComponentTarget(ctx, selection.TargetRef, selection.ComponentKind)
		if resolveErr != nil {
			return nil, resolveErr
		}
		if resolved == nil || asset == nil ||
			strings.TrimSpace(resolved.GetResolvedModelId()) != strings.TrimSpace(selection.LogicalModelID) {
			return nil, durableLocalTargetCapabilityMismatchError()
		}
		if !profileEntryStaticConfigAssetUsable(asset) {
			return nil, durableLocalTargetUnavailableError()
		}
		if err := ValidateDurableLocalImageComponentMetadata(
			main,
			selection.ComponentKind,
			baseBinding.EngineSlot,
			selection.Weight,
			selection.Options,
		); err != nil {
			return nil, err
		}
		if err := validateDurableLocalImageComponentCompatibility(main, baseBinding.EngineSlot, asset); err != nil {
			return nil, err
		}
		materialized = append(materialized, managedMediaProfileMaterializationBinding{
			AssetID:               mainAssetID,
			LocalAssetID:          mainLocalAssetID,
			OccurrenceID:          occurrenceID,
			Order:                 selection.Order,
			Role:                  strings.TrimSpace(selection.Role),
			LogicalModelID:        strings.TrimSpace(selection.LogicalModelID),
			Required:              selection.Required,
			Weight:                strings.TrimSpace(selection.Weight),
			Options:               cloneAnyMap(selection.Options),
			CompanionKind:         strings.ToLower(strings.TrimSpace(selection.ComponentKind)),
			EngineSlot:            strings.TrimSpace(baseBinding.EngineSlot),
			CompanionAssetID:      strings.TrimSpace(asset.GetAssetId()),
			CompanionLocalAssetID: strings.TrimSpace(asset.GetLocalAssetId()),
			ParentAssetID:         mainAssetID,
		})
	}
	key, err := durableLocalImageComponentMaterializationKey(mainLocalAssetID, materialized)
	if err != nil {
		return nil, err
	}
	s.cacheManagedMediaImageProfileResolution(mainLocalAssetID, key, nil, true, materialized)
	target := durableLocalWorkflowBindingTargetRef(workflowBindingIDPrefix + key)
	if target == nil {
		return nil, durableLocalTargetInvalidError()
	}
	if err := s.ValidateDurableLocalImageTargetComponents(ctx, target, ordered); err != nil {
		return nil, err
	}
	return target, nil
}

// ValidateDurableLocalImageComponentMetadata is the Runtime/backend admission
// boundary for occurrence metadata. The currently admitted managed image
// backend (stable-diffusion.cpp) consumes component paths and slots, but has no
// component weight or structural option flags. Non-empty metadata therefore
// fails before a binding can be cached or reported ready. Empty maps remain the
// canonical representation of no options. Callers that do not possess the
// Runtime-owned main asset facts must fail closed rather than inventing a
// backend schema for a public projection.
func ValidateDurableLocalImageComponentMetadata(
	main *runtimev1.LocalAssetRecord,
	componentKind string,
	engineSlot string,
	weight string,
	options map[string]any,
) error {
	if strings.TrimSpace(weight) == "" && len(options) == 0 {
		return nil
	}
	if strings.TrimSpace(componentKind) == "" {
		return durableLocalTargetCapabilityMismatchError()
	}
	if main == nil {
		return durableLocalTargetCapabilityMismatchError()
	}
	if strings.TrimSpace(engineSlot) == "" {
		return durableLocalTargetCapabilityMismatchError()
	}
	backend, known := durableLocalImageAssetBackend(main)
	if !known {
		return durableLocalTargetCapabilityMismatchError()
	}
	schemas, ok := durableLocalImageComponentMetadataSchemas[backend]
	if !ok {
		return durableLocalTargetCapabilityMismatchError()
	}
	schema, ok := schemas[strings.ToLower(strings.TrimSpace(componentKind))]
	if !ok || (!schema.allowWeight && strings.TrimSpace(weight) != "") ||
		(len(options) > 0 && len(schema.allowedKeys) == 0) {
		return durableLocalTargetCapabilityMismatchError()
	}
	for key := range options {
		if _, allowed := schema.allowedKeys[strings.TrimSpace(key)]; !allowed {
			return durableLocalTargetCapabilityMismatchError()
		}
	}
	return nil
}

// validateDurableLocalImageMainRebindCompatibility keeps a committed image
// composition on the same execution backend and model family when only the
// main model is changed. Both facts are Runtime-owned inventory facts. Any
// missing fact fails closed; production must never infer compatibility from a
// logical model id or from a legacy fixture shape.
func validateDurableLocalImageMainRebindCompatibility(
	previous *runtimev1.LocalAssetRecord,
	next *runtimev1.LocalAssetRecord,
) error {
	previousBackend, previousBackendKnown := durableLocalImageAssetBackend(previous)
	nextBackend, nextBackendKnown := durableLocalImageAssetBackend(next)
	if !previousBackendKnown || !nextBackendKnown ||
		previousBackendKnown != nextBackendKnown ||
		(previousBackendKnown && previousBackend != nextBackend) {
		return durableLocalTargetCapabilityMismatchError()
	}
	previousFamily := normalizeProfileRuntimeImageModelFamily(previous.GetFamily())
	nextFamily := normalizeProfileRuntimeImageModelFamily(next.GetFamily())
	if previousFamily == "" || nextFamily == "" ||
		(previousFamily == "") != (nextFamily == "") ||
		(previousFamily != "" && previousFamily != nextFamily) {
		return durableLocalTargetCapabilityMismatchError()
	}
	return nil
}

func durableLocalImageAssetBackend(asset *runtimev1.LocalAssetRecord) (string, bool) {
	if asset == nil {
		return "", false
	}
	config := structToMap(asset.GetEngineConfig())
	backend := strings.TrimSpace(valueAsString(config["backend_family"]))
	if backend == "" {
		backend = strings.TrimSpace(valueAsString(config["backendFamily"]))
	}
	if backend == "" {
		backend = strings.TrimSpace(valueAsString(config["backend"]))
	}
	backend = strings.ToLower(strings.ReplaceAll(backend, "_", "-"))
	return backend, backend != ""
}

func validateDurableLocalImageComponentCompatibility(
	main *runtimev1.LocalAssetRecord,
	engineSlot string,
	component *runtimev1.LocalAssetRecord,
) error {
	if main == nil || component == nil {
		return nil
	}
	if strings.TrimSpace(main.GetFamily()) == "" {
		return durableLocalTargetCapabilityMismatchError()
	}
	resolution := managedMediaProfileSlotResolution{
		MainAsset: main,
		SlotAssets: []managedMediaProfileSlotAsset{{
			EngineSlot: strings.TrimSpace(engineSlot),
			Asset:      component,
		}},
	}
	if err := validateManagedMediaProfileSlotCompatibility(resolution); err != nil {
		return durableLocalTargetCapabilityMismatchError()
	}
	return nil
}

func (s *Service) durableLocalImageBindingState(
	target *runtimev1.RuntimeDurableLocalTargetRef,
) (managedImageProfileState, error) {
	if s == nil || target == nil || strings.TrimSpace(target.GetVersion()) != "v2" {
		return managedImageProfileState{}, durableLocalTargetInvalidError()
	}
	bindingID := strings.TrimSpace(target.GetProfileBindingId())
	if bindingID == "" {
		return managedImageProfileState{}, durableLocalTargetInvalidError()
	}
	state, ok := s.cachedManagedMediaImageProfileBinding(bindingID)
	if !ok || !state.MaterializationResolved || len(state.MaterializationBindings) == 0 {
		return managedImageProfileState{}, durableLocalTargetUnavailableError()
	}
	return state, nil
}

func durableLocalImageComponentBindings(
	state managedImageProfileState,
) []managedMediaProfileMaterializationBinding {
	out := make([]managedMediaProfileMaterializationBinding, 0, len(state.MaterializationBindings))
	for _, binding := range state.MaterializationBindings {
		if strings.TrimSpace(binding.CompanionLocalAssetID) == "" {
			continue
		}
		out = append(out, binding)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Order < out[j].Order })
	return out
}

func durableLocalImageComponentMaterializationKey(
	mainLocalAssetID string,
	bindings []managedMediaProfileMaterializationBinding,
) (string, error) {
	material := map[string]any{
		"main_local_asset_id": strings.TrimSpace(mainLocalAssetID),
		"bindings":            bindings,
	}
	raw, err := json.Marshal(material)
	if err != nil {
		return "", grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "image component binding identity could not be serialized"},
		)
	}
	sum := sha256.Sum256(raw)
	return profileRuntimeMaterializationKeyPrefix + hex.EncodeToString(sum[:]), nil
}

func durableLocalComponentOptionsEqual(left map[string]any, right map[string]any) bool {
	if len(left) == 0 && len(right) == 0 {
		return true
	}
	leftStruct, leftErr := json.Marshal(left)
	rightStruct, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftStruct) == string(rightStruct)
}
