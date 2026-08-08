package localservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	machineLocalConfigurationSchemaVersion = 1
	machineLocalConfigurationFileName      = "machine-local-ai-configuration.json"
)

// storedLocalCapabilityConfiguration contains canonical intent plus the result
// of the last explicit projection. Public summaries are derived at read time.
type storedLocalCapabilityConfiguration struct {
	Configuration     *runtimev1.LocalCapabilityConfiguration
	ProjectionReason  runtimev1.LocalCapabilityReason
	ResolutionReasons []runtimev1.LocalCapabilityReason
}

type machineLocalConfigurationStore interface {
	Load() ([]*storedLocalCapabilityConfiguration, []*runtimev1.LocalCapabilitySelection, error)
	Save([]*storedLocalCapabilityConfiguration, []*runtimev1.LocalCapabilitySelection) error
}

type diskMachineLocalConfigurationStore struct {
	path string
}

type machineLocalConfigurationSnapshot struct {
	SchemaVersion  int                                     `json:"schemaVersion"`
	Configurations []machineLocalConfigurationPersistedRow `json:"configurations"`
	Selections     []json.RawMessage                       `json:"selections"`
}

type machineLocalConfigurationPersistedRow struct {
	Configuration     json.RawMessage `json:"configuration"`
	ProjectionReason  int32           `json:"projectionReason,omitempty"`
	ResolutionReasons []int32         `json:"resolutionReasons,omitempty"`
}

func newDiskMachineLocalConfigurationStore(localStatePath string) machineLocalConfigurationStore {
	path := ""
	if statePath := strings.TrimSpace(localStatePath); statePath != "" {
		path = filepath.Join(filepath.Dir(statePath), machineLocalConfigurationFileName)
	}
	return &diskMachineLocalConfigurationStore{path: path}
}

func (store *diskMachineLocalConfigurationStore) Load() ([]*storedLocalCapabilityConfiguration, []*runtimev1.LocalCapabilitySelection, error) {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil, nil, nil
	}
	payload, err := os.ReadFile(store.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("read Machine Local AI Configuration: %w", err)
	}
	if len(payload) == 0 {
		return nil, nil, fmt.Errorf("read Machine Local AI Configuration: empty store")
	}
	var snapshot machineLocalConfigurationSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return nil, nil, fmt.Errorf("decode Machine Local AI Configuration: %w", err)
	}
	if snapshot.SchemaVersion != machineLocalConfigurationSchemaVersion {
		return nil, nil, fmt.Errorf("unsupported Machine Local AI Configuration schemaVersion=%d", snapshot.SchemaVersion)
	}
	rows := make([]*storedLocalCapabilityConfiguration, 0, len(snapshot.Configurations))
	seenConfigurations := make(map[string]struct{}, len(snapshot.Configurations))
	for index, persisted := range snapshot.Configurations {
		configuration := &runtimev1.LocalCapabilityConfiguration{}
		if err := protojson.Unmarshal(persisted.Configuration, configuration); err != nil {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration row %d: %w", index, err)
		}
		canonicalizeStoredConfiguration(configuration)
		configurationID := strings.TrimSpace(configuration.GetConfigurationId())
		if configurationID == "" {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration row %d: configuration id is required", index)
		}
		if _, exists := seenConfigurations[configurationID]; exists {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration: duplicate configuration id %q", configurationID)
		}
		seenConfigurations[configurationID] = struct{}{}
		row := &storedLocalCapabilityConfiguration{
			Configuration:     configuration,
			ProjectionReason:  runtimev1.LocalCapabilityReason(persisted.ProjectionReason),
			ResolutionReasons: make([]runtimev1.LocalCapabilityReason, 0, len(persisted.ResolutionReasons)),
		}
		for _, reason := range persisted.ResolutionReasons {
			row.ResolutionReasons = append(row.ResolutionReasons, runtimev1.LocalCapabilityReason(reason))
		}
		rows = append(rows, row)
	}
	selections := make([]*runtimev1.LocalCapabilitySelection, 0, len(snapshot.Selections))
	seenCapabilities := make(map[string]struct{}, len(snapshot.Selections))
	for index, payload := range snapshot.Selections {
		selection := &runtimev1.LocalCapabilitySelection{}
		if err := protojson.Unmarshal(payload, selection); err != nil {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration selection %d: %w", index, err)
		}
		canonicalizeStoredLocalCapabilitySelection(selection)
		capabilityContract := selection.GetCapabilityContract()
		if capabilityContract == "" || selection.GetConfigurationId() == "" {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration selection %d: complete selection identity is required", index)
		}
		if _, exists := seenCapabilities[capabilityContract]; exists {
			return nil, nil, fmt.Errorf("decode Machine Local AI Configuration: duplicate selection for capability %q", capabilityContract)
		}
		seenCapabilities[capabilityContract] = struct{}{}
		selections = append(selections, selection)
	}
	return rows, selections, nil
}

