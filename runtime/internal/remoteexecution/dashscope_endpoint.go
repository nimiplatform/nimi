package remoteexecution

import (
	"net/url"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-speech-endpoint-materialization
// Qwen's HTTP TTS protocol uses the regional shared origin, while Qwen Audio
// and voice customization retain the workspace origin. Resolve before dispatch;
// never retry a failed request against another host.
// https://help.aliyun.com/zh/model-studio/qwen-tts-api
// https://help.aliyun.com/en/model-studio/base-url
func materializeDashScopeSpeechEndpoint(endpoint string, target providerTargetIdentity) (string, string) {
	media, ok := target.(interface{ CapabilityContract() string })
	if !ok || target.Provider() != "dashscope" || media.CapabilityContract() != "audio.synthesize" {
		return endpoint, ""
	}
	model := strings.ToLower(target.ProviderModelID())
	if !(model == "qwen-tts" || strings.HasPrefix(model, "qwen-tts-") || strings.HasPrefix(model, "qwen3-tts-")) || strings.Contains(model, "-realtime") {
		return endpoint, ""
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return endpoint, ""
	}
	labels := strings.Split(strings.ToLower(u.Hostname()), ".")
	if len(labels) != 5 || strings.Join(labels[2:], ".") != "maas.aliyuncs.com" || !isDashScopeWorkspaceLabel(labels[0]) {
		return endpoint, ""
	}
	var host string
	switch labels[1] {
	case "cn-beijing":
		host = "dashscope.aliyuncs.com"
	case "ap-southeast-1":
		host = "dashscope-intl.aliyuncs.com"
	default:
		return endpoint, ""
	}
	if u.Port() != "" {
		host += ":" + u.Port()
	}
	u.Host = host
	// The shared origin accepts keys from multiple workspaces. Keep the
	// workspace selected by the captured hostname explicit in the native
	// request, as MultiModalConversation(workspace=...) does in the SDK.
	return u.String(), labels[0]
}

func isDashScopeWorkspaceLabel(label string) bool {
	if !strings.HasPrefix(label, "ws-") || len(label) <= 3 || len(label) > 63 || strings.HasSuffix(label, "-") {
		return false
	}
	for _, c := range label[3:] {
		if !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' {
			return false
		}
	}
	return true
}
