package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

func isCanonicalSupervisedImageAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) bool {
	return isManagedLlamaBackedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine)
}

func canonicalSupervisedImageSelection(
	profile *runtimev1.LocalDeviceProfile,
) engine.ImageSupervisedBackendMatrixSelection {
	if profile == nil {
		return engine.ImageSupervisedBackendMatrixSelection{
			Family:         engine.ImageSupervisedBackendFamilyUnsupported,
			Supported:      false,
			ControlPlane:   engine.EngineLlama,
			ExecutionPlane: engine.EngineMedia,
			Detail:         "device profile unavailable",
		}
	}
	return engine.ResolveImageSupervisedBackendMatrixSelection(
		profile.GetOs(),
		profile.GetArch(),
		profile.GetGpu().GetVendor(),
		profile.GetGpu().GetModel(),
	)
}

func canonicalSupervisedImageSupportDetailForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return ""
	}
	return strings.TrimSpace(canonicalSupervisedImageSelection(profile).Detail)
}

func canonicalSupervisedImageHostSupportedForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) bool {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return true
	}
	return canonicalSupervisedImageSelection(profile).Supported
}

func canonicalSupervisedImageAttachedEndpointDetail(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) string {
	if !isCanonicalSupervisedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return ""
	}
	return "local image assets require runtime supervised execution; attached endpoints are not supported for the canonical GGUF image path"
}
