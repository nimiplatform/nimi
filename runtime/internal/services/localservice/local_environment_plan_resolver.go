package localservice

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

// resolvePlanModelAssetDependencies implements the design/05 §2-3 plan-internal
// model resolution seam. When the plan request carries an install_level and no
// explicit AssetID, it runs the K-MCAT-034 deterministic resolver over the
// curated preset + host posture and projects the pack's model.asset /
// model.companion-asset families into one dependency per resolved preset slot
// (and per companion) whose capability the pack hosts.
//
// The returned map is keyed by dependency family. A family present in the map
// fully replaces that family's single-dependency resolution in the plan loop;
// model.asset is 1:N (one resolved-slot asset per entry). A family absent from
// the map keeps its prior explicit-identity resolution path.
//
// The same deterministic resolver also serves the MintRuntimeBaselineReadiness
// activation path (resolveBaselineConsumerBindings); both seams resolve
// identical assets for the same (install_level, host_posture) — neither
// re-decides (K-MCAT-034 determinism, design/05 consistency invariant).
//
// Fail-close: a resolver FailClose leaves each model family with a single
// `unsupported` dependency carrying the typed resolver reason code — never an
// empty DependencyID and never a placeholder asset (K-MCAT-037, design/05 §5).
//
// hostProfile is the normalized host posture resolveLocalEnvironmentPlan
// already derived (a caller-supplied profile, or one collected on this host
// when the request omitted it). The K-MCAT-034 resolver MUST receive this
// normalized profile rather than req.HostProfile: a nil request HostProfile
// zeroes the resolver's RAM budget and fail-closes every cpu variant, which
// would project a capable host into the first-run `blocked` state.
func (s *Service) resolvePlanModelAssetDependencies(
	def localComputePackDefinition,
	hostState localEnvironmentHostProfileState,
	platformTuple string,
	runtimeDataRoot string,
	req localEnvironmentPlanRequest,
	hostProfile *runtimev1.LocalDeviceProfile,
) map[string][]localEnvironmentPlanDependency {
	installLevel := normalizeRuntimeBaselineInstallLevel(req.InstallLevel)
	// Install-level resolution applies only when an install_level is supplied
	// and the caller passes no explicit AssetID. An explicit AssetID always
	// wins: the user-driven install/import path is unchanged (design/05 §2).
	if installLevel == "" || strings.TrimSpace(req.AssetID) != "" {
		return nil
	}
	// The pack hosts no preset model slot — install-level resolution does not
	// apply; the families keep their prior resolution path.
	modelFamilies := planModelDependencyFamilies(def)
	if len(modelFamilies) == 0 || len(def.HostedCapabilities) == 0 {
		return nil
	}

	resolution := make(map[string][]localEnvironmentPlanDependency, len(modelFamilies))

	if s.localProviderCatalog == nil {
		failClose := s.planModelAssetFailCloseDependencies(def, modelFamilies, hostState, platformTuple, runtimeDataRoot, req,
			catalog.ReasonLocalModelResolveHostUnsupported,
			"local provider catalog is not loaded; cannot resolve the install-level model set")
		for family, deps := range failClose {
			resolution[family] = deps
		}
		return resolution
	}

	outcome := s.localProviderCatalog.ResolveLocalModelSet(installLevel, hostProfile)
	if outcome.Kind != catalog.LocalResolveResolved {
		reason := strings.TrimSpace(outcome.ReasonCode)
		if reason == "" {
			reason = catalog.ReasonLocalModelResolveHostUnsupported
		}
		detail := strings.TrimSpace(outcome.Detail)
		if detail == "" {
			detail = "install-level model resolution failed closed"
		}
		failClose := s.planModelAssetFailCloseDependencies(def, modelFamilies, hostState, platformTuple, runtimeDataRoot, req, reason, detail)
		for family, deps := range failClose {
			resolution[family] = deps
		}
		return resolution
	}

	// Resolved: emit one model.asset dependency per resolved preset slot whose
	// capability the pack hosts, and one model.companion-asset dependency per
	// companion of those hosted slots (design/05 §2-4).
	hosted := s.planHostedResolvedSlots(def, outcome)

	for _, family := range modelFamilies {
		switch family {
		case localEnvironmentFamilyModelAsset:
			deps := make([]localEnvironmentPlanDependency, 0, len(hosted))
			for _, slot := range hosted {
				slotReq := req
				slotReq.AssetID = slot.AssetID
				slotReq.LocalAssetID = ""
				slotConsumerScope := planResolvedSlotConsumerScope(def, slot, req)
				deps = append(deps, s.resolveLocalEnvironmentDependency(
					def, family, true, hostState, platformTuple, runtimeDataRoot,
					slotConsumerScope, slotReq))
			}
			if len(deps) == 0 {
				// The pack declares a model.asset family but the resolver
				// produced no hosted slot for it — a host-unsupported
				// fail-close, never an empty-id dependency (design/05 §5).
				deps = s.planModelAssetFailCloseFamily(def, family, true, hostState, platformTuple, runtimeDataRoot, req,
					catalog.ReasonLocalModelResolveHostUnsupported,
					fmt.Sprintf("install-level resolution produced no hosted model slot for pack %q", def.PackID))
			}
			resolution[family] = deps
		case localEnvironmentFamilyModelCompanion:
			deps := make([]localEnvironmentPlanDependency, 0)
			for _, slot := range hosted {
				for _, companion := range slot.Companions {
					companionReq := req
					companionReq.AssetID = ""
					companionReq.LocalAssetID = ""
					companionReq.CompanionAssetID = companion.AssetID
					companionReq.ParentAssetID = slot.AssetID
					slotConsumerScope := planResolvedSlotConsumerScope(def, slot, req)
					deps = append(deps, s.resolveLocalEnvironmentDependency(
						def, family, planModelFamilyRequired(def, family), hostState, platformTuple, runtimeDataRoot,
						slotConsumerScope, companionReq))
				}
			}
			if len(deps) == 0 {
				// The pack declares a model.companion-asset family but no
				// hosted resolved slot carries a companion — fail-close with
				// the typed reason (design/05 §5).
				deps = s.planModelAssetFailCloseFamily(def, family, planModelFamilyRequired(def, family), hostState, platformTuple, runtimeDataRoot, req,
					catalog.ReasonLocalModelResolveHostUnsupported,
					fmt.Sprintf("install-level resolution produced no hosted companion asset for pack %q", def.PackID))
			}
			resolution[family] = deps
		}
	}
	return resolution
}

