// @nimi-authority: rule.nimi.runtime.local-compute.r008

package localservice

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Reclamation also owns objects whose acquisition never created an asset.
// Their canonical paths are enough to enumerate them after a crash; no second
// inventory or permanent reference counter is needed.
func (s *Service) reclaimUnreferencedModelObjects() error {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.RLock()
	open := s.modelAssetReclamationOpen && s.modelAssetStoreRestriction == nil && !s.modelAssetInventoryReconciliationRequired
	root := s.localModelsPath
	s.mu.RUnlock()
	if !open {
		return nil
	}
	objects := modelObjectsRoot(root)
	if _, err := os.Lstat(objects); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := rejectModelStorageSubtreeLink(root, filepath.Dir(objects)); err != nil {
		return err
	}
	if err := rejectModelStorageSubtreeLink(root, objects); err != nil {
		return err
	}
	// A committed-on-disk manifest not yet in inventory remains a root. Read
	// every view once per sweep, rather than once for every candidate object.
	manifestRoots, err := modelObjectManifestRoots(root)
	if err != nil {
		return err
	}
	shards, err := os.ReadDir(objects)
	if err != nil {
		return err
	}
	var cleanupErr error
	for _, shard := range shards {
		if !shard.IsDir() {
			continue
		}
		directory := filepath.Join(objects, shard.Name())
		if err := rejectModelStorageSubtreeLink(root, directory); err != nil {
			return err
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			path := filepath.Join(directory, entry.Name())
			digest := modelObjectDigestFromPath(root, path)
			if digest == "" || manifestRoots[digest] {
				continue
			}
			// Match persistence's lock order. A new writer/pin cannot enter
			// between the final live-root check and unlink.
			s.mu.RLock()
			s.modelObjectMu.Lock()
			if !s.modelObjectReferencedLocked(digest, "") {
				if info, err := os.Lstat(path); err == nil && info.Mode().IsRegular() {
					if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
						cleanupErr = errors.Join(cleanupErr, fmt.Errorf("reclaim model object %s: %w", digest, err))
					}
				} else if err != nil && !errors.Is(err, os.ErrNotExist) {
					cleanupErr = errors.Join(cleanupErr, err)
				}
			}
			s.modelObjectMu.Unlock()
			s.mu.RUnlock()
		}
		_ = os.Remove(directory) // empty shard only
	}
	return cleanupErr
}

// Caller holds s.mu and modelObjectMu. Metadata commits/deletion additionally
// serialize through modelAssetMutationMu; object writers only hold the digest
// mutex while registering their claim, never while doing network/hash I/O.
func (s *Service) modelObjectReferencedLocked(digest, excludedObligation string) bool {
	if _, active := s.modelObjectWriters[digest]; active || len(s.modelObjectHolds[digest]) > 0 {
		return true
	}
	for _, asset := range s.modelAssets {
		for _, file := range asset.GetFiles() {
			if normalizeExactSHA256Hex(file.GetSha256()) == digest {
				return true
			}
		}
	}
	for id, obligation := range s.modelAssetCleanupObligations {
		if id == excludedObligation || obligation.Terminal || obligation.Phase == modelAssetCleanupPhaseReclaimObjects {
			continue
		}
		for _, candidate := range obligation.ObjectCandidates {
			if candidate == digest {
				return true
			}
		}
	}
	for _, intent := range s.transferCommitIntentsLocked() {
		for _, file := range intent.Files {
			if file.SHA256 == digest {
				return true
			}
		}
	}
	return false
}

func modelObjectManifestRoots(modelsRoot string) (map[string]bool, error) {
	root := filepath.Join(modelsRoot, "resolved")
	roots := make(map[string]bool)
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return roots, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(root, entry.Name(), localAssetManifestFileName))
		if errors.Is(err, os.ErrNotExist) {
			continue // a still-materializing view is protected by acquisition pins
		}
		if err != nil {
			return nil, err
		}
		var manifest modelAssetManifest
		if err := decodeStrictJSON(payload, &manifest); err != nil {
			return nil, fmt.Errorf("cannot establish manifest roots for %s: %w", entry.Name(), err)
		}
		for _, file := range manifest.Files {
			digest := normalizeExactSHA256Hex(file.SHA256)
			if digest == "" {
				return nil, fmt.Errorf("manifest %s has an unknown content root", entry.Name())
			}
			roots[digest] = true
		}
	}
	return roots, nil
}

func (s *Service) retryAcquisitionMaterialCleanup() {
	s.mu.RLock()
	ids := make([]string, 0)
	for id, summary := range s.transfers {
		if summary != nil && isTerminalTransferState(summary.GetState()) && !isRetryableFailedManagedDownload(summary) && s.transferControls[id] == nil {
			ids = append(ids, id)
		}
	}
	s.mu.RUnlock()
	for _, id := range ids {
		pending := s.localTransferSummary(id).GetCleanupPending()
		root := s.resolvedLocalModelsPath()
		for _, directory := range []string{managedModelDownloadStageDir(root, id), managedModelImportStageDir(root, id)} {
			if _, err := os.Lstat(directory); !errors.Is(err, os.ErrNotExist) {
				pending = true
			}
		}
		if pending {
			s.discardAcquisitionMaterial(id)
		}
	}
}
