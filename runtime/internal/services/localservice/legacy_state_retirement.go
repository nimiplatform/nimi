package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LegacyStateRetirementReport describes the exact retired inputs removed from
// active Runtime state by the explicit one-time recovery tool.
type LegacyStateRetirementReport struct {
	StateChanged                bool   `json:"stateChanged"`
	StateQuarantinePath         string `json:"stateQuarantinePath,omitempty"`
	ConfigurationChanged        bool   `json:"configurationChanged"`
	ConfigurationQuarantinePath string `json:"configurationQuarantinePath,omitempty"`
	RetiredServiceRows          int    `json:"retiredServiceRows"`
	RetiredMaterializationRows  int    `json:"retiredMaterializationRows"`
}

// RetireLegacyLocalModelState is the terminal step of the explicit recovery
// flow. It removes only retired product-owned sections after preserving the
// exact source documents. Model-bearing LocalAsset rows must be handled by the
// dedicated migration command first and are never discarded here.
//
// @nimi-authority: rule.nimi.runtime.local-compute.r008
// @nimi-authority: rule.nimi.runtime.local-compute.r111
func (s *Service) RetireLegacyLocalModelState(_ context.Context) (LegacyStateRetirementReport, error) {
	report := LegacyStateRetirementReport{}
	if s == nil || !s.adoptResolvedModelImports || s.stateProcessLock == nil {
		return report, errors.New("legacy state retirement requires an exclusive recovery service")
	}

	document, assetRows, mode, err := readLegacyLocalAssetStateDocument(s.stateStorePath)
	if err != nil {
		return report, fmt.Errorf("read retired local state: %w", err)
	}
	if len(assetRows) != 0 {
		return report, errors.New("retired LocalAsset rows remain; run --migrate-legacy-state-assets before --retire-legacy-state")
	}

	statePayload, stateReadErr := os.ReadFile(s.stateStorePath)
	if stateReadErr != nil && !errors.Is(stateReadErr, os.ErrNotExist) {
		return report, fmt.Errorf("read local state for retirement: %w", stateReadErr)
	}
	if document != nil {
		report.RetiredServiceRows, err = rawJSONArrayLength(document["services"])
		if err != nil {
			return report, fmt.Errorf("decode retired LocalService rows: %w", err)
		}
		report.RetiredMaterializationRows, err = rawJSONArrayLength(document["managedImageProfileMaterializations"])
		if err != nil {
			return report, fmt.Errorf("decode retired managed image materializations: %w", err)
		}
		_, hasAssets := document["assets"]
		_, hasServices := document["services"]
		_, hasMaterializations := document["managedImageProfileMaterializations"]
		report.StateChanged = hasAssets || hasServices || hasMaterializations
		if report.StateChanged {
			quarantinePath, preserveErr := preserveRetiredStateDocument(s.stateStorePath, statePayload)
			if preserveErr != nil {
				return LegacyStateRetirementReport{}, fmt.Errorf("preserve retired local state: %w", preserveErr)
			}
			report.StateQuarantinePath = quarantinePath
			delete(document, "assets")
			delete(document, "services")
			delete(document, "managedImageProfileMaterializations")
			payload, marshalErr := json.MarshalIndent(document, "", "  ")
			if marshalErr != nil {
				return LegacyStateRetirementReport{}, fmt.Errorf("encode retired local state removal: %w", marshalErr)
			}
			if writeErr := writeFileAtomically(s.stateStorePath, append(payload, '\n'), mode); writeErr != nil {
				return LegacyStateRetirementReport{}, fmt.Errorf("commit retired local state removal: %w", writeErr)
			}
		}
	}

	configurationPath := filepath.Join(filepath.Dir(s.stateStorePath), "machine-local-ai-configuration.json")
	configurationInfo, statErr := os.Lstat(configurationPath)
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return report, fmt.Errorf("inspect retired machine configuration: %w", statErr)
	}
	if statErr == nil {
		if !configurationInfo.Mode().IsRegular() {
			return report, errors.New("retired machine configuration path is not a regular file")
		}
		configurationPayload, readErr := os.ReadFile(configurationPath)
		if readErr != nil {
			return report, fmt.Errorf("read retired machine configuration: %w", readErr)
		}
		quarantinePath, quarantineErr := quarantineStateDocument(configurationPath, configurationPayload)
		if quarantineErr != nil {
			return report, fmt.Errorf("quarantine retired machine configuration: %w", quarantineErr)
		}
		report.ConfigurationChanged = true
		report.ConfigurationQuarantinePath = quarantinePath
	}
	return report, nil
}

func rawJSONArrayLength(raw json.RawMessage) (int, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return 0, nil
	}
	var rows []json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func preserveRetiredStateDocument(path string, payload []byte) (string, error) {
	directory := stateQuarantineDirectory(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(directory, filepath.Base(path)+"."+stateIsolationTimestamp()+".retired.json")
	if err := writeFileAtomically(target, payload, 0o600); err != nil {
		return "", err
	}
	return target, nil
}