// planModelDependencyFamilies returns the model.asset / model.companion-asset
// families declared by the pack, in declaration order.
func planModelDependencyFamilies(def localComputePackDefinition) []string {
	out := make([]string, 0, 2)
	for _, family := range def.RequiredDependencyFamilies {
		if family == localEnvironmentFamilyModelAsset || family == localEnvironmentFamilyModelCompanion {
			out = append(out, family)
		}
	}
	for _, family := range def.OptionalDependencyFamilies {
		if family == localEnvironmentFamilyModelAsset || family == localEnvironmentFamilyModelCompanion {
			out = append(out, family)
		}
	}
	return out
}

// planModelFamilyRequired reports whether the pack declares the family as a
// required dependency.
func planModelFamilyRequired(def localComputePackDefinition, family string) bool {
	for _, declared := range def.RequiredDependencyFamilies {
		if declared == family {
			return true
		}
	}
	return false
}

// planConsumerScope mirrors resolveLocalEnvironmentPlan's consumer-scope
// defaulting so the synthesized per-slot dependency requests carry the same
// scope.
func planConsumerScope(def localComputePackDefinition, req localEnvironmentPlanRequest) string {
	scope := strings.TrimSpace(req.ConsumerScope)
	if scope == "" {
		return def.PackID
	}
	return scope
}

