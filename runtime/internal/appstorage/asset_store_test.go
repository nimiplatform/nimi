package appstorage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/text/unicode/norm"
)

func assetTestOwner(accountID, subject string) ManagedOwner {
	return ManagedOwner{AccountID: accountID, RegisteredAppSubject: subject}
}

func assetTestPolicy() AssetPolicy {
	return AssetPolicy{MinFreeBytes: 1}
}

type assetPatternReader struct{}

func (assetPatternReader) Read(payload []byte) (int, error) {
	for index := range payload {
		payload[index] = byte((index*17 + 3) % 251)
	}
	return len(payload), nil
}

type assetCountingSource struct {
	io.Reader
	closes atomic.Int32
}

func (source *assetCountingSource) Close() error {
	source.closes.Add(1)
	return nil
}

func writeAssetBytes(t *testing.T, store *AssetStore, owner ManagedOwner, path string, payload []byte, overwrite bool) AssetRecord {
	t.Helper()
	record, err := store.Write(context.Background(), owner, path, "application/octet-stream", overwrite, io.NopCloser(bytes.NewReader(payload)))
	if err != nil {
		t.Fatalf("Write(%q): %v", path, err)
	}
	return record
}

func TestNormalizeAssetRelativePathAndEncodingArePortableAndCollisionProof(t *testing.T) {
	valid := []string{"media/video/run-123.mp4", "Images/头像.webp", strings.Repeat("a", 255) + "/index.bin"}
	for _, value := range valid {
		if normalized, err := NormalizeAssetRelativePath(value); err != nil || normalized != value {
			t.Fatalf("Normalize(%q)=%q err=%v", value, normalized, err)
		}
	}
	nonNFC := norm.NFD.String("images/café.png")
	invalid := []string{"", " media/a.bin", "../a.bin", "media//a.bin", "media/./a.bin", "media\\a.bin", "C:/a.bin", "/a.bin", "media/CON", "media/a. ", nonNFC}
	for _, value := range invalid {
		if _, err := NormalizeAssetRelativePath(value); !errors.Is(err, ErrAssetPathInvalid) {
			t.Fatalf("Normalize(%q) err=%v", value, err)
		}
	}
	root := t.TempDir()
	upper, err := encodedLogicalPath(root, "Images/Café.png", assetObjectName)
	if err != nil {
		t.Fatal(err)
	}
	lower, err := encodedLogicalPath(root, "images/café.png", assetObjectName)
	if err != nil {
		t.Fatal(err)
	}
	if upper == lower {
		t.Fatal("case-distinct logical paths collided physically")
	}
	if decoded, err := decodeLogicalPath(root, upper, assetObjectName); err != nil || decoded != "Images/Café.png" {
		t.Fatalf("decode=%q err=%v", decoded, err)
	}
}

func TestAssetStoreLargeStreamRoundTripRestartAndOwnerIsolation(t *testing.T) {
	dataRoot := t.TempDir()
	store, err := NewAssetStore(dataRoot, assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	sizeBytes := int64(33*1024*1024 + 17)
	source := &assetCountingSource{Reader: io.LimitReader(assetPatternReader{}, sizeBytes)}
	record, err := store.Write(context.Background(), owner, "media/video/large.mp4", "video/mp4", false, source)
	if err != nil {
		t.Fatal(err)
	}
	if source.closes.Load() != 1 || record.SizeBytes != sizeBytes || record.MediaType != "video/mp4" || record.SHA256 == "" {
		t.Fatalf("record=%+v closes=%d", record, source.closes.Load())
	}
	if _, err := store.Stat(context.Background(), assetTestOwner("account-1", "subject-2"), record.RelativePath); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("cross-subject Stat err=%v", err)
	}
	if _, err := store.Stat(context.Background(), assetTestOwner("account-2", "subject-1"), record.RelativePath); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("cross-account Stat err=%v", err)
	}
	reopened, err := NewAssetStore(dataRoot, assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	sourceView, err := reopened.Open(context.Background(), owner, record.RelativePath)
	if err != nil {
		t.Fatal(err)
	}
	hasher := sha256.New()
	readBytes, readErr := io.Copy(hasher, sourceView.Body)
	closeErr := sourceView.Body.Close()
	if readErr != nil || closeErr != nil || readBytes != sizeBytes || "sha256:"+hex.EncodeToString(hasher.Sum(nil)) != record.SHA256 {
		t.Fatalf("read=%d readErr=%v closeErr=%v digest=%x", readBytes, readErr, closeErr, hasher.Sum(nil))
	}
	page, err := reopened.List(context.Background(), owner, "media/", "", 10)
	if err != nil || len(page.Assets) != 1 || page.Assets[0].RelativePath != record.RelativePath {
		t.Fatalf("restart list=%+v err=%v", page, err)
	}
}

