package localservice

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	stateIsolationLevelRecord   = "record"
	stateIsolationLevelDocument = "document"

	localStateRecordQuarantinedReason      = "LOCAL_STATE_RECORD_QUARANTINED"
	localStateDocumentQuarantinedReason    = "LOCAL_STATE_DOCUMENT_QUARANTINED"
	machineConfigRecordQuarantinedReason   = "MACHINE_LOCAL_CONFIGURATION_RECORD_QUARANTINED"
	machineConfigDocumentQuarantinedReason = "MACHINE_LOCAL_CONFIGURATION_DOCUMENT_QUARANTINED"
)

type stateIsolationDiagnostic struct {
	Store          string
	Level          string
	ReasonCode     string
	Message        string
	QuarantinePath string
	Section        string
	RecordIndex    int
	RecordID       string
}

// recordStartupStateIsolationDiagnostics makes record isolation operator-visible
// without reintroducing a public reconciliation control plane. It is called only
// while the Service is being constructed, before concurrent access is possible.
func (s *Service) recordStartupStateIsolationDiagnostics(diagnostics []stateIsolationDiagnostic) {
	for _, diagnostic := range diagnostics {
		s.logger.Warn(
			"isolated corrupt local state record",
			"store", diagnostic.Store,
			"level", diagnostic.Level,
			"reason", diagnostic.ReasonCode,
			"quarantine", diagnostic.QuarantinePath,
			"section", diagnostic.Section,
			"index", diagnostic.RecordIndex,
		)
	}
}

type quarantinedStateRecord struct {
	Store       string          `json:"store"`
	Section     string          `json:"section"`
	RecordIndex int             `json:"recordIndex"`
	Reason      string          `json:"reason"`
	Payload     json.RawMessage `json:"payload"`
}

type localStateRawSnapshot struct {
	SchemaVersion                       int               `json:"schemaVersion"`
	SavedAt                             string            `json:"savedAt"`
	RetiredAssets                       []json.RawMessage `json:"assets,omitempty"`
	RetiredServices                     []json.RawMessage `json:"services,omitempty"`
	Transfers                           []json.RawMessage `json:"transfers,omitempty"`
	Audits                              []json.RawMessage `json:"audits,omitempty"`
	LocalEnvironmentHostProfiles        []json.RawMessage `json:"localEnvironmentHostProfiles,omitempty"`
	LocalEnvironmentSelectedSources     []json.RawMessage `json:"localEnvironmentSelectedSourceRecords,omitempty"`
	LocalEnvironmentDependencyJobs      []json.RawMessage `json:"localEnvironmentDependencyJobs,omitempty"`
	LocalEnvironmentPlanContracts       []json.RawMessage `json:"localEnvironmentPlanDependencyContracts,omitempty"`
	RetiredManagedImageMaterializations []json.RawMessage `json:"managedImageProfileMaterializations,omitempty"`
}

func emptyLocalStateSnapshot() localStateSnapshot {
	return localStateSnapshot{
		Transfers: []localStateTransferState{},
		Audits:    []localStateAuditState{},
	}
}

func rejectRetiredMachineConfiguration(statePath string) error {
	legacyPath := filepath.Join(filepath.Dir(statePath), "machine-local-ai-configuration.json")
	info, err := os.Lstat(legacyPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect retired machine configuration: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("retired machine configuration path is not a regular file; run the explicit local-model-recovery tool before starting Runtime")
	}
	return fmt.Errorf("retired machine-local-ai-configuration.json is present; run the explicit local-model-recovery tool before starting Runtime")
}

