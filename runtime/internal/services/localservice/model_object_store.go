// @nimi-authority: rule.nimi.runtime.local-compute.r008

package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/oklog/ulid/v2"
)

// Content objects are the single healthy, published, plain-file copy of one
// SHA-256 within a models root. Distribution views under resolved/ reference
// them through Runtime-created same-volume hard links; no view is ever the
// only place a payload byte lives once its object is published, and no object
// is ever overwritten in place.
const (
	modelObjectsSubtree      = "objects"
	modelObjectsHashSubtree  = "sha256"
	modelObjectsProbeSubtree = ".link-probe"
	modelObjectLinkProbeSize = 64
	modelObjectHashBufferLen = 4 * 1024 * 1024
)

// modelFileIdentity is the physical identity of one file on its volume. It is
// the physical generation used by cleanup and quarantine decisions; the hash
// content key is never a substitute for it.
type modelFileIdentity struct {
	Volume uint64 `json:"volume"`
	Index  uint64 `json:"index"`
}

func (identity modelFileIdentity) valid() bool {
	return identity.Volume != 0 || identity.Index != 0
}

func (identity modelFileIdentity) String() string {
	return fmt.Sprintf("%x:%x", identity.Volume, identity.Index)
}

// modelObjectHold kinds describe why a transfer keeps a digest alive.
const (
	modelObjectHoldPrefix = "prefix"
	modelObjectHoldObject = "object"
)

type modelObjectHold struct {
	Digest string `json:"digest"`
	Kind   string `json:"kind"`
}

type modelObjectConflictKind string

const (
	modelObjectConflictInProgress     modelObjectConflictKind = "in_progress"
	modelObjectConflictResumeRequired modelObjectConflictKind = "resume_required"
)

// modelObjectConflict reports that another transfer owns the digest this
// acquisition needs. It is a typed guidance value, not a retry signal.
type modelObjectConflict struct {
	Kind              modelObjectConflictKind
	Digest            string
	RelatedTransferID string
}

func (conflict *modelObjectConflict) Error() string {
	if conflict == nil {
		return "model object conflict"
	}
	switch conflict.Kind {
	case modelObjectConflictResumeRequired:
		return fmt.Sprintf("content %s has a durable prefix owned by transfer %s; resume that transfer", conflict.Digest, conflict.RelatedTransferID)
	default:
		return fmt.Sprintf("content %s is being acquired by transfer %s", conflict.Digest, conflict.RelatedTransferID)
	}
}

func modelObjectsRoot(modelsRoot string) string {
	return filepath.Join(resolveLocalModelsPath(modelsRoot), modelObjectsSubtree, modelObjectsHashSubtree)
}

func modelObjectPath(modelsRoot string, digest string) (string, error) {
	normalized := normalizeExactSHA256Hex(digest)
	if normalized == "" {
		return "", errors.New("model object digest must be an exact SHA-256")
	}
	return filepath.Join(modelObjectsRoot(modelsRoot), normalized[:2], normalized), nil
}

func modelObjectDigestFromPath(modelsRoot string, path string) string {
	relative, err := filepath.Rel(modelObjectsRoot(modelsRoot), filepath.Clean(path))
	if err != nil {
		return ""
	}
	parts := strings.Split(filepath.ToSlash(relative), "/")
	if len(parts) != 2 || len(parts[0]) != 2 {
		return ""
	}
	digest := normalizeExactSHA256Hex(parts[1])
	if digest == "" || !strings.HasPrefix(digest, parts[0]) {
		return ""
	}
	return digest
}

// modelObjectLinkSupportError is the typed unsupported result for a models
// root that cannot create same-volume file links. It is reported before any
// payload transfer and never silently degrades to copying.
type modelObjectLinkSupportError struct {
	Root  string
	Cause error
}

