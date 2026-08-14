package appstorage

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	AssetDefaultPageSize        = 100
	AssetMaxPageSize            = 500
	AssetChunkBytes             = 1024 * 1024
	AssetDefaultMaxObjectBytes  = int64(8 * 1024 * 1024 * 1024)
	AssetDefaultMaxOwnerBytes   = int64(64 * 1024 * 1024 * 1024)
	AssetDefaultMaxOwnerObjects = int64(100000)
	AssetDefaultMinFreeBytes    = int64(1024 * 1024 * 1024)
	AssetDefaultActiveStreams   = 16

	assetObjectName       = "object.asset"
	assetFooterMagic      = "NIMIAS01"
	assetFooterTrailerLen = 12
	assetMaxMetadataBytes = 16 * 1024
)

var (
	ErrAssetNotFound      = errors.New("managed App asset not found")
	ErrAssetAlreadyExists = errors.New("managed App asset already exists")
	ErrAssetQuota         = errors.New("managed App asset quota exceeded")
	ErrAssetTooLarge      = errors.New("managed App asset is too large")
	ErrAssetUnavailable   = errors.New("managed App asset storage is unavailable")
	ErrAssetCorrupt       = errors.New("managed App asset is corrupt")
	ErrAssetCursorInvalid = errors.New("managed App asset cursor is invalid")
	ErrAssetMediaInvalid  = errors.New("managed App asset media type is invalid")
)

type AssetPolicy struct {
	MaxObjectBytes  int64
	MaxOwnerBytes   int64
	MaxOwnerObjects int64
	MinFreeBytes    int64
	ActiveStreams   int
}

func (policy AssetPolicy) normalized() AssetPolicy {
	if policy.MaxObjectBytes <= 0 {
		policy.MaxObjectBytes = AssetDefaultMaxObjectBytes
	}
	if policy.MaxOwnerBytes <= 0 {
		policy.MaxOwnerBytes = AssetDefaultMaxOwnerBytes
	}
	if policy.MaxOwnerObjects <= 0 {
		policy.MaxOwnerObjects = AssetDefaultMaxOwnerObjects
	}
	if policy.MinFreeBytes <= 0 {
		policy.MinFreeBytes = AssetDefaultMinFreeBytes
	}
	if policy.ActiveStreams <= 0 {
		policy.ActiveStreams = AssetDefaultActiveStreams
	}
	return policy
}

type AssetRecord struct {
	RelativePath string
	MediaType    string
	SizeBytes    int64
	SHA256       string
	CreatedAt    time.Time
	ModifiedAt   time.Time
}

type AssetListPage struct {
	Assets     []AssetRecord
	NextCursor string
}

type AssetSource struct {
	Record AssetRecord
	Body   io.ReadSeekCloser
}

// VerifiedAssetInput is a Runtime-custody source whose public target metadata
// must match the bytes observed during the copy before commit.
type VerifiedAssetInput struct {
	MediaType string
	SizeBytes int64
	SHA256    string
	Body      io.ReadCloser
}

type assetDiskMetadata struct {
	MediaType  string    `json:"media_type,omitempty"`
	SizeBytes  int64     `json:"size_bytes"`
	SHA256     string    `json:"sha256"`
	CreatedAt  time.Time `json:"created_at"`
	ModifiedAt time.Time `json:"modified_at"`
}

type assetOwnerState struct {
	quotaMu sync.Mutex
	streams chan struct{}
}

// @nimi-authority: definition.nimi.runtime.app-surface.app-projection-plane
type AssetStore struct {
	dataRoot  string
	baseRoot  string
	policy    AssetPolicy
	cursorKey [32]byte

	mu        sync.Mutex
	owners    map[string]*assetOwnerState
	pathLocks map[string]*sync.Mutex
}

func NewAssetStore(dataRootRef string, policy AssetPolicy) (*AssetStore, error) {
	dataRootRef = filepath.Clean(strings.TrimSpace(dataRootRef))
	if dataRootRef == "." || dataRootRef == "" || !filepath.IsAbs(dataRootRef) {
		return nil, ErrAssetUnavailable
	}
	baseRoot := filepath.Join(dataRootRef, managedStorageDirectory, "v1")
	if err := materializeRoot(dataRootRef, baseRoot); err != nil {
		return nil, ErrAssetUnavailable
	}
	store := &AssetStore{
		dataRoot: dataRootRef, baseRoot: baseRoot, policy: policy.normalized(),
		owners: make(map[string]*assetOwnerState), pathLocks: make(map[string]*sync.Mutex),
	}
	if _, err := rand.Read(store.cursorKey[:]); err != nil {
		return nil, ErrAssetUnavailable
	}
	if err := store.cleanupAbandonedCandidates(); err != nil {
		return nil, err
	}
	return store, nil
}