func loadLocalStateSnapshotIsolated(path string) (localStateSnapshot, []stateIsolationDiagnostic, bool, error) {
	result := emptyLocalStateSnapshot()
	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return result, nil, false, nil
		}
		return result, nil, false, err
	}

	var raw localStateRawSnapshot
	if len(payload) == 0 {
		return isolateLocalStateDocument(path, payload, errors.New("document is empty"))
	}
	if err := decodeStrictJSON(payload, &raw); err != nil {
		return isolateLocalStateDocument(path, payload, err)
	}
	if raw.SchemaVersion != localStateSchemaVersion {
		return isolateLocalStateDocument(path, payload, fmt.Errorf("unsupported schemaVersion=%d (expected %d)", raw.SchemaVersion, localStateSchemaVersion))
	}

	result.SchemaVersion = raw.SchemaVersion
	result.SavedAt = raw.SavedAt
	if len(raw.RetiredAssets) > 0 || len(raw.RetiredServices) > 0 || len(raw.RetiredManagedImageMaterializations) > 0 {
		return result, nil, false, fmt.Errorf("local-state.json contains retired LocalAsset/LocalService/Profile state; run the explicit local-model-recovery tool before starting Runtime")
	}
	quarantined := make([]quarantinedStateRecord, 0)
	result.Transfers = decodeIsolatedRows(raw.Transfers, "local-state.json", "transfers", &quarantined,
		func(row *localStateTransferState, _ json.RawMessage) error {
			if strings.TrimSpace(row.InstallSessionID) == "" {
				return errors.New("install session id is required")
			}
			if row.ManagedDownloadSpec != nil {
				spec, err := managedDownloadedModelSpecFromLocalState(row.ManagedDownloadSpec)
				if err != nil {
					return err
				}
				if spec.modelID != strings.TrimSpace(row.AssetID) {
					return errors.New("managed download spec model identity does not match transfer")
				}
			}
			requiresDownloadSpec := normalizeTransferKind(row.SessionKind) == localTransferKindDownload &&
				(!isTerminalTransferState(row.State) ||
					(normalizeTransferState(row.State) == localTransferStateFailed && row.Retryable))
			if requiresDownloadSpec && row.ManagedDownloadSpec == nil {
				return errors.New("active managed download requires an immutable transfer spec")
			}
			return nil
		}, func(row localStateTransferState) string { return strings.TrimSpace(row.InstallSessionID) })
	result.Audits = decodeIsolatedRows(raw.Audits, "local-state.json", "audits", &quarantined,
		func(row *localStateAuditState, _ json.RawMessage) error {
			if strings.TrimSpace(row.ID) == "" {
				return errors.New("audit id is required")
			}
			return nil
		}, func(row localStateAuditState) string { return strings.TrimSpace(row.ID) })
	result.LocalEnvironmentHostProfiles = decodeIsolatedRows(raw.LocalEnvironmentHostProfiles, "local-state.json", "localEnvironmentHostProfiles", &quarantined,
		func(row *localEnvironmentHostProfileState, _ json.RawMessage) error {
			if strings.TrimSpace(row.HostProfileID) == "" {
				return errors.New("host profile id is required")
			}
			return nil
		}, func(row localEnvironmentHostProfileState) string { return strings.TrimSpace(row.HostProfileID) })
	result.LocalEnvironmentSelectedSources = decodeIsolatedRows(raw.LocalEnvironmentSelectedSources, "local-state.json", "localEnvironmentSelectedSourceRecords", &quarantined,
		func(row *localEnvironmentSelectedSourceRecordState, _ json.RawMessage) error {
			if strings.TrimSpace(row.EnvironmentKey) == "" || localEnvironmentSelectedSourceRecordKey(*row) == "" {
				return errors.New("selected source identity is incomplete")
			}
			if !localEnvironmentDependencyFamilyHasMaterializer(row.DependencyFamily) {
				return errors.New("selected source dependency family is not admitted")
			}
			return nil
		}, func(row localEnvironmentSelectedSourceRecordState) string {
			return localEnvironmentSelectedSourceRecordKey(row)
		})
	result.LocalEnvironmentDependencyJobs = decodeIsolatedRows(raw.LocalEnvironmentDependencyJobs, "local-state.json", "localEnvironmentDependencyJobs", &quarantined,
		func(row *localEnvironmentDependencyJobState, _ json.RawMessage) error {
			if strings.TrimSpace(row.JobID) == "" {
				return errors.New("dependency job id is required")
			}
			if !localEnvironmentDependencyFamilyHasMaterializer(row.DependencyFamily) {
				return errors.New("dependency job family is not admitted")
			}
			return nil
		}, func(row localEnvironmentDependencyJobState) string { return strings.TrimSpace(row.JobID) })
	result.LocalEnvironmentPlanContracts = decodeIsolatedRows(raw.LocalEnvironmentPlanContracts, "local-state.json", "localEnvironmentPlanDependencyContracts", &quarantined,
		func(row *localEnvironmentPlanDependencyContractState, _ json.RawMessage) error {
			if localEnvironmentPlanDependencyContractKey(row.EnvironmentKey, row.DependencyFamily, row.DependencyID, row.ConsumerScope) == "" {
				return errors.New("dependency contract identity is incomplete")
			}
			if !localEnvironmentDependencyFamilyHasMaterializer(row.DependencyFamily) {
				return errors.New("dependency contract family is not admitted")
			}
			return nil
		}, func(row localEnvironmentPlanDependencyContractState) string {
			return localEnvironmentPlanDependencyContractKey(row.EnvironmentKey, row.DependencyFamily, row.DependencyID, row.ConsumerScope)
		})

	if len(quarantined) == 0 {
		return result, nil, false, nil
	}
	quarantinePath, quarantineErr := writeQuarantinedStateRecords(path, quarantined)
	diagnostics := make([]stateIsolationDiagnostic, 0, len(quarantined))
	for _, record := range quarantined {
		message := record.Reason
		if quarantineErr != nil {
			message += "; quarantine write failed: " + quarantineErr.Error()
		}
		diagnostics = append(diagnostics, stateIsolationDiagnostic{
			Store:          record.Store,
			Level:          stateIsolationLevelRecord,
			ReasonCode:     localStateRecordQuarantinedReason,
			Message:        message,
			QuarantinePath: quarantinePath,
			Section:        record.Section,
			RecordIndex:    record.RecordIndex,
		})
	}
	if quarantineErr != nil {
		result.retainedRecords = cloneQuarantinedStateRecords(quarantined)
	}
	return result, diagnostics, quarantineErr == nil, nil
}

