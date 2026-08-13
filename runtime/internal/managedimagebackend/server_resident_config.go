package managedimagebackend

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type stableDiffusionCPPResidentConfig struct {
	ModelPath          string                  `json:"model_path"`
	Components         []managedImageComponent `json:"components,omitempty"`
	DiffusionFA        bool                    `json:"diffusion_fa,omitempty"`
	OffloadParamsToCPU bool                    `json:"offload_params_to_cpu,omitempty"`
	Threads            int32                   `json:"threads,omitempty"`
}

func validateManagedImageLoadState(state loadModelState) error {
	if strings.TrimSpace(state.ModelPath) == "" {
		return fmt.Errorf("managed image model path is required")
	}
	if _, err := os.Stat(strings.TrimSpace(state.ModelPath)); err != nil {
		return fmt.Errorf("managed image model path unavailable: %w", err)
	}
	components, err := normalizeStableDiffusionCPPComponents(state.Options.Components)
	if err != nil {
		return err
	}
	for _, component := range components {
		if _, err := os.Stat(strings.TrimSpace(component.Path)); err != nil {
			return fmt.Errorf("managed image option path unavailable: %w", err)
		}
	}
	return nil
}

func stableDiffusionCPPResidentConfigFromLoad(state loadModelState) (stableDiffusionCPPResidentConfig, error) {
	components, err := normalizeStableDiffusionCPPComponents(state.Options.Components)
	if err != nil {
		return stableDiffusionCPPResidentConfig{}, err
	}
	return stableDiffusionCPPResidentConfig{
		ModelPath:          strings.TrimSpace(state.ModelPath),
		Components:         components,
		DiffusionFA:        state.Options.DiffusionFA != nil && *state.Options.DiffusionFA,
		OffloadParamsToCPU: state.Options.OffloadParamsToCPU != nil && *state.Options.OffloadParamsToCPU,
		Threads:            state.Threads,
	}, nil
}

