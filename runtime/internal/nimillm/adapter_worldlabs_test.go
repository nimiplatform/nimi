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

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func TestWorldLabsNativeOperationPackagesCurrentWorldIDWithoutEstimatedUsage(t *testing.T) {
	var world map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/marble/v1/worlds:generate":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["model"] != "marble-1.1" || MapField(body["permission"], "public") != false || MapField(body["world_prompt"], "text_prompt") != "A fictional sunlit reading room." {
				t.Errorf("native world request=%+v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": "operation-1"})
		case "/marble/v1/operations/operation-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"done": true, "metadata": map[string]any{"world_id": "world-current"}, "response": world})
		case "/marble/v1/worlds/world-current":
			_ = json.NewEncoder(w).Encode(map[string]any{"world_id": "world-current", "assets": world["assets"]})
		case "/scene.spz":
			if r.Header.Get("WLT-Api-Key") != "" {
				t.Error("world credential escaped to asset download")
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = io.WriteString(w, "owned scene bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	world = map[string]any{"id": "world-current", "assets": map[string]any{"splats": map[string]any{
		"spz_urls": map[string]any{"500k": server.URL + "/scene.spz"}, "semantics_metadata": map[string]any{"metric_scale_factor": 1.2, "ground_plane_offset": 0.0},
	}}}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{TextPrompt: "A fictional sunlit reading room."}}}}
	artifacts, usage, operation, err := ExecuteWorldLabsWorld(loopbackProviderTestContext(context.Background()), MediaAdapterConfig{BaseURL: server.URL, APIKey: "key", AllowLoopbackEndpoint: true}, noopJobStateUpdater{}, "job-1", req, "marble-1.1")
	if err != nil || usage != nil || operation != "operation-1" || len(artifacts) != 2 || artifacts[1].GetMimeType() != WorldBundleMIME {
		t.Fatalf("current world packaging artifacts=%+v usage=%+v operation=%q err=%v", artifacts, usage, operation, err)
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
	semantics := world["assets"].(map[string]any)["splats"].(map[string]any)["semantics_metadata"].(map[string]any)
	delete(semantics, "ground_plane_offset")
	if _, err := buildWorldLabsBundle(ctx, world); err == nil {
		t.Fatal("missing ground metadata became a guessed zero")
	}
	semantics["ground_plane_offset"] = float64(0)
	if _, err := buildWorldLabsBundle(ctx, world); err != nil {
		t.Fatalf("reported zero ground offset was rejected: %v", err)
	}
	world["assets"].(map[string]any)["mesh"] = map[string]any{"collider_mesh_url": server.URL + "/missing"}
	if _, err := buildWorldLabsBundle(ctx, world); err == nil || !strings.Contains(err.Error(), "colliderPath") {
		t.Fatalf("missing asset did not fail the bundle: %v", err)
	}
}

func TestWorldLabsDocumentedGetEnvelopesNormalizeOneCapturedIdentity(t *testing.T) {
	for _, response := range []map[string]any{
		{"world_id": "world-1", "display_name": "Room"},
		{"world": map[string]any{"id": "world-1", "display_name": "Room"}},
	} {
		world, envelope, err := normalizeWorldLabsGetResponse(response, "world-1")
		if err != nil || world["world_id"] != "world-1" || world["id"] != nil || world["display_name"] != "Room" || envelope == "" {
			t.Fatalf("documented envelope lost captured identity: %+v %q %v", world, envelope, err)
		}
	}
	for _, response := range []map[string]any{
		{"id": "world-1"},
		{"world_id": "foreign-world"},
		{"world": map[string]any{"id": "foreign-world"}},
		{"world_id": "world-1", "world": map[string]any{"id": "world-1"}},
	} {
		if _, _, err := normalizeWorldLabsGetResponse(response, "world-1"); err == nil {
			t.Fatalf("ambiguous or wrong world accepted: %+v", response)
		}
	}
	if _, err := worldLabsOperationWorldID(map[string]any{"metadata": map[string]any{"world_id": "world-1"}, "response": map[string]any{"id": "foreign-world"}}); err == nil {
		t.Fatal("operation response escaped its captured world identity")
	}
}

func TestWorldLabsGetFailureDoesNotFallbackToOperationSnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()
	if world, err := fetchWorldLabsWorld(loopbackProviderTestContext(context.Background()), server.URL, nil, map[string]any{
		"metadata": map[string]any{"world_id": "world-1"}, "response": map[string]any{"id": "world-1", "assets": map[string]any{}},
	}); err == nil || world != nil {
		t.Fatalf("failed GET became a snapshot success: %+v err=%v", world, err)
	}
}
