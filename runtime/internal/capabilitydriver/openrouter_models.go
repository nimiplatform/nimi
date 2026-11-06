package capabilitydriver

// Reviewed model-specific gateway contracts. Remote discovery never mutates these mappings.
func openRouterTextPolicies() []openRouterTextPolicy {
	return []openRouterTextPolicy{
		{model: "openai/gpt-6.1-terra", efforts: "max xhigh high medium low", maxOutput: 128000, off: true, vision: true, schema: true},
		{model: "openai/gpt-6.1-sol", efforts: "max xhigh high medium low", maxOutput: 128000, off: false, vision: true, schema: true},
		{model: "openai/gpt-6-astra", efforts: "max xhigh high medium low", maxOutput: 128000, off: false, vision: true, schema: true},
		{model: "openai/gpt-6-luna", efforts: "max xhigh high medium low", maxOutput: 128000, off: true, vision: true, schema: true},
		{model: "anthropic/claude-fable-5.1", efforts: "max xhigh high medium low", maxOutput: 128000, off: false, vision: true, schema: true},
		{model: "anthropic/claude-opus-5.5", efforts: "max xhigh high medium low", maxOutput: 128000, off: false, vision: true, schema: true},
		{model: "anthropic/claude-sonnet-5.5", efforts: "max xhigh high medium low", maxOutput: 128000, off: false, vision: true, schema: true},
		{model: "anthropic/claude-haiku-5.5", efforts: "max xhigh high medium low", maxOutput: 128000, off: true, vision: true, schema: true},
		{model: "google/gemini-4-argon", efforts: "high medium low", maxOutput: 943718, off: false, vision: true, schema: true},
		{model: "google/gemini-3.8-flash", efforts: "high medium low", maxOutput: 65536, off: false, vision: true, schema: true},
		{model: "x-ai/grok-4.7", efforts: "xhigh high medium low", maxOutput: 0, off: false, vision: true, schema: true},
		{model: "moonshotai/kimi-k3.1-pro", efforts: "max high low", maxOutput: 943718, off: true, vision: true, schema: true},
		{model: "moonshotai/kimi-k3", efforts: "max high low", maxOutput: 943718, off: true, vision: true, schema: true},
		{model: "deepseek/deepseek-v4.1-flash-1017", efforts: "max high low", maxOutput: 393216, off: true, vision: true, schema: true},
		{model: "z-ai/glm-5.3", efforts: "max high low", maxOutput: 943718, off: false, vision: false, schema: true},
		{model: "z-ai/glm-5.3-flash", efforts: "max high low", maxOutput: 943717, off: false, vision: true, schema: true},
		{model: "z-ai/glm-5.3-flashx", efforts: "max high low", maxOutput: 131072, off: false, vision: true, schema: false},
		{model: "z-ai/glm-5.3-flashx-legal", efforts: "max high low", maxOutput: 131072, off: false, vision: true, schema: true},
		{model: "minimax/minimax-m3.1-flash", efforts: "max xhigh high medium low", maxOutput: 524288, off: false, vision: true, schema: true},
	}
}

const OpenRouterSpeechModel = "mistralai/voxtral-mini-tts-3-0"
const OpenRouterVideoModel = "google/gemini-omni-1.2-flash"

func IsOpenRouterImageModel(m string) bool {
	return m == "openai/gpt-image-2.6-flare" || m == "openai/gpt-image-2.6-sunburst" || m == "google/gemini-nano-banana-2.1"
}
func IsOpenRouterTranscribeModel(m string) bool {
	return m == "openai/gpt-transcribe" || m == "mistralai/voxtral-mini-transcribe-3-0"
}
func OpenRouterEmbedDimensions(m string) uint32 {
	switch m {
	case "cohere/embed-5-fast", "cohere/embed-5-pro":
		return 2048
	case "openai/text-embedding-3-small":
		return 1536
	case "openai/text-embedding-3-large":
		return 3072
	}
	return 0
}

func OpenRouterEmbeddingNativeModel(model string) string {
	switch model {
	case "cohere/embed-5-fast":
		return "embed-v5.0-fast"
	case "cohere/embed-5-pro":
		return "embed-v5.0-pro"
	case "openai/text-embedding-3-small":
		return "text-embedding-3-small"
	case "openai/text-embedding-3-large":
		return "text-embedding-3-large"
	default:
		return ""
	}
}

func OpenRouterSpeechVoices() []string {
	return []string{"voice_3150", "voice_478", "voice_447", "voice_485", "en_paul_sad", "en_paul_neutral", "en_paul_happy", "en_paul_frustrated", "en_paul_excited", "en_paul_confident", "en_paul_cheerful", "en_paul_angry", "voice_3149", "voice_3147", "voice_591", "voice_590", "voice_1788", "voice_1787", "voice_1786", "gb_oliver_neutral", "gb_jane_sarcasm", "gb_jane_confused", "gb_oliver_sad", "gb_oliver_excited", "gb_oliver_curious", "gb_oliver_confident", "gb_oliver_cheerful", "gb_oliver_angry", "gb_jane_shameful", "gb_jane_sad", "gb_jane_neutral", "gb_jane_jealousy", "gb_jane_frustrated", "gb_jane_curious", "gb_jane_confident", "voice_479", "voice_3143", "voice_481", "voice_483", "voice_592", "voice_3137", "voice_589", "voice_3141", "fr_marie_sad", "fr_marie_neutral", "fr_marie_happy", "fr_marie_excited", "fr_marie_curious", "fr_marie_angry", "voice_3153", "voice_3139", "voice_3146", "voice_482", "voice_3133", "voice_3136", "voice_3135", "voice_3145", "voice_3134", "voice_3154", "voice_480", "voice_3155", "voice_3132", "voice_3138", "voice_3140", "voice_3144", "voice_3142"}
}
