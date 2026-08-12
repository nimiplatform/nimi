package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestInstallManagedDownloadedModelInfersEmbeddingKindWhenUnspecified(t *testing.T) {
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
	if got := record.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
		t.Fatalf("record kind mismatch: got=%s want=%s", got, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING)
	}
	if got := record.GetCapabilities(); len(got) != 1 || got[0] != "text.embed" {
		t.Fatalf("record capabilities mismatch: %#v", got)
	}
	if got := record.GetFiles(); len(got) != 1 || got[0] != "Qwen3-Embedding-8B-Q4_K_M.gguf" {
		t.Fatalf("record files mismatch: %#v", got)
	}

	manifestPath := runtimeManagedAssetManifestPath(
		resolveLocalModelsPath(svc.localModelsPath),
		filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local/qwen3-embedding-8b"))),
	)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if want := []byte(`"kind": "embedding"`); !bytes.Contains(raw, want) {
		t.Fatalf("manifest kind missing embedding token: %s", string(raw))
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(manifestPath), "Qwen3-Embedding-8B-Q4_K_M.gguf")); err != nil {
		t.Fatalf("managed embedding file missing: %v", err)
	}
}

// TestInstallManagedDownloadedModelStagesUnderConfiguredModelsRoot is the
// regression guard for the e2e download-root bug: a managed bundle install
// stages and activates under the single config-sourced runtime models root
// (`resolveLocalModelsPath(s.localModelsPath)` → `<dataRootRef>/models`), at the
// canonical `resolved/<logicalModelID>/` bundle layout — never a relative
// `resolved/` directory rooted at the runtime process CWD.
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
	if record.GetLogicalModelId() == "" {
		t.Fatal("installed record missing logical model id")
	}

	// The bundle is staged under `<modelsRoot>/resolved/<logicalModelID>/` — the
	// canonical layout the materializer verify path resolves.
	logicalID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local/qwen3-embedding-8b")))
	wantManifest := runtimeManagedAssetManifestPath(modelsRoot, logicalID)
	gotAsset := filepath.Join(filepath.Dir(wantManifest), "Qwen3-Embedding-8B-Q4_K_M.gguf")
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
