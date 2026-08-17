package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestInstallManagedDownloadedModelCreatesContentOnlyModelAsset(t *testing.T) {
	svc := newTestService(t)
	modelBytes := validTestGGUF()
	sum := sha256.Sum256(modelBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/Qwen3-Embedding-8B-Q4_K_M.gguf" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(modelBytes)
	}))
	defer func() { server.Close() }()

	svc.hfDownloadBaseURL = server.URL

	record, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:      "local/qwen3-embedding-8b",
		kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		capabilities: []string{"text.embed"},
		engine:       "llama",
		entry:        "Qwen3-Embedding-8B-Q4_K_M.gguf",
		files:        []string{"Qwen3-Embedding-8B-Q4_K_M.gguf"},
		license:      "apache-2.0",
		repo:         "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:     "main",
		hashes:       map[string]string{"Qwen3-Embedding-8B-Q4_K_M.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	})
	if err != nil {
		t.Fatalf("installManagedDownloadedModel: %v", err)
	}
	if record.GetModelAssetId() == "" || record.GetContentId() == "" {
		t.Fatalf("content-only ModelAsset identity is incomplete: %+v", record)
	}
	if got := record.GetFiles(); len(got) != 1 || got[0].GetRelativePath() != "Qwen3-Embedding-8B-Q4_K_M.gguf" {
		t.Fatalf("record files mismatch: %#v", got)
	}

	manifestPath := filepath.Join(svc.modelAssetDirectories[record.GetModelAssetId()], localAssetManifestFileName)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if bytes.Contains(raw, []byte(`"kind"`)) || !bytes.Contains(raw, []byte(`"model_asset_id"`)) || !bytes.Contains(raw, []byte(`"content_id"`)) {
		t.Fatalf("managed download did not hard-cut to a content-only ModelAsset manifest: %s", string(raw))
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("managed download ModelAsset inventory count = %d, want 1", len(svc.modelAssets))
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(manifestPath), "Qwen3-Embedding-8B-Q4_K_M.gguf")); err != nil {
		t.Fatalf("managed embedding file missing: %v", err)
	}
}

func TestManagedDownloadMintsIndependentDuplicateContentInstances(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	spec := managedDownloadedModelSpec{
		modelID: "local/duplicate-content", capabilities: []string{"text.embed"}, engine: "llama",
		entry: "model.gguf", files: []string{"model.gguf"}, repo: "owner/repo", revision: "main",
		hashes: map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	}
	first, err := svc.installManagedDownloadedModel(context.Background(), spec)
	if err != nil {
		t.Fatalf("first acquisition: %v", err)
	}
	second, err := svc.installManagedDownloadedModel(context.Background(), spec)
	if err != nil {
		t.Fatalf("second acquisition: %v", err)
	}
	if first.GetModelAssetId() == second.GetModelAssetId() || first.GetContentId() != second.GetContentId() || !second.GetDuplicateContent() {
		t.Fatalf("duplicate acquisitions did not mint independent identities: first=%+v second=%+v", first, second)
	}
	firstDir := svc.modelAssetDirectories[first.GetModelAssetId()]
	secondDir := svc.modelAssetDirectories[second.GetModelAssetId()]
	if firstDir == "" || secondDir == "" || canonicalReportPath(firstDir) == canonicalReportPath(secondDir) {
		t.Fatalf("duplicate acquisitions reused resolved-directory custody: first=%q second=%q", firstDir, secondDir)
	}
	for _, directory := range []string{firstDir, secondDir} {
		if _, err := os.Stat(filepath.Join(directory, "model.gguf")); err != nil {
			t.Fatalf("acquisition payload missing from %q: %v", directory, err)
		}
	}
}

