package localservice

import (
	"fmt"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func buildMediaRecommendation(candidate recommendationCandidate, profile *runtimev1.LocalDeviceProfile, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) *runtimev1.LocalCatalogRecommendation {
	support := classifyRecommendationHostSupport(candidate.engine, profile)
	reasonCodes := []string{}
	notes := []string{}
	baseline := runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_UNSPECIFIED
	switch normalizeRecommendationFeedCapability(candidate.capability) {
	case "image":
		baseline = runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_IMAGE_DEFAULT_V1
		pushRecommendationCode(&reasonCodes, reasonBaselineImageDefault)
		pushRecommendationNote(&notes, "Baseline: image-default-v1 (1024x1024 text-to-image).")
	case "video":
		baseline = runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_VIDEO_DEFAULT_V1
		pushRecommendationCode(&reasonCodes, reasonBaselineVideoDefault)
		pushRecommendationNote(&notes, "Baseline: video-default-v1 (720p, 4s, 16fps, text-to-video, no audio).")
	}
	sizeBytes := candidate.mainSizeBytes
	if sizeBytes <= 0 {
		sizeBytes = candidate.knownTotalSizeBytes
		pushRecommendationCode(&reasonCodes, reasonMetadataIncomplete)
		if sizeBytes > 0 {
			pushRecommendationCode(&reasonCodes, reasonRepoLevelEstimate)
		} else {
			pushRecommendationCode(&reasonCodes, reasonMainSizeUnknown)
		}
	}
	budgetBytes := mediaMemoryBudgetBytes(candidate.capability, profile, &reasonCodes, &notes)
	if budgetBytes <= 0 {
		pushRecommendationCode(&reasonCodes, reasonGPUMemoryUnknown)
		pushRecommendationNote(&notes, "Host memory profile is incomplete; recommendation confidence is reduced.")
	}
	confidence := runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_MEDIUM
	if candidate.format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF && candidate.mainSizeBytes > 0 && budgetBytes > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_HIGH
	}
	if candidate.mainSizeBytes <= 0 || budgetBytes <= 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_LOW
	}
	multiplier := mediaOverheadMultiplier(candidate.capability, candidate.format, candidate.engine)
	estimatedBytes := int64(math.Ceil(float64(sizeBytes) * multiplier))
	pushRecommendationCode(&reasonCodes, reasonPrereqOverhead)
	pushRecommendationCode(&reasonCodes, reasonEngineOverhead)
	pushRecommendationNote(&notes, "Estimate includes conservative hard-prerequisite and engine overhead.")
	if quant := quantHintFromEntry(candidate.entry); quant != "" {
		pushRecommendationCode(&reasonCodes, reasonVariantQuantParsed)
		pushRecommendationNote(&notes, fmt.Sprintf("Parsed quant hint from variant filename: %s.", quant))
	}
	tier := recommendationTierForBudget(estimatedBytes, budgetBytes, &reasonCodes, &notes)
	switch support.class {
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY:
		pushRecommendationCode(&reasonCodes, reasonHostAttachedOnly)
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED:
		pushRecommendationCode(&reasonCodes, reasonHostUnsupported)
	}
	if support.detail != "" {
		pushRecommendationNote(&notes, support.detail)
	}
	pushRecommendationNote(&notes, "Dependency assets may still be required and are not part of the runnable-asset tier.")
	return &runtimev1.LocalCatalogRecommendation{
		Source:           runtimev1.LocalRecommendationSource_LOCAL_RECOMMENDATION_SOURCE_MEDIA_FIT,
		Format:           candidate.format,
		Tier:             tier,
		HostSupportClass: support.class,
		Confidence:       confidence,
		ReasonCodes:      reasonCodes,
		RecommendedEntry: candidate.entry,
		FallbackEntries:  append([]string(nil), candidate.fallbackEntries...),
		SuggestedAssets:  companionSuggestions(candidate, verifiedAssets),
		SuggestedNotes:   notes,
		Baseline:         baseline,
	}
}

