package nimillm

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildWorldLabsManifestKeepsExecutionProvenanceOutOfStableOutput(t *testing.T) {
	raw, metadata, err := buildWorldLabsManifest(map[string]any{
		"world_id": "world-1",
		"model":    "provider-private-model",
		"assets": map[string]any{
			"thumbnail_url": "https://example.invalid/thumb.png",
		},
	}, "provider-operation-1")
	if err != nil {
		t.Fatal(err)
	}
	manifest := map[string]any{}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"provider", "provider_operation", "model"} {
		if _, ok := manifest[key]; ok {
			t.Fatalf("stable world manifest exposed %s", key)
		}
		if _, ok := metadata[key]; ok {
			t.Fatalf("world artifact metadata exposed %s", key)
		}
	}
	if manifest["world_id"] != "world-1" || metadata["world_id"] != "world-1" {
		t.Fatalf("world identity was not preserved: manifest=%v metadata=%v", manifest, metadata)
	}
}

func TestWorldLabsBundlePreservesAssetsAndSpatialMetadataWithoutProviderURLs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("WLT-Api-Key") != "" {
			t.Error("provider credential forwarded to asset endpoint")
		}
		if r.URL.Path == "/missing" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("asset:" + r.URL.Path))
	}))
	defer server.Close()
	world := map[string]any{
		"world_id": "world-bundle-1", "display_name": "Test garden",
		"assets": map[string]any{
			"splats": map[string]any{
				"spz_urls":           map[string]any{"500k": server.URL + "/scene.spz"},
				"semantics_metadata": map[string]any{"metric_scale_factor": 2.1, "ground_plane_offset": 1.7},
			},
			"mesh": map[string]any{"collider_mesh_url": server.URL + "/collider.glb"},
		},
	}
	ctx := loopbackProviderTestContext(context.Background())
	raw, err := buildWorldLabsBundle(ctx, world)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string][]byte)
	for _, entry := range reader.File {
		stream, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(stream)
		_ = stream.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[entry.Name] = data
	}
	if string(files["world.spz"]) != "asset:/scene.spz" || string(files["collider.glb"]) != "asset:/collider.glb" {
		t.Fatal("archive did not retain the downloaded assets")
	}
	var metadata map[string]any
	if err := json.Unmarshal(files["world.json"], &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["metricScaleFactor"] != 2.1 || metadata["groundPlaneOffset"] != 1.7 || metadata["splatCoordinateSystem"] != "opencv" {
		t.Fatalf("spatial metadata was lost: %v", metadata)
	}
	if bytes.Contains(files["world.json"], []byte(server.URL)) {
		t.Fatal("world archive exposed a provider URL")
	}
	world["assets"].(map[string]any)["mesh"] = map[string]any{"collider_mesh_url": server.URL + "/missing"}
	if _, err := buildWorldLabsBundle(ctx, world); err == nil || !strings.Contains(err.Error(), "colliderPath") {
		t.Fatalf("missing asset did not fail the bundle: %v", err)
	}
}