// TestInstallManagedDownloadedModelStagesUnderConfiguredModelsRoot is the
// regression guard for the e2e download-root bug: a managed bundle install
// stages and activates under the single config-sourced runtime models root
// (`resolveLocalModelsPath(s.localModelsPath)` → `<dataRootRef>/models`), at the
// canonical per-acquisition `resolved/` custody — never a relative directory
// rooted at the Runtime process CWD and never a shared content directory.
func TestInstallManagedDownloadedModelStagesUnderConfiguredModelsRoot(t *testing.T) {
	svc := newTestService(t)
	modelBytes := validTestGGUF()
	sum := sha256.Sum256(modelBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/Qwen3-Embedding-8B-Q4_K_M.gguf" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(modelBytes)
	}))
	defer func() { server.Close() }()
	svc.hfDownloadBaseURL = server.URL

	modelsRoot := svc.resolvedLocalModelsPath()

	record, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:      "local/qwen3-embedding-8b",
		kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		capabilities: []string{"text.embed"},
		engine:       "llama",
		entry:        "Qwen3-Embedding-8B-Q4_K_M.gguf",
		files:        []string{"Qwen3-Embedding-8B-Q4_K_M.gguf"},
		license:      "apache-2.0",
		repo:         "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:     "main",
		hashes:       map[string]string{"Qwen3-Embedding-8B-Q4_K_M.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	})
	if err != nil {
		t.Fatalf("installManagedDownloadedModel: %v", err)
	}
	if record.GetModelAssetId() == "" {
		t.Fatal("installed record missing ModelAsset id")
	}

	// Each acquisition owns a distinct resolved directory under the configured
	// models root; duplicate content never reuses another ModelAsset directory.
	gotAsset := filepath.Join(svc.modelAssetDirectories[record.GetModelAssetId()], "Qwen3-Embedding-8B-Q4_K_M.gguf")
	if _, err := os.Stat(gotAsset); err != nil {
		t.Fatalf("managed model file not staged under the configured models root %q: %v", modelsRoot, err)
	}
	if !strings.HasPrefix(gotAsset, modelsRoot) {
		t.Fatalf("managed model file %q is not under the configured models root %q", gotAsset, modelsRoot)
	}
}

// TestResolveManagedBundleModelsRootFailsClosed asserts a managed bundle install
// never resolves an empty or relative models root. With no resolved runtime
// models root the resolver fails closed with a typed reason code rather than
// staging a relative `resolved/` into the runtime process CWD; an absolute
// config-sourced models root resolves through unchanged.
func TestResolveManagedBundleModelsRootFailsClosed(t *testing.T) {
	svc := newTestService(t)

	// An unresolved runtime models root (no dataRootRef in config) fails closed.
	svc.localModelsPath = ""
	if _, err := svc.resolveManagedBundleModelsRoot(); err == nil {
		t.Fatal("expected an empty models root to fail closed")
	} else if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for an empty models root, got %v", err)
	}

	// A relative configured models root is a fail-close condition, not a
	// CWD-relative default.
	svc.localModelsPath = "relative/nimi-data/models"
	if _, err := svc.resolveManagedBundleModelsRoot(); err == nil {
		t.Fatal("expected a relative models root to fail closed")
	} else if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for a relative models root, got %v", err)
	}

	// An absolute config-sourced models root resolves through unchanged.
	absoluteRoot := filepath.Join(t.TempDir(), "models")
	svc.localModelsPath = absoluteRoot
	root, err := svc.resolveManagedBundleModelsRoot()
	if err != nil {
		t.Fatalf("resolveManagedBundleModelsRoot for an absolute models root: %v", err)
	}
	if root != absoluteRoot {
		t.Fatalf("resolved models root = %q, want %q", root, absoluteRoot)
	}
}

func TestInstallManagedDownloadedModelRequiresExpectedHash(t *testing.T) {
	svc := newTestService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(validTestGGUF())
	}))
	defer func() { server.Close() }()

	svc.hfDownloadBaseURL = server.URL

	_, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:      "local/qwen3-embedding-8b",
		kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		capabilities: []string{"text.embed"},
		engine:       "llama",
		entry:        "Qwen3-Embedding-8B-Q4_K_M.gguf",
		files:        []string{"Qwen3-Embedding-8B-Q4_K_M.gguf"},
		license:      "apache-2.0",
		repo:         "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:     "main",
		hashes:       map[string]string{},
	})
	if err == nil {
		t.Fatal("expected managed download without expected hash to fail")
	}
	if !strings.Contains(err.Error(), "requires admitted expected sha256") {
		t.Fatalf("expected missing expected hash error, got %v", err)
	}
}

