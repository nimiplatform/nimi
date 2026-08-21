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
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
		modelID:          "local/qwen3-embedding-8b",
		kind:             runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		capabilities:     []string{"text.embed"},
		engine:           "llama",
		entry:            "Qwen3-Embedding-8B-Q4_K_M.gguf",
		files:            []string{"Qwen3-Embedding-8B-Q4_K_M.gguf"},
		license:          "apache-2.0",
		sourceProvenance: "Qwen/Qwen3-Embedding-8B converted by example-owner",
		repo:             "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:         "main",
		hashes:           map[string]string{"Qwen3-Embedding-8B-Q4_K_M.gguf": "sha256:" + hex.EncodeToString(sum[:])},
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
	if got := record.GetProvenance().GetFields()["license"].GetStringValue(); got != "apache-2.0" {
		t.Fatalf("record license provenance = %q", got)
	}
	if got := record.GetProvenance().GetFields()["source_provenance"].GetStringValue(); got != "Qwen/Qwen3-Embedding-8B converted by example-owner" {
		t.Fatalf("record source provenance = %q", got)
	}

	manifestPath := filepath.Join(svc.modelAssetDirectories[record.GetModelAssetId()], localAssetManifestFileName)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if bytes.Contains(raw, []byte(`"kind"`)) || !bytes.Contains(raw, []byte(`"model_asset_id"`)) || !bytes.Contains(raw, []byte(`"content_id"`)) || !bytes.Contains(raw, []byte(`"license": "apache-2.0"`)) || !bytes.Contains(raw, []byte(`"source_provenance": "Qwen/Qwen3-Embedding-8B converted by example-owner"`)) {
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

func TestManagedDownloadFromProtectedDynamicCatalogPlanDoesNotRequireBuiltInDescriptor(t *testing.T) {
	svc := newTestService(t)
	payload := append(validTestGGUF(), []byte("-dynamic-catalog")...)
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	record, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:           "dynamic.hf.model",
		displayName:       "Dynamic HF Model",
		catalogAssetID:    "hf_dynamic_item",
		catalogTemplateID: "",
		capabilities:      []string{"text.generate"},
		entry:             "model.gguf",
		files:             []string{"model.gguf"},
		license:           "apache-2.0",
		repo:              "dynamic/repo",
		revision:          "main",
		hashes:            map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	})
	if err != nil {
		t.Fatalf("dynamic protected acquisition: %v", err)
	}
	if record.GetModelAssetId() == "" || record.GetContentId() == "" {
		t.Fatalf("dynamic protected acquisition returned incomplete ModelAsset: %+v", record)
	}
	snapshot, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(svc.stateStorePath)
	if err != nil {
		t.Fatalf("reload completed dynamic transfer state: %v", err)
	}
	if len(diagnostics) != 0 || rewriteRequired || len(snapshot.Transfers) != 1 {
		t.Fatalf("completed dynamic transfer was not restart-safe: transfers=%d diagnostics=%d rewrite=%t", len(snapshot.Transfers), len(diagnostics), rewriteRequired)
	}
	if snapshot.Transfers[0].State != localTransferStateCompleted || snapshot.Transfers[0].ManagedDownloadSpec != nil {
		t.Fatalf("completed dynamic transfer retained active execution spec: %+v", snapshot.Transfers[0])
	}
}

func TestManagedDownloadDoesNotStartHTTPBeforeDurableTransferCapture(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&requests, 1)
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	// An existing directory cannot be atomically replaced by the state file.
	// This exercises the production persistence failure before any HTTP effect.
	svc.stateStorePath = t.TempDir()

	_, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:      "dynamic.capture.failure",
		capabilities: []string{"text.generate"},
		entry:        "model.gguf",
		files:        []string{"model.gguf"},
		repo:         "dynamic/repo",
		revision:     "main",
		hashes:       map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	})
	if err == nil {
		t.Fatal("managed download started without durable transfer capture")
	}
	if got := atomic.LoadInt32(&requests); got != 0 {
		t.Fatalf("HTTP requests before durable transfer capture = %d, want 0", got)
	}
	if len(svc.transfers) != 0 || len(svc.managedModelDownloadSpecs) != 0 {
		t.Fatalf("failed durable capture retained transfer state: transfers=%d specs=%d", len(svc.transfers), len(svc.managedModelDownloadSpecs))
	}
}

