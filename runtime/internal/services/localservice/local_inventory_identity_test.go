package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
)

func TestInferAssetKindFromCapabilitiesEmbedding(t *testing.T) {
	if got := inferAssetKindFromCapabilities([]string{"text.embed"}); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
		t.Fatalf("infer embed kind mismatch: got=%s want=%s", got, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING)
	}
	if got := inferAssetKindFromCapabilities([]string{"text.generate", "text.embed"}); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("infer mixed kind mismatch: got=%s want=%s", got, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT)
	}
}

func TestAssetKindMatchesCapabilityEmbedding(t *testing.T) {
	if !assetKindMatchesCapability(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, "embedding") {
		t.Fatal("expected embedding kind to match embedding token")
	}
	if !assetKindMatchesCapability(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, "text.embed") {
		t.Fatal("expected embedding kind to match text.embed")
	}
	if assetKindMatchesCapability(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, "chat") {
		t.Fatal("embedding kind must not match chat")
	}
}

func TestListLocalAssetsProjectsLegacyEmbeddingChatRecord(t *testing.T) {
	svc := newTestService(t)
	record, err := svc.installLocalAssetRecord(
		"local/legacy-embed",
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		[]string{"text.embed"},
		"llama",
		"legacy-embed.gguf",
		"unknown",
		"file:///tmp/legacy-embed/asset.manifest.json",
		"local",
		nil,
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		nil,
		nil,
		"runtime_model_ready_after_install",
		"legacy embedding model installed",
		false,
	)
	if err != nil {
		t.Fatalf("install legacy embed record: %v", err)
	}

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{
		KindFilter: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
	})
	if err != nil {
		t.Fatalf("ListLocalAssets: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("embedding asset count mismatch: got=%d want=1", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
		t.Fatalf("projected kind mismatch: got=%s want=%s", got, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING)
	}
	if got := resp.GetAssets()[0].GetLocalAssetId(); got != record.GetLocalAssetId() {
		t.Fatalf("projected local asset mismatch: got=%q want=%q", got, record.GetLocalAssetId())
	}

	svc.mu.RLock()
	stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
	svc.mu.RUnlock()
	if stored == nil {
		t.Fatal("expected stored legacy embed record")
	}
	if got := stored.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("stored kind should remain chat for compatibility: got=%s", got)
	}
}

func TestListLocalAssetsProjectsImageCompanionAsAuxiliary(t *testing.T) {
	svc := newTestService(t)
	record, err := svc.installLocalAssetRecord(
		"local-import/ideogram4_uncond-Q4_0",
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		[]string{"image.generate"},
		"media",
		"ideogram4_uncond-Q4_0.gguf",
		"unknown",
		"file:///tmp/ideogram4-uncond/asset.manifest.json",
		"local",
		nil,
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		nil,
		&modelregistry.NativeProjection{
			Family:           "ideogram4",
			ArtifactRoles:    []string{"uncond_diffusion_model"},
			PreferredEngine:  "media",
			LogicalModelID:   "nimi/local-import-ideogram4-uncond-q4-0",
			FallbackEngines:  []string{"media"},
			HostRequirements: &runtimev1.LocalHostRequirements{GpuRequired: true},
		},
		"runtime_model_ready_after_install",
		"ideogram4 uncond companion installed",
		false,
	)
	if err != nil {
		t.Fatalf("install image companion record: %v", err)
	}

	imageResp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{
		KindFilter: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
	})
	if err != nil {
		t.Fatalf("ListLocalAssets image: %v", err)
	}
	for _, asset := range imageResp.GetAssets() {
		if asset.GetLocalAssetId() == record.GetLocalAssetId() {
			t.Fatalf("image companion must not appear in runnable image listing: %+v", asset)
		}
	}

	auxResp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{
		KindFilter: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
	})
	if err != nil {
		t.Fatalf("ListLocalAssets auxiliary: %v", err)
	}
	if len(auxResp.GetAssets()) != 1 {
		t.Fatalf("auxiliary asset count mismatch: got=%d want=1", len(auxResp.GetAssets()))
	}
	projected := auxResp.GetAssets()[0]
	if got := projected.GetLocalAssetId(); got != record.GetLocalAssetId() {
		t.Fatalf("projected local asset mismatch: got=%q want=%q", got, record.GetLocalAssetId())
	}
	if got := projected.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY {
		t.Fatalf("projected companion kind = %s, want auxiliary", got)
	}
	if !containsString(projected.GetArtifactRoles(), "uncond_diffusion_model") {
		t.Fatalf("projected companion role missing: %#v", projected.GetArtifactRoles())
	}

	svc.mu.RLock()
	stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
	svc.mu.RUnlock()
	if stored == nil {
		t.Fatal("expected stored image companion record")
	}
	if got := stored.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		t.Fatalf("stored kind should remain image for materialization: got=%s", got)
	}
}
