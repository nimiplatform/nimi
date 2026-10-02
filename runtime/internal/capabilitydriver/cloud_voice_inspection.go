package capabilitydriver

import (
	"fmt"
	"strings"
)

// CloudVoiceInspectionMappedRequest contains only one Driver-admitted private
// resource lookup. It carries no App-selected provider URL or credential.
type CloudVoiceInspectionMappedRequest struct {
	provider, adapter, providerVoiceRef string
}

func (r *CloudVoiceInspectionMappedRequest) Provider() string         { return r.provider }
func (r *CloudVoiceInspectionMappedRequest) Adapter() string          { return r.adapter }
func (r *CloudVoiceInspectionMappedRequest) ProviderVoiceRef() string { return r.providerVoiceRef }

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
func (d providerCloudMediaDriver) MapVoiceInspectRequest(target CloudMediaTarget, providerVoiceRef string) (*CloudVoiceInspectionMappedRequest, error) {
	if d.provider != "gemini" || target.provider != d.provider || target.capabilityContract != "voice.create" || target.providerModelID != "gemini-3.8-flash-tts" || strings.TrimSpace(providerVoiceRef) == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("voice inspection is unsupported for this exact creation target"))
	}
	return &CloudVoiceInspectionMappedRequest{provider: d.provider, adapter: CloudMediaAdapterGeminiVoiceInspect, providerVoiceRef: providerVoiceRef}, nil
}
