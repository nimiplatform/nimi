package nimillm

import "time"

// CloudConfig holds all cloud provider connection parameters.
type CloudConfig struct {
	NimiLLMBaseURL             string
	NimiLLMAPIKey              string
	AlibabaBaseURL             string
	AlibabaAPIKey              string
	BytedanceBaseURL           string
	BytedanceAPIKey            string
	BytedanceSpeechBaseURL     string
	BytedanceSpeechAPIKey      string
	GeminiBaseURL              string
	GeminiAPIKey               string
	MiniMaxBaseURL             string
	MiniMaxAPIKey              string
	KimiBaseURL                string
	KimiAPIKey                 string
	GLMBaseURL                 string
	GLMAPIKey                  string
	HTTPTimeout                time.Duration
}