func (err *modelObjectLinkSupportError) Error() string {
	if err == nil {
		return "models root does not support same-volume file links"
	}
	message := fmt.Sprintf("models root %q does not support same-volume file links", err.Root)
	if err.Cause != nil {
		message += ": " + err.Cause.Error()
	}
	return message
}

func (err *modelObjectLinkSupportError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

// probeModelObjectLinkSupport creates a small temporary file under the models
// root objects area, links it, verifies both paths share one physical identity,
// and removes both. The probe also establishes that objects, resolved views,
// and staging live on one real volume: the volume identity of the probe file is
// compared with a probe under resolved/ and quarantine/.
func probeModelObjectLinkSupport(modelsRoot string) error {
	root := resolveLocalModelsPath(modelsRoot)
	if strings.TrimSpace(root) == "" || !filepath.IsAbs(root) {
		return &modelObjectLinkSupportError{Root: root, Cause: errors.New("models root must be absolute")}
	}
	probeRoot := filepath.Join(root, modelObjectsSubtree, modelObjectsProbeSubtree)
	if err := os.MkdirAll(probeRoot, 0o700); err != nil {
		return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("prepare link probe: %w", err)}
	}
	token := strings.ToLower(ulid.Make().String())
	sourcePath := filepath.Join(probeRoot, "probe-"+token)
	linkPath := filepath.Join(probeRoot, "link-"+token)
	defer func() {
		_ = os.Remove(linkPath)
		_ = os.Remove(sourcePath)
		_ = os.Remove(probeRoot)
	}()
	payload := make([]byte, modelObjectLinkProbeSize)
	copy(payload, token)
	if err := os.WriteFile(sourcePath, payload, 0o600); err != nil {
		return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("write link probe: %w", err)}
	}
	if err := os.Link(sourcePath, linkPath); err != nil {
		return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("create file link: %w", err)}
	}
	sourceIdentity, _, err := modelFileIdentityOf(sourcePath)
	if err != nil {
		return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("inspect probe identity: %w", err)}
	}
	linkIdentity, _, err := modelFileIdentityOf(linkPath)
	if err != nil {
		return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("inspect link identity: %w", err)}
	}
	if !sourceIdentity.valid() || sourceIdentity != linkIdentity {
		return &modelObjectLinkSupportError{Root: root, Cause: errors.New("linked paths do not share one physical file identity")}
	}
	for _, subtree := range []string{"resolved", "quarantine"} {
		directory := filepath.Join(root, subtree)
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("prepare %s: %w", subtree, err)}
		}
		if err := rejectModelStorageSubtreeLink(root, directory); err != nil {
			return &modelObjectLinkSupportError{Root: root, Cause: err}
		}
		volumePath := filepath.Join(directory, ".volume-probe-"+token)
		if err := os.WriteFile(volumePath, payload[:8], 0o600); err != nil {
			return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("write %s volume probe: %w", subtree, err)}
		}
		identity, _, identityErr := modelFileIdentityOf(volumePath)
		_ = os.Remove(volumePath)
		if identityErr != nil {
			return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("inspect %s volume probe: %w", subtree, identityErr)}
		}
		if identity.Volume != sourceIdentity.Volume {
			return &modelObjectLinkSupportError{Root: root, Cause: fmt.Errorf("%s does not share the objects volume", subtree)}
		}
	}
	return nil
}

// rejectModelStorageSubtreeLink refuses a managed subtree that is itself a
// link or reparse point. Escaping the models root through a mounted or
// linked subtree is a storage-boundary violation, not a supported layout.
func rejectModelStorageSubtreeLink(root string, directory string) error {
	info, err := os.Lstat(directory)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", filepath.Base(directory), err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeIrregular != 0 {
		return fmt.Errorf("%s must be a plain directory inside the models root", filepath.Base(directory))
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return fmt.Errorf("resolve %s: %w", filepath.Base(directory), err)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("resolve models root: %w", err)
	}
	if !pathWithinBase(resolvedRoot, resolved, false) {
		return fmt.Errorf("%s escapes the models root", filepath.Base(directory))
	}
	return nil
}