func isolateLocalStateDocument(path string, payload []byte, cause error) (localStateSnapshot, []stateIsolationDiagnostic, bool, error) {
	quarantinePath, quarantineErr := quarantineStateDocument(path, payload)
	message := "local-state.json document was isolated: " + cause.Error()
	if quarantineErr != nil {
		message += "; quarantine failed: " + quarantineErr.Error()
	}
	diagnostics := []stateIsolationDiagnostic{{
		Store:          "local-state.json",
		Level:          stateIsolationLevelDocument,
		ReasonCode:     localStateDocumentQuarantinedReason,
		Message:        message,
		QuarantinePath: quarantinePath,
		RecordIndex:    -1,
	}}
	if quarantineErr != nil {
		return emptyLocalStateSnapshot(), diagnostics, false, fmt.Errorf("isolate local-state.json document after %v: %w", cause, quarantineErr)
	}
	return emptyLocalStateSnapshot(), diagnostics, false, nil
}

func decodeIsolatedRows[T any](
	rawRows []json.RawMessage,
	store string,
	section string,
	quarantined *[]quarantinedStateRecord,
	validate func(*T, json.RawMessage) error,
	identity func(T) string,
) []T {
	rows := make([]T, 0, len(rawRows))
	seen := make(map[string]struct{}, len(rawRows))
	for index, rawRow := range rawRows {
		var row T
		err := decodeStrictJSON(rawRow, &row)
		if err == nil && validate != nil {
			err = validate(&row, rawRow)
		}
		if err == nil && identity != nil {
			key := strings.TrimSpace(identity(row))
			if key != "" {
				if _, exists := seen[key]; exists {
					err = fmt.Errorf("duplicate record identity %q", key)
				} else {
					seen[key] = struct{}{}
				}
			}
		}
		if err != nil {
			*quarantined = append(*quarantined, quarantinedStateRecord{
				Store: store, Section: section, RecordIndex: index, Reason: err.Error(), Payload: append(json.RawMessage(nil), rawRow...),
			})
			continue
		}
		rows = append(rows, row)
	}
	return rows
}