func buildLLMRecommendation(candidate recommendationCandidate, profile *runtimev1.LocalDeviceProfile) *runtimev1.LocalCatalogRecommendation {
	support := classifyRecommendationHostSupport(candidate.engine, profile)
	reasonCodes := []string{}
	notes := []string{}
	quant := llmQuantHint(candidate)
	if quant != "" {
		pushRecommendationCode(&reasonCodes, reasonLLMFITQuantFile)
	}
	parameters, fromName := inferParameters(candidate, quant)
	if fromName {
		pushRecommendationCode(&reasonCodes, reasonLLMFITParamsFile)
	} else {
		pushRecommendationCode(&reasonCodes, reasonLLMFITParamsSize)
	}
	if _, defaulted := inferContextLength(candidate); defaulted {
		pushRecommendationCode(&reasonCodes, reasonLLMFITCtxDefaulted)
	}
	if hasVisionHint(candidate) {
		pushRecommendationCode(&reasonCodes, reasonLLMFITVision)
	}
	sizeBytes := candidate.mainSizeBytes
	if sizeBytes <= 0 {
		sizeBytes = candidate.knownTotalSizeBytes
	}
	if sizeBytes <= 0 && parameters > 0 {
		sizeBytes = int64(float64(parameters) * quantBytesPerParam(defaultString(quant, "Q4_K_M")))
	}
	requiredGB := (float64(sizeBytes) / recommendationBytesPerGiB) + 0.5
	availableGB := llmAvailableMemoryGB(profile)
	tier := runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_NOT_RECOMMENDED
	if availableGB > 0 && requiredGB > 0 {
		ratio := requiredGB / availableGB
		switch {
		case ratio <= 0.70:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RECOMMENDED
			pushRecommendationCode(&reasonCodes, reasonLLMFITRecommended)
		case ratio <= 0.85:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RUNNABLE
			pushRecommendationCode(&reasonCodes, reasonLLMFITRunnable)
		case ratio <= 1.0:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_TIGHT
			pushRecommendationCode(&reasonCodes, reasonLLMFITMarginal)
			pushRecommendationCode(&reasonCodes, reasonLLMFITTight)
		default:
			pushRecommendationCode(&reasonCodes, reasonMemoryExceeded)
		}
	}
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		pushRecommendationCode(&reasonCodes, reasonLLMFITGPUPath)
	case "cpu-offload":
		pushRecommendationCode(&reasonCodes, reasonLLMFITCPUOffload)
	default:
		pushRecommendationCode(&reasonCodes, reasonLLMFITCPUOnly)
	}
	switch support.class {
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY:
		pushRecommendationCode(&reasonCodes, reasonHostAttachedOnly)
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED:
		pushRecommendationCode(&reasonCodes, reasonHostUnsupported)
	}
	if support.detail != "" {
		pushRecommendationNote(&notes, support.detail)
	}
	pushRecommendationCode(&reasonCodes, reasonLLMFITTpsEstimated)
	pushRecommendationNote(&notes, fmt.Sprintf("llmfit estimated %.1f tok/s via %s in %s mode.", estimateLLMTokensPerSecond(profile, requiredGB), llmRuntimeText(profile), llmRunModeText(profile, requiredGB)))
	pushRecommendationNote(&notes, fmt.Sprintf("Estimated memory %.1f GB against %.1f GB available.", requiredGB, availableGB))
	confidence := runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_LOW
	if candidate.mainSizeBytes > 0 && quant != "" && parameters > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_HIGH
	} else if candidate.mainSizeBytes > 0 || candidate.knownTotalSizeBytes > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_MEDIUM
	}
	return &runtimev1.LocalCatalogRecommendation{
		Source:           runtimev1.LocalRecommendationSource_LOCAL_RECOMMENDATION_SOURCE_LLMFIT,
		Format:           candidate.format,
		Tier:             tier,
		HostSupportClass: support.class,
		Confidence:       confidence,
		ReasonCodes:      reasonCodes,
		RecommendedEntry: candidate.entry,
		FallbackEntries:  append([]string(nil), candidate.fallbackEntries...),
		SuggestedNotes:   notes,
	}
}