func TestLocalModelDownloadRetryPolicyMatchesAuthority(t *testing.T) {
	want := []time.Duration{
		300 * time.Millisecond,
		1 * time.Second,
		5 * time.Second,
		15 * time.Second,
		30 * time.Second,
		60 * time.Second,
		120 * time.Second,
		180 * time.Second,
	}
	if localModelDownloadMaxAttempts != len(want)+1 {
		t.Fatalf("max attempts = %d, want one initial plus %d retries", localModelDownloadMaxAttempts, len(want))
	}
	if len(localModelDownloadRetryDelays) != len(want) {
		t.Fatalf("retry delay count = %d, want %d", len(localModelDownloadRetryDelays), len(want))
	}
	for index := range want {
		if localModelDownloadRetryDelays[index] != want[index] {
			t.Fatalf("retry delay %d = %s, want %s", index, localModelDownloadRetryDelays[index], want[index])
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
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID {
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
		0,
		int64(len(modelBytes)),
		true,
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
	if residual, persistErr := svc.mutateLocalTransfer(transfer.GetInstallSessionId(), true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.State = localTransferStateRunning
		summary.Message = "downloading model.bin"
		summary.ReasonCode = ""
		summary.Retryable = false
	}); residual == nil || persistErr != nil {
		t.Fatalf("failed to persist residual running transfer: summary=%+v err=%v", residual, persistErr)
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

func TestPausedManagedModelDownloadStaysPausedWhenInstallCallIsCanceled(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.paused-call-cancel"
	payload := append(validTestGGUF(), []byte(strings.Repeat("paused-call-cancel-payload", 4096))...)
	sum := sha256.Sum256(payload)
	requestStarted := make(chan struct{})
	var requests int32
	var rangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := atomic.AddInt32(&requests, 1)
		if attempt > 1 {
			if rangeHeader := strings.TrimSpace(r.Header.Get("Range")); rangeHeader != "" {
				startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
				if start, parseErr := strconv.ParseInt(startToken, 10, 64); parseErr == nil {
					atomic.StoreInt64(&rangeStart, start)
				}
			}
			serveModelWithRange(w, r, payload)
			return
		}
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

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := svc.installManagedDownloadedModel(ctx, managedDownloadFailureSpec(modelID, hex.EncodeToString(sum[:])))
		done <- err
	}()
	<-requestStarted
	transfer := transferForAssetForTest(t, svc, modelID)
	if _, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	}); err != nil {
		t.Fatalf("pause managed download: %v", err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel paused install call error = %v, want context.Canceled", err)
	}

	paused := svc.localTransferSummary(transfer.GetInstallSessionId())
	if paused.GetState() != localTransferStatePaused || !paused.GetRetryable() {
		t.Fatalf("paused transfer after install call cancellation = %+v, want paused/retryable", paused)
	}
	response, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if err != nil {
		t.Fatalf("resume paused transfer after install call cancellation: %v", err)
	}
	if response.GetTransfer().GetState() != localTransferStateRunning {
		t.Fatalf("resumed transfer = %+v, want running", response.GetTransfer())
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if summary := svc.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() == localTransferStateCompleted {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	completed := svc.localTransferSummary(transfer.GetInstallSessionId())
	if completed.GetState() != localTransferStateCompleted {
		t.Fatalf("resumed transfer did not complete: %+v", completed)
	}
	if got := atomic.LoadInt64(&rangeStart); got != paused.GetBytesReceived() {
		t.Fatalf("resumed transfer Range start = %d, want durable prefix %d", got, paused.GetBytesReceived())
	}
}

func TestResumeRestoredDynamicHFDownloadUsesDurableTransferSpec(t *testing.T) {
	svc := newTestService(t)
	modelID := "dynamic.hf.resume"
	payload := append(validTestGGUF(), []byte("-dynamic-resume")...)
	sum := sha256.Sum256(payload)
	prefixLen := len(payload) / 3
	requestStarted := make(chan struct{})
	var requests int32
	var rangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := atomic.AddInt32(&requests, 1)
		if attempt == 1 {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload[:prefixLen])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			close(requestStarted)
			<-r.Context().Done()
			return
		}
		if rangeHeader := strings.TrimSpace(r.Header.Get("Range")); rangeHeader != "" {
			startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
			if start, parseErr := strconv.ParseInt(startToken, 10, 64); parseErr == nil {
				atomic.StoreInt64(&rangeStart, start)
			}
		}
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	spec := managedDownloadedModelSpec{
		modelID:        modelID,
		displayName:    "Dynamic Resume",
		catalogAssetID: "hf_dynamic_resume",
		capabilities:   []string{"text.generate"},
		entry:          "model.gguf",
		files:          []string{"model.gguf"},
		license:        "apache-2.0",
		repo:           "dynamic/repo",
		revision:       "main",
		hashes:         map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	}

	shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(context.Background())
	ctx, cancel := context.WithCancel(shutdownCtx)
	go func() {
		<-requestStarted
		time.Sleep(100 * time.Millisecond)
		shutdownSignal.MarkServerShutdown()
		cancel()
	}()
	if _, err := svc.installManagedDownloadedModel(ctx, spec); !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted dynamic download error = %v, want context.Canceled", err)
	}
	transfer := transferForAssetForTest(t, svc, modelID)
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
	restored.hfDownloadBaseURL = server.URL
	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if err != nil {
		t.Fatalf("ResumeLocalTransfer dynamic HF: %v", err)
	}
	if response.GetTransfer().GetState() != localTransferStateRunning {
		t.Fatalf("dynamic resume state = %q, want running", response.GetTransfer().GetState())
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
		t.Fatalf("dynamic resumed transfer did not complete: %+v", completed)
	}
	if got := atomic.LoadInt64(&rangeStart); got != int64(prefixLen) {
		t.Fatalf("dynamic resume Range start = %d, want %d", got, prefixLen)
	}
	if len(restored.modelAssets) != 1 {
		t.Fatalf("dynamic resumed ModelAsset inventory count = %d, want 1", len(restored.modelAssets))
	}
}

func TestResumeRestoredMultiFileDownloadSkipsCompletedFilesAndKeepsAggregateProgress(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.multi-file-resume"
	fileA := []byte("already-complete-file-a")
	fileB := []byte(strings.Repeat("resumable-file-b", 128))
	hashA := sha256.Sum256(fileA)
	hashB := sha256.Sum256(fileB)
	prefixLen := len(fileB) / 3
	bundleTotal := int64(len(fileA) + len(fileB))
	spec := managedDownloadedModelSpec{
		modelID:        modelID,
		displayName:    "Multi-file resume",
		capabilities:   []string{"audio.synthesize"},
		entry:          "a.bin",
		files:          []string{"a.bin", "b.bin"},
		license:        "test",
		repo:           "test/multi-file-resume",
		revision:       "main",
		totalSizeBytes: bundleTotal,
		hashes: map[string]string{
			"a.bin": "sha256:" + hex.EncodeToString(hashA[:]),
			"b.bin": "sha256:" + hex.EncodeToString(hashB[:]),
		},
	}
	transfer, err := svc.newManagedModelDownloadTransfer(localTransferMutation{
		ModelID:       modelID,
		Phase:         "download",
		State:         localTransferStateRunning,
		BytesReceived: 0,
		Message:       "downloading multi-file bundle",
	}, spec)
	if err != nil {
		t.Fatalf("capture multi-file transfer: %v", err)
	}
	stageDir := managedModelDownloadStageDir(
		svc.resolvedLocalModelsPath(),
		managedModelAcquisitionStorageID(modelID, transfer.GetInstallSessionId()),
	)
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "a.bin"), fileA, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "b.bin.download"), fileB[:prefixLen], 0o600); err != nil {
		t.Fatal(err)
	}
	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore multi-file transfer: %v", err)
	}
	defer restored.Close()
	restored.mu.RLock()
	restoredTotal := restored.managedModelDownloadSpecs[transfer.GetInstallSessionId()].totalSizeBytes
	restored.mu.RUnlock()
	if restoredTotal != bundleTotal {
		t.Fatalf("restored managed download spec total=%d, want %d", restoredTotal, bundleTotal)
	}
	var fileARequests int32
	var fileBRangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch filepath.Base(r.URL.Path) {
		case "a.bin":
			atomic.AddInt32(&fileARequests, 1)
			serveModelWithRange(w, r, fileA)
		case "b.bin":
			if raw := strings.TrimSpace(r.Header.Get("Range")); raw != "" {
				startToken := strings.TrimSuffix(strings.TrimPrefix(raw, "bytes="), "-")
				if start, parseErr := strconv.ParseInt(startToken, 10, 64); parseErr == nil {
					atomic.StoreInt64(&fileBRangeStart, start)
				}
			}
			serveModelWithRange(w, r, fileB)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	restored.hfDownloadBaseURL = server.URL
	restored.modelDownloadMaxAttempts = 1

	restored.mu.Lock()
	subscriberID, updates := restored.addTransferSubscriberLocked()
	restored.mu.Unlock()
	defer restored.removeTransferSubscriber(subscriberID)

	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if err != nil {
		t.Fatalf("resume multi-file transfer: %v", err)
	}
	stagedBeforeResume := int64(len(fileA) + prefixLen)
	if response.GetTransfer().GetBytesReceived() != stagedBeforeResume || response.GetTransfer().GetBytesTotal() != bundleTotal {
		t.Fatalf("resume projection = received=%d total=%d, want %d/%d",
			response.GetTransfer().GetBytesReceived(), response.GetTransfer().GetBytesTotal(), stagedBeforeResume, bundleTotal)
	}

	deadline := time.After(5 * time.Second)
	for {
		select {
		case event := <-updates:
			if event == nil {
				t.Fatal("multi-file progress stream closed before terminal event")
			}
			if event.GetPhase() == "download" && event.GetState() == localTransferStateRunning {
				if event.GetBytesReceived() < stagedBeforeResume {
					t.Fatalf("multi-file progress regressed to %d below staged prefix %d", event.GetBytesReceived(), stagedBeforeResume)
				}
				if event.GetBytesTotal() != bundleTotal {
					t.Fatalf("multi-file progress total = %d, want bundle total %d", event.GetBytesTotal(), bundleTotal)
				}
			}
			if event.GetDone() {
				if !event.GetSuccess() {
					t.Fatalf("multi-file resume terminal event = %+v", event)
				}
				goto completed
			}
		case <-deadline:
			t.Fatal("multi-file resume did not complete")
		}
	}

completed:
	if got := atomic.LoadInt32(&fileARequests); got != 0 {
		t.Fatalf("completed file A was downloaded %d times", got)
	}
	if got := atomic.LoadInt64(&fileBRangeStart); got != int64(prefixLen) {
		t.Fatalf("file B Range start = %d, want %d", got, prefixLen)
	}
}

