package capabilitydriver

func SiliconFlowEmbedDimensions(model string) uint32 {
	switch model {
	case "Qwen/Qwen3-Embedding-0.6B":
		return 1024
	case "Qwen/Qwen3-Embedding-4B":
		return 2560
	case "Qwen/Qwen3-Embedding-8B", "Qwen/Qwen3-VL-Embedding-8B":
		return 4096
	default:
		return 0
	}
}
func SiliconFlowEmbedDimensionAllowed(model string, width uint32) bool {
	if width > SiliconFlowEmbedDimensions(model) {
		return false
	}
	switch width {
	case 64, 128, 256, 512, 768, 1024, 1536, 2048, 2560, 4096:
		return true
	default:
		return false
	}
}