// TestDownloadManagedModelFileRetriesMidStreamDrop is the model-path regression
// guard for the fresh-install gemma download bug: a 5 GB GGUF download dropped
// mid-stream with `unexpected EOF`. The model path now delegates to the shared
// filedownload core, so a mid-stream connection drop is auto-retried with an
// HTTP Range resume and completes with the correct sha256 — exercised end to
// end through downloadManagedModelFile so the transfer-progress projection is
// driven by the same path.
func TestDownloadManagedModelFileRetriesMidStreamDrop(t *testing.T) {
	svc := newTestService(t)
	modelBytes := validTestGGUF()
	sum := sha256.Sum256(modelBytes)
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/model.gguf" {
			http.NotFound(w, r)
			return
		}
		if atomic.AddInt32(&requests, 1) == 1 {
			w.Header().Set("Content-Length", strconv.Itoa(len(modelBytes)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(modelBytes[:len(modelBytes)/2])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Errorf("expected hijacker support")
				return
			}
			conn, _, err := hijacker.Hijack()
			if err != nil {
				t.Errorf("hijack: %v", err)
				return
			}
			_ = conn.Close()
			return
		}
		serveModelWithRange(w, r, modelBytes)
	}))
	defer func() { server.Close() }()
	svc.hfDownloadBaseURL = server.URL

	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local/qwen3-embedding-8b",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	targetPath := filepath.Join(t.TempDir(), "model.gguf")
	hash, err := svc.downloadManagedModelFile(
		context.Background(),
		transfer.GetInstallSessionId(),
		"Qwen/Qwen3-Embedding-8B-GGUF",
		"main",
		"model.gguf",
		targetPath,
		map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	)
	if err != nil {
		t.Fatalf("downloadManagedModelFile: %v", err)
	}
	if hash != hex.EncodeToString(sum[:]) {
		t.Fatalf("model hash mismatch: got=%s want=%s", hash, hex.EncodeToString(sum[:]))
	}
	if got := atomic.LoadInt32(&requests); got < 2 {
		t.Fatalf("expected a retry after the mid-stream drop, got %d requests", got)
	}
	got, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("read downloaded model: %v", err)
	}
	if string(got) != string(modelBytes) {
		t.Fatalf("downloaded model contents mismatch: got %d bytes want %d", len(got), len(modelBytes))
	}
}

func serveModelWithRange(w http.ResponseWriter, r *http.Request, payload []byte) {
	rangeHeader := strings.TrimSpace(r.Header.Get("Range"))
	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
		return
	}
	startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
	start, err := strconv.Atoi(startToken)
	if err != nil || start < 0 || start > len(payload) {
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(payload)-1, len(payload)))
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)-start))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(payload[start:])
}

