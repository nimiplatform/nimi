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
	if canonicalProviderKey(trimmed) != trimmed {
		return false
	}
	switch trimmed {
	case "local", "nexa", "nimi_media", "nimillm", "openai", "anthropic", "dashscope", "volcengine", "azure", "mistral", "groq", "xai", "qianfan", "hunyuan", "spark", "volcengine_openspeech", "gemini", "minimax", "kimi", "glm", "deepseek", "openrouter", "openai_compatible":
		return true
	default:
		return false
	}
}

func canonicalProviderKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// fileConfigEngineBool extracts the Enabled *bool for the named engine from FileConfig.
func fileConfigEngineBool(fileCfg FileConfig, engine string) *bool {
	if fileCfg.Engines == nil {
		return nil
	}
	switch engine {
	case "localai":
		if fileCfg.Engines.LocalAI != nil {
			return fileCfg.Engines.LocalAI.Enabled
		}
	case "nexa":
		if fileCfg.Engines.Nexa != nil {
			return fileCfg.Engines.Nexa.Enabled
		}
	case "nimi_media":
		if fileCfg.Engines.NimiMedia != nil {
			return fileCfg.Engines.NimiMedia.Enabled
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
	case "localai":
		cfg = fileCfg.Engines.LocalAI
	case "nexa":
		cfg = fileCfg.Engines.Nexa
	case "nimi_media":
		cfg = fileCfg.Engines.NimiMedia
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
	case "localai":
		cfg = fileCfg.Engines.LocalAI
	case "nexa":
		cfg = fileCfg.Engines.Nexa
	case "nimi_media":
		cfg = fileCfg.Engines.NimiMedia
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

func fileConfigLocalAIImageBackendString(fileCfg FileConfig, field string) string {
	if fileCfg.Engines == nil || fileCfg.Engines.LocalAI == nil || fileCfg.Engines.LocalAI.ImageBackend == nil {
		return ""
	}
	cfg := fileCfg.Engines.LocalAI.ImageBackend
	switch field {
	case "mode":
		return cfg.Mode
	case "backendName":
		return cfg.BackendName
	case "address":
		return cfg.Address
	case "command":
		return cfg.Command
	case "workingDir":
		return cfg.WorkingDir
	default:
		return ""
	}
}

func fileConfigLocalAIImageBackendArgs(fileCfg FileConfig) []string {
	if fileCfg.Engines == nil || fileCfg.Engines.LocalAI == nil || fileCfg.Engines.LocalAI.ImageBackend == nil {
		return nil
	}
	return append([]string(nil), fileCfg.Engines.LocalAI.ImageBackend.Args...)
}

func fileConfigLocalAIImageBackendEnv(fileCfg FileConfig) map[string]string {
	if fileCfg.Engines == nil || fileCfg.Engines.LocalAI == nil || fileCfg.Engines.LocalAI.ImageBackend == nil {
		return nil
	}
	return normalizeStringMap(fileCfg.Engines.LocalAI.ImageBackend.Env)
}