func planResolvedSlotConsumerScope(def localComputePackDefinition, slot catalog.ResolvedSlot, req localEnvironmentPlanRequest) string {
	scope := planConsumerScope(def, req)
	if !localEnvironmentFirstRunConsumerScope(scope) {
		return scope
	}
	switch strings.TrimSpace(slot.Capability) {
	case localResolverCapabilityTextGenerate:
		return "llama.cpp.cpu"
	case localResolverCapabilityAudioTranscribe:
		return "speech.qwen3-asr.python"
	case localResolverCapabilityAudioSynthesize:
		return "speech.qwen3-tts.python"
	case localResolverCapabilityImageGenerate:
		switch def.PackID {
		case "local-image-python":
			return "media.diffusers.cpu"
		default:
			return "stable-diffusion.cpp.metal"
		}
	case localResolverCapabilityVideoGenerate:
		return "media.video-python.cpu"
	default:
		return scope
	}
}

// planHostedResolvedSlots returns the resolver-resolved slots whose capability
// the pack hosts, in a deterministic order (sorted by slot id). The relation is
// the pack's explicit HostedCapabilities (design/05 §3); it never keys on
// consumerScope.
func (s *Service) planHostedResolvedSlots(def localComputePackDefinition, outcome catalog.LocalResolveOutcome) []catalog.ResolvedSlot {
	hostedSet := make(map[string]struct{}, len(def.HostedCapabilities))
	for _, capability := range def.HostedCapabilities {
		hostedSet[strings.ToLower(strings.TrimSpace(capability))] = struct{}{}
	}
	hosted := make([]catalog.ResolvedSlot, 0, len(outcome.ResolvedSlots))
	for _, slot := range outcome.ResolvedSlots {
		if _, ok := hostedSet[strings.ToLower(strings.TrimSpace(slot.Capability))]; ok {
			hosted = append(hosted, slot)
		}
	}
	sort.Slice(hosted, func(i, j int) bool {
		return strings.ToLower(hosted[i].Slot) < strings.ToLower(hosted[j].Slot)
	})
	return hosted
}

// planModelAssetFailCloseDependencies builds a single typed `unsupported`
// dependency for every model family of the pack when the resolver fails closed.
func (s *Service) planModelAssetFailCloseDependencies(
	def localComputePackDefinition,
	modelFamilies []string,
	hostState localEnvironmentHostProfileState,
	platformTuple string,
	runtimeDataRoot string,
	req localEnvironmentPlanRequest,
	reasonCode string,
	detail string,
) map[string][]localEnvironmentPlanDependency {
	out := make(map[string][]localEnvironmentPlanDependency, len(modelFamilies))
	for _, family := range modelFamilies {
		out[family] = s.planModelAssetFailCloseFamily(def, family, planModelFamilyRequired(def, family), hostState, platformTuple, runtimeDataRoot, req, reasonCode, detail)
	}
	return out
}

// planModelAssetFailCloseFamily builds a single typed `unsupported` dependency
// carrying the resolver reason code. The DependencyID is the pack's stable
// default model-family id — never empty — so the dependency stays `unsupported`
// (the typed fail-close projection) and is never forwarded as a startable job
// with an empty DependencyID (design/05 §5, K-MCAT-037).
func (s *Service) planModelAssetFailCloseFamily(
	def localComputePackDefinition,
	family string,
	required bool,
	hostState localEnvironmentHostProfileState,
	platformTuple string,
	runtimeDataRoot string,
	req localEnvironmentPlanRequest,
	reasonCode string,
	detail string,
) []localEnvironmentPlanDependency {
	dependencyID := defaultLocalEnvironmentDependencyID(def.PackID, family)
	environmentKey := localEnvironmentKey(family, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot)
	return []localEnvironmentPlanDependency{{
		DependencyFamily:     family,
		DependencyID:         dependencyID,
		ConsumerScope:        strings.TrimSpace(planConsumerScope(def, req)),
		Required:             required,
		EnvironmentKey:       environmentKey,
		State:                localEnvironmentStateUnsupported,
		SourceKind:           localEnvironmentSourceUnavailable,
		ConfirmationRequired: false,
		ReasonCode:           strings.TrimSpace(reasonCode),
		Detail:               strings.TrimSpace(detail),
	}}
}