func TestManagedModelDownloadShutdownRestoresPausedWithStaging(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.shutdown-resume"
	payload := []byte(strings.Repeat("shutdown-resume-payload", 4096))
	sum := sha256.Sum256(payload)
	requestStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload[:4096])
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		close(requestStarted)
		<-r.Context().Done()
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(context.Background())
	ctx, cancel := context.WithCancel(shutdownCtx)
	go func() {
		<-requestStarted
		time.Sleep(100 * time.Millisecond)
		shutdownSignal.MarkServerShutdown()
		cancel()
	}()
	_, err := svc.installManagedDownloadedModel(ctx, managedDownloadFailureSpec(modelID, hex.EncodeToString(sum[:])))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown download error = %v, want context.Canceled", err)
	}

	transfer := transferForAssetForTest(t, svc, modelID)
	stageDir := managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId()))
	if !pathWithinBase(filepath.Join(svc.resolvedLocalModelsPath(), "quarantine", "downloads"), stageDir, false) {
		t.Fatalf("download staging escaped the exact resolved/quarantine models topology: %s", stageDir)
	}
	partialPath := filepath.Join(stageDir, "model.bin.download")
	beforeRestart, err := os.ReadFile(partialPath)
	if err != nil || len(beforeRestart) == 0 {
		t.Fatalf("shutdown partial before restart = %d bytes, err=%v", len(beforeRestart), err)
	}
	if transfer.GetState() != localTransferStatePaused || transfer.GetReasonCode() != localTransferInterruptionReason || !transfer.GetRetryable() {
		t.Fatalf("shutdown transfer = %+v, want paused/retryable interruption", transfer)
	}
	// Also model a hard stop after the last running snapshot was persisted: the
	// restore path, rather than the cancellation handler, must heal it to paused.
	if residual := svc.mutateLocalTransfer(transfer.GetInstallSessionId(), true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.State = localTransferStateRunning
		summary.Message = "downloading model.bin"
		summary.ReasonCode = ""
		summary.Retryable = false
	}); residual == nil {
		t.Fatal("failed to persist residual running transfer")
	}

	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()
	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore local service: %v", err)
	}
	defer restored.Close()
	restoredTransfer := restored.localTransferSummary(transfer.GetInstallSessionId())
	if restoredTransfer.GetState() != localTransferStatePaused || restoredTransfer.GetReasonCode() != localTransferInterruptionReason || !restoredTransfer.GetRetryable() {
		t.Fatalf("restored transfer = %+v, want paused/retryable interruption", restoredTransfer)
	}
	afterRestart, err := os.ReadFile(partialPath)
	if err != nil || !bytes.Equal(afterRestart, beforeRestart) {
		t.Fatalf("restored staging changed: before=%d after=%d err=%v", len(beforeRestart), len(afterRestart), err)
	}
	if _, err := restored.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()}); err != nil {
		t.Fatalf("cancel restored transfer: %v", err)
	}
	if _, err := os.Stat(stageDir); !os.IsNotExist(err) {
		t.Fatalf("cancel restored transfer retained staging: %s err=%v", stageDir, err)
	}
}

