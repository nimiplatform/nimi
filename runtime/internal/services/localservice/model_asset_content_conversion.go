// @nimi-authority: rule.nimi.runtime.local-compute.r111

package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// ModelStorageConversionOptions drives the one-time, explicit, offline
// conversion of a pre-content-addressed models root. Dry-run is the default;
// Apply performs the planned changes. The conversion is re-runnable: every
// step is derived from the current disk state, so an interrupted apply
// continues from what already happened.
type ModelStorageConversionOptions struct {
	Apply bool
	// PreviewUnlocked marks a read-only plan computed without the exclusive
	// state owner lock (a daemon may still be running). It can only preview;
	// apply always recomputes the plan under the lock.
	PreviewUnlocked bool
}

type ModelStorageConversionGroup struct {
	KeepModelAssetID    string   `json:"keepModelAssetId"`
	KeepDirectory       string   `json:"keepDirectory"`
	TargetDirectory     string   `json:"targetDirectory"`
	KeepRegistered      bool     `json:"keepRegistered"`
	KeepReason          string   `json:"keepReason"`
	MergedModelAssetIDs []string `json:"mergedModelAssetIds,omitempty"`
	MergedDirectories   []string `json:"mergedDirectories,omitempty"`
	ContentID           string   `json:"contentId"`
	Entry               string   `json:"entry"`
	FileCount           int      `json:"fileCount"`
	TotalSizeBytes      int64    `json:"totalSizeBytes"`
	DisplayName         string   `json:"displayName,omitempty"`
	AlreadyConverted    bool     `json:"alreadyConverted"`
}

type ModelStorageLoadoutRewrite struct {
	LoadoutID         string `json:"loadoutId"`
	SlotID            string `json:"slotId"`
	FromModelAssetID  string `json:"fromModelAssetId"`
	ToModelAssetID    string `json:"toModelAssetId"`
	ExpectedContentID string `json:"expectedContentId"`
	Resolved          bool   `json:"resolved"`
	Reason            string `json:"reason,omitempty"`
}

type ModelStoragePrefixDisposition struct {
	TransferID     string `json:"transferId"`
	Directory      string `json:"directory"`
	TargetPath     string `json:"targetPath,omitempty"`
	File           string `json:"file"`
	Repo           string `json:"repo"`
	ExpectedSHA256 string `json:"expectedSha256"`
	BytesOnDisk    int64  `json:"bytesOnDisk"`
	Disposition    string `json:"disposition"`
	Reason         string `json:"reason,omitempty"`
}

type ModelStorageConversionEntry struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

type ModelStorageObjectDuplicate struct {
	SHA256      string   `json:"sha256"`
	SizeBytes   int64    `json:"sizeBytes"`
	SourcePath  string   `json:"sourcePath"`
	LinkedViews []string `json:"linkedViews"`
}

type ModelStorageConversionReport struct {
	Mode                     string                          `json:"mode"`
	PreviewUnlocked          bool                            `json:"previewUnlocked,omitempty"`
	ModelsRoot               string                          `json:"modelsRoot"`
	StateStore               string                          `json:"stateStore"`
	InventorySchemaVersion   int                             `json:"inventorySchemaVersion"`
	AlreadyConverted         bool                            `json:"alreadyConverted"`
	Groups                   []ModelStorageConversionGroup   `json:"groups"`
	LoadoutRewrites          []ModelStorageLoadoutRewrite    `json:"loadoutRewrites"`
	Prefixes                 []ModelStoragePrefixDisposition `json:"prefixes"`
	OldCleanupObligations    []ModelStorageConversionEntry   `json:"oldCleanupObligations"`
	InventoryRowsWithoutData []ModelStorageConversionEntry   `json:"inventoryRowsWithoutData"`
	UnknownEntries           []ModelStorageConversionEntry   `json:"unknownEntries"`
	SharedObjects            []ModelStorageObjectDuplicate   `json:"sharedObjects"`
	ObjectsToPublish         int                             `json:"objectsToPublish"`
	ViewsToRelink            int                             `json:"viewsToRelink"`
	DirectoriesToDelete      []string                        `json:"directoriesToDelete"`
	EstimatedReclaimBytes    int64                           `json:"estimatedReclaimBytes"`
	AssetCountBefore         int                             `json:"assetCountBefore"`
	AssetCountAfter          int                             `json:"assetCountAfter"`
	BackupDirectory          string                          `json:"backupDirectory,omitempty"`
	Applied                  bool                            `json:"applied"`
	AppliedSteps             []string                        `json:"appliedSteps,omitempty"`
	ReclaimedBytes           int64                           `json:"reclaimedBytes"`
}

// conversionCandidate is one manifest directory under resolved/ with its real
// rehashed distribution.
type conversionCandidate struct {
	directory      string
	manifest       modelAssetManifest
	manifestRaw    json.RawMessage
	legacy         bool
	registered     bool
	registeredRow  *runtimev1.ModelAssetRecord
	files          []*runtimev1.ModelAssetFile
	distribution   modelDistribution
	contentID      string
	total          int64
	loadoutRefs    int
	fileIdentities map[string]modelFileIdentity
	problem        string
}

type legacyStoreRow struct {
	Asset            json.RawMessage `json:"asset"`
	ManagedDirectory string          `json:"managedDirectory"`
}

