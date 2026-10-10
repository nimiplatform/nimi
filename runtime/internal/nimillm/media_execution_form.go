package nimillm

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// MediaUsesNativeTask follows the actual dispatcher branches, including the
// synchronous variants inside adapters whose names also mention tasks. This
// is a private Host protocol fact, not a public capability or route choice.
func MediaUsesNativeTask(adapter string, request *runtimev1.SubmitScenarioJobRequest, model string) bool {
	modal := scenarioModal(request)
	switch adapter {
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
	case AdapterMiniMaxTask:
		return modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterGLMTask, AdapterLumaTask, AdapterPikaTask, AdapterRunwayTask, AdapterGoogleVeoOperation:
		return modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterKlingTask:
		return modal == runtimev1.Modal_MODAL_IMAGE || modal == runtimev1.Modal_MODAL_VIDEO
	case AdapterFluxNative:
		return modal == runtimev1.Modal_MODAL_IMAGE
	case AdapterMubertMusic:
		return modal == runtimev1.Modal_MODAL_MUSIC
	case AdapterWorldLabsNative, AdapterSpaitialNative:
		return modal == runtimev1.Modal_MODAL_WORLD
	default:
		return false
	}
}