func TestResumeRestoredManagedModelDownloadRebuildsExecutorAndRangePrefix(t *testing.T) {
	svc := newTestService(t)
	descriptor := svc.verifiedAssetDescriptorForAssetID("test.chat.qwen2")
	if descriptor == nil {
		t.Fatal("test verified descriptor not found")
	}
	payload := validTestGGUF()
	descriptor.TotalSizeBytes = int64(len(payload))
	prefixLen := len(payload) / 3
	modelID := descriptor.GetAssetId()
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:       modelID,
		Phase:         "download",
		State:         localTransferStateRunning,
		BytesReceived: 0,
		BytesTotal:    int64(len(payload)),
		Message:       "downloading model.gguf",
	})
	stageDir := managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId()))
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		t.Fatalf("create restored staging: %v", err)
	}
	partialPath := filepath.Join(stageDir, descriptor.GetEntry()+".download")
	if err := os.WriteFile(partialPath, payload[:prefixLen], 0o644); err != nil {
		t.Fatalf("write restored prefix: %v", err)
	}

	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore local service: %v", err)
	}
	defer restored.Close()
	restoredTransfer := restored.localTransferSummary(transfer.GetInstallSessionId())
	if restoredTransfer.GetState() != localTransferStatePaused {
		t.Fatalf("restored transfer state = %q, want paused", restoredTransfer.GetState())
	}
	if restoredTransfer.GetBytesReceived() != int64(prefixLen) {
		t.Fatalf("restored bytesReceived = %d, want on-disk prefix %d", restoredTransfer.GetBytesReceived(), prefixLen)
	}

	// New-process catalog projection: Resume must reconstruct from this durable
	// descriptor rather than from the original process's held install plan.
	restored.mu.Lock()
	restored.verified = append(restored.verified, cloneVerifiedAsset(descriptor))
	restored.mu.Unlock()

	var rangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/" + descriptor.GetRepo() + "/resolve/" + descriptor.GetRevision() + "/" + descriptor.GetEntry()
		if r.URL.Path != wantPath {
			http.NotFound(w, r)
			return
		}
		rangeHeader := strings.TrimSpace(r.Header.Get("Range"))
		if rangeHeader != "" {
			startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
			start, parseErr := strconv.ParseInt(startToken, 10, 64)
			if parseErr == nil {
				atomic.StoreInt64(&rangeStart, start)
			}
		}
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	restored.hfDownloadBaseURL = server.URL

	restored.mu.Lock()
	subscriberID, updates := restored.addTransferSubscriberLocked()
	restored.mu.Unlock()
	defer restored.removeTransferSubscriber(subscriberID)

	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if err != nil {
		t.Fatalf("ResumeLocalTransfer: %v", err)
	}
	if got := response.GetTransfer().GetBytesReceived(); got != int64(prefixLen) {
		t.Fatalf("resume response bytesReceived = %d, want prefix %d", got, prefixLen)
	}
	select {
	case event := <-updates:
		if event.GetBytesReceived() < int64(prefixLen) {
			t.Fatalf("first resumed event bytesReceived = %d, want >= %d", event.GetBytesReceived(), prefixLen)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("resume published no progress event")
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if summary := restored.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() == localTransferStateCompleted {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	completed := restored.localTransferSummary(transfer.GetInstallSessionId())
	if completed.GetState() != localTransferStateCompleted {
		t.Fatalf("resumed transfer did not complete: %+v", completed)
	}
	if got := atomic.LoadInt64(&rangeStart); got != int64(prefixLen) {
		t.Fatalf("Range start = %d, want %d", got, prefixLen)
	}
	restored.mu.RLock()
	record := cloneModelAsset(restored.modelAssets[completed.GetAssetId()])
	restored.mu.RUnlock()
	if record == nil {
		t.Fatal("resumed transfer did not commit the installed ModelAsset record")
	}
	if len(restored.modelAssets) != 1 {
		t.Fatalf("resumed ModelAsset inventory count = %d, want 1", len(restored.modelAssets))
	}
	if completed.GetAssetId() == "" || completed.GetAssetId() != record.GetModelAssetId() || !strings.HasPrefix(completed.GetAssetId(), "model_") {
		t.Fatalf("resumed transfer committed non-ModelAsset identity: transfer=%q record=%q", completed.GetAssetId(), record.GetModelAssetId())
	}
	committedDir := restored.modelAssetDirectories[record.GetModelAssetId()]
	committed, err := os.ReadFile(filepath.Join(committedDir, descriptor.GetEntry()))
	if err != nil {
		t.Fatalf("read committed entry: %v", err)
	}
	if !bytes.Equal(committed, payload) {
		t.Fatalf("committed entry bytes = %d, want %d", len(committed), len(payload))
	}
	wantHash := descriptor.GetHashes()[descriptor.GetEntry()]
	gotHash := ""
	for _, file := range record.GetFiles() {
		if file.GetRelativePath() == descriptor.GetEntry() {
			gotHash = file.GetSha256()
			break
		}
	}
	if gotHash != strings.TrimPrefix(wantHash, "sha256:") {
		t.Fatalf("committed sha256 = %q, want %q", gotHash, wantHash)
	}
	if _, err := os.Stat(stageDir); !os.IsNotExist(err) {
		t.Fatalf("completed staging still exists: %s err=%v", stageDir, err)
	}
}

func TestResumeRestoredManagedModelDownloadFailsTypedWhenCatalogSpecMissing(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.resume-catalog-missing"
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: modelID,
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore local service: %v", err)
	}
	defer restored.Close()
	if summary := restored.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStatePaused {
		t.Fatalf("restored transfer state = %q, want paused", summary.GetState())
	}

	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if response != nil {
		t.Fatalf("missing-spec resume response = %+v, want nil", response)
	}
	if status.Code(err) != codes.NotFound {
		t.Fatalf("missing-spec resume error = %v, want NotFound", err)
	}
	failed := restored.localTransferSummary(transfer.GetInstallSessionId())
	if failed.GetState() != localTransferStateFailed || failed.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND.String() {
		t.Fatalf("missing-spec transfer = %+v, want typed failed catalog miss", failed)
	}
	if restored.transferControl(transfer.GetInstallSessionId()) != nil {
		t.Fatal("missing-spec transfer retained an executor control")
	}
}

func TestManagedModelDownloadNetworkFailurePreservesRetryableStaging(t *testing.T) {
	svc := newTestService(t)
	svc.modelDownloadMaxAttempts = 1
	svc.modelDownloadRetryBackoff = 0
	modelID := "local.test.network-resume"
	payload := []byte(strings.Repeat("network-resume-payload", 4096))
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload[:4096])
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("httptest response does not support hijacking")
			return
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack response: %v", err)
			return
		}
		_ = conn.Close()
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	if _, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadFailureSpec(modelID, hex.EncodeToString(sum[:]))); err == nil {
		t.Fatal("expected interrupted network download to fail")
	}
	transfer := transferForAssetForTest(t, svc, modelID)
	if transfer.GetState() != localTransferStateFailed || !transfer.GetRetryable() {
		t.Fatalf("network failure transfer = %+v, want failed/retryable", transfer)
	}
	partialPath := filepath.Join(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId())), "model.bin.download")
	if info, err := os.Stat(partialPath); err != nil || info.Size() == 0 {
		t.Fatalf("network failure partial = %+v, err=%v", info, err)
	}
}

