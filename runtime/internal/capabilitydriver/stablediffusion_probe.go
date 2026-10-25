package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const sdImageGGUFProbeSchema = "sd-image-gguf-probe/v1"

type sdImageGGUFProbe struct {
	Schema         string   `json:"schema"`
	RecipeID       string   `json:"recipeId"`
	RequirementID  string   `json:"requirementId"`
	Full           bool     `json:"full"`
	Architecture   string   `json:"architecture"`
	Families       []string `json:"families"`
	TensorContract string   `json:"tensorContract,omitempty"`
}

func sdImageProbeRequirement(recipe, slot string) (*runtimev1.LocalCapabilityRequirement, error) {
	driver := StableDiffusionImageDriver{}
	features, reason := driver.ImplementationSupportedFeatures(recipe)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, fmt.Errorf("unsupported image probe recipe")
	}
	requirements, reason := driver.ProjectRecipe(recipe, nil, features)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, fmt.Errorf("invalid image probe recipe")
	}
	for _, requirement := range requirements {
		if requirement.GetRequirementId() == slot {
			return requirement, nil
		}
	}
	return nil, fmt.Errorf("unknown image probe slot")
}

func sdGGUFFullInspection(requirement *runtimev1.LocalCapabilityRequirement) bool {
	_, family := stableDiffusionRequirementConstraintStrings(requirement, "gguf_families")
	_, architecture := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architectures")
	_, architectureFamily := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architecture_families")
	_, tensor := stableDiffusionRequirementConstraintString(requirement, "tensor_contract")
	return tensor || family || !(architecture || architectureFamily)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r064
func (StableDiffusionImageDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	requirement, err := sdImageProbeRequirement(input.RecipeID, input.RequirementID)
	if err != nil {
		return nil, err
	}
	format, ok := stableDiffusionRequirementConstraintString(requirement, "format")
	if !ok || filepath.Ext(strings.ToLower(input.RelativePath)) != "."+format {
		return nil, fmt.Errorf("image probe format mismatch")
	}
	if format == "safetensors" {
		return readSDDeclaredSafetensorsHeader(source, size)
	}
	if format != "gguf" {
		return nil, fmt.Errorf("unsupported image probe format")
	}
	reader, err := newGGUFProbeReader(source, size, MaxAssetFormatProbeBytes)
	if err != nil {
		return nil, err
	}
	facts := sdImageGGUFProbe{Schema: sdImageGGUFProbeSchema, RecipeID: input.RecipeID, RequirementID: input.RequirementID, Full: sdGGUFFullInspection(requirement)}
	var summary ggufmeta.Summary
	if facts.Full {
		summary, err = ggufmeta.Inspect(reader)
	} else {
		summary, err = ggufmeta.InspectLLMMetadata(reader)
	}
	if failure := reader.actualFailure(); failure != nil {
		return nil, failure
	}
	if err != nil {
		return nil, err
	}
	facts.Architecture = ggufmeta.LLMDetectedArchitecture(summary)
	families := map[string]bool{}
	if family := ggufmeta.StableDiffusionDetectedFamily(summary); family != "" {
		families[family] = true
	}
	for _, signature := range ggufmeta.StableDiffusionTensorSignaturesPresent(summary) {
		if family, _, ok := strings.Cut(signature, ":"); ok {
			families[family] = true
		}
	}
	for family := range families {
		facts.Families = append(facts.Families, family)
	}
	sort.Strings(facts.Families)
	if contract, constrained := stableDiffusionRequirementConstraintString(requirement, "tensor_contract"); constrained {
		if !stableDiffusionGGUFTensorContractValid(contract, summary) {
			return nil, fmt.Errorf("image GGUF tensor contract mismatch")
		}
		facts.TensorContract = contract
	}
	if _, valid := sdGGUFRequirementFamily(requirement, facts); !valid {
		return nil, fmt.Errorf("image GGUF model contract mismatch")
	}
	data, err := json.Marshal(facts)
	if err != nil {
		return nil, err
	}
	if len(data) > MaxAssetFormatProbeBytes {
		return nil, fmt.Errorf("image structured probe exceeds its bound")
	}
	return data, nil
}

func decodeSDImageGGUFProbe(probe []byte) (sdImageGGUFProbe, error) {
	var facts sdImageGGUFProbe
	if len(probe) > MaxAssetFormatProbeBytes {
		return facts, fmt.Errorf("image structured probe exceeds its bound")
	}
	decoder := json.NewDecoder(bytes.NewReader(probe))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&facts); err != nil {
		return facts, err
	}
	if decoder.Decode(new(any)) != io.EOF || facts.Schema != sdImageGGUFProbeSchema || facts.RecipeID == "" || facts.RequirementID == "" {
		return facts, fmt.Errorf("invalid image GGUF structured probe")
	}
	return facts, nil
}