func (s *Service) ensureModelObjectLinkSupport(modelsRoot string) error {
	root := resolveLocalModelsPath(modelsRoot)
	s.modelObjectMu.Lock()
	cached, known := s.modelObjectLinkProbe[root]
	s.modelObjectMu.Unlock()
	if known {
		return cached
	}
	err := probeModelObjectLinkSupport(root)
	s.modelObjectMu.Lock()
	if s.modelObjectLinkProbe == nil {
		s.modelObjectLinkProbe = make(map[string]error)
	}
	if err == nil {
		s.modelObjectLinkProbe[root] = nil
	}
	s.modelObjectMu.Unlock()
	return err
}

// hashRegularFile reads the whole file and returns its digest and size. The
// file must be a plain regular file reached without following a link.
func hashRegularFile(path string, onProgress func(int64) error) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, fmt.Errorf("%s is not a plain regular file", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	buffer := make([]byte, modelObjectHashBufferLen)
	var total int64
	for {
		count, readErr := file.Read(buffer)
		if count > 0 {
			_, _ = hasher.Write(buffer[:count])
			total += int64(count)
			if onProgress != nil {
				if err := onProgress(int64(count)); err != nil {
					return "", total, err
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", total, readErr
		}
	}
	after, err := os.Lstat(path)
	if err != nil {
		return "", total, err
	}
	if after.Size() != total || after.ModTime() != info.ModTime() || !os.SameFile(info, after) {
		return "", total, fmt.Errorf("%s changed while it was being hashed", path)
	}
	return hex.EncodeToString(hasher.Sum(nil)), total, nil
}

// verifyModelObject proves the published object for digest is a plain regular
// file whose bytes hash to digest. size < 0 skips the size check. It returns
// the object's physical identity and verified size; ErrNotExist when absent.
func verifyModelObject(modelsRoot string, digest string, size int64, onProgress func(int64) error) (modelFileIdentity, int64, error) {
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return modelFileIdentity{}, 0, err
	}
	identity, info, err := modelFileIdentityOf(objectPath)
	if err != nil {
		return modelFileIdentity{}, 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return modelFileIdentity{}, 0, fmt.Errorf("model object %s is not a plain regular file", digest)
	}
	if size >= 0 && info.Size() != size {
		return modelFileIdentity{}, 0, fmt.Errorf("model object %s size %d differs from declared %d", digest, info.Size(), size)
	}
	actual, verifiedSize, err := hashRegularFile(objectPath, onProgress)
	if err != nil {
		return modelFileIdentity{}, 0, fmt.Errorf("verify model object %s: %w", digest, err)
	}
	if !strings.EqualFold(actual, normalizeExactSHA256Hex(digest)) {
		return modelFileIdentity{}, 0, fmt.Errorf("model object %s content does not match its key", digest)
	}
	return identity, verifiedSize, nil
}

// modelObjectPresent reports whether an object path exists as a plain file
// with the expected size, without reading its bytes. Presence is never proof
// of health; callers that reuse content verify by reading.
func modelObjectPresent(modelsRoot string, digest string) (bool, os.FileInfo, error) {
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return false, nil, err
	}
	info, err := os.Lstat(objectPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return false, nil, fmt.Errorf("model object %s is not a plain regular file", digest)
	}
	return true, info, nil
}