func classifyRecommendationHostSupport(engine string, profile *runtimev1.LocalDeviceProfile) hostSupportDescriptor {
	classification, detail := classifyManagedEngineSupport(engine, profile)
	switch classification {
	case localEngineSupportSupportedSupervised:
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED, detail: strings.TrimSpace(detail)}
	case localEngineSupportAttachedOnly:
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY, detail: strings.TrimSpace(detail)}
	case localEngineSupportUnsupported:
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED, detail: strings.TrimSpace(detail)}
	default:
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED, detail: "unknown managed engine"}
	}
}

func mediaMemoryBudgetBytes(capability string, profile *runtimev1.LocalDeviceProfile, reasonCodes *[]string, notes *[]string) int64 {
	if normalizeRecommendationFeedCapability(capability) != "image" && normalizeRecommendationFeedCapability(capability) != "video" {
		return 0
	}
	gpu := profile.GetGpu()
	switch gpu.GetMemoryModel() {
	case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED:
		budget := gpu.GetAvailableVramBytes()
		if budget <= 0 {
			budget = profile.GetAvailableRamBytes()
		}
		if budget > 0 {
			pushRecommendationCode(reasonCodes, reasonUnifiedMemory)
			pushRecommendationNote(notes, fmt.Sprintf("Using unified memory estimate from host profile (available %s).", formatRecommendationGB(budget)))
		}
		return budget
	case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE:
		return gpu.GetAvailableVramBytes()
	default:
		if gpu.GetAvailableVramBytes() > 0 {
			return gpu.GetAvailableVramBytes()
		}
		return profile.GetAvailableRamBytes()
	}
}

func mediaOverheadMultiplier(capability string, format runtimev1.LocalRecommendationFormat, engine string) float64 {
	capability = normalizeRecommendationFeedCapability(capability)
	engine = strings.ToLower(strings.TrimSpace(engine))
	switch {
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF && engine == "llama":
		return 1.5
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF:
		return 1.6
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS && engine == "media":
		return 2.2
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS:
		return 2.0
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF:
		return 2.2
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS && engine == "media":
		return 2.8
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS:
		return 2.5
	case capability == "image":
		return 1.8
	case capability == "video":
		return 2.6
	default:
		return 1.0
	}
}

func recommendationTierForBudget(estimate int64, budget int64, reasonCodes *[]string, notes *[]string) runtimev1.LocalRecommendationTier {
	if estimate <= 0 || budget <= 0 {
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_UNSPECIFIED
	}
	ratio := float64(estimate) / float64(budget)
	pushRecommendationNote(notes, fmt.Sprintf("Estimated memory %s against available host budget %s.", formatRecommendationGB(estimate), formatRecommendationGB(budget)))
	switch {
	case ratio <= 0.70:
		pushRecommendationCode(reasonCodes, reasonMemoryRecommended)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RECOMMENDED
	case ratio <= 0.85:
		pushRecommendationCode(reasonCodes, reasonMemoryRunnable)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RUNNABLE
	case ratio <= 1.0:
		pushRecommendationCode(reasonCodes, reasonMemoryTight)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_TIGHT
	default:
		pushRecommendationCode(reasonCodes, reasonMemoryExceeded)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_NOT_RECOMMENDED
	}
}

func formatRecommendationGB(bytes int64) string {
	return fmt.Sprintf("%.1f GB", float64(bytes)/recommendationBytesPerGiB)
}

func quantHintFromEntry(entry string) string {
	upper := strings.ToUpper(strings.TrimSpace(entry))
	for _, token := range []string{"Q2", "Q3", "Q4", "Q5", "Q6", "Q8", "IQ1", "IQ2", "IQ3", "IQ4"} {
		if strings.Contains(upper, token) {
			return token
		}
	}
	return ""
}

