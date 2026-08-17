package localservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	loadoutStoreSchemaVersion        = 1
	loadoutStoreFileName             = "loadouts.json"
	loadoutRecordQuarantinedReason   = "LOADOUT_RECORD_QUARANTINED"
	loadoutDocumentQuarantinedReason = "LOADOUT_DOCUMENT_QUARANTINED"
)

type loadoutStore interface {
	Load() ([]*runtimev1.Loadout, []*runtimev1.LoadoutSelection, error)
	Save([]*runtimev1.Loadout, []*runtimev1.LoadoutSelection) error
}

// @nimi-authority: rule.nimi.runtime.local-compute.r096
// @nimi-authority: rule.nimi.runtime.local-compute.r111
type diskLoadoutStore struct {
	path            string
	diagnostics     []stateIsolationDiagnostic
	retainedRecords []quarantinedStateRecord
}

type loadoutStoreSnapshot struct {
	SchemaVersion   int               `json:"schemaVersion"`
	SavedAt         string            `json:"savedAt"`
	Loadouts        []json.RawMessage `json:"loadouts"`
	Selections      []json.RawMessage `json:"selections"`
	retainedRecords []quarantinedStateRecord
}

func newDiskLoadoutStore(localStatePath string) loadoutStore {
	path := ""
	if statePath := strings.TrimSpace(localStatePath); statePath != "" {
		path = filepath.Join(filepath.Dir(statePath), loadoutStoreFileName)
	}
	return &diskLoadoutStore{path: path}
}

func (store *diskLoadoutStore) Load() ([]*runtimev1.Loadout, []*runtimev1.LoadoutSelection, error) {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil, nil, nil
	}
	store.diagnostics = nil
	store.retainedRecords = nil
	payload, err := os.ReadFile(store.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("read Loadout store: %w", err)
	}
	var snapshot loadoutStoreSnapshot
	documentErr := error(nil)
	if len(payload) == 0 {
		documentErr = errors.New("document is empty")
	} else if err := decodeStrictJSON(payload, &snapshot); err != nil {
		documentErr = err
	} else if snapshot.SchemaVersion != loadoutStoreSchemaVersion {
		documentErr = fmt.Errorf("unsupported schemaVersion=%d (expected %d)", snapshot.SchemaVersion, loadoutStoreSchemaVersion)
	}
	if documentErr != nil {
		quarantinePath, quarantineErr := quarantineStateDocument(store.path, payload)
		message := "loadouts.json document was isolated: " + documentErr.Error()
		if quarantineErr != nil {
			message += "; quarantine failed: " + quarantineErr.Error()
		}
		store.diagnostics = append(store.diagnostics, stateIsolationDiagnostic{
			Store: loadoutStoreFileName, Level: stateIsolationLevelDocument,
			ReasonCode: loadoutDocumentQuarantinedReason, Message: message,
			QuarantinePath: quarantinePath, RecordIndex: -1,
		})
		if quarantineErr != nil {
			return nil, nil, fmt.Errorf("isolate %s document after %v: %w", loadoutStoreFileName, documentErr, quarantineErr)
		}
		return nil, nil, nil
	}

	loadouts := make([]*runtimev1.Loadout, 0, len(snapshot.Loadouts))
	loadoutsByID := make(map[string]*runtimev1.Loadout, len(snapshot.Loadouts))
	quarantined := make([]quarantinedStateRecord, 0)
	for index, raw := range snapshot.Loadouts {
		loadout := &runtimev1.Loadout{}
		rowErr := protojson.Unmarshal(raw, loadout)
		canonicalizeLoadout(loadout)
		if rowErr == nil {
			rowErr = validateStoredLoadout(loadout)
		}
		if rowErr == nil && loadoutsByID[loadout.GetLoadoutId()] != nil {
			rowErr = fmt.Errorf("duplicate loadout_id %q", loadout.GetLoadoutId())
		}
		if rowErr != nil {
			quarantined = append(quarantined, quarantinedStateRecord{
				Store: loadoutStoreFileName, Section: "loadouts", RecordIndex: index,
				Reason: rowErr.Error(), Payload: append(json.RawMessage(nil), raw...),
			})
			continue
		}
		loadouts = append(loadouts, cloneLoadout(loadout))
		loadoutsByID[loadout.GetLoadoutId()] = loadout
	}

	selections := make([]*runtimev1.LoadoutSelection, 0, len(snapshot.Selections))
	seenContracts := make(map[string]struct{}, len(snapshot.Selections))
	for index, raw := range snapshot.Selections {
		selection := &runtimev1.LoadoutSelection{}
		rowErr := protojson.Unmarshal(raw, selection)
		canonicalizeLoadoutSelection(selection)
		if rowErr == nil {
			rowErr = validateStoredLoadoutSelection(selection, loadoutsByID)
		}
		if rowErr == nil {
			if _, duplicate := seenContracts[selection.GetCapabilityContract()]; duplicate {
				rowErr = fmt.Errorf("duplicate Loadout selection for %q", selection.GetCapabilityContract())
			}
		}
		if rowErr != nil {
			quarantined = append(quarantined, quarantinedStateRecord{
				Store: loadoutStoreFileName, Section: "selections", RecordIndex: index,
				Reason: rowErr.Error(), Payload: append(json.RawMessage(nil), raw...),
			})
			continue
		}
		seenContracts[selection.GetCapabilityContract()] = struct{}{}
		selections = append(selections, cloneLoadoutSelection(selection))
	}

	if len(quarantined) > 0 {
		quarantinePath, quarantineErr := writeQuarantinedStateRecords(store.path, quarantined)
		for _, record := range quarantined {
			message := record.Reason
			if quarantineErr != nil {
				message += "; quarantine write failed: " + quarantineErr.Error()
			}
			store.diagnostics = append(store.diagnostics, stateIsolationDiagnostic{
				Store: loadoutStoreFileName, Level: stateIsolationLevelRecord,
				ReasonCode: loadoutRecordQuarantinedReason, Message: message,
				QuarantinePath: quarantinePath, Section: record.Section, RecordIndex: record.RecordIndex,
			})
		}
		if quarantineErr != nil {
			store.retainedRecords = cloneQuarantinedStateRecords(quarantined)
		} else {
			if err := store.Save(loadouts, selections); err != nil {
				store.diagnostics = append(store.diagnostics, stateIsolationDiagnostic{
					Store: loadoutStoreFileName, Level: stateIsolationLevelRecord,
					ReasonCode:     loadoutRecordQuarantinedReason,
					Message:        "isolated Loadout records were retained but healthy store rewrite failed: " + err.Error(),
					QuarantinePath: quarantinePath, RecordIndex: -1,
				})
			}
		}
	}
	return loadouts, selections, nil
}