// publishModelObjectIfAbsent links a Runtime-verified staged file into the
// object area. The staged file must already have been fully hashed by this
// intake and have its non-executable permission applied. When another object
// already occupies the digest path it is verified by reading and the staged
// file yields to it; a corrupt occupant is a generation conflict that the
// caller reports rather than overwrites. It returns the object identity and
// whether this call published the object.
func publishModelObjectIfAbsent(modelsRoot string, digest string, stagedPath string) (modelFileIdentity, bool, error) {
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return modelFileIdentity{}, false, err
	}
	stagedIdentity, stagedInfo, err := modelFileIdentityOf(stagedPath)
	if err != nil {
		return modelFileIdentity{}, false, fmt.Errorf("inspect staged model file: %w", err)
	}
	if !stagedInfo.Mode().IsRegular() || stagedInfo.Mode()&os.ModeSymlink != 0 {
		return modelFileIdentity{}, false, errors.New("staged model file is not a plain regular file")
	}
	if err := os.MkdirAll(filepath.Dir(objectPath), 0o755); err != nil {
		return modelFileIdentity{}, false, fmt.Errorf("prepare model object directory: %w", err)
	}
	linkErr := os.Link(stagedPath, objectPath)
	if linkErr == nil {
		identity, _, err := modelFileIdentityOf(objectPath)
		if err != nil {
			return modelFileIdentity{}, false, fmt.Errorf("inspect published model object: %w", err)
		}
		if identity != stagedIdentity {
			return modelFileIdentity{}, false, errors.New("published model object identity differs from its staged source")
		}
		return identity, true, nil
	}
	if !errors.Is(linkErr, os.ErrExist) {
		return modelFileIdentity{}, false, fmt.Errorf("publish model object %s: %w", digest, linkErr)
	}
	identity, _, err := verifyModelObject(modelsRoot, digest, stagedInfo.Size(), nil)
	if err != nil {
		return modelFileIdentity{}, false, fmt.Errorf("existing model object %s cannot be reused: %w", digest, err)
	}
	return identity, false, nil
}

// linkModelObjectIntoView creates the view path as a hard link to the object.
// The view path must not exist; an existing entry is a layout conflict.
func linkModelObjectIntoView(modelsRoot string, digest string, viewPath string) (modelFileIdentity, error) {
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return modelFileIdentity{}, err
	}
	if err := os.MkdirAll(filepath.Dir(viewPath), 0o755); err != nil {
		return modelFileIdentity{}, fmt.Errorf("prepare view directory: %w", err)
	}
	if err := os.Link(objectPath, viewPath); err != nil {
		return modelFileIdentity{}, fmt.Errorf("link model object %s into view: %w", digest, err)
	}
	identity, _, err := modelFileIdentityOf(viewPath)
	if err != nil {
		return modelFileIdentity{}, fmt.Errorf("inspect linked view file: %w", err)
	}
	return identity, nil
}

// viewFileLinkedToObject reports whether the view path and the object path for
// digest are one physical file. A missing object or view is reported as not
// linked with the underlying error.
func viewFileLinkedToObject(modelsRoot string, digest string, viewPath string) (bool, modelFileIdentity, error) {
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return false, modelFileIdentity{}, err
	}
	viewIdentity, viewInfo, err := modelFileIdentityOf(viewPath)
	if err != nil {
		return false, modelFileIdentity{}, err
	}
	if !viewInfo.Mode().IsRegular() || viewInfo.Mode()&os.ModeSymlink != 0 {
		return false, viewIdentity, errors.New("view file is not a plain regular file")
	}
	objectIdentity, objectInfo, err := modelFileIdentityOf(objectPath)
	if err != nil {
		return false, viewIdentity, err
	}
	if !objectInfo.Mode().IsRegular() || objectInfo.Mode()&os.ModeSymlink != 0 {
		return false, viewIdentity, errors.New("model object is not a plain regular file")
	}
	return viewIdentity == objectIdentity, viewIdentity, nil
}

// normalizeModelPayloadPermissionsBeforePublish applies the shared-content
// permission policy once, before the file becomes a published object: code
// files and files carrying an execute bit lose execution. Published objects,
// views, and every later verification are read-only with respect to mode.
func normalizeModelPayloadPermissionsBeforePublish(path string, relativePath string) (bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return false, err
	}
	_, codeExtension := modelAssetCodeExtensions[strings.ToLower(filepath.Ext(relativePath))]
	code := codeExtension || info.Mode().Perm()&0o111 != 0
	if code {
		if err := os.Chmod(path, 0o600); err != nil {
			return false, fmt.Errorf("mark code file as non-executable content: %w", err)
		}
	}
	return code, nil
}

