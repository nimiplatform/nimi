package catalog

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// variantFitTier is the bounded head-room tier used by the variant selector.
type variantFitTier int

const (
	tierRecommended    variantFitTier = 4 // estimated_mem <= 70% budget
	tierRunnable       variantFitTier = 3 // <= 85%
	tierTight          variantFitTier = 2 // <= 100%
	tierNotRecommended variantFitTier = 1 // > budget
	tierIneligible     variantFitTier = 0 // accelerator unavailable / no budget evidence
)

// quantRank is the fixed K-MCAT-035 total order over quant identifiers. A
// higher rank is a higher-fidelity quant. Unknown quant tokens rank 0 and only
// tie-break by variant_id. Same-precision K-variants share a rank; the stable
// variant_id tie-break makes selection deterministic among them.
var quantRank = map[string]int{
	"f16":    9,
	"q8_0":   8,
	"q6_k":   7,
	"q5_k_m": 6,
	"q5_k_s": 6,
	"q5_0":   5,
	"q4_k_m": 4,
	"q4_k":   4,
	"q4_k_s": 4,
	"q4_0":   3,
	"q3":     2,
	"q3_k":   2,
	"q3_k_m": 2,
	"q3_k_s": 2,
	"q2":     1,
	"q2_k":   1,
}

// hostBudget captures the resolved per-accelerator memory budget and
// availability derived from the Runtime LocalDeviceProfile (K-DEV-*).
type hostBudget struct {
	cpuAvailable   bool
	metalAvailable bool
	cudaAvailable  bool
	ramBytes       int64
	vramBytes      int64
	// unifiedMemory marks a host whose GPU shares system RAM (Apple Silicon).
	unifiedMemory bool
}

// resolveHostBudget projects a LocalDeviceProfile into accelerator availability
// and memory budgets.
func resolveHostBudget(profile *runtimev1.LocalDeviceProfile) hostBudget {
	budget := hostBudget{cpuAvailable: true}
	if profile == nil {
		return budget
	}
	budget.ramBytes = profile.GetTotalRamBytes()
	gpu := profile.GetGpu()
	if gpu != nil && gpu.GetAvailable() {
		vendor := strings.ToLower(strings.TrimSpace(gpu.GetVendor()))
		os := strings.ToLower(strings.TrimSpace(profile.GetOs()))
		if gpu.GetMemoryModel() == runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED || os == "darwin" {
			budget.unifiedMemory = true
		}
		switch {
		case strings.Contains(vendor, "apple") || os == "darwin":
			budget.metalAvailable = true
		case strings.Contains(vendor, "nvidia"):
			budget.cudaAvailable = true
		}
		budget.vramBytes = gpu.GetTotalVramBytes()
		// On a unified-memory host the GPU shares system RAM; when the VRAM
		// probe is unavailable fall back to the RAM budget.
		if budget.unifiedMemory && budget.vramBytes <= 0 {
			budget.vramBytes = budget.ramBytes
		}
	}
	return budget
}

// classifyVariant returns the K-MCAT-035 fit tier for one variant against the
// host budget. A variant whose accelerator is unavailable, or whose budget
// evidence is missing, is tierIneligible (never auto-selected).
func classifyVariant(variant LocalPlaneVariant, budget hostBudget) variantFitTier {
	accelerator := strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator))
	var available bool
	var hostBudgetBytes int64
	var footprintBytes int64
	switch accelerator {
	case "cpu":
		available = budget.cpuAvailable
		hostBudgetBytes = budget.ramBytes
		footprintBytes = variant.HostRequirement.MinRAMBytes
	case "metal":
		available = budget.metalAvailable
		hostBudgetBytes = budget.vramBytes
		footprintBytes = variant.HostRequirement.MinVRAMBytes
	case "cuda":
		available = budget.cudaAvailable
		hostBudgetBytes = budget.vramBytes
		footprintBytes = variant.HostRequirement.MinVRAMBytes
	default:
		return tierIneligible
	}
	if !available {
		return tierIneligible
	}
	// Missing budget evidence or footprint must fail closed to ineligible —
	// the resolver never selects a variant on unverified head-room.
	if hostBudgetBytes <= 0 || footprintBytes <= 0 {
		return tierIneligible
	}
	ratio := float64(footprintBytes) / float64(hostBudgetBytes)
	switch {
	case ratio <= 0.70:
		return tierRecommended
	case ratio <= 0.85:
		return tierRunnable
	case ratio <= 1.00:
		return tierTight
	default:
		return tierNotRecommended
	}
}

