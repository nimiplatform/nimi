package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func passiveCatalogDescriptorForTest(
	assetID string,
	kind runtimev1.LocalAssetKind,
	file string,
	sha256Hex string,
	family string,
	roles []string,
) *runtimev1.LocalVerifiedAssetDescriptor {
	metadata, _ := structpb.NewStruct(map[string]any{"family": family})
	return &runtimev1.LocalVerifiedAssetDescriptor{
		TemplateId:    assetID,
		AssetId:       assetID,
		Kind:          kind,
		Entry:         file,
		Files:         []string{file},
		Hashes:        map[string]string{file: "sha256:" + sha256Hex},
		Metadata:      metadata,
		ArtifactRoles: append([]string(nil), roles...),
	}
}

func TestLoadLocalStateSnapshotRejectsRetiredLocalAssetRows(t *testing.T) {
	asset := map[string]any{
		"localAssetId":         "passive-state",
		"assetId":              "local/passive-state",
		"kind":                 int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE),
		"engine":               "media",
		"preferredEngine":      "media",
		"fallbackEngines":      []string{"media-cpu"},
		"bundleState":          2,
		"localInvokeProfileId": "legacy-profile",
		"engineConfig":         map[string]any{"backend": "legacy"},
	}
	payload, err := json.Marshal(map[string]any{
		"schemaVersion": localStateSchemaVersion,
		"assets":        []any{asset},
		"services":      []any{},
	})
	if err != nil {
		t.Fatalf("marshal state: %v", err)
	}
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := os.WriteFile(statePath, payload, 0o600); err != nil {
		t.Fatalf("write state: %v", err)
	}
	_, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(statePath)
	if err == nil || !strings.Contains(err.Error(), "explicit local-model-recovery tool") {
		t.Fatalf("retired LocalAsset state was not rejected: err=%v", err)
	}
	if len(diagnostics) != 0 || rewriteRequired {
		t.Fatalf("retired state entered isolation rewrite: diagnostics=%+v rewrite=%t", diagnostics, rewriteRequired)
	}
}

func TestInstallPlannedPassiveModelAssetWithoutEngineAdmission(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	digest := sha256.Sum256(payload)
	digestHex := hex.EncodeToString(digest[:])
	revision := strings.Repeat("c", 40)
	const repo = "owner/repo"
	const filename = "encoder.gguf"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/repo/resolve/"+revision+"/"+filename {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	descriptor := passiveCatalogDescriptorForTest("verified-passive", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, filename, digestHex, "qwen-vl", []string{"text_encoder"})
	descriptor.Repo = repo
	descriptor.Revision = revision
	descriptor.License = "test"
	svc.mu.Lock()
	svc.verified = append(svc.verified, descriptor)
	svc.mu.Unlock()

	modelAssetsBefore := len(svc.modelAssets)
	plan, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{TemplateId: descriptor.GetTemplateId()})
	if err != nil {
		t.Fatalf("resolve verified passive asset plan: %v", err)
	}
	resp, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: plan.GetPlan().GetPlanId()})
	if err != nil {
		t.Fatalf("install verified passive asset plan: %v", err)
	}
	modelAsset := resp.GetModelAsset()
	if modelAsset == nil || modelAsset.GetModelAssetId() == "" || modelAsset.GetContentId() == "" || !modelAsset.GetContentVerified() ||
		modelAsset.GetCatalogVerification() != runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED || modelAsset.GetBoundedFingerprint() == nil {
		t.Fatalf("catalog install ModelAsset projection is incomplete: %+v", modelAsset)
	}
	if got := len(svc.modelAssets); got != modelAssetsBefore+1 {
		t.Fatalf("catalog install ModelAsset count=%d, want %d", got, modelAssetsBefore+1)
	}
	entryPath := filepath.Join(svc.modelAssetDirectories[modelAsset.GetModelAssetId()], modelAsset.GetEntry())
	if got, err := os.ReadFile(entryPath); err != nil || string(got) != string(payload) {
		t.Fatalf("installed passive bytes mismatch: size=%d err=%v", len(got), err)
	}
	manifestPath := filepath.Join(filepath.Dir(entryPath), localAssetManifestFileName)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read downloaded passive manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode downloaded passive manifest: %v", err)
	}
	for _, field := range []string{"engine", "preferred_engine", "fallback_engines", "engine_config"} {
		if _, exists := manifest[field]; exists {
			t.Fatalf("downloaded passive manifest contains %q: %#v", field, manifest)
		}
	}
}
