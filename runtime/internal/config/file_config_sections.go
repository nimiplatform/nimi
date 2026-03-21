package config

import "strings"

// fileConfigJWTField extracts a string field from the optional FileConfig Auth JWT section.
func fileConfigJWTField(fileCfg FileConfig, getter func(*FileConfigJWT) string) string {
	if fileCfg.Auth != nil && fileCfg.Auth.JWT != nil {
		return getter(fileCfg.Auth.JWT)
	}
	return ""
}

func isCanonicalProviderName(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}
	if normalizedProviderKey(trimmed) != trimmed {
		return false
	}
	switch trimmed {
	case "nimillm", "openai", "anthropic", "dashscope", "volcengine", "azure", "mistral", "groq", "xai", "qianfan", "hunyuan", "spark", "volcengine_openspeech", "gemini", "minimax", "kimi", "glm", "deepseek", "openrouter", "openai_compatible":
		return true
	default:
		return false
	}
}

func normalizedProviderKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// fileConfigEngineBool extracts the Enabled *bool for the named engine from FileConfig.
func fileConfigEngineBool(fileCfg FileConfig, engine string) *bool {
	if fileCfg.Engines == nil {
		return nil
	}
	switch engine {
	case "llama":
		if fileCfg.Engines.Llama != nil {
			return fileCfg.Engines.Llama.Enabled
		}
	case "media":
		if fileCfg.Engines.Media != nil {
			return fileCfg.Engines.Media.Enabled
		}
	case "speech":
		if fileCfg.Engines.Speech != nil {
			return fileCfg.Engines.Speech.Enabled
		}
	}
	return nil
}

// fileConfigEngineString extracts a string field for the named engine from FileConfig.
func fileConfigEngineString(fileCfg FileConfig, engine string, field string) string {
	if fileCfg.Engines == nil {
		return ""
	}
	var cfg *FileConfigEngine
	switch engine {
	case "llama":
		cfg = fileCfg.Engines.Llama
	case "media":
		cfg = fileCfg.Engines.Media
	case "speech":
		cfg = fileCfg.Engines.Speech
	}
	if cfg == nil {
		return ""
	}
	switch field {
	case "version":
		return cfg.Version
	}
	return ""
}

// fileConfigEngineInt extracts a *int field for the named engine from FileConfig.
func fileConfigEngineInt(fileCfg FileConfig, engine string, field string) *int {
	if fileCfg.Engines == nil {
		return nil
	}
	var cfg *FileConfigEngine
	switch engine {
	case "llama":
		cfg = fileCfg.Engines.Llama
	case "media":
		cfg = fileCfg.Engines.Media
	case "speech":
		cfg = fileCfg.Engines.Speech
	}
	if cfg == nil {
		return nil
	}
	switch field {
	case "port":
		return cfg.Port
	}
	return nil
}