func TestResumeRestoredDownloadPersistenceFailureStartsNoWorker(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.resume-persist-failure"
	payload := []byte("resume persistence failure")
	digest := sha256.Sum256(payload)
	spec := managedDownloadedModelSpec{
		modelID:      modelID,
		displayName:  "Resume persistence failure",
		capabilities: []string{"text.generate"},
		entry:        "model.bin",
		files:        []string{"model.bin"},
		license:      "test",
		repo:         "test/resume-persist-failure",
		revision:     "main",
		hashes:       map[string]string{"model.bin": "sha256:" + hex.EncodeToString(digest[:])},
	}
	transfer, err := svc.newManagedModelDownloadTransfer(localTransferMutation{
		ModelID:    modelID,
		Phase:      "download",
		State:      localTransferStateRunning,
		BytesTotal: int64(len(payload)),
	}, spec)
	if err != nil {
		t.Fatalf("capture restored transfer: %v", err)
	}
	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore transfer: %v", err)
	}
	defer restored.Close()
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	restored.hfDownloadBaseURL = server.URL
	restored.modelDownloadMaxAttempts = 1
	restored.stateStorePath = t.TempDir()

	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if status.Code(err) != codes.Unavailable || response != nil {
		t.Fatalf("restored resume persistence failure response=%+v err=%v", response, err)
	}
	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt32(&requests); got != 0 {
		t.Fatalf("restored resume started %d HTTP requests before durable running state", got)
	}
	if summary := restored.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStatePaused {
		t.Fatalf("restored resume persistence failure changed summary: %+v", summary)
	}
}