func (store *AssetStore) Write(
	ctx context.Context,
	owner ManagedOwner,
	relativePath string,
	mediaType string,
	overwrite bool,
	source io.ReadCloser,
) (AssetRecord, error) {
	return store.write(ctx, owner, relativePath, mediaType, overwrite, source, nil)
}

func (store *AssetStore) Adopt(
	ctx context.Context,
	owner ManagedOwner,
	relativePath string,
	overwrite bool,
	input VerifiedAssetInput,
) (AssetRecord, error) {
	verification := &assetVerification{SizeBytes: input.SizeBytes, SHA256: strings.ToLower(strings.TrimSpace(input.SHA256))}
	return store.write(ctx, owner, relativePath, input.MediaType, overwrite, input.Body, verification)
}

type assetVerification struct {
	SizeBytes int64
	SHA256    string
}

func (store *AssetStore) write(
	ctx context.Context,
	owner ManagedOwner,
	relativePath string,
	mediaType string,
	overwrite bool,
	source io.ReadCloser,
	verification *assetVerification,
) (AssetRecord, error) {
	if ctx == nil || source == nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	defer func() { _ = source.Close() }()
	normalizedPath, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return AssetRecord{}, err
	}
	normalizedMedia, err := normalizeAssetMediaType(mediaType)
	if err != nil {
		return AssetRecord{}, err
	}
	if verification != nil && verification.SizeBytes > store.policy.MaxObjectBytes {
		return AssetRecord{}, ErrAssetTooLarge
	}
	if verification != nil && (verification.SizeBytes < 0 ||
		len(verification.SHA256) != len("sha256:")+sha256.Size*2 || !strings.HasPrefix(verification.SHA256, "sha256:") ||
		verification.SHA256 != strings.ToLower(verification.SHA256)) {
		return AssetRecord{}, ErrAssetCorrupt
	}
	if verification != nil {
		if _, err := hex.DecodeString(strings.TrimPrefix(verification.SHA256, "sha256:")); err != nil {
			return AssetRecord{}, ErrAssetCorrupt
		}
	}
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return AssetRecord{}, err
	}
	state, ownerKey := store.ownerState(normalizedOwner)
	if err := acquireAssetStream(ctx, state); err != nil {
		return AssetRecord{}, err
	}
	defer releaseAssetStream(state)
	unlock := store.lockAssetPaths(ownerKey, normalizedPath)
	defer unlock()

	objectsRoot, candidatesRoot, err := store.materializeAssetRoots(ownerRoot)
	if err != nil {
		return AssetRecord{}, err
	}
	target, err := encodedLogicalPath(objectsRoot, normalizedPath, assetObjectName)
	if err != nil {
		return AssetRecord{}, err
	}
	existing, existingErr := store.readRecord(ctx, objectsRoot, target)
	if existingErr == nil && !overwrite {
		return AssetRecord{}, ErrAssetAlreadyExists
	}
	if existingErr != nil && !errors.Is(existingErr, ErrAssetNotFound) {
		return AssetRecord{}, existingErr
	}

	candidate, err := os.CreateTemp(candidatesRoot, ".asset-candidate-*")
	if err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	candidatePath := candidate.Name()
	committed := false
	defer func() {
		_ = candidate.Close()
		if !committed {
			_ = os.Remove(candidatePath)
		}
	}()
	if err := candidate.Chmod(0o600); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	hasher := sha256.New()
	sizeBytes, err := copyAssetBody(ctx, candidate, hasher, source, store.policy.MaxObjectBytes)
	if err != nil {
		return AssetRecord{}, err
	}
	observedDigest := "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	if verification != nil && (sizeBytes != verification.SizeBytes || observedDigest != verification.SHA256) {
		return AssetRecord{}, ErrAssetCorrupt
	}
	now := time.Now().UTC()
	createdAt := now
	if existingErr == nil {
		createdAt = existing.CreatedAt
	}
	metadata := assetDiskMetadata{
		MediaType: normalizedMedia, SizeBytes: sizeBytes,
		SHA256: observedDigest, CreatedAt: createdAt, ModifiedAt: now,
	}
	if err := appendAssetFooter(candidate, metadata); err != nil {
		return AssetRecord{}, err
	}
	if err := candidate.Sync(); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	if err := candidate.Close(); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}

	state.quotaMu.Lock()
	defer state.quotaMu.Unlock()
	usageBytes, usageObjects, usageErr := store.reconcileOwnerUsage(ctx, objectsRoot)
	if usageErr != nil {
		return AssetRecord{}, usageErr
	}
	existingBytes := int64(0)
	if existingErr == nil {
		existingBytes = existing.SizeBytes
	}
	newObjects := usageObjects
	if existingErr != nil {
		newObjects++
	}
	if usageBytes-existingBytes+sizeBytes > store.policy.MaxOwnerBytes || newObjects > store.policy.MaxOwnerObjects {
		return AssetRecord{}, ErrAssetQuota
	}
	availableBytes, freeErr := availableDiskBytes(store.dataRoot)
	if freeErr != nil || availableBytes < store.policy.MinFreeBytes {
		return AssetRecord{}, ErrAssetUnavailable
	}
	if _, err := ensureManagedParent(objectsRoot, target, true); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	if err := replaceLocalAppJSONFile(candidatePath, target); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	committed = true
	return metadata.public(normalizedPath), nil
}

