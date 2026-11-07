package nimillm

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// MediaUsesNativeTask follows the actual dispatcher branches, including the
// synchronous variants inside adapters whose names also mention tasks. This
// is a private Host protocol fact, not a public capability or route choice.
func MediaUsesNativeTask(adapter string, request *runtimev1.SubmitScenarioJobRequest, model string) bool {
	modal := scenarioModal(request)
	switch adapter {
	case AdapterTogetherVideo:
		return modal == runtimev1.Modal_MODAL_VIDEO && capabilitydriver.IsTogetherVideoModel(model)
	case AdapterXAIImage:
		return modal == runtimev1.Modal_MODAL_IMAGE && capabilitydriver.IsXAIImageModel(model)
	case AdapterXAIVideo:
		return modal == runtimev1.Modal_MODAL_VIDEO && capabilitydriver.IsXAIVideoModel(model)
	case AdapterOpenRouterVideo:
		return modal == runtimev1.Modal_MODAL_VIDEO && model == capabilitydriver.OpenRouterVideoModel
	case AdapterBytedanceARKTask:
		return modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterAlibabaNative:
		if modal == runtimev1.Modal_MODAL_VIDEO {
			return true
		}
		if modal != runtimev1.Modal_MODAL_IMAGE || isDashscopeQwen3ImageModel(model) {
			return false
		}
		contract := resolveDashScopeImageRequestContract(model)
		return contract == dashScopeImageRequestContractAsyncTask || contract == dashScopeImageRequestContractAsyncText2Image
	case AdapterMiniMaxTask, AdapterMiniMaxH3Video:
		return modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterPikaTask:
		return modal == runtimev1.Modal_MODAL_VIDEO && capabilitydriver.IsPikaVideoModel(model)
	case AdapterRunwayTask:
		return modal == runtimev1.Modal_MODAL_VIDEO && capabilitydriver.IsRunwayVideoModel(model)
	case AdapterGLMTask, AdapterLumaTask, AdapterLumaRay32, AdapterGeminiOmniVideo:
		return modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterKlingTask:
		return modal == runtimev1.Modal_MODAL_IMAGE && capabilitydriver.IsKlingImageModel(model) || modal == runtimev1.Modal_MODAL_VIDEO && capabilitydriver.IsKlingVideoModel(model)
	case AdapterIdeogramNative:
		return modal == runtimev1.Modal_MODAL_IMAGE && model == "ideogram-4-5"
	case AdapterLumaUniImage:
		return modal == runtimev1.Modal_MODAL_IMAGE
	case AdapterFluxNative:
		return modal == runtimev1.Modal_MODAL_IMAGE || modal == runtimev1.Modal_MODAL_VIDEO && model == "flux-3-video"
	case AdapterMubertMusic:
		return modal == runtimev1.Modal_MODAL_MUSIC
	case AdapterSoundverseMusic:
		return modal == runtimev1.Modal_MODAL_MUSIC && capabilitydriver.IsSoundverseMusicModel(model)
	case AdapterStabilityMusic:
		return modal == runtimev1.Modal_MODAL_MUSIC && model == "stable-audio-3"
	case AdapterWorldLabsNative, AdapterSpaitialNative:
		return modal == runtimev1.Modal_MODAL_WORLD
	default:
		return false
	}
}
