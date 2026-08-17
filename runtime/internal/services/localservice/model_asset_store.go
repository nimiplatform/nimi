package localservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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

type modelAssetStoreAccessError struct {
	err error
}

func (e modelAssetStoreAccessError) Error() string { return e.err.Error() }
func (e modelAssetStoreAccessError) Unwrap() error { return e.err }

func failModelAssetStoreAccess(operation string, err error) error {
	return modelAssetStoreAccessError{err: fmt.Errorf("%s: %w", operation, err)}
}

func isModelAssetStoreAccessError(err error) bool {
	var target modelAssetStoreAccessError
	return errors.As(err, &target)
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
	if len(raw.Assets) > 0 {
		if err := validateModelAssetStoreResolvedRoot(modelsRoot); err != nil {
			return result, err
		}
	}

	quarantined := make([]quarantinedStateRecord, 0)
	seenDirectories := make(map[string]struct{}, len(raw.Assets))
	var accessErr error
	rows := decodeIsolatedRows(raw.Assets, modelAssetStoreFileName, "assets", &quarantined,
		func(row *modelAssetStoreRecord, _ json.RawMessage) error {
			if err := validateStoredModelAssetRecord(modelsRoot, row); err != nil {
				if accessErr == nil && isModelAssetStoreAccessError(err) {
					accessErr = err
				}
				return err
			}
			directoryKey := canonicalReportPath(row.ManagedDirectory)
			if _, duplicate := seenDirectories[directoryKey]; duplicate {
				return fmt.Errorf("duplicate ModelAsset managed directory %q", row.ManagedDirectory)
			}
			seenDirectories[directoryKey] = struct{}{}
			return nil
		}, func(row modelAssetStoreRecord) string {
			asset := &runtimev1.ModelAssetRecord{}
			if protojson.Unmarshal(row.Asset, asset) != nil {
				return ""
			}
			return strings.TrimSpace(asset.GetModelAssetId())
		})
	if accessErr != nil {
		return result, accessErr
	}
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

// validateModelAssetStoreResolvedRoot distinguishes a root-scope custody
// outage from an independently invalid ModelAsset row. When the complete
// resolved root cannot be located, every child Lstat can surface ErrNotExist
// (including Windows PATH_NOT_FOUND/BAD_NETPATH). Treating those child errors
// as record corruption would quarantine and rewrite the entire active
// inventory. Fail startup without touching the store instead; once the root is
// available, ordinary missing or invalid child records remain record-scoped.
func validateModelAssetStoreResolvedRoot(modelsRoot string) error {
	root := filepath.Join(resolveLocalModelsPath(modelsRoot), "resolved")
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(root) {
		return failModelAssetStoreAccess("inspect ModelAsset resolved root", errors.New("resolved models root is unavailable"))
	}
	info, err := os.Lstat(root)
	if err != nil {
		return failModelAssetStoreAccess("inspect ModelAsset resolved root", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return failModelAssetStoreAccess("inspect ModelAsset resolved root", errors.New("resolved models root must be an available non-link directory"))
	}
	return nil
}

// validateStoredModelAssetRecord keeps the durable inventory fail-closed
// without rereading every payload byte during daemon startup. The store row,
// canonical manifest, and declared payload layout are one identity; fresh
// content verification remains the Job-admission boundary.
func validateStoredModelAssetRecord(modelsRoot string, row *modelAssetStoreRecord) error {
	if row == nil {
		return errors.New("ModelAsset store row is required")
	}
	directory := strings.TrimSpace(row.ManagedDirectory)
	if directory == "" || directory != row.ManagedDirectory || !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return errors.New("managedDirectory must be a canonical absolute path")
	}
	if !modelAssetManagedDirectoryWithinRoot(modelsRoot, directory) {
		return errors.New("managedDirectory must stay under the Runtime resolved models root")
	}
	directoryInfo, err := os.Lstat(directory)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return failModelAssetStoreAccess("inspect ModelAsset managed directory", err)
		}
		return errors.New("managedDirectory must be an available non-link directory")
	}
	if !directoryInfo.IsDir() || directoryInfo.Mode()&os.ModeSymlink != 0 {
		return errors.New("managedDirectory must be an available non-link directory")
	}

	asset := &runtimev1.ModelAssetRecord{}
	if err := protojson.Unmarshal(row.Asset, asset); err != nil {
		return fmt.Errorf("decode ModelAsset: %w", err)
	}
	if asset.GetModelAssetId() == "" || strings.TrimSpace(asset.GetModelAssetId()) != asset.GetModelAssetId() ||
		normalizeVerifiedContentID(asset.GetContentId()) != asset.GetContentId() || !asset.GetContentVerified() {
		return errors.New("ModelAsset identity or content verification is incomplete")
	}
	if asset.GetCatalogVerification() != runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED &&
		asset.GetCatalogVerification() != runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED {
		return errors.New("ModelAsset catalog verification is not canonical")
	}
	if !canonicalModelAssetRelativePath(asset.GetEntry()) || len(asset.GetFiles()) == 0 {
		return errors.New("ModelAsset entry or file inventory is incomplete")
	}
	seenFiles := make(map[string]struct{}, len(asset.GetFiles()))
	entryFound := false
	var totalSize int64
	previousPath := ""
	for _, file := range asset.GetFiles() {
		if file == nil || !canonicalModelAssetRelativePath(file.GetRelativePath()) || isModelAssetControlFile(file.GetRelativePath()) {
			return errors.New("ModelAsset file path is not canonical")
		}
		if previousPath != "" && file.GetRelativePath() <= previousPath {
			return errors.New("ModelAsset files must be unique and canonically ordered")
		}
		previousPath = file.GetRelativePath()
		if _, duplicate := seenFiles[file.GetRelativePath()]; duplicate {
			return errors.New("ModelAsset file inventory contains a duplicate path")
		}
		seenFiles[file.GetRelativePath()] = struct{}{}
		if normalizeExactSHA256Hex(file.GetSha256()) != file.GetSha256() || file.GetSizeBytes() < 0 {
			return errors.New("ModelAsset file digest or size is invalid")
		}
		if file.GetRelativePath() == asset.GetEntry() {
			entryFound = true
		}
		if file.GetSizeBytes() > int64(^uint64(0)>>1)-totalSize {
			return errors.New("ModelAsset total size overflows")
		}
		totalSize += file.GetSizeBytes()
		payloadPath := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		info, statErr := os.Lstat(payloadPath)
		if statErr != nil {
			if !errors.Is(statErr, os.ErrNotExist) {
				return failModelAssetStoreAccess("inspect ModelAsset payload file", statErr)
			}
			return fmt.Errorf("ModelAsset payload file %q is unavailable or differs from inventory", file.GetRelativePath())
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != file.GetSizeBytes() {
			return fmt.Errorf("ModelAsset payload file %q is unavailable or differs from inventory", file.GetRelativePath())
		}
	}
	if !entryFound || totalSize != asset.GetTotalSizeBytes() || modelAssetContentID(asset.GetFiles()) != asset.GetContentId() {
		return errors.New("ModelAsset entry, total size, or content identity does not match its file inventory")
	}

	manifestPath := filepath.Join(directory, localAssetManifestFileName)
	if err := validateResolvedModelManifestPath(manifestPath, modelsRoot); err != nil {
		var pathErr *os.PathError
		if errors.As(err, &pathErr) && !errors.Is(err, os.ErrNotExist) {
			return failModelAssetStoreAccess("validate ModelAsset manifest path", err)
		}
		return err
	}
	manifestInfo, err := os.Lstat(manifestPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return failModelAssetStoreAccess("inspect ModelAsset manifest", err)
		}
		return errors.New("ModelAsset manifest must be an available non-link regular file")
	}
	if !manifestInfo.Mode().IsRegular() || manifestInfo.Mode()&os.ModeSymlink != 0 {
		return errors.New("ModelAsset manifest must be an available non-link regular file")
	}
	manifestPayload, err := os.ReadFile(manifestPath)
	if err != nil {
		return failModelAssetStoreAccess("read ModelAsset manifest", err)
	}
	var manifest modelAssetManifest
	if err := decodeStrictJSON(manifestPayload, &manifest); err != nil {
		return fmt.Errorf("decode ModelAsset manifest: %w", err)
	}
	if !reflect.DeepEqual(manifest, modelAssetManifestFromRecord(asset)) {
		return errors.New("ModelAsset store row does not match its canonical manifest")
	}
	return nil
}

func canonicalModelAssetRelativePath(value string) bool {
	if value == "" || strings.TrimSpace(value) != value || !safeModelAssetRelativePath(filepath.FromSlash(value)) {
		return false
	}
	return filepath.ToSlash(filepath.Clean(filepath.FromSlash(value))) == value
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