func (store *AssetStore) Stat(ctx context.Context, owner ManagedOwner, relativePath string) (AssetRecord, error) {
	normalizedPath, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return AssetRecord{}, err
	}
	ownerRoot, _, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return AssetRecord{}, err
	}
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	target, err := encodedLogicalPath(objectsRoot, normalizedPath, assetObjectName)
	if err != nil {
		return AssetRecord{}, err
	}
	return store.readRecord(ctx, objectsRoot, target)
}

func (store *AssetStore) Open(ctx context.Context, owner ManagedOwner, relativePath string) (*AssetSource, error) {
	normalizedPath, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return nil, err
	}
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return nil, err
	}
	state, _ := store.ownerState(normalizedOwner)
	if err := acquireAssetStream(ctx, state); err != nil {
		return nil, err
	}
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	target, err := encodedLogicalPath(objectsRoot, normalizedPath, assetObjectName)
	if err != nil {
		releaseAssetStream(state)
		return nil, err
	}
	file, metadata, err := openAndVerifyAsset(ctx, target)
	if err != nil {
		releaseAssetStream(state)
		return nil, err
	}
	body := &assetFileBody{
		reader: io.NewSectionReader(file, 0, metadata.SizeBytes), file: file, ctx: ctx,
		release: func() { releaseAssetStream(state) },
	}
	return &AssetSource{Record: metadata.public(normalizedPath), Body: body}, nil
}

func (store *AssetStore) List(ctx context.Context, owner ManagedOwner, prefix string, cursor string, pageSize int) (AssetListPage, error) {
	normalizedPrefix, err := NormalizeAssetListPrefix(prefix)
	if err != nil {
		return AssetListPage{}, err
	}
	if pageSize == 0 {
		pageSize = AssetDefaultPageSize
	}
	if pageSize < 1 || pageSize > AssetMaxPageSize {
		return AssetListPage{}, ErrAssetCursorInvalid
	}
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return AssetListPage{}, err
	}
	ownerKey := managedOwnerKey(normalizedOwner)
	after := ""
	if cursor != "" {
		payload, err := store.parseCursor(cursor)
		if err != nil || payload.OwnerKey != ownerKey || payload.Prefix != normalizedPrefix {
			return AssetListPage{}, ErrAssetCursorInvalid
		}
		after = payload.After
	}
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	records, err := store.listRecords(ctx, objectsRoot, normalizedPrefix)
	if err != nil {
		return AssetListPage{}, err
	}
	sort.Slice(records, func(left, right int) bool { return records[left].RelativePath < records[right].RelativePath })
	start := sort.Search(len(records), func(index int) bool { return records[index].RelativePath > after })
	end := start + pageSize
	if end > len(records) {
		end = len(records)
	}
	page := AssetListPage{Assets: append([]AssetRecord(nil), records[start:end]...)}
	if end < len(records) && len(page.Assets) > 0 {
		page.NextCursor, err = store.issueCursor(assetCursorPayload{OwnerKey: ownerKey, Prefix: normalizedPrefix, After: page.Assets[len(page.Assets)-1].RelativePath})
		if err != nil {
			return AssetListPage{}, err
		}
	}
	return page, nil
}