func llmQuantHint(candidate recommendationCandidate) string {
	for _, text := range []string{candidate.entry, candidate.title, candidate.modelID, candidate.repo} {
		upper := strings.ToUpper(text)
		for _, row := range []struct{ needle, output string }{
			{"Q8_0", "Q8_0"},
			{"Q6_K", "Q6_K"},
			{"Q5_K_M", "Q5_K_M"},
			{"Q4_K_M", "Q4_K_M"},
			{"Q4_0", "Q4_0"},
			{"Q3_K_M", "Q3_K_M"},
			{"Q2_K", "Q2_K"},
			{"BF16", "BF16"},
			{"F16", "F16"},
			{"AWQ-4BIT", "AWQ-4bit"},
			{"AWQ-8BIT", "AWQ-8bit"},
			{"GPTQ-INT4", "GPTQ-Int4"},
			{"GPTQ-INT8", "GPTQ-Int8"},
		} {
			if strings.Contains(upper, row.needle) {
				return row.output
			}
		}
	}
	return quantHintFromEntry(candidate.entry)
}

func parseSuffixNumber(input string, suffix byte) (float64, bool) {
	lower := strings.ToLower(input)
	best := 0.0
	found := false
	for index := 0; index < len(lower); index++ {
		if (lower[index] < '0' || lower[index] > '9') && lower[index] != '.' {
			continue
		}
		start := index
		dot := lower[index] == '.'
		index++
		for index < len(lower) {
			ch := lower[index]
			if ch >= '0' && ch <= '9' {
				index++
				continue
			}
			if ch == '.' && !dot {
				dot = true
				index++
				continue
			}
			break
		}
		if index >= len(lower) || lower[index] != suffix {
			continue
		}
		var value float64
		if _, err := fmt.Sscanf(lower[start:index], "%f", &value); err == nil {
			if !found || value > best {
				best = value
			}
			found = true
		}
	}
	return best, found
}

func inferParameters(candidate recommendationCandidate, quant string) (uint64, bool) {
	for _, text := range []string{candidate.entry, candidate.title, candidate.modelID, candidate.repo, strings.Join(candidate.tags, " ")} {
		if value, ok := parseSuffixNumber(text, 'b'); ok {
			return uint64(math.Round(value * 1_000_000_000)), true
		}
		if value, ok := parseSuffixNumber(text, 'm'); ok {
			return uint64(math.Round(value * 1_000_000)), true
		}
	}
	size := candidate.mainSizeBytes
	if size <= 0 {
		size = candidate.knownTotalSizeBytes
	}
	if size <= 0 {
		return 0, false
	}
	bpp := quantBytesPerParam(defaultString(quant, "Q4_K_M"))
	if bpp <= 0 {
		bpp = 0.5
	}
	return uint64(math.Max(1, math.Round(float64(size)/bpp))), false
}

func quantBytesPerParam(quant string) float64 {
	upper := strings.ToUpper(strings.TrimSpace(quant))
	switch {
	case strings.Contains(upper, "Q8"), strings.Contains(upper, "INT8"):
		return 1.0
	case strings.Contains(upper, "Q6"):
		return 0.75
	case strings.Contains(upper, "Q5"):
		return 0.625
	case strings.Contains(upper, "Q4"), strings.Contains(upper, "INT4"), strings.Contains(upper, "4BIT"):
		return 0.5
	case strings.Contains(upper, "Q3"):
		return 0.375
	case strings.Contains(upper, "Q2"):
		return 0.25
	case strings.Contains(upper, "BF16"), strings.Contains(upper, "F16"):
		return 2.0
	default:
		return 0.5
	}
}

func inferContextLength(candidate recommendationCandidate) (uint32, bool) {
	for _, tag := range candidate.tags {
		lower := strings.ToLower(tag)
		if !strings.Contains(lower, "context") && !strings.Contains(lower, "ctx") && !strings.HasSuffix(lower, "k") {
			continue
		}
		if value, ok := parseSuffixNumber(lower, 'k'); ok {
			tokens := uint32(math.Round(value * 1024))
			if tokens >= 1024 {
				return tokens, false
			}
		}
	}
	return 4096, true
}

