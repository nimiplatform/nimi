package remoteexecution

import "testing"

type speechEndpointTarget struct{ provider, model, capability string }

func (t speechEndpointTarget) Provider() string             { return t.provider }
func (t speechEndpointTarget) ProviderModelID() string      { return t.model }
func (t speechEndpointTarget) RemoteModelCatalogID() string { return "catalog" }
func (t speechEndpointTarget) CapabilityContract() string   { return t.capability }

func TestDashScopeSpeechEndpointMaterialization(t *testing.T) {
	const workspace = "https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
	for _, model := range []string{"qwen3-tts-flash", "qwen3-tts-flash-2025-11-27", "qwen3-tts-instruct-flash", "qwen3-tts-vc-2026-01-22", "qwen3-tts-vd-2026-01-26", "qwen-tts"} {
		for _, tc := range []struct{ endpoint, want string }{
			{workspace, "https://dashscope.aliyuncs.com/compatible-mode/v1"},
			{"https://ws-test.ap-southeast-1.maas.aliyuncs.com/api/v1", "https://dashscope-intl.aliyuncs.com/api/v1"},
			{"https://WS-TEST.cn-beijing.maas.aliyuncs.com:443/", "https://dashscope.aliyuncs.com:443/"},
		} {
			t.Run(model+"/"+tc.endpoint, func(t *testing.T) {
				target := speechEndpointTarget{"dashscope", model, "audio.synthesize"}
				if got, workspace := materializeDashScopeSpeechEndpoint(tc.endpoint, target); got != tc.want || workspace != "ws-test" {
					t.Fatalf("endpoint=%q workspace=%q want=%q ws-test", got, workspace, tc.want)
				}
			})
		}
	}
}

func TestDashScopeSpeechEndpointPreservesOtherProtocolsAndDestinations(t *testing.T) {
	const workspace = "https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
	for _, tc := range []struct{ provider, model, capability string }{
		{"dashscope", "qwen-audio-3.0-tts-plus", "audio.synthesize"},
		{"dashscope", "qwen-audio-3.0-tts-flash", "audio.synthesize"},
		{"dashscope", "cosyvoice-v3.5-plus", "audio.synthesize"},
		{"dashscope", "qwen3-tts-flash-realtime", "audio.synthesize"},
		{"dashscope", "qwen3-tts-vc-realtime-2026-01-15", "audio.synthesize"},
		{"dashscope", "qwen-audio-3.0-asr-flash-streaming", "audio.transcribe"},
		{"dashscope", "qwen-audio-3.0-tts-plus", "voice.create"},
		{"dashscope", "qwen3-tts-vd-2026-01-26", "voice.create"},
		{"dashscope", "qwen3-tts-flash", "text.generate"},
		{"openai", "qwen3-tts-flash", "audio.synthesize"},
	} {
		t.Run(tc.provider+"/"+tc.model+"/"+tc.capability, func(t *testing.T) {
			if got, scope := materializeDashScopeSpeechEndpoint(workspace, speechEndpointTarget(tc)); got != workspace || scope != "" {
				t.Fatalf("unrelated target retargeted: %q workspace=%q", got, scope)
			}
		})
	}
	for _, endpoint := range []string{
		"https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope-intl.aliyuncs.com/api/v1",
		"https://proxy.example.com/compatible-mode/v1", "http://127.0.0.1:1234/compatible-mode/v1",
		"https://ws-test.cn-beijing.maas.aliyuncs.com.evil.example/v1", "https://nested.ws-test.cn-beijing.maas.aliyuncs.com/v1",
		"https://trial.cn-beijing.maas.aliyuncs.com/v1", "https://token-plan.cn-beijing.maas.aliyuncs.com/v1",
		"https://ws-test.eu-central-1.maas.aliyuncs.com/v1", "https://ws-.cn-beijing.maas.aliyuncs.com/v1",
		"http://ws-test.cn-beijing.maas.aliyuncs.com/v1", "https://ws-test.cn-beijing.maas.aliyuncs.com:8443/v1",
		"https://user@ws-test.cn-beijing.maas.aliyuncs.com/v1", "https://ws-test.cn-beijing.maas.aliyuncs.com/v1?tenant=x",
		"https://ws-test.cn-beijing.maas.aliyuncs.com/v1#fragment",
	} {
		t.Run(endpoint, func(t *testing.T) {
			if got, scope := materializeDashScopeSpeechEndpoint(endpoint, speechEndpointTarget{"dashscope", "qwen3-tts-flash", "audio.synthesize"}); got != endpoint || scope != "" {
				t.Fatalf("custom or unmapped endpoint retargeted: %q workspace=%q", got, scope)
			}
		})
	}
}