type legacyStoreDocument struct {
	SchemaVersion      int                           `json:"schemaVersion"`
	Assets             []legacyStoreRow              `json:"assets"`
	CleanupObligations []modelAssetCleanupObligation `json:"cleanupObligations"`
}

// ConvertModelStorageToContentAddressed plans and optionally applies the
// one-time conversion of the models root to the object-linked layout:
// equivalent distributions merge into one kept identity, Loadout references
// to merged identities are rewritten only when their expected content matches,
// identical bytes across distinct distributions become one published object,
// transfer-owned prefixes are re-keyed by transfer identity, and the
// inventory becomes schema 2. Nothing runs implicitly; the Runtime must be
// stopped and the service opened exclusively for recovery.
func (s *Service) ConvertModelStorageToContentAddressed(ctx context.Context, options ModelStorageConversionOptions) (*ModelStorageConversionReport, error) {
	if !s.adoptResolvedModelImports {
		return nil, errors.New("content-addressed conversion requires the exclusive recovery service")
	}
	if options.Apply && options.PreviewUnlocked {
		return nil, errors.New("an unlocked preview can never apply; reopen the root under the exclusive state owner lock")
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	if err := s.ensureModelObjectLinkSupport(modelsRoot); err != nil {
		return nil, err
	}
	report := &ModelStorageConversionReport{Mode: "dry-run", PreviewUnlocked: options.PreviewUnlocked, ModelsRoot: modelsRoot, StateStore: s.stateStorePath}
	if options.Apply {
		report.Mode = "apply"
	}
	resolvedRoot := filepath.Join(modelsRoot, "resolved")

	// 1. Inventory as written (any schema), read raw so a restricted domain
	//    still yields its rows.
	legacyRows, legacyCleanup, schemaVersion, err := readLegacyModelAssetStore(s.modelAssetStorePath)
	if err != nil {
		return nil, err
	}
	report.InventorySchemaVersion = schemaVersion
	report.AssetCountBefore = len(legacyRows)
	registeredByDirectory := make(map[string]*runtimev1.ModelAssetRecord, len(legacyRows))
	registeredByID := make(map[string]string, len(legacyRows))
	for _, row := range legacyRows {
		asset := &runtimev1.ModelAssetRecord{}
		if protojson.Unmarshal(row.Asset, asset) != nil {
			continue
		}
		directory := filepath.Clean(strings.TrimSpace(row.ManagedDirectory))
		if !filepath.IsAbs(directory) {
			directory = filepath.Join(modelsRoot, filepath.FromSlash(row.ManagedDirectory))
		}
		registeredByDirectory[canonicalReportPath(directory)] = asset
		registeredByID[asset.GetModelAssetId()] = directory
	}

	// 2. Every manifest directory under resolved/, at any depth, rehashed.
	candidates, unknown := s.collectConversionCandidates(ctx, modelsRoot, registeredByDirectory)
	report.UnknownEntries = append(report.UnknownEntries, unknown...)
	for id, directory := range registeredByID {
		found := false
		for _, candidate := range candidates {
			if candidate.registered && candidate.registeredRow.GetModelAssetId() == id {
				found = true
				break
			}
		}
		if !found {
			report.InventoryRowsWithoutData = append(report.InventoryRowsWithoutData, ModelStorageConversionEntry{Path: directory, Reason: "inventory row has no readable manifest directory; dropped from the converted inventory"})
		}
	}

	// 3. Loadout references (for keep selection and rewrites).
	s.mu.RLock()
	loadouts := make([]*runtimev1.Loadout, 0, len(s.loadouts))
	for _, loadout := range s.loadouts {
		loadouts = append(loadouts, cloneLoadout(loadout))
	}
	s.mu.RUnlock()
	sort.Slice(loadouts, func(i, j int) bool { return loadouts[i].GetLoadoutId() < loadouts[j].GetLoadoutId() })
	refCount := make(map[string]int)
	for _, loadout := range loadouts {
		for _, axis := range loadout.GetModelAxes() {
			refCount[strings.TrimSpace(axis.GetModelAssetId())]++
		}
	}
	for _, candidate := range candidates {
		candidate.loadoutRefs = refCount[candidate.manifest.ModelAssetID]
	}

	// 4a. Old cleanup obligations: a removed asset whose directory is still
	//     present with matching identity is disposed, never kept or grouped.
	for _, obligation := range legacyCleanup {
		directory := filepath.Clean(strings.TrimSpace(obligation.ManagedDirectory))
		if !filepath.IsAbs(directory) {
			directory = filepath.Join(modelsRoot, filepath.FromSlash(obligation.ManagedDirectory))
		}
		if _, err := os.Lstat(directory); errors.Is(err, os.ErrNotExist) {
			report.OldCleanupObligations = append(report.OldCleanupObligations, ModelStorageConversionEntry{Path: directory, Reason: "removed ModelAsset " + obligation.ModelAssetID + ": directory already gone; obligation dropped"})
			continue
		}
		matched := false
		for _, candidate := range candidates {
			if canonicalReportPath(candidate.directory) == canonicalReportPath(directory) && candidate.manifest.ModelAssetID == obligation.ModelAssetID && candidate.contentID == obligation.ContentID {
				matched = true
				candidate.problem = "explicitly removed ModelAsset whose cleanup never completed; deleted by the conversion"
			}
		}
		if matched {
			report.OldCleanupObligations = append(report.OldCleanupObligations, ModelStorageConversionEntry{Path: directory, Reason: "removed ModelAsset " + obligation.ModelAssetID + " still on disk with matching identity; deleted on apply"})
			report.DirectoriesToDelete = append(report.DirectoriesToDelete, directory)
		} else {
			report.OldCleanupObligations = append(report.OldCleanupObligations, ModelStorageConversionEntry{Path: directory, Reason: "removed ModelAsset " + obligation.ModelAssetID + ": directory content no longer matches; left for manual review"})
		}
	}
	// 4. Group by exact distribution.
	groups := make(map[string][]*conversionCandidate)
	order := make([]string, 0)
	for _, candidate := range candidates {
		if candidate.problem != "" {
			report.UnknownEntries = append(report.UnknownEntries, ModelStorageConversionEntry{Path: candidate.directory, Reason: candidate.problem})
			continue
		}
		key := candidate.distribution.layoutKey() + "|" + fmt.Sprintf("%d", candidate.total)
		if _, seen := groups[key]; !seen {
			order = append(order, key)
		}
		groups[key] = append(groups[key], candidate)
	}
	sort.Strings(order)
	keepByMerged := make(map[string]*conversionCandidate)
	keeps := make([]*conversionCandidate, 0, len(order))
	for _, key := range order {
		members := groups[key]
		sort.Slice(members, func(i, j int) bool {
			left, right := members[i], members[j]
			if left.registered != right.registered {
				return left.registered
			}
			if left.loadoutRefs != right.loadoutRefs {
				return left.loadoutRefs > right.loadoutRefs
			}
			if left.manifest.CreatedAt != right.manifest.CreatedAt {
				return left.manifest.CreatedAt < right.manifest.CreatedAt
			}
			return left.manifest.ModelAssetID < right.manifest.ModelAssetID
		})
		keep := members[0]
		keeps = append(keeps, keep)
		group := ModelStorageConversionGroup{
			KeepModelAssetID: keep.manifest.ModelAssetID, KeepDirectory: keep.directory,
			TargetDirectory: filepath.Join(resolvedRoot, keep.manifest.ModelAssetID), KeepRegistered: keep.registered,
			ContentID: keep.contentID, Entry: keep.distribution.Entry, FileCount: len(keep.files), TotalSizeBytes: keep.total,
			DisplayName: keep.manifest.DisplayName, AlreadyConverted: !keep.legacy && keep.registered && len(members) == 1,
		}
		switch {
		case keep.registered:
			group.KeepReason = "registered in the current inventory"
		case keep.loadoutRefs > 0:
			group.KeepReason = "referenced by Loadouts"
		default:
			group.KeepReason = "earliest creation time, then identity order"
		}
		for _, merged := range members[1:] {
			group.MergedModelAssetIDs = append(group.MergedModelAssetIDs, merged.manifest.ModelAssetID)
			group.MergedDirectories = append(group.MergedDirectories, merged.directory)
			keepByMerged[merged.manifest.ModelAssetID] = keep
		}
		report.Groups = append(report.Groups, group)
	}
	report.AssetCountAfter = len(keeps)

	// 5. Loadout rewrites: only an equivalent, content-matching target.
	keepIDs := make(map[string]*conversionCandidate, len(keeps))
	for _, keep := range keeps {
		keepIDs[keep.manifest.ModelAssetID] = keep
	}
	for _, loadout := range loadouts {
		for _, axis := range loadout.GetModelAxes() {
			id := strings.TrimSpace(axis.GetModelAssetId())
			if id == "" {
				// An unbound optional slot references nothing.
				continue
			}
			if _, kept := keepIDs[id]; kept {
				continue
			}
			keep, merged := keepByMerged[id]
			rewrite := ModelStorageLoadoutRewrite{LoadoutID: loadout.GetLoadoutId(), SlotID: axis.GetSlotId(), FromModelAssetID: id, ExpectedContentID: axis.GetExpectedContentId()}
			if !merged {
				rewrite.Reason = "referenced ModelAsset is neither kept nor merged; the reference stays unresolved"
			} else if axis.GetExpectedContentId() != keep.contentID {
				rewrite.ToModelAssetID = keep.manifest.ModelAssetID
				rewrite.Reason = "expected content identity differs from the kept distribution; not rewritten"
			} else {
				rewrite.ToModelAssetID = keep.manifest.ModelAssetID
				rewrite.Resolved = true
			}
			report.LoadoutRewrites = append(report.LoadoutRewrites, rewrite)
		}
	}

	// 6. Physical sharing across kept distributions and the resulting work.
	sourceByDigest := make(map[string]*conversionFileSource)
	for _, keep := range keeps {
		for _, file := range keep.files {
			digest := normalizeExactSHA256Hex(file.GetSha256())
			viewPath := filepath.Join(keep.directory, filepath.FromSlash(file.GetRelativePath()))
			identity := keep.fileIdentities[file.GetRelativePath()]
			source, exists := sourceByDigest[digest]
			if !exists {
				source = &conversionFileSource{digest: digest, size: file.GetSizeBytes(), sourcePath: viewPath, identity: identity}
				sourceByDigest[digest] = source
				objectPath, _ := modelObjectPath(modelsRoot, digest)
				if objectIdentity, info, err := modelFileIdentityOf(objectPath); err == nil && info.Mode().IsRegular() {
					source.objectPublished = true
					source.objectIdentity = objectIdentity
				}
			}
			source.views = append(source.views, viewPath)
			if source.objectPublished {
				if identity != source.objectIdentity {
					report.ViewsToRelink++
				}
			} else if identity != source.identity {
				report.ViewsToRelink++
			}
		}
	}
	digests := make([]string, 0, len(sourceByDigest))
	for digest := range sourceByDigest {
		digests = append(digests, digest)
	}
	sort.Strings(digests)
	for _, digest := range digests {
		source := sourceByDigest[digest]
		if !source.objectPublished {
			report.ObjectsToPublish++
		}
		if len(source.views) > 1 {
			report.SharedObjects = append(report.SharedObjects, ModelStorageObjectDuplicate{SHA256: digest, SizeBytes: source.size, SourcePath: source.sourcePath, LinkedViews: append([]string(nil), source.views...)})
			// Every view beyond the source that is a distinct inode is physical
			// space the relink frees.
			seen := map[modelFileIdentity]struct{}{source.identity: {}}
			for _, keep := range keeps {
				for _, file := range keep.files {
					if normalizeExactSHA256Hex(file.GetSha256()) != digest {
						continue
					}
					identity := keep.fileIdentities[file.GetRelativePath()]
					if _, counted := seen[identity]; counted {
						continue
					}
					seen[identity] = struct{}{}
					report.EstimatedReclaimBytes += file.GetSizeBytes()
				}
			}
		}
	}
	// Merged duplicate views: their files are separate inodes unless already linked.
	for _, key := range order {
		members := groups[key]
		for _, merged := range members[1:] {
			report.DirectoriesToDelete = append(report.DirectoriesToDelete, merged.directory)
			for _, file := range merged.files {
				identity := merged.fileIdentities[file.GetRelativePath()]
				if source := sourceByDigest[normalizeExactSHA256Hex(file.GetSha256())]; source != nil && (identity == source.identity || (source.objectPublished && identity == source.objectIdentity)) {
					continue
				}
				report.EstimatedReclaimBytes += file.GetSizeBytes()
			}
		}
	}

	// 8. Transfer prefixes owned by retryable old downloads.
	legacyTransfers, stateDocument, err := readLegacyLocalStateTransfers(s.stateStorePath)
	if err != nil {
		return nil, err
	}
	prefixGroups := make(map[string][]*ModelStoragePrefixDisposition)
	prefixOrder := make([]string, 0)
	for _, row := range legacyTransfers {
		if normalizeTransferKind(row.SessionKind) != localTransferKindDownload || row.ManagedDownloadSpec == nil {
			continue
		}
		if !(normalizeTransferState(row.State) == localTransferStateFailed && row.Retryable) && !(normalizeTransferState(row.State) == localTransferStatePaused) {
			continue
		}
		spec := row.ManagedDownloadSpec
		if _, err := os.Lstat(managedModelDownloadStageDir(modelsRoot, row.InstallSessionID)); err == nil {
			// Already keyed by its own transfer identity: nothing to convert.
			continue
		}
		legacyDirectory := legacyManagedModelDownloadStageDir(modelsRoot, spec.ModelID, row.InstallSessionID)
		if _, err := os.Lstat(legacyDirectory); errors.Is(err, os.ErrNotExist) {
			// No material anywhere: the row alone converts as non-resumable.
			continue
		}
		disposition := &ModelStoragePrefixDisposition{TransferID: row.InstallSessionID, Directory: legacyDirectory, Repo: spec.Repo, TargetPath: managedModelDownloadStageDir(modelsRoot, row.InstallSessionID)}
		if len(spec.Files) != 1 {
			disposition.Disposition = "unknown"
			disposition.Reason = "multi-file prefix; re-acquire"
		} else {
			disposition.File = spec.Files[0]
			disposition.ExpectedSHA256 = normalizeExactSHA256Hex(spec.Hashes[spec.Files[0]])
			partial := filepath.Join(legacyDirectory, filepath.FromSlash(spec.Files[0])+".download")
			info, statErr := os.Lstat(partial)
			if statErr != nil || !info.Mode().IsRegular() {
				disposition.Disposition = "unknown"
				disposition.Reason = "no resumable prefix on disk; re-acquire"
			} else {
				disposition.BytesOnDisk = info.Size()
			}
		}
		key := spec.Repo + "|" + disposition.File + "|" + disposition.ExpectedSHA256
		if _, seen := prefixGroups[key]; !seen {
			prefixOrder = append(prefixOrder, key)
		}
		prefixGroups[key] = append(prefixGroups[key], disposition)
	}
	sort.Strings(prefixOrder)
	for _, key := range prefixOrder {
		members := prefixGroups[key]
		sort.Slice(members, func(i, j int) bool {
			if members[i].BytesOnDisk != members[j].BytesOnDisk {
				return members[i].BytesOnDisk > members[j].BytesOnDisk
			}
			return members[i].TransferID < members[j].TransferID
		})
		for index, member := range members {
			if member.Disposition == "unknown" {
				report.DirectoriesToDelete = append(report.DirectoriesToDelete, member.Directory)
				report.Prefixes = append(report.Prefixes, *member)
				continue
			}
			if index == 0 {
				member.Disposition = "keep"
				member.Reason = "largest verified-spec prefix for this content; re-keyed to its own transfer and resumable through the original session"
			} else {
				member.Disposition = "discard"
				member.Reason = "same content as the kept prefix; one writer per digest"
				report.EstimatedReclaimBytes += member.BytesOnDisk
				report.DirectoriesToDelete = append(report.DirectoriesToDelete, member.Directory)
			}
			report.Prefixes = append(report.Prefixes, *member)
		}
	}
	sort.Strings(report.DirectoriesToDelete)
	if schemaVersion == modelAssetStoreSchemaVersion && report.ObjectsToPublish == 0 && report.ViewsToRelink == 0 && len(report.DirectoriesToDelete) == 0 && report.AssetCountAfter == report.AssetCountBefore {
		report.AlreadyConverted = true
	}
	if !options.Apply {
		return report, nil
	}
	if err := s.applyModelStorageConversion(ctx, modelsRoot, report, keeps, sourceByDigest, keepByMerged, loadouts, legacyTransfers, stateDocument); err != nil {
		return report, err
	}
	return report, nil
}

type conversionFileSource struct {
	digest          string
	size            int64
	sourcePath      string
	identity        modelFileIdentity
	objectPublished bool
	objectIdentity  modelFileIdentity
	views           []string
}

func readLegacyModelAssetStore(path string) ([]legacyStoreRow, []modelAssetCleanupObligation, int, error) {
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, 0, nil
	}
	if err != nil {
		return nil, nil, 0, err
	}
	var document legacyStoreDocument
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, nil, 0, fmt.Errorf("decode ModelAsset inventory: %w", err)
	}
	return document.Assets, document.CleanupObligations, document.SchemaVersion, nil
}