func (store *AssetStore) Remove(ctx context.Context, owner ManagedOwner, relativePath string) (bool, error) {
	normalizedPath, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return false, err
	}
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return false, err
	}
	state, ownerKey := store.ownerState(normalizedOwner)
	unlock := store.lockAssetPaths(ownerKey, normalizedPath)
	defer unlock()
	state.quotaMu.Lock()
	defer state.quotaMu.Unlock()
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	target, err := encodedLogicalPath(objectsRoot, normalizedPath, assetObjectName)
	if err != nil {
		return false, err
	}
	if _, err := store.readRecord(ctx, objectsRoot, target); errors.Is(err, ErrAssetNotFound) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := os.Remove(target); err != nil {
		return false, ErrAssetUnavailable
	}
	removeEmptyAssetParents(objectsRoot, filepath.Dir(target))
	return true, nil
}

func (store *AssetStore) Move(ctx context.Context, owner ManagedOwner, from string, to string, overwrite bool) (AssetRecord, error) {
	fromPath, err := NormalizeAssetRelativePath(from)
	if err != nil {
		return AssetRecord{}, err
	}
	toPath, err := NormalizeAssetRelativePath(to)
	if err != nil || fromPath == toPath {
		return AssetRecord{}, ErrAssetPathInvalid
	}
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return AssetRecord{}, err
	}
	state, ownerKey := store.ownerState(normalizedOwner)
	unlock := store.lockAssetPaths(ownerKey, fromPath, toPath)
	defer unlock()
	state.quotaMu.Lock()
	defer state.quotaMu.Unlock()
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	fromTarget, _ := encodedLogicalPath(objectsRoot, fromPath, assetObjectName)
	toTarget, _ := encodedLogicalPath(objectsRoot, toPath, assetObjectName)
	record, err := store.readRecord(ctx, objectsRoot, fromTarget)
	if err != nil {
		return AssetRecord{}, err
	}
	if _, targetErr := store.readRecord(ctx, objectsRoot, toTarget); targetErr == nil && !overwrite {
		return AssetRecord{}, ErrAssetAlreadyExists
	} else if targetErr != nil && !errors.Is(targetErr, ErrAssetNotFound) {
		return AssetRecord{}, targetErr
	}
	if _, err := ensureManagedParent(objectsRoot, toTarget, true); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	if err := replaceLocalAppJSONFile(fromTarget, toTarget); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	removeEmptyAssetParents(objectsRoot, filepath.Dir(fromTarget))
	record.RelativePath = toPath
	return record, nil
}

func (store *AssetStore) Usage(ctx context.Context, owner ManagedOwner) (int64, int64, error) {
	ownerRoot, normalizedOwner, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return 0, 0, err
	}
	state, _ := store.ownerState(normalizedOwner)
	state.quotaMu.Lock()
	defer state.quotaMu.Unlock()
	return store.reconcileOwnerUsage(ctx, filepath.Join(ownerRoot, "assets", "objects"))
}

func (store *AssetStore) ownerState(owner ManagedOwner) (*assetOwnerState, string) {
	key := managedOwnerKey(owner)
	store.mu.Lock()
	defer store.mu.Unlock()
	state := store.owners[key]
	if state == nil {
		state = &assetOwnerState{streams: make(chan struct{}, store.policy.ActiveStreams)}
		store.owners[key] = state
	}
	return state, key
}

func managedOwnerKey(owner ManagedOwner) string {
	digest := sha256.Sum256([]byte(owner.AccountID + "\x00" + owner.RegisteredAppSubject))
	return hex.EncodeToString(digest[:])
}