// Apply the actual requirement's original architecture/family predicates.
// A tensor contract is interpreted during the full probe, never inferred from
// a family/name or replaced by a projection-cache hit.
func sdGGUFRequirementFamily(requirement *runtimev1.LocalCapabilityRequirement, facts sdImageGGUFProbe) (string, bool) {
	if requirement.GetRequirementId() != facts.RequirementID || sdGGUFFullInspection(requirement) != facts.Full {
		return "", false
	}
	if recipe, exists := stableDiffusionRequirementConstraintString(requirement, "recipe_id"); exists && recipe != facts.RecipeID {
		return "", false
	}
	if contract, constrained := stableDiffusionRequirementConstraintString(requirement, "tensor_contract"); constrained && contract != facts.TensorContract {
		return "", false
	}
	if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architectures"); exists && !contains(expected, facts.Architecture) {
		return "", false
	}
	if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_families"); exists {
		matched := false
		for _, family := range facts.Families {
			if contains(expected, family) {
				matched = true
				break
			}
		}
		if !matched {
			return "", false
		}
	}
	family := ""
	if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architecture_families"); exists {
		family = stableDiffusionGGUFArchitectureFamily(facts.Architecture)
		if !contains(expected, family) {
			return "", false
		}
	}
	if configured, exists := stableDiffusionRequirementConstraintString(requirement, "model_family"); exists {
		family = configured
	} else if family == "" {
		families, exists := stableDiffusionRequirementConstraintStrings(requirement, "compatible_families")
		if !exists || len(families) != 1 {
			return "", false
		}
		family = families[0]
	}
	return family, true
}

// This reads only the same length-prefixed bytes consumed by SD's existing
// validators. It deliberately does not import another Driver's stricter
// tensor/offset policy; Image and Video keep their distinct original checks.
func readSDDeclaredSafetensorsHeader(source io.ReaderAt, size int64) ([]byte, error) {
	if source == nil || size < 10 {
		return nil, fmt.Errorf("incomplete SD safetensors header")
	}
	var prefix [8]byte
	if n, err := source.ReadAt(prefix[:], 0); err != nil {
		return nil, err
	} else if n != len(prefix) {
		return nil, io.ErrUnexpectedEOF
	}
	if err := sdProbeContextErr(source); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint64(prefix[:])
	if length < 2 || length > MaxSafetensorsHeaderBytes || length > uint64(size-8) {
		return nil, fmt.Errorf("SD safetensors header exceeds its bound")
	}
	probe := make([]byte, 8+int(length))
	copy(probe, prefix[:])
	if n, err := source.ReadAt(probe[8:], 8); err != nil {
		return nil, err
	} else if n != len(probe)-8 {
		return nil, io.ErrUnexpectedEOF
	}
	if err := sdProbeContextErr(source); err != nil {
		return nil, err
	}
	return probe, nil
}

func sdProbeContextErr(source io.ReaderAt) error {
	if checker, ok := source.(interface{ ContextErr() error }); ok {
		return checker.ContextErr()
	}
	return nil
}

func (StableDiffusionVideoDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	slot, ok := stableDiffusionVideoSlot(input.RequirementID)
	if !ok || input.RecipeID != StableDiffusionVideoRecipeID || filepath.Ext(strings.ToLower(input.RelativePath)) != "."+slot.format {
		return nil, fmt.Errorf("video probe contract mismatch")
	}
	if slot.format == "safetensors" {
		return readSDDeclaredSafetensorsHeader(source, size)
	}
	if source == nil || size < 4 {
		return nil, fmt.Errorf("incomplete video GGUF magic")
	}
	signatures := stableDiffusionVideoGGUFSignatures(slot.id)
	if len(signatures) == 0 {
		return nil, fmt.Errorf("unsupported video GGUF slot")
	}
	bound := min(size, int64(MaxAssetFormatProbeBytes))
	probe := make([]byte, 0, min(bound, 64<<10))
	found := make([]bool, len(signatures))
	remaining := len(signatures)
	overlap := 0
	for _, signature := range signatures {
		overlap = max(overlap, len(signature)-1)
	}
	for int64(len(probe)) < bound {
		start := len(probe)
		chunk := make([]byte, min(int64(64<<10), bound-int64(start)))
		if n, err := source.ReadAt(chunk, int64(start)); err != nil {
			return nil, err
		} else if n != len(chunk) {
			return nil, io.ErrUnexpectedEOF
		}
		if err := sdProbeContextErr(source); err != nil {
			return nil, err
		}
		probe = append(probe, chunk...)
		if start == 0 && !bytes.Equal(probe[:4], []byte("GGUF")) {
			return probe, nil
		}
		window := probe[max(0, start-overlap):]
		for index, signature := range signatures {
			if !found[index] && bytes.Contains(window, []byte(signature)) {
				found[index] = true
				remaining--
			}
		}
		if remaining == 0 {
			break
		}
	}
	return probe, nil
}
