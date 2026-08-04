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
	Load() ([]*storedLocalCapabilityConfiguration, error)
	Save([]*storedLocalCapabilityConfiguration) error
}

type diskMachineLocalConfigurationStore struct {
	path string
}

type machineLocalConfigurationSnapshot struct {
	SchemaVersion  int                                     `json:"schemaVersion"`
	Configurations []machineLocalConfigurationPersistedRow `json:"configurations"`
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

func (store *diskMachineLocalConfigurationStore) Load() ([]*storedLocalCapabilityConfiguration, error) {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil, nil
	}
	payload, err := os.ReadFile(store.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read Machine Local AI Configuration: %w", err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("read Machine Local AI Configuration: empty store")
	}
	var snapshot machineLocalConfigurationSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return nil, fmt.Errorf("decode Machine Local AI Configuration: %w", err)
	}
	if snapshot.SchemaVersion != machineLocalConfigurationSchemaVersion {
		return nil, fmt.Errorf("unsupported Machine Local AI Configuration schemaVersion=%d", snapshot.SchemaVersion)
	}
	rows := make([]*storedLocalCapabilityConfiguration, 0, len(snapshot.Configurations))
	seen := make(map[string]struct{}, len(snapshot.Configurations))
	for index, persisted := range snapshot.Configurations {
		configuration := &runtimev1.LocalCapabilityConfiguration{}
		if err := protojson.Unmarshal(persisted.Configuration, configuration); err != nil {
			return nil, fmt.Errorf("decode Machine Local AI Configuration row %d: %w", index, err)
		}
		canonicalizeStoredConfiguration(configuration)
		configurationID := strings.TrimSpace(configuration.GetConfigurationId())
		if configurationID == "" {
			return nil, fmt.Errorf("decode Machine Local AI Configuration row %d: configuration id is required", index)
		}
		if _, exists := seen[configurationID]; exists {
			return nil, fmt.Errorf("decode Machine Local AI Configuration: duplicate configuration id %q", configurationID)
		}
		seen[configurationID] = struct{}{}
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
	return rows, nil
}

func (store *diskMachineLocalConfigurationStore) Save(rows []*storedLocalCapabilityConfiguration) error {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil
	}
	ordered := cloneStoredLocalCapabilityConfigurations(rows)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].Configuration.GetConfigurationId() < ordered[j].Configuration.GetConfigurationId()
	})
	snapshot := machineLocalConfigurationSnapshot{
		SchemaVersion:  machineLocalConfigurationSchemaVersion,
		Configurations: make([]machineLocalConfigurationPersistedRow, 0, len(ordered)),
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
	configuration.Interpretability = runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNSPECIFIED
	configuration.RequirementResolution = runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNSPECIFIED
	configuration.Reasons = nil
}