// selectVariant picks the highest-quant-rank variant that reaches at least the
// runnable tier (K-MCAT-035). tight / not_recommended variants are never
// auto-selected. Returns false when no variant is runnable on this host.
func selectVariant(variants []LocalPlaneVariant, budget hostBudget) (LocalPlaneVariant, bool) {
	type candidate struct {
		variant LocalPlaneVariant
		rank    int
	}
	eligible := make([]candidate, 0, len(variants))
	for _, variant := range variants {
		if classifyVariant(variant, budget) >= tierRunnable {
			eligible = append(eligible, candidate{
				variant: variant,
				rank:    quantRank[strings.ToLower(strings.TrimSpace(variant.Quant))],
			})
		}
	}
	if len(eligible) == 0 {
		return LocalPlaneVariant{}, false
	}
	// Deterministic order: highest quant rank first, then stable variant_id
	// tie-break.
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].rank != eligible[j].rank {
			return eligible[i].rank > eligible[j].rank
		}
		return strings.ToLower(eligible[i].variant.VariantID) < strings.ToLower(eligible[j].variant.VariantID)
	})
	return eligible[0].variant, true
}

// RecommendVariantForHost resolves one recipe-authored candidate set through
// the Runtime-owned host policy. It returns no recommendation when none of the
// declared candidates reaches the runnable tier.
func (c *LocalProviderCatalog) RecommendVariantForHost(variantIDs []string, profile *runtimev1.LocalDeviceProfile) (string, bool) {
	if c == nil || len(variantIDs) == 0 {
		return "", false
	}
	wanted := make(map[string]struct{}, len(variantIDs))
	for _, id := range variantIDs {
		if normalized := strings.TrimSpace(id); normalized != "" {
			wanted[normalized] = struct{}{}
		}
	}
	candidates := make([]LocalPlaneVariant, 0, len(wanted))
	appendCandidates := func(variants []LocalPlaneVariant) {
		for _, variant := range variants {
			if _, ok := wanted[strings.TrimSpace(variant.VariantID)]; ok {
				candidates = append(candidates, variant)
			}
		}
	}
	for _, model := range c.models {
		appendCandidates(model.Variants)
	}
	selected, ok := selectVariant(candidates, resolveHostBudget(profile))
	if !ok {
		return "", false
	}
	return strings.TrimSpace(selected.VariantID), true
}

// RankVariantsForHost preserves the recipe-authored ordinal inside each
// Runtime-owned applicability bucket. It does not inspect inventory.
func (c *LocalProviderCatalog) RankVariantsForHost(variantIDs []string, profile *runtimev1.LocalDeviceProfile) []RankedLocalVariant {
	if c == nil || len(variantIDs) == 0 {
		return nil
	}
	byID := make(map[string]LocalPlaneVariant)
	for _, model := range c.models {
		for _, variant := range model.Variants {
			byID[strings.TrimSpace(variant.VariantID)] = variant
		}
	}
	budget := resolveHostBudget(profile)
	ranked := make([]RankedLocalVariant, 0, len(variantIDs))
	for ordinal, id := range variantIDs {
		variant, ok := byID[strings.TrimSpace(id)]
		if !ok {
			continue
		}
		ranked = append(ranked, RankedLocalVariant{
			Variant:       variant,
			Applicability: variantApplicability(variant, budget),
			Ordinal:       ordinal,
		})
	}
	bucket := func(value LocalVariantApplicability) int {
		switch value {
		case LocalVariantApplicabilitySupported:
			return 0
		case LocalVariantApplicabilityUnknown:
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		left, right := ranked[i], ranked[j]
		if bucket(left.Applicability) != bucket(right.Applicability) {
			return bucket(left.Applicability) < bucket(right.Applicability)
		}
		if left.Ordinal != right.Ordinal {
			return left.Ordinal < right.Ordinal
		}
		return strings.ToLower(left.Variant.VariantID) < strings.ToLower(right.Variant.VariantID)
	})
	return ranked
}

func variantApplicability(variant LocalPlaneVariant, budget hostBudget) LocalVariantApplicability {
	accelerator := strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator))
	switch accelerator {
	case "cpu":
		if !budget.cpuAvailable {
			return LocalVariantApplicabilityUnsupported
		}
		if budget.ramBytes <= 0 || variant.HostRequirement.MinRAMBytes <= 0 {
			return LocalVariantApplicabilityUnknown
		}
	case "metal":
		if !budget.metalAvailable {
			return LocalVariantApplicabilityUnsupported
		}
		if budget.vramBytes <= 0 || variant.HostRequirement.MinVRAMBytes <= 0 {
			return LocalVariantApplicabilityUnknown
		}
	case "cuda":
		if !budget.cudaAvailable {
			return LocalVariantApplicabilityUnsupported
		}
		if budget.vramBytes <= 0 || variant.HostRequirement.MinVRAMBytes <= 0 {
			return LocalVariantApplicabilityUnknown
		}
	default:
		return LocalVariantApplicabilityUnknown
	}
	if classifyVariant(variant, budget) == tierNotRecommended {
		return LocalVariantApplicabilityUnsupported
	}
	return LocalVariantApplicabilitySupported
}