type legacyTransferRow struct {
	InstallSessionID    string                              `json:"installSessionId"`
	AssetID             string                              `json:"assetId"`
	SessionKind         string                              `json:"sessionKind"`
	Phase               string                              `json:"phase"`
	State               string                              `json:"state"`
	BytesReceived       int64                               `json:"bytesReceived"`
	BytesTotal          int64                               `json:"bytesTotal,omitempty"`
	Message             string                              `json:"message,omitempty"`
	ReasonCode          string                              `json:"reasonCode,omitempty"`
	Retryable           bool                                `json:"retryable,omitempty"`
	CreatedAt           string                              `json:"createdAt"`
	UpdatedAt           string                              `json:"updatedAt"`
	PlanID              string                              `json:"planId,omitempty"`
	ManagedDownloadSpec *localStateManagedModelDownloadSpec `json:"managedDownloadSpec,omitempty"`
}

func readLegacyLocalStateTransfers(path string) ([]legacyTransferRow, map[string]json.RawMessage, error) {
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, map[string]json.RawMessage{}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, nil, fmt.Errorf("decode local state: %w", err)
	}
	var rows []json.RawMessage
	if raw, ok := document["transfers"]; ok && len(raw) > 0 {
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, nil, fmt.Errorf("decode local state transfers: %w", err)
		}
	}
	transfers := make([]legacyTransferRow, 0, len(rows))
	for _, raw := range rows {
		var row legacyTransferRow
		if json.Unmarshal(raw, &row) != nil || strings.TrimSpace(row.InstallSessionID) == "" {
			continue
		}
		transfers = append(transfers, row)
	}
	return transfers, document, nil
}