func (store *AssetStore) lockAssetPaths(ownerKey string, paths ...string) func() {
	keys := append([]string(nil), paths...)
	sort.Strings(keys)
	locks := make([]*sync.Mutex, 0, len(keys))
	store.mu.Lock()
	for _, path := range keys {
		key := ownerKey + "\x00" + path
		lock := store.pathLocks[key]
		if lock == nil {
			lock = &sync.Mutex{}
			store.pathLocks[key] = lock
		}
		locks = append(locks, lock)
	}
	store.mu.Unlock()
	for _, lock := range locks {
		lock.Lock()
	}
	return func() {
		for index := len(locks) - 1; index >= 0; index-- {
			locks[index].Unlock()
		}
	}
}

func acquireAssetStream(ctx context.Context, state *assetOwnerState) error {
	select {
	case state.streams <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func releaseAssetStream(state *assetOwnerState) { <-state.streams }

func (store *AssetStore) materializeAssetRoots(ownerRoot string) (string, string, error) {
	objectsRoot := filepath.Join(ownerRoot, "assets", "objects")
	candidatesRoot := filepath.Join(ownerRoot, "internal", "asset-candidates")
	for _, root := range []string{objectsRoot, candidatesRoot} {
		if err := materializeRoot(store.dataRoot, root); err != nil {
			return "", "", ErrAssetUnavailable
		}
	}
	return objectsRoot, candidatesRoot, nil
}

func (store *AssetStore) cleanupAbandonedCandidates() error {
	return filepath.WalkDir(store.baseRoot, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return ErrAssetUnavailable
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrAssetUnavailable
		}
		if !entry.IsDir() || entry.Name() != "asset-candidates" || filepath.Base(filepath.Dir(current)) != "internal" {
			return nil
		}
		children, err := os.ReadDir(current)
		if err != nil {
			return ErrAssetUnavailable
		}
		for _, child := range children {
			target := filepath.Join(current, child.Name())
			if child.IsDir() || child.Type()&os.ModeSymlink != 0 {
				return ErrAssetUnavailable
			}
			if err := os.Remove(target); err != nil {
				return ErrAssetUnavailable
			}
		}
		return filepath.SkipDir
	})
}

func (store *AssetStore) readRecord(ctx context.Context, objectsRoot string, target string) (AssetRecord, error) {
	if _, err := ensureManagedParent(objectsRoot, target, false); err != nil {
		return AssetRecord{}, ErrAssetUnavailable
	} else if _, statErr := os.Lstat(target); errors.Is(statErr, os.ErrNotExist) {
		return AssetRecord{}, ErrAssetNotFound
	}
	logical, err := decodeLogicalPath(objectsRoot, target, assetObjectName)
	if err != nil {
		return AssetRecord{}, ErrAssetCorrupt
	}
	file, metadata, err := openAssetMetadata(target)
	if err != nil {
		return AssetRecord{}, err
	}
	if closeErr := file.Close(); closeErr != nil {
		return AssetRecord{}, ErrAssetUnavailable
	}
	return metadata.public(logical), nil
}

func openAndVerifyAsset(ctx context.Context, target string) (*os.File, assetDiskMetadata, error) {
	file, metadata, err := openAssetMetadata(target)
	if err != nil {
		return nil, assetDiskMetadata{}, err
	}
	fail := func(result error) (*os.File, assetDiskMetadata, error) {
		_ = file.Close()
		return nil, assetDiskMetadata{}, result
	}
	hasher := sha256.New()
	if _, err := copyAssetReader(ctx, io.Discard, hasher, io.NewSectionReader(file, 0, metadata.SizeBytes), metadata.SizeBytes); err != nil {
		return fail(err)
	}
	if !strings.EqualFold(metadata.SHA256, "sha256:"+hex.EncodeToString(hasher.Sum(nil))) {
		return fail(ErrAssetCorrupt)
	}
	return file, metadata, nil
}

