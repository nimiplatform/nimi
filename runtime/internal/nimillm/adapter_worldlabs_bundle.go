package nimillm

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const WorldBundleMIME = "application/vnd.nimi.world+zip"

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
// Provider URLs stay in Runtime. Apps receive a self-contained, portable
// archive and render its immutable assets through App-private storage.
func buildWorldLabsBundle(ctx context.Context, world map[string]any) ([]byte, error) {
	assets := MapField(world, "assets")
	splats := MapField(assets, "splats")
	semantics := MapField(splats, "semantics_metadata")
	scale := ValueAsFloat64(MapField(semantics, "metric_scale_factor"))
	ground := ValueAsFloat64(MapField(semantics, "ground_plane_offset"))
	if scale <= 0 || math.IsNaN(scale) || math.IsInf(scale, 0) || math.IsNaN(ground) || math.IsInf(ground, 0) {
		return nil, fmt.Errorf("world scale metadata is unavailable or invalid")
	}
	worldID := strings.TrimSpace(ValueAsString(world["world_id"]))
	splatURL := strings.TrimSpace(ValueAsString(MapField(MapField(splats, "spz_urls"), "500k")))
	if worldID == "" || splatURL == "" {
		return nil, fmt.Errorf("world identity or 500k SPZ asset is unavailable")
	}
	manifest := map[string]any{
		"worldId": worldID, "displayName": ValueAsString(world["display_name"]),
		"caption":               ValueAsString(MapField(assets, "caption")),
		"splatCoordinateSystem": "opencv", "metricScaleFactor": scale, "groundPlaneOffset": ground,
		"splatResolution": "500k",
	}
	files := []struct {
		key, name, uri string
	}{
		{"splatPath", "world.spz", splatURL},
		{"colliderPath", "collider.glb", ValueAsString(MapField(MapField(assets, "mesh"), "collider_mesh_url"))},
		{"panoramaPath", "panorama.image", ValueAsString(MapField(MapField(assets, "imagery"), "pano_url"))},
		{"thumbnailPath", "thumbnail.image", ValueAsString(MapField(assets, "thumbnail_url"))},
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for _, file := range files {
		if strings.TrimSpace(file.uri) == "" {
			continue
		}
		data, mime, err := fetchBinaryArtifact(ctx, file.uri)
		if err != nil {
			return nil, fmt.Errorf("download world %s: %w", file.key, err)
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: file.name, Method: zip.Store})
		if err != nil {
			return nil, fmt.Errorf("create world asset entry: %w", err)
		}
		if _, err := entry.Write(data); err != nil {
			return nil, fmt.Errorf("write world asset entry: %w", err)
		}
		manifest[file.key] = file.name
		if file.key == "panoramaPath" || file.key == "thumbnailPath" {
			manifest[strings.TrimSuffix(file.key, "Path")+"MimeType"] = strings.Split(mime, ";")[0]
		}
	}
	metadata, err := json.Marshal(manifest)
	if err != nil {
		return nil, fmt.Errorf("encode world metadata: %w", err)
	}
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: "world.json", Method: zip.Store})
	if err != nil {
		return nil, fmt.Errorf("create world metadata entry: %w", err)
	}
	if _, err := entry.Write(metadata); err != nil {
		return nil, fmt.Errorf("write world metadata entry: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("finish world archive: %w", err)
	}
	return archive.Bytes(), nil
}