func stableDiffusionCPPResidentFingerprint(config stableDiffusionCPPResidentConfig) (string, error) {
	components, err := normalizeStableDiffusionCPPComponents(config.Components)
	if err != nil {
		return "", err
	}
	normalized := config
	normalized.ModelPath = strings.TrimSpace(config.ModelPath)
	normalized.Components = components
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "", fmt.Errorf("marshal managed image resident config: %w", err)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func stableDiffusionCPPResidentStartupArgs(config stableDiffusionCPPResidentConfig, port int) ([]string, error) {
	modelPath := strings.TrimSpace(config.ModelPath)
	if modelPath == "" {
		return nil, fmt.Errorf("managed image model path is required")
	}
	components, err := normalizeStableDiffusionCPPComponents(config.Components)
	if err != nil {
		return nil, err
	}
	args := []string{
		"--listen-ip", "127.0.0.1",
		"--listen-port", strconv.Itoa(port),
		"--diffusion-model", modelPath,
	}
	if config.Threads != 0 {
		args = append(args, "--threads", strconv.Itoa(int(config.Threads)))
	}
	if config.DiffusionFA {
		args = append(args, "--diffusion-fa")
	}
	if config.OffloadParamsToCPU {
		args = append(args, "--offload-to-cpu")
	}
	for _, component := range components {
		binding, ok := stableDiffusionCPPSlotBindings[strings.TrimSpace(component.EngineSlot)]
		if !ok {
			return nil, fmt.Errorf("unsupported managed image component slot %q", component.EngineSlot)
		}
		args = append(args, binding.Argument, strings.TrimSpace(component.Path))
	}
	return args, nil
}

func stableDiffusionCPPResidentStartupSummary(config stableDiffusionCPPResidentConfig) string {
	componentSlots := make([]string, 0, len(config.Components))
	components, err := normalizeStableDiffusionCPPComponents(config.Components)
	if err != nil {
		componentSlots = append(componentSlots, "invalid")
	}
	for _, component := range components {
		if slot := strings.TrimSpace(component.EngineSlot); slot != "" {
			componentSlots = append(componentSlots, slot)
		}
	}
	if len(componentSlots) == 0 {
		componentSlots = append(componentSlots, "-")
	}
	return fmt.Sprintf("threads=%d diffusion_fa=%t offload_to_cpu=%t components=%s",
		config.Threads,
		config.DiffusionFA,
		config.OffloadParamsToCPU,
		strings.Join(componentSlots, ","),
	)
}

func normalizeStableDiffusionCPPComponents(components []managedImageComponent) ([]managedImageComponent, error) {
	normalized := make([]managedImageComponent, 0, len(components))
	seenSlots := map[string]struct{}{}
	seenOccurrences := map[string]struct{}{}
	seenRoleOrders := map[string]struct{}{}
	for _, component := range components {
		slot := strings.ToLower(strings.TrimSpace(component.EngineSlot))
		path := strings.TrimSpace(component.Path)
		if slot == "" {
			return nil, fmt.Errorf("managed image component slot is required")
		}
		if _, ok := stableDiffusionCPPSlotBindings[slot]; !ok {
			return nil, fmt.Errorf("unsupported managed image component slot %q", slot)
		}
		occurrenceID := strings.TrimSpace(component.OccurrenceID)
		if occurrenceID == "" {
			return nil, fmt.Errorf("managed image component occurrence identity is required")
		}
		if _, exists := seenOccurrences[occurrenceID]; exists {
			return nil, fmt.Errorf("duplicate managed image component occurrence %q", occurrenceID)
		}
		if component.Order < 0 {
			return nil, fmt.Errorf("managed image component occurrence %q has invalid order", occurrenceID)
		}
		roleOrder := strings.TrimSpace(component.Role) + "\x00" + strconv.Itoa(int(component.Order))
		if _, exists := seenRoleOrders[roleOrder]; exists {
			return nil, fmt.Errorf("duplicate managed image component order %d for role %q", component.Order, strings.TrimSpace(component.Role))
		}
		if _, exists := seenSlots[slot]; exists {
			return nil, fmt.Errorf("duplicate managed image component slot %q", slot)
		}
		seenOccurrences[occurrenceID] = struct{}{}
		seenRoleOrders[roleOrder] = struct{}{}
		if path == "" {
			return nil, fmt.Errorf("managed image component path is required for slot %q", slot)
		}
		seenSlots[slot] = struct{}{}
		normalized = append(normalized, managedImageComponent{
			OccurrenceID:  occurrenceID,
			Order:         component.Order,
			Role:          strings.TrimSpace(component.Role),
			ComponentKind: strings.TrimSpace(component.ComponentKind),
			EngineSlot:    slot,
			Path:          path,
			Required:      component.Required,
		})
	}
	sort.SliceStable(normalized, func(left, right int) bool {
		leftRole := strings.TrimSpace(normalized[left].Role)
		rightRole := strings.TrimSpace(normalized[right].Role)
		if leftRole != rightRole {
			return leftRole < rightRole
		}
		if normalized[left].Order != normalized[right].Order {
			return normalized[left].Order < normalized[right].Order
		}
		return normalized[left].OccurrenceID < normalized[right].OccurrenceID
	})
	return normalized, nil
}

func resolveStableDiffusionCPPServerExecutable(executablePath string) (string, error) {
	trimmed := strings.TrimSpace(executablePath)
	if trimmed == "" {
		return "", fmt.Errorf("managed image backend executable is required")
	}
	dir := filepath.Dir(trimmed)
	candidates := []string{"sd-server", "sd-server.exe"}
	base := strings.ToLower(filepath.Base(trimmed))
	if base == "sd-server" || base == "sd-server.exe" {
		return trimmed, nil
	}
	for _, candidate := range candidates {
		resolved := filepath.Join(dir, candidate)
		if _, err := os.Stat(resolved); err == nil {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("managed image resident executable not found next to %s", trimmed)
}
