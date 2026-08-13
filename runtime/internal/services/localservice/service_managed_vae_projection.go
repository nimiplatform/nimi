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
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE:
		family, ok := managedImageVAEFamilyFromPath(entryPath)
		if !ok {
			return managedImagePassiveProjection{}, false
		}
		return managedImagePassiveProjection{
			Family:        family,
			ArtifactRoles: []string{"vae"},
		}, true
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA:
		// LoRA safetensors carry no runtime-readable family metadata, so the
		// family is inferred from the entry file name — the same name-based
		// inference used for artifact roles elsewhere. Unknown names fail
		// closed with no projection.
		family := normalizeManagedImageProjectionFamily(filepath.Base(strings.TrimSpace(entryPath)))
		if family == "" {
			return managedImagePassiveProjection{}, false
		}
		return managedImagePassiveProjection{
			Family:        family,
			ArtifactRoles: []string{"lora"},
		}, true
	default:
		return managedImagePassiveProjection{}, false
	}
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

func healManagedImagePassiveProjection(modelsRoot string, record *runtimev1.LocalAssetRecord, logger *slog.Logger) bool {
	if record == nil || invalidProfileRuntimeImageModelFamily(record.GetFamily()) {
		return false
	}
	switch effectiveAssetKind(record.GetKind(), record.GetCapabilities()) {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA:
	default:
		return false
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, record)
	if err != nil {
		if logger != nil {
			logger.Warn("skip managed image passive projection self-heal: resolve entry failed",
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
	if normalizedImageFamily == "" {
		return false
	}
	switch normalizedImageFamily {
	case "z-image":
		// The admitted Comfy-Org/z_image_turbo ae.safetensors is the FLUX.1
		// VAE: its 16-channel latent shape projects above as flux1-vae, which
		// is the shape consumed by the stable-diffusion.cpp Z-Image backend.
		return normalizedVAEFamily == "flux1-vae"
	case "ideogram4":
		return normalizedVAEFamily == "flux2-vae"
	default:
		return true
	}
}
