package localservice

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const maxSafetensorsHeaderBytes = 16 * 1024 * 1024

type managedImagePassiveProjection struct {
	Family        string
	ArtifactRoles []string
}

type safetensorsTensorHeader struct {
	DType       string  `json:"dtype"`
	Shape       []int64 `json:"shape"`
	DataOffsets []int64 `json:"data_offsets"`
}

func managedImagePassiveProjectionForAsset(kind runtimev1.LocalAssetKind, entryPath string) (managedImagePassiveProjection, bool) {
	if kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
		return managedImagePassiveProjection{}, false
	}
	family, ok := managedImageVAEFamilyFromPath(entryPath)
	if !ok {
		return managedImagePassiveProjection{}, false
	}
	return managedImagePassiveProjection{
		Family:        family,
		ArtifactRoles: []string{"vae"},
	}, true
}

func managedImageVAEFamilyFromPath(path string) (string, bool) {
	if strings.ToLower(filepath.Ext(strings.TrimSpace(path))) != ".safetensors" {
		return "", false
	}
	tensors, err := readSafetensorsTensorHeaders(path)
	if err != nil {
		return "", false
	}
	for _, name := range []string{
		"first_stage_model.decoder.conv_in.weight",
		"decoder.conv_in.weight",
		"vae.decoder.conv_in.weight",
	} {
		tensor, ok := tensors[name]
		if !ok {
			continue
		}
		if family, ok := managedImageVAEFamilyFromConvInShape(tensor.Shape); ok {
			return family, true
		}
	}
	return "", false
}

func managedImageVAEFamilyFromConvInShape(shape []int64) (string, bool) {
	if len(shape) != 4 {
		return "", false
	}
	switch shape[1] {
	case 16:
		return "flux1-vae", true
	case 32:
		return "flux2-vae", true
	default:
		return "", false
	}
}

func readSafetensorsTensorHeaders(path string) (map[string]safetensorsTensorHeader, error) {
	file, err := os.Open(strings.TrimSpace(path))
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = file.Close()
	}()

	headerLengthBytes := make([]byte, 8)
	if _, err := io.ReadFull(file, headerLengthBytes); err != nil {
		return nil, fmt.Errorf("read safetensors header length: %w", err)
	}
	headerLength := binary.LittleEndian.Uint64(headerLengthBytes)
	if headerLength == 0 || headerLength > maxSafetensorsHeaderBytes {
		return nil, fmt.Errorf("safetensors header length is unsupported: %d", headerLength)
	}
	headerBytes := make([]byte, int(headerLength))
	if _, err := io.ReadFull(file, headerBytes); err != nil {
		return nil, fmt.Errorf("read safetensors header: %w", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(headerBytes, &raw); err != nil {
		return nil, fmt.Errorf("parse safetensors header: %w", err)
	}
	tensors := make(map[string]safetensorsTensorHeader, len(raw))
	for name, payload := range raw {
		if strings.TrimSpace(name) == "" || name == "__metadata__" {
			continue
		}
		var tensor safetensorsTensorHeader
		if err := json.Unmarshal(payload, &tensor); err != nil {
			continue
		}
		if len(tensor.Shape) == 0 {
			continue
		}
		tensors[name] = tensor
	}
	return tensors, nil
}

func healManagedImageVAEProjection(modelsRoot string, record *runtimev1.LocalAssetRecord, logger *slog.Logger) bool {
	if record == nil || effectiveAssetKind(record.GetKind(), record.GetCapabilities()) != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
		return false
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, record)
	if err != nil {
		if logger != nil {
			logger.Warn("skip managed image vae projection self-heal: resolve entry failed",
				"local_asset_id", record.GetLocalAssetId(),
				"error", err,
			)
		}
		return false
	}
	projection, ok := managedImagePassiveProjectionForAsset(record.GetKind(), entryPath)
	if !ok {
		return false
	}
	healed := false
	if strings.TrimSpace(projection.Family) != "" && strings.TrimSpace(record.GetFamily()) != projection.Family {
		record.Family = projection.Family
		healed = true
	}
	if len(projection.ArtifactRoles) > 0 && !stringSlicesEqual(record.GetArtifactRoles(), projection.ArtifactRoles) {
		record.ArtifactRoles = normalizeStringSlice(projection.ArtifactRoles)
		healed = true
	}
	return healed
}

func normalizeManagedImageVAEFamily(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch normalized {
	case "flux", "flux1", "flux-1", "flux-vae", "flux1-vae", "flux-1-vae":
		return "flux1-vae"
	case "flux2", "flux-2", "flux2-vae", "flux-2-vae", "ideogram4-vae", "ideogram-4-vae":
		return "flux2-vae"
	default:
		return normalized
	}
}

func managedImageVAEFamilyCompatibleWithImageFamily(imageFamily string, vaeFamily string) bool {
	normalizedImageFamily := normalizeProfileRuntimeImageModelFamily(imageFamily)
	normalizedVAEFamily := normalizeManagedImageVAEFamily(vaeFamily)
	switch normalizedImageFamily {
	case "z-image", "z-image-turbo":
		// The admitted Comfy-Org/z_image_turbo ae.safetensors has the
		// 32-channel latent shape projected above as flux2-vae, which is also
		// the shape consumed by the stable-diffusion.cpp Z-Image backend.
		return normalizedVAEFamily == "flux2-vae"
	case "ideogram4":
		return normalizedVAEFamily == "flux2-vae"
	default:
		return true
	}
}