// legacyManagedModelDownloadStageDir recomputes the pre-conversion staging
// location of a download transfer: slug(modelID)-transferID plus eight bytes
// of its SHA-256.
func legacyManagedModelDownloadStageDir(modelsRoot string, modelID string, transferID string) string {
	storageID := slugifyLocalModelID(modelID) + "-" + strings.ToLower(strings.TrimSpace(transferID))
	digest := sha256.Sum256([]byte(storageID))
	identity := fmt.Sprintf("%s-%s", slugifyLocalModelID(storageID), hex.EncodeToString(digest[:8]))
	return filepath.Join(modelsRoot, "quarantine", "downloads", identity)
}

func (s *Service) collectConversionCandidates(ctx context.Context, modelsRoot string, registered map[string]*runtimev1.ModelAssetRecord) ([]*conversionCandidate, []ModelStorageConversionEntry) {
	resolvedRoot := filepath.Join(modelsRoot, "resolved")
	manifestPaths := make([]string, 0)
	_ = filepath.WalkDir(resolvedRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		if strings.EqualFold(entry.Name(), localAssetManifestFileName) {
			manifestPaths = append(manifestPaths, filepath.Clean(path))
		}
		return nil
	})
	sort.Strings(manifestPaths)
	candidates := make([]*conversionCandidate, 0, len(manifestPaths))
	unknown := make([]ModelStorageConversionEntry, 0)
	for _, manifestPath := range manifestPaths {
		if ctx.Err() != nil {
			break
		}
		directory := filepath.Dir(manifestPath)
		candidate := &conversionCandidate{directory: directory, fileIdentities: make(map[string]modelFileIdentity)}
		payload, err := os.ReadFile(manifestPath)
		if err != nil {
			unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "manifest unreadable: " + err.Error()})
			continue
		}
		candidate.manifestRaw = payload
		if err := json.Unmarshal(payload, &candidate.manifest); err != nil || strings.TrimSpace(candidate.manifest.ModelAssetID) == "" {
			unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "manifest is not a ModelAsset manifest; left in place"})
			continue
		}
		candidate.legacy = modelAssetManifestIncompatible(candidate.manifest)
		if asset, ok := registered[canonicalReportPath(directory)]; ok {
			candidate.registered = true
			candidate.registeredRow = asset
		}
		files, _, total, _, _, err := s.hashResolvedPayloadDetailed(ctx, directory)
		if err != nil {
			unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "payload could not be hashed: " + err.Error()})
			continue
		}
		if len(files) == 0 {
			unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "manifest directory holds no payload files"})
			continue
		}
		for _, file := range files {
			identity, _, err := modelFileIdentityOf(filepath.Join(directory, filepath.FromSlash(file.GetRelativePath())))
			if err != nil {
				unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "file identity unavailable: " + err.Error()})
				continue
			}
			candidate.fileIdentities[file.GetRelativePath()] = identity
		}
		candidate.files = files
		candidate.total = total
		candidate.contentID = modelAssetContentID(files)
		entry := strings.TrimSpace(candidate.manifest.Entry)
		distribution, err := modelDistributionFromFiles(entry, files)
		if err != nil {
			unknown = append(unknown, ModelStorageConversionEntry{Path: directory, Reason: "manifest entry does not name a payload file: " + err.Error()})
			continue
		}
		candidate.distribution = distribution
		if strings.TrimSpace(candidate.manifest.ContentID) != candidate.contentID {
			candidate.problem = fmt.Sprintf("manifest content_id %s differs from rehashed content %s; not converted", candidate.manifest.ContentID, candidate.contentID)
		}
		candidates = append(candidates, candidate)
	}
	return candidates, unknown
}