func TestManagedDownloadCompletionPersistenceFailurePublishesNoModelAsset(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	digest := sha256.Sum256(payload)
	statePath := svc.stateStorePath
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := os.Remove(statePath); err != nil && !os.IsNotExist(err) {
			t.Errorf("remove state store: %v", err)
		}
		if err := os.Mkdir(statePath, 0o700); err != nil && !os.IsExist(err) {
			t.Errorf("replace state store with directory: %v", err)
		}
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	svc.modelDownloadMaxAttempts = 1

	asset, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:        "local.test.terminal-persist-failure",
		displayName:    "Terminal persistence failure",
		capabilities:   []string{"text.generate"},
		entry:          "model.gguf",
		files:          []string{"model.gguf"},
		repo:           "test/terminal-persist-failure",
		revision:       "main",
		totalSizeBytes: int64(len(payload)),
		hashes:         map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(digest[:])},
	})
	if status.Code(err) != codes.Unavailable || asset != nil {
		t.Fatalf("completion persistence failure asset=%+v err=%v", asset, err)
	}
	svc.mu.RLock()
	assetCount := len(svc.modelAssets)
	svc.mu.RUnlock()
	if assetCount != 0 {
		t.Fatalf("completion persistence failure published %d ModelAssets", assetCount)
	}
	entries, readErr := os.ReadDir(filepath.Join(svc.resolvedLocalModelsPath(), "resolved"))
	if readErr != nil {
		t.Fatalf("read resolved root: %v", readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("completion persistence failure retained resolved payload: %v", entries)
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
	spec := managedDownloadedModelSpec{
		modelID:           modelID,
		displayName:       descriptor.GetTitle(),
		catalogAssetID:    descriptor.GetAssetId(),
		catalogTemplateID: descriptor.GetTemplateId(),
		kind:              descriptor.GetKind(),
		capabilities:      append([]string(nil), descriptor.GetCapabilities()...),
		engine:            descriptor.GetEngine(),
		entry:             descriptor.GetEntry(),
		files:             append([]string(nil), descriptor.GetFiles()...),
		license:           descriptor.GetLicense(),
		sourceProvenance:  "test catalog conversion provenance",
		repo:              descriptor.GetRepo(),
		revision:          descriptor.GetRevision(),
		hashes:            cloneStringMap(descriptor.GetHashes()),
		engineConfig:      cloneStruct(descriptor.GetEngineConfig()),
	}
	transfer, err := svc.newManagedModelDownloadTransfer(localTransferMutation{
		ModelID:       modelID,
		Phase:         "download",
		State:         localTransferStateRunning,
		BytesReceived: 0,
		BytesTotal:    int64(len(payload)),
		Message:       "downloading model.gguf",
	}, spec)
	if err != nil {
		t.Fatalf("capture managed download transfer: %v", err)
	}
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
	if got := record.GetProvenance().GetFields()["source_provenance"].GetStringValue(); got != "test catalog conversion provenance" {
		t.Fatalf("resumed ModelAsset source provenance = %q", got)
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

func TestActiveManagedModelDownloadWithoutDurableSpecIsIsolated(t *testing.T) {
	svc := newTestService(t)
	modelID := "local.test.resume-catalog-missing"
	svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: modelID,
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	statePath := svc.stateStorePath
	svc.Close()

	snapshot, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(statePath)
	if err != nil {
		t.Fatalf("load isolated local state: %v", err)
	}
	if len(snapshot.Transfers) != 0 {
		t.Fatalf("active transfer without spec remained available: %+v", snapshot.Transfers)
	}
	if len(diagnostics) != 1 || !rewriteRequired {
		t.Fatalf("missing-spec diagnostics=%d rewrite=%t, want 1/true", len(diagnostics), rewriteRequired)
	}
	if _, statErr := os.Stat(diagnostics[0].QuarantinePath); statErr != nil {
		t.Fatalf("missing-spec quarantine was not retained: %v", statErr)
	}
}

func TestManagedModelDownloadNetworkFailurePreservesRetryableStaging(t *testing.T) {
	svc := newTestService(t)
	svc.modelDownloadMaxAttempts = 1
	modelID := "local.test.network-resume"
	payload := []byte(strings.Repeat("network-resume-payload", 4096))
	sum := sha256.Sum256(payload)
	var requests int32
	var rangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requests, 1) > 1 {
			if rangeHeader := strings.TrimSpace(r.Header.Get("Range")); rangeHeader != "" {
				startToken := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
				if start, parseErr := strconv.ParseInt(startToken, 10, 64); parseErr == nil {
					atomic.StoreInt64(&rangeStart, start)
				}
			}
			serveModelWithRange(w, r, payload)
			return
		}
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
	prefixInfo, err := os.Stat(partialPath)
	if err != nil {
		t.Fatalf("stat retryable prefix: %v", err)
	}
	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	logger := svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore retryable transfer: %v", err)
	}
	defer restored.Close()
	restored.hfDownloadBaseURL = server.URL
	restored.modelDownloadMaxAttempts = 1
	response, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if err != nil {
		t.Fatalf("resume retryable failed transfer: %v", err)
	}
	if response.GetTransfer().GetState() != localTransferStateRunning {
		t.Fatalf("retryable resume state = %q, want running", response.GetTransfer().GetState())
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
		t.Fatalf("retryable resumed transfer did not complete: %+v", completed)
	}
	if got := atomic.LoadInt64(&rangeStart); got != prefixInfo.Size() {
		t.Fatalf("retryable resume Range start = %d, want %d", got, prefixInfo.Size())
	}
	if _, err := os.Stat(filepath.Dir(partialPath)); !os.IsNotExist(err) {
		t.Fatalf("completed retryable staging still exists: %s err=%v", filepath.Dir(partialPath), err)
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
