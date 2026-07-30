package localservice

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

// recommendedImageSlotID is the K-MCAT-033 recommended-preset image slot id.
const recommendedImageSlotID = "image"

// recommendedImageConsumerState discriminates the three outcomes of resolving
// the recommended-preset host-conditional image slot into a K-LENV seam.
type recommendedImageConsumerState string

const (
	// recommendedImageStateResolved: the image slot resolved to a concrete
	// image asset + companion bindings; the activation requests are populated.
	recommendedImageStateResolved recommendedImageConsumerState = "resolved"
	// recommendedImageStateOmitted: the host cannot run the optional image slot
	// (main model or a companion has no runnable variant). This is NOT a
	// fail-close — every required slot still ships (K-MCAT-036, design/04).
	recommendedImageStateOmitted recommendedImageConsumerState = "omitted"
	// recommendedImageStateFailClose: the resolver fail-closed (a required slot
	// is unsatisfiable, or the install level is invalid).
	recommendedImageStateFailClose recommendedImageConsumerState = "fail_close"
)

// recommendedImageConsumerBinding is one K-LENV activation/plan request for the
// recommended-preset image consumer. The seam emits one binding for the main
// image asset and one binding per resolved companion: each companion is a
// distinct model.companion-asset dependency keyed by parent_asset_id
// (design/04). CompanionAssetID/ParentAssetID are empty on the main-asset
// binding and populated on each companion binding.
type recommendedImageConsumerBinding struct {
	ConsumerID       string
	AssetID          string
	CompanionKind    string
	EngineSlot       string
	CompanionAssetID string
	ParentAssetID    string
}

// recommendedImageConsumerResolution is the K-LENV seam result for the
// recommended-preset image slot.
type recommendedImageConsumerResolution struct {
	State recommendedImageConsumerState
	// ConsumerID is the accelerator-keyed stable-diffusion.cpp image consumer
	// (set only when State is resolved).
	ConsumerID string
	// Bindings are the activation/plan requests (set only when State is
	// resolved): the main image asset binding plus one per companion.
	Bindings []recommendedImageConsumerBinding
	// ReasonCode is the resolver reason code for omitted / fail-close outcomes.
	ReasonCode string
	Detail     string
}

// recommendedImageConsumerByAccelerator maps a resolved image variant's
// accelerator to the engine-keyed stable-diffusion.cpp native image consumer
// id. The image tier runs on the stablediffusion-ggml native backend; cpu /
// metal / cuda are the admitted accelerator planes
// (local-image-supervised-backend-matrix.yaml).
func recommendedImageConsumerByAccelerator(accelerator string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(accelerator)) {
	case "cuda":
		return stableDiffusionCUDAConsumerID, true
	case "metal":
		return "stable-diffusion.cpp.metal", true
	case "cpu":
		return "stable-diffusion.cpp.cpu", true
	default:
		return "", false
	}
}