func hasVisionHint(candidate recommendationCandidate) bool {
	haystack := strings.ToLower(strings.Join([]string{candidate.modelID, candidate.repo, candidate.title, strings.Join(candidate.tags, " ")}, " "))
	return strings.Contains(haystack, "vision") ||
		strings.Contains(haystack, "-vl-") ||
		strings.Contains(haystack, " llava") ||
		strings.Contains(haystack, "pixtral") ||
		strings.Contains(haystack, "multimodal") ||
		strings.Contains(haystack, "onevision")
}

func llmAvailableMemoryGB(profile *runtimev1.LocalDeviceProfile) float64 {
	gpu := profile.GetGpu()
	if gpu.GetAvailableVramBytes() > 0 {
		return float64(gpu.GetAvailableVramBytes()) / recommendationBytesPerGiB
	}
	if profile.GetAvailableRamBytes() > 0 {
		return float64(profile.GetAvailableRamBytes()) / recommendationBytesPerGiB
	}
	if profile.GetTotalRamBytes() > 0 {
		return float64(profile.GetTotalRamBytes()) / recommendationBytesPerGiB
	}
	return 0
}

func llmRunMode(profile *runtimev1.LocalDeviceProfile, requiredGB float64) string {
	gpu := profile.GetGpu()
	vramGB := float64(gpu.GetAvailableVramBytes()) / recommendationBytesPerGiB
	if gpu.GetAvailable() && vramGB >= requiredGB {
		return "gpu"
	}
	if gpu.GetAvailable() && vramGB > 0 {
		return "cpu-offload"
	}
	return "cpu"
}

func llmRuntimeText(profile *runtimev1.LocalDeviceProfile) string {
	gpu := profile.GetGpu()
	if gpu.GetMemoryModel() == runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED || strings.EqualFold(profile.GetOs(), "darwin") {
		return "metal"
	}
	switch strings.ToLower(strings.TrimSpace(gpu.GetVendor())) {
	case "nvidia":
		return "cuda"
	case "amd":
		return "rocm"
	case "intel":
		return "sycl"
	default:
		return "cpu"
	}
}

func llmRunModeText(profile *runtimev1.LocalDeviceProfile, requiredGB float64) string {
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		return "gpu"
	case "cpu-offload":
		return "cpu offload"
	default:
		return "cpu only"
	}
}

func estimateLLMTokensPerSecond(profile *runtimev1.LocalDeviceProfile, requiredGB float64) float64 {
	base := 6.0
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		base = 22.0
	case "cpu-offload":
		base = 12.0
	}
	if requiredGB <= 4 {
		return base * 1.4
	}
	if requiredGB >= 32 {
		return base * 0.45
	}
	return base
}

func companionSuggestions(candidate recommendationCandidate, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) []*runtimev1.LocalSuggestedAsset {
	haystack := strings.ToLower(strings.Join([]string{candidate.modelID, candidate.repo, candidate.title, strings.Join(candidate.tags, " ")}, " "))
	if !strings.Contains(haystack, "z-image") {
		return nil
	}
	items := make([]*runtimev1.LocalSuggestedAsset, 0)
	for _, asset := range verifiedAssets {
		if asset == nil {
			continue
		}
		family := ""
		if meta := asset.GetMetadata(); meta != nil {
			if value := meta.GetFields()["family"]; value != nil {
				family = value.GetStringValue()
			}
		}
		if family != "z-image" {
			continue
		}
		items = append(items, &runtimev1.LocalSuggestedAsset{
			TemplateId: asset.GetTemplateId(),
			AssetId:    asset.GetAssetId(),
			Kind:       strings.TrimPrefix(strings.ToLower(asset.GetKind().String()), "local_asset_kind_"),
			Family:     family,
		})
	}
	return items
}

func pushRecommendationCode(codes *[]string, code string) {
	code = strings.TrimSpace(code)
	if code == "" {
		return
	}
	for _, item := range *codes {
		if item == code {
			return
		}
	}
	*codes = append(*codes, code)
}

func pushRecommendationNote(notes *[]string, note string) {
	note = strings.TrimSpace(note)
	if note == "" {
		return
	}
	for _, item := range *notes {
		if item == note {
			return
		}
	}
	*notes = append(*notes, note)
}
