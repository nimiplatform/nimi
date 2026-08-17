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
)

const (
	modelAssetStoreSchemaVersion = 1
	modelAssetStoreFileName      = "model-assets.json"
)

type modelAssetStoreSnapshot struct {
	SchemaVersion      int                           `json:"schemaVersion"`
	SavedAt            string                        `json:"savedAt"`
	Assets             []json.RawMessage             `json:"assets"`
	CleanupObligations []modelAssetCleanupObligation `json:"cleanupObligations,omitempty"`
	retainedRecords    []quarantinedStateRecord
}

type modelAssetStoreRecord struct {
	Asset            json.RawMessage `json:"asset"`
	ManagedDirectory string          `json:"managedDirectory"`
}

type modelAssetCleanupObligation struct {
	ModelAssetID     string `json:"modelAssetId"`
	ContentID        string `json:"contentId"`
	Generation       string `json:"generation,omitempty"`
	ManagedDirectory string `json:"managedDirectory"`
	Reason           string `json:"reason"`
	Attempts         int    `json:"attempts"`
	Terminal         bool   `json:"terminal,omitempty"`
	TerminalReason   string `json:"terminalReason,omitempty"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type decodedModelAssetStore struct {
	Assets             map[string]*runtimev1.ModelAssetRecord
	Directories        map[string]string
	CleanupObligations map[string]modelAssetCleanupObligation
	Diagnostics        []stateIsolationDiagnostic
	RewriteRequired    bool
	retainedRecords    []quarantinedStateRecord
}

func resolveModelAssetStorePath(stateStorePath string, modelsRoot string) string {
	if path := strings.TrimSpace(stateStorePath); path != "" {
		return filepath.Join(filepath.Dir(filepath.Clean(path)), modelAssetStoreFileName)
	}
	if root := strings.TrimSpace(modelsRoot); root != "" {
		return filepath.Join(filepath.Dir(filepath.Clean(root)), modelAssetStoreFileName)
	}
	return ""
}

func emptyDecodedModelAssetStore() decodedModelAssetStore {
	return decodedModelAssetStore{
		Assets:             make(map[string]*runtimev1.ModelAssetRecord),
		Directories:        make(map[string]string),
		CleanupObligations: make(map[string]modelAssetCleanupObligation),
	}
}

func loadModelAssetStore(path string, modelsRoot string) (decodedModelAssetStore, error) {
	result := emptyDecodedModelAssetStore()
	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || strings.TrimSpace(path) == "" {
			return result, nil
		}
		return result, err
	}
	if len(payload) == 0 {
		return isolateModelAssetStoreDocument(path, payload, errors.New("document is empty"))
	}
	var raw modelAssetStoreSnapshot
	if err := decodeStrictJSON(payload, &raw); err != nil {
		return isolateModelAssetStoreDocument(path, payload, err)
	}
	if raw.SchemaVersion != modelAssetStoreSchemaVersion {
		return isolateModelAssetStoreDocument(path, payload, fmt.Errorf("unsupported schemaVersion=%d", raw.SchemaVersion))
	}

	quarantined := make([]quarantinedStateRecord, 0)
	rows := decodeIsolatedRows(raw.Assets, modelAssetStoreFileName, "assets", &quarantined,
		func(row *modelAssetStoreRecord, _ json.RawMessage) error {
			if strings.TrimSpace(row.ManagedDirectory) == "" {
				return errors.New("managedDirectory is required")
			}
			if !modelAssetManagedDirectoryWithinRoot(modelsRoot, row.ManagedDirectory) {
				return errors.New("managedDirectory must stay under the Runtime resolved models root")
			}
			asset := &runtimev1.ModelAssetRecord{}
			if err := protojson.Unmarshal(row.Asset, asset); err != nil {
				return fmt.Errorf("decode ModelAsset: %w", err)
			}
			if strings.TrimSpace(asset.GetModelAssetId()) == "" || strings.TrimSpace(asset.GetContentId()) == "" || !asset.GetContentVerified() {
				return errors.New("ModelAsset identity or content verification is incomplete")
			}
			return nil
		}, func(row modelAssetStoreRecord) string {
			asset := &runtimev1.ModelAssetRecord{}
			if protojson.Unmarshal(row.Asset, asset) != nil {
				return ""
			}
			return strings.TrimSpace(asset.GetModelAssetId())
		})
	for _, row := range rows {
		asset := &runtimev1.ModelAssetRecord{}
		if err := protojson.Unmarshal(row.Asset, asset); err != nil {
			continue
		}
		result.Assets[asset.GetModelAssetId()] = asset
		result.Directories[asset.GetModelAssetId()] = filepath.Clean(row.ManagedDirectory)
	}

	seenCleanup := make(map[string]struct{}, len(raw.CleanupObligations))
	for index, obligation := range raw.CleanupObligations {
		id := strings.TrimSpace(obligation.ModelAssetID)
		if id == "" || strings.TrimSpace(obligation.ManagedDirectory) == "" {
			encoded, _ := json.Marshal(obligation)
			quarantined = append(quarantined, quarantinedStateRecord{Store: modelAssetStoreFileName, Section: "cleanupObligations", RecordIndex: index, Reason: "cleanup identity is incomplete", Payload: encoded})
			continue
		}
		if _, exists := seenCleanup[id]; exists {
			encoded, _ := json.Marshal(obligation)
			quarantined = append(quarantined, quarantinedStateRecord{Store: modelAssetStoreFileName, Section: "cleanupObligations", RecordIndex: index, Reason: "duplicate cleanup identity", Payload: encoded})
			continue
		}
		seenCleanup[id] = struct{}{}
		result.CleanupObligations[id] = obligation
	}

	if len(quarantined) > 0 {
		quarantinePath, quarantineErr := writeQuarantinedStateRecords(path, quarantined)
		for _, record := range quarantined {
			message := record.Reason
			if quarantineErr != nil {
				message += "; quarantine write failed: " + quarantineErr.Error()
			}
			result.Diagnostics = append(result.Diagnostics, stateIsolationDiagnostic{
				Store: modelAssetStoreFileName, Level: stateIsolationLevelRecord,
				ReasonCode: localStateRecordQuarantinedReason, Message: message,
				QuarantinePath: quarantinePath, Section: record.Section, RecordIndex: record.RecordIndex,
			})
		}
		result.RewriteRequired = quarantineErr == nil
		if quarantineErr != nil {
			result.retainedRecords = cloneQuarantinedStateRecords(quarantined)
		}
	}
	return result, nil
}

func isolateModelAssetStoreDocument(path string, payload []byte, cause error) (decodedModelAssetStore, error) {
	result := emptyDecodedModelAssetStore()
	quarantinePath, quarantineErr := quarantineStateDocument(path, payload)
	message := modelAssetStoreFileName + " document was isolated: " + cause.Error()
	if quarantineErr != nil {
		message += "; quarantine failed: " + quarantineErr.Error()
	}
	result.Diagnostics = []stateIsolationDiagnostic{{
		Store: modelAssetStoreFileName, Level: stateIsolationLevelDocument,
		ReasonCode: localStateDocumentQuarantinedReason, Message: message,
		QuarantinePath: quarantinePath, RecordIndex: -1,
	}}
	if quarantineErr != nil {
		return result, fmt.Errorf("isolate %s document after %v: %w", modelAssetStoreFileName, cause, quarantineErr)
	}
	return result, nil
}

func buildModelAssetStoreSnapshot(assets map[string]*runtimev1.ModelAssetRecord, directories map[string]string, cleanup map[string]modelAssetCleanupObligation) (modelAssetStoreSnapshot, error) {
	snapshot := modelAssetStoreSnapshot{
		SchemaVersion: modelAssetStoreSchemaVersion,
		SavedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Assets:        make([]json.RawMessage, 0, len(assets)),
	}
	ids := make([]string, 0, len(assets))
	for id := range assets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		asset := assets[id]
		if asset == nil {
			continue
		}
		assetPayload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(asset)
		if err != nil {
			return modelAssetStoreSnapshot{}, err
		}
		rowPayload, err := json.Marshal(modelAssetStoreRecord{Asset: assetPayload, ManagedDirectory: filepath.Clean(directories[id])})
		if err != nil {
			return modelAssetStoreSnapshot{}, err
		}
		snapshot.Assets = append(snapshot.Assets, rowPayload)
	}
	cleanupIDs := make([]string, 0, len(cleanup))
	for id := range cleanup {
		cleanupIDs = append(cleanupIDs, id)
	}
	sort.Strings(cleanupIDs)
	for _, id := range cleanupIDs {
		snapshot.CleanupObligations = append(snapshot.CleanupObligations, cleanup[id])
	}
	return snapshot, nil
}

func saveModelAssetStore(path string, snapshot modelAssetStoreSnapshot) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	payload, err := marshalStateSnapshotWithRetainedRecords(snapshot, snapshot.retainedRecords)
	if err != nil {
		return err
	}
	return writeFileAtomically(path, payload, 0o600)
}