// applyModelStorageConversion performs the planned conversion. Every step is
// idempotent against the current disk state.
func (s *Service) applyModelStorageConversion(ctx context.Context, modelsRoot string, report *ModelStorageConversionReport, keeps []*conversionCandidate, sources map[string]*conversionFileSource, keepByMerged map[string]*conversionCandidate, loadouts []*runtimev1.Loadout, legacyTransfers []legacyTransferRow, stateDocument map[string]json.RawMessage) error {
	resolvedRoot := filepath.Join(modelsRoot, "resolved")
	step := func(name string) { report.AppliedSteps = append(report.AppliedSteps, name) }

	// a. Small metadata backup.
	backupDirectory := filepath.Join(stateQuarantineDirectory(s.stateStorePath), "content-addressed-conversion-"+time.Now().UTC().Format("20060102T150405Z"))
	if err := os.MkdirAll(backupDirectory, 0o700); err != nil {
		return fmt.Errorf("prepare conversion backup: %w", err)
	}
	for _, path := range []string{s.modelAssetStorePath, s.stateStorePath, filepath.Join(filepath.Dir(s.stateStorePath), loadoutStoreFileName)} {
		if payload, err := os.ReadFile(path); err == nil {
			if err := os.WriteFile(filepath.Join(backupDirectory, filepath.Base(path)), payload, 0o600); err != nil {
				return fmt.Errorf("back up %s: %w", filepath.Base(path), err)
			}
		}
	}
	manifestBackups := make([]map[string]any, 0, len(keeps))
	for _, keep := range keeps {
		manifestBackups = append(manifestBackups, map[string]any{"directory": keep.directory, "manifest": json.RawMessage(keep.manifestRaw)})
	}
	if payload, err := json.MarshalIndent(manifestBackups, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(backupDirectory, "manifests.json"), payload, 0o600)
	}
	report.BackupDirectory = backupDirectory
	step("metadata backed up to " + backupDirectory)

	// b. Objects and links for every kept distribution.
	for _, keep := range keeps {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		for _, file := range keep.files {
			digest := normalizeExactSHA256Hex(file.GetSha256())
			viewPath := filepath.Join(keep.directory, filepath.FromSlash(file.GetRelativePath()))
			objectPath, err := modelObjectPath(modelsRoot, digest)
			if err != nil {
				return err
			}
			present, _, err := modelObjectPresent(modelsRoot, digest)
			if err != nil {
				return err
			}
			if !present {
				if _, err := normalizeModelPayloadPermissionsBeforePublish(viewPath, file.GetRelativePath()); err != nil {
					return err
				}
				if _, _, err := publishModelObjectIfAbsent(modelsRoot, digest, viewPath); err != nil {
					return fmt.Errorf("publish object for %s: %w", viewPath, err)
				}
				continue
			}
			linked, _, err := viewFileLinkedToObject(modelsRoot, digest, viewPath)
			if err != nil {
				return err
			}
			if linked {
				continue
			}
			// Same verified bytes under a separate inode: replace the view file
			// with a link to the published object, keeping the layout.
			replacement := viewPath + ".relink"
			_ = os.Remove(replacement)
			if err := os.Link(objectPath, replacement); err != nil {
				return fmt.Errorf("link object into %s: %w", viewPath, err)
			}
			if err := os.Remove(viewPath); err != nil {
				_ = os.Remove(replacement)
				return fmt.Errorf("replace view file %s: %w", viewPath, err)
			}
			if err := os.Rename(replacement, viewPath); err != nil {
				return fmt.Errorf("finish relink of %s: %w", viewPath, err)
			}
		}
	}
	step("objects published and views linked")

	// c. Kept views live at resolved/<model_asset_id>; manifests become schema 2.
	assets := make(map[string]*runtimev1.ModelAssetRecord, len(keeps))
	directories := make(map[string]string, len(keeps))
	for _, keep := range keeps {
		target := filepath.Join(resolvedRoot, keep.manifest.ModelAssetID)
		if canonicalReportPath(keep.directory) != canonicalReportPath(target) {
			if _, err := os.Lstat(target); err == nil {
				return fmt.Errorf("target view %s already exists for %s", target, keep.directory)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := os.Rename(keep.directory, target); err != nil {
				return fmt.Errorf("move view %s to %s: %w", keep.directory, target, err)
			}
			keep.directory = target
		}
		manifest := keep.manifest
		manifest.SchemaVersion = modelAssetManifestSchemaVersion
		manifest.StorageLayout = modelAssetManifestStorageLayoutObjectLinked
		manifest.ContentID = keep.contentID
		manifest.Entry = keep.distribution.Entry
		manifest.TotalSizeBytes = keep.total
		manifest.ContentVerified = true
		manifest.Files = manifest.Files[:0]
		for _, file := range keep.files {
			manifest.Files = append(manifest.Files, modelAssetManifestFile{RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes(), NonExecutableContent: file.GetNonExecutableContent()})
		}
		if strings.TrimSpace(manifest.CreatedAt) == "" {
			manifest.CreatedAt = nowISO()
		}
		asset, err := modelAssetRecordFromCanonicalManifest(manifest)
		if err != nil {
			return fmt.Errorf("canonical manifest for %s: %w", keep.manifest.ModelAssetID, err)
		}
		if keep.registeredRow != nil {
			asset.CatalogVerification = keep.registeredRow.GetCatalogVerification()
			asset.Unclassified = keep.registeredRow.GetUnclassified()
			asset.UpdatedAt = keep.registeredRow.GetUpdatedAt()
		}
		if asset.GetCatalogVerification() == runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_UNSPECIFIED {
			asset.CatalogVerification = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED
		}
		manifest.CatalogVerified = asset.GetCatalogVerification() == runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
		asset.LatestIntegrityCheckedAt = nowISO()
		payload, err := json.MarshalIndent(modelAssetManifestFromRecord(asset), "", "  ")
		if err != nil {
			return err
		}
		if err := writeFileAtomically(filepath.Join(keep.directory, localAssetManifestFileName), payload, 0o600); err != nil {
			return fmt.Errorf("write converted manifest for %s: %w", keep.manifest.ModelAssetID, err)
		}
		assets[asset.GetModelAssetId()] = asset
		directories[asset.GetModelAssetId()] = keep.directory
	}
	step("kept views relocated and manifests upgraded")

	// d. Inventory schema 2.
	snapshot, err := buildModelAssetStoreSnapshot(assets, directories, map[string]modelAssetCleanupObligation{}, map[string]modelObjectQuarantineObligation{}, modelsRoot)
	if err != nil {
		return err
	}
	if err := saveModelAssetStore(s.modelAssetStorePath, snapshot); err != nil {
		return fmt.Errorf("write converted inventory: %w", err)
	}
	step("inventory written as schema 2")

	// e. Loadout references to merged identities.
	rewritten := false
	for _, loadout := range loadouts {
		for _, axis := range loadout.GetModelAxes() {
			keep, merged := keepByMerged[strings.TrimSpace(axis.GetModelAssetId())]
			if merged && axis.GetExpectedContentId() == keep.contentID {
				axis.ModelAssetId = keep.manifest.ModelAssetID
				rewritten = true
			}
		}
	}
	if rewritten {
		s.mu.Lock()
		selections := make([]*runtimev1.LoadoutSelection, 0, len(s.loadoutSelections))
		for _, selection := range s.loadoutSelections {
			selections = append(selections, selection)
		}
		revisions := make(map[string]string, len(s.loadoutSelectionRevisions))
		for key, value := range s.loadoutSelectionRevisions {
			revisions[key] = value
		}
		for _, loadout := range loadouts {
			s.loadouts[loadout.GetLoadoutId()] = cloneLoadout(loadout)
		}
		err := s.loadoutStore.Save(loadouts, selections, revisions)
		s.mu.Unlock()
		if err != nil {
			return fmt.Errorf("write rewritten Loadouts: %w", err)
		}
		step("equivalent Loadout references rewritten")
	}

	// f. Transfers: kept prefixes re-keyed, rows converted to the current shape.
	keptPrefixes := make(map[string]ModelStoragePrefixDisposition)
	for _, prefix := range report.Prefixes {
		if prefix.Disposition == "keep" {
			keptPrefixes[prefix.TransferID] = prefix
		}
	}
	convertedRows := make([]localStateTransferState, 0, len(legacyTransfers))
	for _, row := range legacyTransfers {
		converted := localStateTransferState{
			SpecVersion: localStateTransferSpecVersion, InstallSessionID: row.InstallSessionID, SessionKind: normalizeTransferKind(row.SessionKind),
			Phase: row.Phase, State: normalizeTransferState(row.State), BytesReceived: row.BytesReceived, BytesTotal: row.BytesTotal,
			Message: row.Message, ReasonCode: row.ReasonCode, Retryable: row.Retryable, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			PlanID: row.PlanID, SourceLabel: row.AssetID,
		}
		if prefix, kept := keptPrefixes[row.InstallSessionID]; kept {
			if err := os.MkdirAll(filepath.Dir(prefix.TargetPath), 0o755); err != nil {
				return err
			}
			if _, err := os.Lstat(prefix.TargetPath); errors.Is(err, os.ErrNotExist) {
				if err := os.Rename(prefix.Directory, prefix.TargetPath); err != nil {
					return fmt.Errorf("re-key prefix %s: %w", prefix.Directory, err)
				}
			}
			converted.ManagedDownloadSpec = row.ManagedDownloadSpec
			converted.State = localTransferStateFailed
			converted.Retryable = true
			converted.ObjectHolds = []modelObjectHold{{Digest: prefix.ExpectedSHA256, Kind: modelObjectHoldPrefix}}
			converted.BytesReceived = prefix.BytesOnDisk
		} else if converted.State == localTransferStateFailed && converted.Retryable {
			// Its prefix was discarded or unknown: nothing remains to resume.
			converted.Retryable = false
			converted.Message = strings.TrimSpace(row.Message + "; prefix discarded by content-addressed conversion; acquire again")
		} else if !isTerminalTransferState(converted.State) {
			converted.State = localTransferStateFailed
			converted.Retryable = false
			converted.ReasonCode = localTransferInterruptionReason
		}
		convertedRows = append(convertedRows, converted)
	}
	rowsPayload, err := json.Marshal(convertedRows)
	if err != nil {
		return err
	}
	stateDocument["transfers"] = rowsPayload
	if _, ok := stateDocument["schemaVersion"]; !ok {
		stateDocument["schemaVersion"] = json.RawMessage(fmt.Sprintf("%d", localStateSchemaVersion))
	}
	statePayload, err := json.MarshalIndent(stateDocument, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFileAtomically(s.stateStorePath, statePayload, 0o600); err != nil {
		return fmt.Errorf("write converted local state: %w", err)
	}
	step("transfer rows converted and kept prefix re-keyed")

	// g. Delete merged views, disposed obligations, and discarded prefixes.
	var reclaimed int64
	for _, directory := range report.DirectoriesToDelete {
		for _, keep := range keeps {
			if canonicalReportPath(keep.directory) == canonicalReportPath(directory) {
				return fmt.Errorf("refusing to delete kept view %s", directory)
			}
		}
		size := conversionDirectoryUniqueBytes(directory, sources)
		if err := os.RemoveAll(directory); err != nil {
			return fmt.Errorf("delete %s: %w", directory, err)
		}
		reclaimed += size
	}
	report.ReclaimedBytes = reclaimed
	removeEmptyConversionParents(resolvedRoot)
	step("merged views, discarded prefixes, and removed-asset directories deleted")

	// h. Verify the converted inventory loads and every kept view is linked.
	decoded, err := loadModelAssetStore(s.modelAssetStorePath, modelsRoot)
	if err != nil {
		return fmt.Errorf("verify converted inventory: %w", err)
	}
	if decoded.Restriction != nil || len(decoded.Assets) != len(assets) {
		return fmt.Errorf("converted inventory verification: restriction=%v assets=%d want %d", decoded.Restriction, len(decoded.Assets), len(assets))
	}
	for id, asset := range decoded.Assets {
		if err := verifyModelAssetViewLinks(modelsRoot, asset, decoded.Directories[id]); err != nil {
			return fmt.Errorf("converted view %s: %w", id, err)
		}
	}
	report.Applied = true
	step("converted inventory verified")
	return nil
}

// conversionDirectoryUniqueBytes sums the sizes of regular files under the
// directory whose inode is not the published object of their content.
func conversionDirectoryUniqueBytes(directory string, sources map[string]*conversionFileSource) int64 {
	var total int64
	_ = filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		identity, info, err := modelFileIdentityOf(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		for _, source := range sources {
			if source.objectPublished && identity == source.objectIdentity {
				return nil
			}
			if identity == source.identity {
				return nil
			}
		}
		total += info.Size()
		return nil
	})
	return total
}

func removeEmptyConversionParents(resolvedRoot string) {
	directories := make([]string, 0)
	_ = filepath.WalkDir(resolvedRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr == nil && entry.IsDir() && path != resolvedRoot {
			directories = append(directories, path)
		}
		return nil
	})
	sort.Sort(sort.Reverse(sort.StringSlice(directories)))
	for _, directory := range directories {
		entries, err := os.ReadDir(directory)
		if err == nil && len(entries) == 0 {
			_ = os.Remove(directory)
		}
	}
}