// --- in-process object coordination -------------------------------------

// acquireModelObjectWriter grants transferID the single active writer for a
// digest. Another transfer's active writer yields an in-progress conflict; a
// durable prefix held by another live transfer yields a resume-required
// conflict. The grant records a prefix hold for transferID.
func (s *Service) acquireModelObjectWriter(digest string, transferID string) *modelObjectConflict {
	key := normalizeExactSHA256Hex(digest)
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if owner, active := s.modelObjectWriters[key]; active && owner != transferID {
		return &modelObjectConflict{Kind: modelObjectConflictInProgress, Digest: key, RelatedTransferID: owner}
	}
	for holder, kind := range s.modelObjectHolds[key] {
		if holder == transferID || kind != modelObjectHoldPrefix {
			continue
		}
		return &modelObjectConflict{Kind: modelObjectConflictResumeRequired, Digest: key, RelatedTransferID: holder}
	}
	if s.modelObjectWriters == nil {
		s.modelObjectWriters = make(map[string]string)
	}
	s.modelObjectWriters[key] = transferID
	s.addModelObjectHoldLocked(key, transferID, modelObjectHoldPrefix)
	return nil
}

// releaseModelObjectWriter ends transferID's active writer for digest. The
// prefix hold stays until the transfer publishes (pin) or cleans its staging.
func (s *Service) releaseModelObjectWriter(digest string, transferID string) {
	key := normalizeExactSHA256Hex(digest)
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if owner, active := s.modelObjectWriters[key]; active && owner == transferID {
		delete(s.modelObjectWriters, key)
	}
}

func (s *Service) addModelObjectHoldLocked(digest string, transferID string, kind string) {
	if s.modelObjectHolds == nil {
		s.modelObjectHolds = make(map[string]map[string]string)
	}
	holders := s.modelObjectHolds[digest]
	if holders == nil {
		holders = make(map[string]string)
		s.modelObjectHolds[digest] = holders
	}
	holders[transferID] = kind
}

// pinModelObject converts or creates an object hold: the transfer references
// a published object until its result commits or it is cancelled.
func (s *Service) pinModelObject(digest string, transferID string) {
	key := normalizeExactSHA256Hex(digest)
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if owner, active := s.modelObjectWriters[key]; active && owner == transferID {
		delete(s.modelObjectWriters, key)
	}
	s.addModelObjectHoldLocked(key, transferID, modelObjectHoldObject)
}

// Guard a potentially published object before inspecting its path. Preserve
// an existing prefix/writer claim until publication is actually verified.
func (s *Service) holdModelObjectForVerification(digest string, transferID string) {
	key := normalizeExactSHA256Hex(digest)
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if _, held := s.modelObjectHolds[key][transferID]; !held {
		s.addModelObjectHoldLocked(key, transferID, modelObjectHoldObject)
	}
}

// Persist the claim before writing a prefix or exposing a published object.
// A restart must not lose the only owner of partially acquired content.
func (s *Service) persistModelObjectHolds(transferID string) error {
	if strings.TrimSpace(transferID) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.transferPrivateLocked(transferID).cancelRequested {
		return errLocalTransferCancelled
	}
	if err := s.persistStateLocked(); err != nil {
		return localTransferPersistenceError(err)
	}
	return nil
}

// releaseModelObjectWriters drops only the active writer grants of a transfer
// whose executor exited; its prefix holds stay durable for an explicit resume
// and a concurrent acquisition of the same digest now sees resume-required.
func (s *Service) releaseModelObjectWriters(transferID string) {
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	for digest, owner := range s.modelObjectWriters {
		if owner == transferID {
			delete(s.modelObjectWriters, digest)
		}
	}
}

