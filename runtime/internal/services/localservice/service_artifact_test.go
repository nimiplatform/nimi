package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

func TestLocalImportLocalArtifactAndList(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	artifactDir := filepath.Join(modelsRoot, "local-z-image-ae")
	if err := os.MkdirAll(filepath.Join(artifactDir, "vae"), 0o755); err != nil {
		t.Fatalf("mkdir artifact dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(artifactDir, "vae", "diffusion_pytorch_model.safetensors"), []byte("vae"), 0o600); err != nil {
		t.Fatalf("write artifact payload: %v", err)
	}
	manifestPath := filepath.Join(artifactDir, "artifact.manifest.json")
	manifestBody, err := json.Marshal(map[string]any{
		"schemaVersion": "1.0.0",
		"artifactId":    "local/z_image_ae",
		"kind":          "vae",
		"engine":        "localai",
		"entry":         "vae/diffusion_pytorch_model.safetensors",
		"files":         []string{"vae/diffusion_pytorch_model.safetensors"},
		"license":       "tongyi",
		"source": map[string]any{
			"repo":     "file://" + manifestPath,
			"revision": "import",
		},
		"hashes": map[string]any{
			"vae/diffusion_pytorch_model.safetensors": "sha256:test",
		},
		"metadata": map[string]any{
			"family": "z-image",
		},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestBody, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	imported, err := svc.ImportLocalArtifact(context.Background(), &runtimev1.ImportLocalArtifactRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import artifact: %v", err)
	}
	if imported.GetArtifact().GetKind() != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE {
		t.Fatalf("unexpected artifact kind: %s", imported.GetArtifact().GetKind())
	}

	listed, err := svc.ListLocalArtifacts(context.Background(), &runtimev1.ListLocalArtifactsRequest{
		KindFilter: runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE,
	})
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	if len(listed.GetArtifacts()) != 1 {
		t.Fatalf("expected one artifact, got %d", len(listed.GetArtifacts()))
	}
	if listed.GetArtifacts()[0].GetArtifactId() != "local/z_image_ae" {
		t.Fatalf("unexpected artifact id: %q", listed.GetArtifacts()[0].GetArtifactId())
	}
}

func TestInstallVerifiedArtifactDownloadsFilesAndWritesManifest(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	payload := []byte("verified-vae")
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	svc.hfDownloadBaseURL = server.URL
	svc.verifiedArtifacts = []*runtimev1.LocalVerifiedArtifactDescriptor{
		{
			TemplateId: "verified.artifact.z_image.vae",
			Title:      "Z-Image AE",
			ArtifactId: "local/z_image_ae",
			Kind:       runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE,
			Engine:     "localai",
			Entry:      "vae/diffusion_pytorch_model.safetensors",
			Files:      []string{"vae/diffusion_pytorch_model.safetensors"},
			License:    "tongyi",
			Repo:       "Tongyi-MAI/Z-Image-Turbo",
			Revision:   "main",
			Hashes: map[string]string{
				"vae/diffusion_pytorch_model.safetensors": fmt.Sprintf("sha256:%x", sum),
			},
		},
	}

	resp, err := svc.InstallVerifiedArtifact(context.Background(), &runtimev1.InstallVerifiedArtifactRequest{
		TemplateId: "verified.artifact.z_image.vae",
	})
	if err != nil {
		t.Fatalf("install verified artifact: %v", err)
	}
	if resp.GetArtifact().GetArtifactId() != "local/z_image_ae" {
		t.Fatalf("unexpected artifact id: %q", resp.GetArtifact().GetArtifactId())
	}

	artifactDir := filepath.Join(modelsRoot, slugifyLocalModelID("local/z_image_ae"))
	artifactPath := filepath.Join(artifactDir, "vae", "diffusion_pytorch_model.safetensors")
	raw, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("read installed artifact payload: %v", err)
	}
	if !bytes.Equal(raw, payload) {
		t.Fatalf("unexpected installed artifact payload: got=%q want=%q", string(raw), string(payload))
	}

	manifestRaw, err := os.ReadFile(filepath.Join(artifactDir, "artifact.manifest.json"))
	if err != nil {
		t.Fatalf("read artifact manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatalf("unmarshal artifact manifest: %v", err)
	}
	if manifest["artifactId"] != "local/z_image_ae" {
		t.Fatalf("unexpected manifest artifactId: %#v", manifest["artifactId"])
	}
	hashes, ok := manifest["hashes"].(map[string]any)
	if !ok {
		t.Fatalf("manifest hashes missing or invalid: %#v", manifest["hashes"])
	}
	if hashes["vae/diffusion_pytorch_model.safetensors"] != fmt.Sprintf("sha256:%x", sum) {
		t.Fatalf("unexpected manifest hash: %#v", hashes["vae/diffusion_pytorch_model.safetensors"])
	}
}

func TestInstallVerifiedArtifactHashMismatchRollsBack(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("wrong-hash"))
	}))
	defer server.Close()

	svc.hfDownloadBaseURL = server.URL
	svc.verifiedArtifacts = []*runtimev1.LocalVerifiedArtifactDescriptor{
		{
			TemplateId: "verified.artifact.z_image.vae",
			Title:      "Z-Image AE",
			ArtifactId: "local/z_image_ae",
			Kind:       runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE,
			Engine:     "localai",
			Entry:      "vae/diffusion_pytorch_model.safetensors",
			Files:      []string{"vae/diffusion_pytorch_model.safetensors"},
			License:    "tongyi",
			Repo:       "Tongyi-MAI/Z-Image-Turbo",
			Revision:   "main",
			Hashes: map[string]string{
				"vae/diffusion_pytorch_model.safetensors": "sha256:deadbeef",
			},
		},
	}

	if _, err := svc.InstallVerifiedArtifact(context.Background(), &runtimev1.InstallVerifiedArtifactRequest{
		TemplateId: "verified.artifact.z_image.vae",
	}); err == nil {
		t.Fatalf("expected hash mismatch error")
	}

	artifactDir := filepath.Join(modelsRoot, slugifyLocalModelID("local/z_image_ae"))
	if _, err := os.Stat(artifactDir); !os.IsNotExist(err) {
		t.Fatalf("artifact dir should be absent after rollback, stat err=%v", err)
	}

	listed, err := svc.ListLocalArtifacts(context.Background(), &runtimev1.ListLocalArtifactsRequest{})
	if err != nil {
		t.Fatalf("list artifacts after failed install: %v", err)
	}
	if len(listed.GetArtifacts()) != 0 {
		t.Fatalf("expected no installed artifacts after rollback, got %d", len(listed.GetArtifacts()))
	}
}

func TestRemoveLocalArtifactUsesReasonCodes(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.RemoveLocalArtifact(ctx, &runtimev1.RemoveLocalArtifactRequest{})
	assertGRPCCode(t, err, "RemoveLocalArtifact(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "RemoveLocalArtifact(empty_id)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.RemoveLocalArtifact(ctx, &runtimev1.RemoveLocalArtifactRequest{
		LocalArtifactId: "artifact_missing",
	})
	assertGRPCCode(t, err, "RemoveLocalArtifact(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "RemoveLocalArtifact(not_found)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}