func decodeStrictJSON(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func stateQuarantineDirectory(path string) string {
	return filepath.Join(filepath.Dir(path), "state-quarantine")
}

func quarantineStateDocument(path string, payload []byte) (string, error) {
	directory := stateQuarantineDirectory(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(directory, filepath.Base(path)+"."+stateIsolationTimestamp()+".document.json")
	if err := os.Rename(path, target); err == nil {
		return target, nil
	}
	if err := writeFileAtomically(target, payload, 0o600); err != nil {
		return "", err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return target, err
	}
	return target, nil
}

func writeQuarantinedStateRecords(path string, records []quarantinedStateRecord) (string, error) {
	directory := stateQuarantineDirectory(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(directory, filepath.Base(path)+"."+stateIsolationTimestamp()+".records.json")
	payload, err := json.MarshalIndent(map[string]any{
		"isolatedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"records":    records,
	}, "", "  ")
	if err != nil {
		return "", err
	}
	if err := writeFileAtomically(target, payload, 0o600); err != nil {
		return "", err
	}
	return target, nil
}

func cloneQuarantinedStateRecords(records []quarantinedStateRecord) []quarantinedStateRecord {
	if len(records) == 0 {
		return nil
	}
	cloned := make([]quarantinedStateRecord, 0, len(records))
	for _, record := range records {
		record.Payload = append(json.RawMessage(nil), record.Payload...)
		cloned = append(cloned, record)
	}
	return cloned
}

// marshalStateSnapshotWithRetainedRecords keeps record-level quarantine
// failures lossless. Invalid rows stay opaque and byte-for-byte unchanged in
// their original section until a later load can write quarantine evidence.
func marshalStateSnapshotWithRetainedRecords(snapshot any, records []quarantinedStateRecord) ([]byte, error) {
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil || len(records) == 0 {
		return payload, err
	}
	sections := make([]string, 0)
	bySection := make(map[string][]json.RawMessage)
	for _, record := range records {
		section := strings.TrimSpace(record.Section)
		if section == "" || !json.Valid(record.Payload) {
			return nil, fmt.Errorf("retained state record is invalid for section %q", section)
		}
		if _, exists := bySection[section]; !exists {
			sections = append(sections, section)
		}
		bySection[section] = append(bySection[section], append(json.RawMessage(nil), record.Payload...))
	}
	for _, section := range sections {
		payload, err = appendRetainedStateRecords(payload, section, bySection[section])
		if err != nil {
			return nil, err
		}
	}
	if !json.Valid(payload) {
		return nil, errors.New("retained state records produced invalid JSON")
	}
	return payload, nil
}

func appendRetainedStateRecords(payload []byte, section string, records []json.RawMessage) ([]byte, error) {
	values := make([]byte, 0)
	for index, record := range records {
		if index > 0 {
			values = append(values, ',')
		}
		values = append(values, record...)
	}

	marker := []byte("\n  \"" + section + "\": [")
	markerIndex := bytes.Index(payload, marker)
	if markerIndex < 0 {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(payload, &fields); err != nil {
			return nil, err
		}
		if _, exists := fields[section]; exists {
			return nil, fmt.Errorf("state section %q is not a JSON array", section)
		}
		objectEnd := bytes.LastIndex(payload, []byte("\n}"))
		if objectEnd < 0 {
			return nil, errors.New("state snapshot is not an indented JSON object")
		}
		encodedSection, _ := json.Marshal(section)
		insertion := append([]byte(",\n  "), encodedSection...)
		insertion = append(insertion, []byte(": [")...)
		insertion = append(insertion, values...)
		insertion = append(insertion, ']')
		result := make([]byte, 0, len(payload)+len(insertion))
		result = append(result, payload[:objectEnd]...)
		result = append(result, insertion...)
		result = append(result, payload[objectEnd:]...)
		return result, nil
	}

	arrayStart := markerIndex + len(marker) - 1
	arrayEnd, err := matchingJSONArrayEnd(payload, arrayStart)
	if err != nil {
		return nil, fmt.Errorf("state section %q: %w", section, err)
	}
	insertion := values
	if len(bytes.TrimSpace(payload[arrayStart+1:arrayEnd])) > 0 {
		insertion = append([]byte{','}, insertion...)
	}
	result := make([]byte, 0, len(payload)+len(insertion))
	result = append(result, payload[:arrayEnd]...)
	result = append(result, insertion...)
	result = append(result, payload[arrayEnd:]...)
	return result, nil
}

func matchingJSONArrayEnd(payload []byte, start int) (int, error) {
	if start < 0 || start >= len(payload) || payload[start] != '[' {
		return -1, errors.New("JSON array start is invalid")
	}
	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(payload); index++ {
		value := payload[index]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if value == '\\' {
				escaped = true
				continue
			}
			if value == '"' {
				inString = false
			}
			continue
		}
		if value == '"' {
			inString = true
			continue
		}
		switch value {
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return index, nil
			}
		}
	}
	return -1, errors.New("JSON array is unterminated")
}

func writeFileAtomically(path string, payload []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".state-isolation-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	keep := true
	defer func() {
		_ = temporary.Close()
		if keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := replaceLocalStateFileAtomically(temporaryPath, path); err != nil {
		return err
	}
	keep = false
	return nil
}

func stateIsolationTimestamp() string {
	return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}