// resolveRecommendedImageConsumer runs the deterministic K-MCAT-034 resolver
// over the recommended preset + host posture and projects the host-conditional
// image slot + its companions into K-LENV activation/plan requests
// (design/04 seam). Image is a recommended-only, host_conditional slot and is
// not part of the Product Control first-run required consumer set; this seam
// is consumed on the recommended/confirmed-plan path.
//
// A host that cannot run the optional image slot yields state=omitted (not a
// fail-close) — the required slots still ship. A resolver fail-close (a
// required slot is unsatisfiable) yields state=fail_close.
func (s *Service) resolveRecommendedImageConsumer(hostProfile *runtimev1.LocalDeviceProfile) recommendedImageConsumerResolution {
	if s.localProviderCatalog == nil {
		return recommendedImageConsumerResolution{
			State:      recommendedImageStateFailClose,
			ReasonCode: catalog.ReasonLocalModelResolveHostUnsupported,
			Detail:     "local provider catalog is not loaded; cannot resolve the recommended image slot",
		}
	}
	outcome := s.localProviderCatalog.ResolveLocalModelSet(localEnvironmentInstallLevelRecommended, hostProfile)
	switch outcome.Kind {
	case catalog.LocalResolveFailClose:
		return recommendedImageConsumerResolution{
			State:      recommendedImageStateFailClose,
			ReasonCode: outcome.ReasonCode,
			Detail:     "recommended preset resolution failed closed: " + strings.TrimSpace(outcome.Detail),
		}
	case catalog.LocalResolveResolved:
		// proceed
	default:
		return recommendedImageConsumerResolution{
			State:      recommendedImageStateFailClose,
			ReasonCode: catalog.ReasonLocalModelResolveHostUnsupported,
			Detail:     "recommended preset resolution returned an unknown outcome",
		}
	}

	imageSlot, resolved := outcome.ResolvedSlotByName(recommendedImageSlotID)
	if !resolved {
		// The image slot is host_conditional: a host that cannot run it has the
		// slot omitted by the resolver. This is the design/04 host-conditional
		// adaptation, not a fail-close.
		for _, omitted := range outcome.OmittedSlots {
			if strings.EqualFold(strings.TrimSpace(omitted.Slot), recommendedImageSlotID) {
				return recommendedImageConsumerResolution{
					State:      recommendedImageStateOmitted,
					ReasonCode: omitted.ReasonCode,
					Detail:     "recommended image slot omitted on this host: " + strings.TrimSpace(omitted.Note),
				}
			}
		}
		// No resolved image slot and no omitted image slot: the recommended
		// preset does not declare an image slot at all.
		return recommendedImageConsumerResolution{
			State:      recommendedImageStateOmitted,
			ReasonCode: catalog.ReasonLocalModelResolveSlotOmitted,
			Detail:     "recommended preset declares no image slot",
		}
	}

	consumerID, ok := recommendedImageConsumerByAccelerator(imageSlot.Accelerator)
	if !ok {
		return recommendedImageConsumerResolution{
			State:      recommendedImageStateFailClose,
			ReasonCode: catalog.ReasonLocalModelResolveHostUnsupported,
			Detail:     fmt.Sprintf("resolved image variant %q has no admitted accelerator-keyed image consumer (accelerator=%q)", imageSlot.VariantID, imageSlot.Accelerator),
		}
	}

	bindings := make([]recommendedImageConsumerBinding, 0, len(imageSlot.Companions)+1)
	// Main image asset binding — AssetID only; companion fields are empty.
	bindings = append(bindings, recommendedImageConsumerBinding{
		ConsumerID: consumerID,
		AssetID:    imageSlot.AssetID,
	})
	// One model.companion-asset binding per resolved companion. parent_asset_id
	// is the image slot's resolved variant asset id (design/04 K-LENV seam).
	for _, companion := range imageSlot.Companions {
		bindings = append(bindings, recommendedImageConsumerBinding{
			ConsumerID:       consumerID,
			AssetID:          imageSlot.AssetID,
			CompanionKind:    companion.CompanionKind,
			EngineSlot:       companion.EngineSlot,
			CompanionAssetID: companion.AssetID,
			ParentAssetID:    imageSlot.AssetID,
		})
	}

	return recommendedImageConsumerResolution{
		State:      recommendedImageStateResolved,
		ConsumerID: consumerID,
		Bindings:   bindings,
	}
}

// resolveRecommendedImageActivationGate runs the K-LENV activation gate for the
// recommended-preset image consumer. It resolves the host-conditional image
// slot + companions, then runs the activation gate once per binding so the
// main model.asset dependency and every model.companion-asset dependency get a
// concrete asset identity (design/04 seam).
//
// When the image slot is host-omitted it returns nil gates with state=omitted:
// the optional image slot is dropped, the required slots still ship.
func (s *Service) resolveRecommendedImageActivationGate(
	hostProfile *runtimev1.LocalDeviceProfile,
	runtimeDataRoot string,
) (recommendedImageConsumerResolution, []localEnvironmentConsumerActivationGate) {
	resolution := s.resolveRecommendedImageConsumer(hostProfile)
	if resolution.State != recommendedImageStateResolved {
		return resolution, nil
	}
	gates := make([]localEnvironmentConsumerActivationGate, 0, len(resolution.Bindings))
	for _, binding := range resolution.Bindings {
		gates = append(gates, s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
			ConsumerID:       binding.ConsumerID,
			HostProfile:      hostProfile,
			RuntimeDataRoot:  runtimeDataRoot,
			AssetID:          binding.AssetID,
			CompanionAssetID: binding.CompanionAssetID,
			ParentAssetID:    binding.ParentAssetID,
		}))
	}
	return resolution, gates
}