// openAssetMetadata validates the self-contained committed record without
// reading its payload. Stat and list therefore remain metadata operations;
// body integrity is verified by Open before any read metadata is emitted.
func openAssetMetadata(target string) (*os.File, assetDiskMetadata, error) {
	linkInfo, linkErr := os.Lstat(target)
	if errors.Is(linkErr, os.ErrNotExist) {
		return nil, assetDiskMetadata{}, ErrAssetNotFound
	}
	if linkErr != nil || linkInfo.Mode()&os.ModeSymlink != 0 || !linkInfo.Mode().IsRegular() {
		return nil, assetDiskMetadata{}, ErrAssetCorrupt
	}
	file, err := openCommittedAssetFile(target)
	if errors.Is(err, os.ErrNotExist) {
		return nil, assetDiskMetadata{}, ErrAssetNotFound
	}
	if err != nil {
		return nil, assetDiskMetadata{}, ErrAssetUnavailable
	}
	fail := func(result error) (*os.File, assetDiskMetadata, error) {
		_ = file.Close()
		return nil, assetDiskMetadata{}, result
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < assetFooterTrailerLen {
		return fail(ErrAssetCorrupt)
	}
	trailer := make([]byte, assetFooterTrailerLen)
	if _, err := file.ReadAt(trailer, info.Size()-assetFooterTrailerLen); err != nil || string(trailer[4:]) != assetFooterMagic {
		return fail(ErrAssetCorrupt)
	}
	metadataSize := int64(binary.BigEndian.Uint32(trailer[:4]))
	if metadataSize <= 0 || metadataSize > assetMaxMetadataBytes || metadataSize+assetFooterTrailerLen > info.Size() {
		return fail(ErrAssetCorrupt)
	}
	metadataBytes := make([]byte, metadataSize)
	metadataOffset := info.Size() - assetFooterTrailerLen - metadataSize
	if _, err := file.ReadAt(metadataBytes, metadataOffset); err != nil {
		return fail(ErrAssetCorrupt)
	}
	var metadata assetDiskMetadata
	if err := json.Unmarshal(metadataBytes, &metadata); err != nil || metadata.SizeBytes != metadataOffset ||
		metadata.SizeBytes < 0 || metadata.SHA256 == "" || metadata.CreatedAt.IsZero() || metadata.ModifiedAt.IsZero() {
		return fail(ErrAssetCorrupt)
	}
	normalizedMediaType, mediaErr := normalizeAssetMediaType(metadata.MediaType)
	if mediaErr != nil || normalizedMediaType != metadata.MediaType || len(metadata.SHA256) != len("sha256:")+sha256.Size*2 ||
		!strings.HasPrefix(metadata.SHA256, "sha256:") {
		return fail(ErrAssetCorrupt)
	}
	if _, digestErr := hex.DecodeString(strings.TrimPrefix(metadata.SHA256, "sha256:")); digestErr != nil || metadata.SHA256 != strings.ToLower(metadata.SHA256) {
		return fail(ErrAssetCorrupt)
	}
	return file, metadata, nil
}

func (store *AssetStore) listRecords(ctx context.Context, objectsRoot string, prefix string) ([]AssetRecord, error) {
	if info, err := os.Lstat(objectsRoot); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, ErrAssetUnavailable
	}
	records := make([]AssetRecord, 0)
	err := filepath.WalkDir(objectsRoot, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return ErrAssetUnavailable
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrAssetCorrupt
		}
		if entry.IsDir() || entry.Name() != assetObjectName {
			return nil
		}
		logical, err := decodeLogicalPath(objectsRoot, current, assetObjectName)
		if err != nil {
			return ErrAssetCorrupt
		}
		if prefix != "" && logical != prefix && !(strings.HasSuffix(prefix, "/") && strings.HasPrefix(logical, prefix)) {
			return nil
		}
		record, err := store.readRecord(ctx, objectsRoot, current)
		if errors.Is(err, ErrAssetNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		records = append(records, record)
		return nil
	})
	return records, err
}

func (store *AssetStore) reconcileOwnerUsage(ctx context.Context, objectsRoot string) (int64, int64, error) {
	records, err := store.listRecords(ctx, objectsRoot, "")
	if err != nil {
		return 0, 0, err
	}
	var bytesUsed int64
	for _, record := range records {
		if record.SizeBytes < 0 || bytesUsed > store.policy.MaxOwnerBytes-record.SizeBytes {
			return 0, 0, ErrAssetQuota
		}
		bytesUsed += record.SizeBytes
	}
	return bytesUsed, int64(len(records)), nil
}

func normalizeAssetMediaType(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if len([]byte(value)) > 255 || strings.IndexFunc(value, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
		return "", ErrAssetMediaInvalid
	}
	if _, _, err := mime.ParseMediaType(value); err != nil {
		return "", ErrAssetMediaInvalid
	}
	return value, nil
}