// releaseModelObjectHolds drops every hold and writer grant transferID owns.
func (s *Service) releaseModelObjectHolds(transferID string) {
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	for digest, owner := range s.modelObjectWriters {
		if owner == transferID {
			delete(s.modelObjectWriters, digest)
		}
	}
	for digest, holders := range s.modelObjectHolds {
		delete(holders, transferID)
		if len(holders) == 0 {
			delete(s.modelObjectHolds, digest)
		}
	}
}

// restoreModelObjectHolds rehydrates durable holds for a restored transfer
// without granting it an active writer.
func (s *Service) restoreModelObjectHolds(transferID string, holds []modelObjectHold) {
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	for _, hold := range holds {
		key := normalizeExactSHA256Hex(hold.Digest)
		if key == "" {
			continue
		}
		kind := hold.Kind
		if kind != modelObjectHoldObject {
			kind = modelObjectHoldPrefix
		}
		s.addModelObjectHoldLocked(key, transferID, kind)
	}
}

func (s *Service) modelObjectHoldsForTransfer(transferID string) []modelObjectHold {
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	holds := make([]modelObjectHold, 0)
	for digest, holders := range s.modelObjectHolds {
		if kind, held := holders[transferID]; held {
			holds = append(holds, modelObjectHold{Digest: digest, Kind: kind})
		}
	}
	sort.Slice(holds, func(i, j int) bool { return holds[i].Digest < holds[j].Digest })
	return holds
}

// modelObjectHeldByOthers reports whether any transfer other than exclude
// holds the digest (prefix or object) or is its active writer.
func (s *Service) modelObjectHeldByOthers(digest string, exclude string) bool {
	key := normalizeExactSHA256Hex(digest)
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if owner, active := s.modelObjectWriters[key]; active && owner != exclude {
		return true
	}
	for holder := range s.modelObjectHolds[key] {
		if holder != exclude {
			return true
		}
	}
	return false
}

// --- ModelAsset use pins ---------------------------------------------------

// AcquireModelAssetUse is the localexecution.ModelAssetUseHolder surface.
func (s *Service) AcquireModelAssetUse(modelAssetID string, holder string) func() {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.RLock()
	asset := s.modelAssets[strings.TrimSpace(modelAssetID)]
	s.mu.RUnlock()
	if asset == nil {
		return nil
	}
	return s.acquireModelAssetUse(modelAssetID, holder)
}

// acquireModelAssetUse records that holder (a Job admission, a persisted Job,
// or an ExecutionHost) is using the asset's directory. Cleanup waits for every
// use to be released before removing the view. The returned release function
// is idempotent.
func (s *Service) acquireModelAssetUse(modelAssetID string, holder string) func() {
	id := strings.TrimSpace(modelAssetID)
	token := strings.TrimSpace(holder)
	if id == "" || token == "" {
		return func() {}
	}
	s.modelObjectMu.Lock()
	if s.modelAssetUses == nil {
		s.modelAssetUses = make(map[string]map[string]int)
	}
	users := s.modelAssetUses[id]
	if users == nil {
		users = make(map[string]int)
		s.modelAssetUses[id] = users
	}
	users[token]++
	s.modelObjectMu.Unlock()
	released := false
	return func() {
		s.modelObjectMu.Lock()
		if !released {
			released = true
			if users := s.modelAssetUses[id]; users != nil {
				users[token]--
				if users[token] <= 0 {
					delete(users, token)
				}
				if len(users) == 0 {
					delete(s.modelAssetUses, id)
				}
			}
		}
		s.modelObjectMu.Unlock()
		s.retryModelAssetCleanupObligation(id)
	}
}

func (s *Service) modelAssetUseHolders(modelAssetID string) []string {
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	holders := make([]string, 0, len(s.modelAssetUses[modelAssetID]))
	for holder := range s.modelAssetUses[modelAssetID] {
		holders = append(holders, holder)
	}
	sort.Strings(holders)
	return holders
}