func (store *diskMachineLocalConfigurationStore) Save(rows []*storedLocalCapabilityConfiguration, selections []*runtimev1.LocalCapabilitySelection) error {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil
	}
	ordered := cloneStoredLocalCapabilityConfigurations(rows)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].Configuration.GetConfigurationId() < ordered[j].Configuration.GetConfigurationId()
	})
	orderedSelections := cloneLocalCapabilitySelections(selections)
	sort.Slice(orderedSelections, func(i, j int) bool {
		return orderedSelections[i].GetCapabilityContract() < orderedSelections[j].GetCapabilityContract()
	})
	snapshot := machineLocalConfigurationSnapshot{
		SchemaVersion:  machineLocalConfigurationSchemaVersion,
		Configurations: make([]machineLocalConfigurationPersistedRow, 0, len(ordered)),
		Selections:     make([]json.RawMessage, 0, len(orderedSelections)),
	}
	for _, row := range ordered {
		if row == nil || row.Configuration == nil {
			continue
		}
		configuration := cloneCanonicalStoredConfiguration(row.Configuration)
		payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(configuration)
		if err != nil {
			return fmt.Errorf("encode Machine Local AI Configuration %q: %w", configuration.GetConfigurationId(), err)
		}
		persisted := machineLocalConfigurationPersistedRow{
			Configuration:     payload,
			ProjectionReason:  int32(row.ProjectionReason),
			ResolutionReasons: make([]int32, 0, len(row.ResolutionReasons)),
		}
		for _, reason := range row.ResolutionReasons {
			persisted.ResolutionReasons = append(persisted.ResolutionReasons, int32(reason))
		}
		snapshot.Configurations = append(snapshot.Configurations, persisted)
	}
	for _, selection := range orderedSelections {
		canonicalizeStoredLocalCapabilitySelection(selection)
		if selection.GetCapabilityContract() == "" || selection.GetConfigurationId() == "" {
			return fmt.Errorf("encode Machine Local AI Configuration: complete selection identity is required")
		}
		payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(selection)
		if err != nil {
			return fmt.Errorf("encode Machine Local AI Configuration selection %q: %w", selection.GetCapabilityContract(), err)
		}
		snapshot.Selections = append(snapshot.Selections, payload)
	}
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Machine Local AI Configuration store: %w", err)
	}
	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create Machine Local AI Configuration directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".machine-local-ai-configuration-*.tmp")
	if err != nil {
		return fmt.Errorf("create Machine Local AI Configuration temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	keepTemporary := true
	defer func() {
		_ = temporary.Close()
		if keepTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("secure Machine Local AI Configuration temporary file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		return fmt.Errorf("write Machine Local AI Configuration temporary file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync Machine Local AI Configuration temporary file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Machine Local AI Configuration temporary file: %w", err)
	}
	if err := os.Rename(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace Machine Local AI Configuration: %w", err)
	}
	keepTemporary = false
	if err := syncMachineLocalConfigurationDirectory(directory); err != nil {
		return fmt.Errorf("persist Machine Local AI Configuration directory entry: %w", err)
	}
	return nil
}

func syncMachineLocalConfigurationDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open directory: %w", err)
	}
	defer func() { _ = directory.Close() }()
	if err := directory.Sync(); err != nil {
		// Windows does not expose directory FlushFileBuffers through os.File.Sync.
		if runtime.GOOS == "windows" || errors.Is(err, os.ErrInvalid) {
			return nil
		}
		return fmt.Errorf("sync directory: %w", err)
	}
	return nil
}

func cloneStoredLocalCapabilityConfiguration(input *storedLocalCapabilityConfiguration) *storedLocalCapabilityConfiguration {
	if input == nil {
		return nil
	}
	return &storedLocalCapabilityConfiguration{
		Configuration:     cloneCanonicalStoredConfiguration(input.Configuration),
		ProjectionReason:  input.ProjectionReason,
		ResolutionReasons: append([]runtimev1.LocalCapabilityReason(nil), input.ResolutionReasons...),
	}
}

func cloneStoredLocalCapabilityConfigurations(inputs []*storedLocalCapabilityConfiguration) []*storedLocalCapabilityConfiguration {
	result := make([]*storedLocalCapabilityConfiguration, 0, len(inputs))
	for _, input := range inputs {
		if cloned := cloneStoredLocalCapabilityConfiguration(input); cloned != nil {
			result = append(result, cloned)
		}
	}
	return result
}

func cloneLocalCapabilitySelections(inputs []*runtimev1.LocalCapabilitySelection) []*runtimev1.LocalCapabilitySelection {
	result := make([]*runtimev1.LocalCapabilitySelection, 0, len(inputs))
	for _, input := range inputs {
		if input == nil {
			continue
		}
		cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilitySelection)
		canonicalizeStoredLocalCapabilitySelection(cloned)
		result = append(result, cloned)
	}
	return result
}

func canonicalizeStoredLocalCapabilitySelection(selection *runtimev1.LocalCapabilitySelection) {
	if selection == nil {
		return
	}
	selection.CapabilityContract = strings.TrimSpace(selection.GetCapabilityContract())
	selection.ConfigurationId = strings.TrimSpace(selection.GetConfigurationId())
	selection.EffectiveDefaults = nil
}

func cloneCanonicalStoredConfiguration(input *runtimev1.LocalCapabilityConfiguration) *runtimev1.LocalCapabilityConfiguration {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilityConfiguration)
	canonicalizeStoredConfiguration(cloned)
	return cloned
}

func canonicalizeStoredConfiguration(configuration *runtimev1.LocalCapabilityConfiguration) {
	if configuration == nil {
		return
	}
	// Proto3 decodes fields added by the occurrence cutover to zero values.
	// Ordinal zero is the exact unordered/singleton default. Legacy rows without
	// a label retain their stable requirement identity as the display fallback;
	// no filename, path, inventory order, or binding time participates.
	for _, requirement := range configuration.GetProjectedRequirements() {
		if requirement != nil && requirement.GetDisplayLabel() == "" {
			requirement.DisplayLabel = requirement.GetRequirementId()
		}
	}
	configuration.Interpretability = runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNSPECIFIED
	configuration.RequirementResolution = runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNSPECIFIED
	configuration.Reasons = nil
}