func TestAssetAndJSONNamespacesAndQuotaAccountingAreIndependent(t *testing.T) {
	dataRoot := t.TempDir()
	store, err := NewAssetStore(dataRoot, AssetPolicy{MaxObjectBytes: 32 * 1024 * 1024, MaxOwnerBytes: 64 * 1024 * 1024, MaxOwnerObjects: 10, MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	assetSize := int64(LocalAppJSONPartitionQuotaBytes + 1024)
	if _, err := store.Write(context.Background(), owner, "state/value.json", "application/json", false,
		io.NopCloser(io.LimitReader(assetPatternReader{}, assetSize))); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteLocalAppJSON(dataRoot, owner, "state/value.json", []byte(`{"json":true}`)); err != nil {
		t.Fatalf("asset bytes charged JSON quota: %v", err)
	}
	bytesUsed, objects, err := store.Usage(context.Background(), owner)
	if err != nil || bytesUsed != assetSize || objects != 1 {
		t.Fatalf("asset usage bytes=%d objects=%d err=%v", bytesUsed, objects, err)
	}
	ownerRoot, _, _ := managedOwnerRoot(dataRoot, owner)
	internal := filepath.Join(ownerRoot, "internal", "metadata.bin")
	if err := os.MkdirAll(filepath.Dir(internal), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(internal, make([]byte, 1024), 0o600); err != nil {
		t.Fatal(err)
	}
	bytesUsed, objects, err = store.Usage(context.Background(), owner)
	if err != nil || bytesUsed != assetSize || objects != 1 {
		t.Fatalf("internal metadata charged asset quota bytes=%d objects=%d err=%v", bytesUsed, objects, err)
	}
}

type gatedAssetReader struct {
	payload []byte
	ready   chan<- struct{}
	release <-chan struct{}
	once    sync.Once
}

func (reader *gatedAssetReader) Read(target []byte) (int, error) {
	reader.once.Do(func() {
		reader.ready <- struct{}{}
		<-reader.release
	})
	if len(reader.payload) == 0 {
		return 0, io.EOF
	}
	read := copy(target, reader.payload)
	reader.payload = reader.payload[read:]
	return read, nil
}

func TestAssetConcurrentCommitsCannotOversubscribeQuota(t *testing.T) {
	store, err := NewAssetStore(t.TempDir(), AssetPolicy{MaxObjectBytes: 10, MaxOwnerBytes: 10, MaxOwnerObjects: 2, MinFreeBytes: 1, ActiveStreams: 2})
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	errorsOut := make(chan error, 2)
	for _, path := range []string{"a.bin", "b.bin"} {
		go func(path string) {
			_, writeErr := store.Write(context.Background(), owner, path, "application/octet-stream", false,
				io.NopCloser(&gatedAssetReader{payload: []byte("123456"), ready: ready, release: release}))
			errorsOut <- writeErr
		}(path)
	}
	<-ready
	<-ready
	close(release)
	results := []error{<-errorsOut, <-errorsOut}
	successes, quotas := 0, 0
	for _, result := range results {
		switch {
		case result == nil:
			successes++
		case errors.Is(result, ErrAssetQuota):
			quotas++
		default:
			t.Fatalf("unexpected concurrent result: %v", result)
		}
	}
	if successes != 1 || quotas != 1 {
		t.Fatalf("successes=%d quotas=%d", successes, quotas)
	}
	bytesUsed, objects, err := store.Usage(context.Background(), owner)
	if err != nil || bytesUsed != 6 || objects != 1 {
		t.Fatalf("usage bytes=%d objects=%d err=%v", bytesUsed, objects, err)
	}
}

func TestAssetCancellationOverwriteAndStartupCandidateCleanup(t *testing.T) {
	dataRoot := t.TempDir()
	store, err := NewAssetStore(dataRoot, assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	writeAssetBytes(t, store, owner, "media/current.bin", []byte("original"), false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source := &assetCountingSource{Reader: strings.NewReader("replacement")}
	if _, err := store.Write(ctx, owner, "media/current.bin", "application/octet-stream", true, source); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled overwrite err=%v", err)
	}
	if source.closes.Load() != 1 {
		t.Fatalf("canceled source closes=%d", source.closes.Load())
	}
	opened, err := store.Open(context.Background(), owner, "media/current.bin")
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := io.ReadAll(opened.Body)
	_ = opened.Body.Close()
	if string(payload) != "original" {
		t.Fatalf("canceled overwrite changed target: %q", payload)
	}
	ownerRoot, _, _ := managedOwnerRoot(dataRoot, owner)
	candidates := filepath.Join(ownerRoot, "internal", "asset-candidates")
	if err := os.WriteFile(filepath.Join(candidates, ".asset-candidate-abandoned"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAssetStore(dataRoot, assetTestPolicy()); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(candidates)
	if err != nil || len(entries) != 0 {
		t.Fatalf("abandoned candidates=%v err=%v", entries, err)
	}
}

func TestAssetListCursorBindingOrderingMoveRemoveAndPinnedOpen(t *testing.T) {
	store, err := NewAssetStore(t.TempDir(), assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	for _, path := range []string{"media/b.bin", "media/A.bin", "media/a.bin", "other/z.bin"} {
		writeAssetBytes(t, store, owner, path, []byte(path), false)
	}
	page, err := store.List(context.Background(), owner, "media/", "", 2)
	if err != nil || len(page.Assets) != 2 || page.NextCursor == "" {
		t.Fatalf("first page=%+v err=%v", page, err)
	}
	paths := []string{page.Assets[0].RelativePath, page.Assets[1].RelativePath}
	if !sort.StringsAreSorted(paths) {
		t.Fatalf("page ordering=%v", paths)
	}
	second, err := store.List(context.Background(), owner, "media/", page.NextCursor, 2)
	if err != nil || len(second.Assets) != 1 {
		t.Fatalf("second page=%+v err=%v", second, err)
	}
	if _, err := store.List(context.Background(), owner, "other/", page.NextCursor, 2); !errors.Is(err, ErrAssetCursorInvalid) {
		t.Fatalf("foreign-prefix cursor err=%v", err)
	}
	if _, err := store.List(context.Background(), assetTestOwner("account-1", "subject-2"), "media/", page.NextCursor, 2); !errors.Is(err, ErrAssetCursorInvalid) {
		t.Fatalf("foreign-owner cursor err=%v", err)
	}
	replacement := byte('A')
	if page.NextCursor[len(page.NextCursor)-1] == replacement {
		replacement = 'B'
	}
	tampered := page.NextCursor[:len(page.NextCursor)-1] + string(replacement)
	if _, err := store.List(context.Background(), owner, "media/", tampered, 2); !errors.Is(err, ErrAssetCursorInvalid) {
		t.Fatalf("tampered cursor err=%v", err)
	}

	pinned, err := store.Open(context.Background(), owner, "media/a.bin")
	if err != nil {
		t.Fatal(err)
	}
	writeAssetBytes(t, store, owner, "media/a.bin", []byte("new-version"), true)
	oldPayload, err := io.ReadAll(pinned.Body)
	if closeErr := pinned.Body.Close(); err != nil || closeErr != nil || string(oldPayload) != "media/a.bin" {
		t.Fatalf("pinned payload=%q err=%v close=%v", oldPayload, err, closeErr)
	}
	moved, err := store.Move(context.Background(), owner, "media/a.bin", "archive/a.bin", false)
	if err != nil || moved.RelativePath != "archive/a.bin" {
		t.Fatalf("move=%+v err=%v", moved, err)
	}
	if _, err := store.Stat(context.Background(), owner, "media/a.bin"); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("moved source err=%v", err)
	}
	removed, err := store.Remove(context.Background(), owner, "archive/a.bin")
	if err != nil || !removed {
		t.Fatalf("remove=%v err=%v", removed, err)
	}
	removed, err = store.Remove(context.Background(), owner, "archive/a.bin")
	if err != nil || removed {
		t.Fatalf("idempotent remove=%v err=%v", removed, err)
	}
}

func TestAssetRestartReconcilesCommittedTruthAndCorruptionFailsClosed(t *testing.T) {
	dataRoot := t.TempDir()
	owner := assetTestOwner("account-1", "subject-1")
	store, err := NewAssetStore(dataRoot, AssetPolicy{MaxObjectBytes: 10, MaxOwnerBytes: 10, MaxOwnerObjects: 1, MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	writeAssetBytes(t, store, owner, "one.bin", []byte("123456"), false)
	reopened, err := NewAssetStore(dataRoot, AssetPolicy{MaxObjectBytes: 10, MaxOwnerBytes: 10, MaxOwnerObjects: 1, MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Write(context.Background(), owner, "two.bin", "application/octet-stream", false, io.NopCloser(strings.NewReader("1"))); !errors.Is(err, ErrAssetQuota) {
		t.Fatalf("restart did not reconcile object quota: %v", err)
	}
	target, err := reopened.debugObjectPath(owner, "one.bin")
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(target, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if _, err := file.WriteAt([]byte{'X'}, info.Size()-1); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	_ = file.Close()
	if _, err := reopened.Stat(context.Background(), owner, "one.bin"); !errors.Is(err, ErrAssetCorrupt) {
		t.Fatalf("corrupt Stat err=%v", err)
	}
	if _, err := reopened.List(context.Background(), owner, "", "", 10); !errors.Is(err, ErrAssetCorrupt) {
		t.Fatalf("corrupt List err=%v", err)
	}
}

func TestAssetOpenVerifiesPayloadIntegrityWhileStatRemainsMetadataOnly(t *testing.T) {
	owner := assetTestOwner("account-1", "subject-1")
	store, err := NewAssetStore(t.TempDir(), assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	writeAssetBytes(t, store, owner, "media.bin", []byte("payload"), false)
	target, err := store.debugObjectPath(owner, "media.bin")
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(target, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteAt([]byte{'X'}, 0); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	_ = file.Close()
	if _, err := store.Stat(context.Background(), owner, "media.bin"); err != nil {
		t.Fatalf("metadata-only Stat read payload: %v", err)
	}
	if _, err := store.Open(context.Background(), owner, "media.bin"); !errors.Is(err, ErrAssetCorrupt) {
		t.Fatalf("payload-corrupt Open err=%v", err)
	}
}

func TestAssetFreeSpaceFailureLeavesNoCommittedUsage(t *testing.T) {
	store, err := NewAssetStore(t.TempDir(), AssetPolicy{MaxObjectBytes: 1024, MaxOwnerBytes: 1024, MaxOwnerObjects: 10, MinFreeBytes: math.MaxInt64})
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	if _, err := store.Write(context.Background(), owner, "fail.bin", "application/octet-stream", false, io.NopCloser(strings.NewReader("payload"))); !errors.Is(err, ErrAssetUnavailable) {
		t.Fatalf("free-space failure err=%v", err)
	}
	bytesUsed, objects, err := store.Usage(context.Background(), owner)
	if err != nil || bytesUsed != 0 || objects != 0 {
		t.Fatalf("failed candidate usage bytes=%d objects=%d err=%v", bytesUsed, objects, err)
	}
}

func TestAssetActiveStreamLimitHonorsCancellation(t *testing.T) {
	store, err := NewAssetStore(t.TempDir(), AssetPolicy{MaxObjectBytes: 1024, MaxOwnerBytes: 4096, MaxOwnerObjects: 10, MinFreeBytes: 1, ActiveStreams: 1})
	if err != nil {
		t.Fatal(err)
	}
	owner := assetTestOwner("account-1", "subject-1")
	writeAssetBytes(t, store, owner, "one.bin", []byte("one"), false)
	opened, err := store.Open(context.Background(), owner, "one.bin")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := store.Open(ctx, owner, "one.bin"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("second Open err=%v", err)
	}
	_ = opened.Body.Close()
}
