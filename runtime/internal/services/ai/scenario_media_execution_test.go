package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type fakeLocalImageProfileResolver struct {
	alias               string
	profile             map[string]any
	forwardedExtensions map[string]any
}

func (f *fakeLocalImageProfileResolver) ResolveManagedMediaImageProfile(_ context.Context, _ string, _ map[string]any) (string, map[string]any, map[string]any, error) {
	return f.alias, f.profile, f.forwardedExtensions, nil
}

func (f *fakeLocalImageProfileResolver) ResolveManagedAssetPath(_ context.Context, _ string) (string, error) {
	return "", nil
}

func TestExecuteBackendSyncMediaImageUsesManagedPathWhenProfileResolverReturnsManagedModel(t *testing.T) {
	t.Helper()

	var (
		importCalled    bool
		generateModelID string
		generateStep    float64
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/models/import":
			importCalled = true
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
			})
		case "/v1/media/image/generate":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode image request: %v", err)
			}
			generateModelID, _ = payload["model"].(string)
			spec, _ := payload["spec"].(map[string]any)
			extensions, _ := spec["extensions"].(map[string]any)
			generateStep, _ = extensions["step"].(float64)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artifact": map[string]any{
					"mime_type":   "image/png",
					"data_base64": base64.StdEncoding.EncodeToString([]byte("png")),
				},
			})
		default:
			t.Fatalf("unexpected request path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	svc := &Service{
		localImageProfile: &fakeLocalImageProfileResolver{
			alias: "managed-image-alias",
			profile: map[string]any{
				"model": "managed-image-alias",
			},
			forwardedExtensions: map[string]any{
				"step": 25,
			},
		},
	}
	selectedProvider := &localProvider{
		media: nimillm.NewBackend("local-media", server.URL, "", 0),
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			ModelId: "local-import/z_image_turbo-Q4_K",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	}

	artifacts, _, _, err := executeBackendSyncMedia(
		context.Background(),
		svc,
		nil,
		req,
		selectedProvider,
		"media/local-import/z_image_turbo-Q4_K",
		adapterMediaNative,
		nil,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("executeBackendSyncMedia: %v", err)
	}
	if !importCalled {
		t.Fatal("expected managed media import to be called")
	}
	if generateModelID != "managed-image-alias" {
		t.Fatalf("expected managed image alias, got %q", generateModelID)
	}
	if generateStep != 25 {
		t.Fatalf("expected managed image forwarded step=25, got %v", generateStep)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one artifact, got %d", len(artifacts))
	}
}