func TestManagedModelDownloadExplicitCancelClearsStaging(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.explicit-cancel"
	payload := []byte(strings.Repeat("cancel-payload", 1<<18))
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for offset := 0; offset < len(payload); offset += 1024 {
			end := offset + 1024
			if end > len(payload) {
				end = len(payload)
			}
			if _, err := w.Write(payload[offset:end]); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(time.Millisecond)
		}
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	result := make(chan error, 1)
	go func() {
		_, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadFailureSpec(modelID, hex.EncodeToString(sum[:])))
		result <- err
	}()
	transfer := awaitTransferBytesForTest(t, svc, modelID)
	if _, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()}); err != nil {
		t.Fatalf("CancelLocalTransfer: %v", err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, errLocalTransferCancelled) {
			t.Fatalf("cancelled download error = %v, want errLocalTransferCancelled", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled download did not stop within the bounded test window")
	}
	cancelled := svc.localTransferSummary(transfer.GetInstallSessionId())
	if cancelled.GetState() != localTransferStateCancelled || cancelled.GetRetryable() {
		t.Fatalf("cancelled transfer = %+v", cancelled)
	}
	stageDir := managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId()))
	if _, err := os.Stat(stageDir); !os.IsNotExist(err) {
		t.Fatalf("cancelled staging still exists: %s err=%v", stageDir, err)
	}
}

func TestManagedModelDownloadHashMismatchClearsStagingAndIsNotRetryable(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.hash-mismatch"
	payload := []byte("hash-mismatch-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	_, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadFailureSpec(modelID, strings.Repeat("0", 64)))
	if !errors.Is(err, errModelDownloadHashMismatch) {
		t.Fatalf("hash mismatch error = %v, want errModelDownloadHashMismatch", err)
	}
	transfer := transferForAssetForTest(t, svc, modelID)
	if transfer.GetState() != localTransferStateFailed || transfer.GetRetryable() {
		t.Fatalf("hash mismatch transfer = %+v, want failed/non-retryable", transfer)
	}
	stageDir := managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId()))
	if _, err := os.Stat(stageDir); !os.IsNotExist(err) {
		t.Fatalf("hash-mismatch staging still exists: %s err=%v", stageDir, err)
	}
}

func managedDownloadFailureSpec(modelID string, expectedHash string) managedDownloadedModelSpec {
	return managedDownloadedModelSpec{
		modelID:  modelID,
		entry:    "model.bin",
		files:    []string{"model.bin"},
		repo:     "test/repo",
		revision: "main",
		hashes:   map[string]string{"model.bin": "sha256:" + expectedHash},
	}
}

func transferForAssetForTest(t *testing.T, svc *Service, modelID string) *runtimev1.LocalTransferSessionSummary {
	t.Helper()
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	for _, summary := range svc.transfers {
		if summary != nil && summary.GetAssetId() == modelID {
			return cloneLocalTransferSummary(summary)
		}
	}
	t.Fatalf("transfer for asset %q not found", modelID)
	return nil
}

func awaitTransferBytesForTest(t *testing.T, svc *Service, modelID string) *runtimev1.LocalTransferSessionSummary {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		svc.mu.RLock()
		for _, summary := range svc.transfers {
			if summary != nil && summary.GetAssetId() == modelID && summary.GetBytesReceived() > 0 {
				cloned := cloneLocalTransferSummary(summary)
				svc.mu.RUnlock()
				return cloned
			}
		}
		svc.mu.RUnlock()
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("transfer for asset %q did not report bytes", modelID)
	return nil
}