func (store *diskLoadoutStore) IsolationDiagnostics() []stateIsolationDiagnostic {
	if store == nil {
		return nil
	}
	return append([]stateIsolationDiagnostic(nil), store.diagnostics...)
}

func (store *diskLoadoutStore) Save(loadouts []*runtimev1.Loadout, selections []*runtimev1.LoadoutSelection) error {
	if store == nil || strings.TrimSpace(store.path) == "" {
		return nil
	}
	orderedLoadouts := cloneLoadouts(loadouts)
	sort.Slice(orderedLoadouts, func(i, j int) bool { return orderedLoadouts[i].GetLoadoutId() < orderedLoadouts[j].GetLoadoutId() })
	orderedSelections := cloneLoadoutSelections(selections)
	sort.Slice(orderedSelections, func(i, j int) bool {
		return orderedSelections[i].GetCapabilityContract() < orderedSelections[j].GetCapabilityContract()
	})
	snapshot := loadoutStoreSnapshot{
		SchemaVersion:   loadoutStoreSchemaVersion,
		SavedAt:         time.Now().UTC().Format(time.RFC3339Nano),
		Loadouts:        make([]json.RawMessage, 0, len(orderedLoadouts)),
		Selections:      make([]json.RawMessage, 0, len(orderedSelections)),
		retainedRecords: cloneQuarantinedStateRecords(store.retainedRecords),
	}
	for _, loadout := range orderedLoadouts {
		canonicalizeLoadout(loadout)
		if err := validateStoredLoadout(loadout); err != nil {
			return fmt.Errorf("encode Loadout %q: %w", loadout.GetLoadoutId(), err)
		}
		payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(loadout)
		if err != nil {
			return fmt.Errorf("encode Loadout %q: %w", loadout.GetLoadoutId(), err)
		}
		snapshot.Loadouts = append(snapshot.Loadouts, payload)
	}
	byID := make(map[string]*runtimev1.Loadout, len(orderedLoadouts))
	for _, loadout := range orderedLoadouts {
		byID[loadout.GetLoadoutId()] = loadout
	}
	for _, selection := range orderedSelections {
		canonicalizeLoadoutSelection(selection)
		if err := validateStoredLoadoutSelection(selection, byID); err != nil {
			return fmt.Errorf("encode Loadout selection: %w", err)
		}
		payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(selection)
		if err != nil {
			return fmt.Errorf("encode Loadout selection: %w", err)
		}
		snapshot.Selections = append(snapshot.Selections, payload)
	}
	payload, err := marshalStateSnapshotWithRetainedRecords(snapshot, snapshot.retainedRecords)
	if err != nil {
		return fmt.Errorf("encode Loadout store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(store.path), 0o700); err != nil {
		return fmt.Errorf("create Loadout store directory: %w", err)
	}
	if err := writeFileAtomically(store.path, payload, 0o600); err != nil {
		return fmt.Errorf("persist Loadout store: %w", err)
	}
	return nil
}

func cloneLoadout(input *runtimev1.Loadout) *runtimev1.Loadout {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.Loadout)
	return cloned
}

func cloneLoadouts(inputs []*runtimev1.Loadout) []*runtimev1.Loadout {
	result := make([]*runtimev1.Loadout, 0, len(inputs))
	for _, input := range inputs {
		if cloned := cloneLoadout(input); cloned != nil {
			result = append(result, cloned)
		}
	}
	return result
}

func cloneLoadoutSelection(input *runtimev1.LoadoutSelection) *runtimev1.LoadoutSelection {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LoadoutSelection)
	return cloned
}

func cloneLoadoutSelections(inputs []*runtimev1.LoadoutSelection) []*runtimev1.LoadoutSelection {
	result := make([]*runtimev1.LoadoutSelection, 0, len(inputs))
	for _, input := range inputs {
		if cloned := cloneLoadoutSelection(input); cloned != nil {
			result = append(result, cloned)
		}
	}
	return result
}