func copyAssetBody(ctx context.Context, destination io.Writer, hasher hash.Hash, source io.Reader, limit int64) (int64, error) {
	return copyAssetReader(ctx, io.MultiWriter(destination, hasher), nil, source, limit)
}

func copyAssetReader(ctx context.Context, destination io.Writer, hasher hash.Hash, source io.Reader, limit int64) (int64, error) {
	buffer := make([]byte, AssetChunkBytes)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			total += int64(read)
			if total > limit {
				return total, ErrAssetTooLarge
			}
			if _, err := destination.Write(buffer[:read]); err != nil {
				return total, ErrAssetUnavailable
			}
			if hasher != nil {
				_, _ = hasher.Write(buffer[:read])
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return total, nil
			}
			return total, readErr
		}
	}
}

func appendAssetFooter(file *os.File, metadata assetDiskMetadata) error {
	encoded, err := json.Marshal(metadata)
	if err != nil || len(encoded) == 0 || len(encoded) > assetMaxMetadataBytes {
		return ErrAssetUnavailable
	}
	if _, err := file.Write(encoded); err != nil {
		return ErrAssetUnavailable
	}
	trailer := make([]byte, assetFooterTrailerLen)
	binary.BigEndian.PutUint32(trailer[:4], uint32(len(encoded)))
	copy(trailer[4:], assetFooterMagic)
	if _, err := file.Write(trailer); err != nil {
		return ErrAssetUnavailable
	}
	return nil
}

func (metadata assetDiskMetadata) public(relativePath string) AssetRecord {
	return AssetRecord{
		RelativePath: relativePath, MediaType: metadata.MediaType, SizeBytes: metadata.SizeBytes,
		SHA256: strings.ToLower(metadata.SHA256), CreatedAt: metadata.CreatedAt.UTC(), ModifiedAt: metadata.ModifiedAt.UTC(),
	}
}

type assetFileBody struct {
	reader  *io.SectionReader
	file    *os.File
	ctx     context.Context
	release func()
	once    sync.Once
}

func (body *assetFileBody) Read(payload []byte) (int, error) {
	if err := body.ctx.Err(); err != nil {
		return 0, err
	}
	return body.reader.Read(payload)
}

func (body *assetFileBody) Seek(offset int64, whence int) (int64, error) {
	if err := body.ctx.Err(); err != nil {
		return 0, err
	}
	return body.reader.Seek(offset, whence)
}

func (body *assetFileBody) Close() error {
	var err error
	body.once.Do(func() {
		err = body.file.Close()
		body.release()
	})
	return err
}

func removeEmptyAssetParents(root string, current string) {
	for within(root, current) {
		if err := os.Remove(current); err != nil {
			return
		}
		current = filepath.Dir(current)
	}
}

type assetCursorPayload struct {
	OwnerKey string `json:"owner"`
	Prefix   string `json:"prefix"`
	After    string `json:"after"`
}

func (store *AssetStore) issueCursor(payload assetCursorPayload) (string, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", ErrAssetCursorInvalid
	}
	signature := hmac.New(sha256.New, store.cursorKey[:])
	_, _ = signature.Write(encoded)
	value := append(encoded, signature.Sum(nil)...)
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (store *AssetStore) parseCursor(value string) (assetCursorPayload, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) <= sha256.Size || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return assetCursorPayload{}, ErrAssetCursorInvalid
	}
	payloadBytes := decoded[:len(decoded)-sha256.Size]
	signatureBytes := decoded[len(decoded)-sha256.Size:]
	signature := hmac.New(sha256.New, store.cursorKey[:])
	_, _ = signature.Write(payloadBytes)
	if !hmac.Equal(signature.Sum(nil), signatureBytes) {
		return assetCursorPayload{}, ErrAssetCursorInvalid
	}
	var payload assetCursorPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil || payload.OwnerKey == "" || payload.After == "" {
		return assetCursorPayload{}, ErrAssetCursorInvalid
	}
	return payload, nil
}

func (store *AssetStore) debugObjectPath(owner ManagedOwner, relativePath string) (string, error) {
	ownerRoot, _, err := managedOwnerRoot(store.dataRoot, owner)
	if err != nil {
		return "", err
	}
	return encodedLogicalPath(filepath.Join(ownerRoot, "assets", "objects"), relativePath, assetObjectName)
}
