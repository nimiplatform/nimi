package localservice

import "strings"

// LocalProviderEndpointSink publishes supervised local engine endpoints to the
// runtime AI provider registry after localservice starts an engine on demand.
type LocalProviderEndpointSink interface {
	SetLocalProviderEndpoint(providerID string, endpoint string, apiKey string)
}

func (s *Service) SetLocalProviderEndpointSink(sink LocalProviderEndpointSink) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.localProviderEndpointSink = sink
	s.mu.Unlock()
}

func (s *Service) publishLocalProviderEndpoint(providerID string, endpoint string) {
	normalizedProviderID := strings.TrimSpace(providerID)
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if s == nil || normalizedProviderID == "" || normalizedEndpoint == "" {
		return
	}
	s.mu.RLock()
	sink := s.localProviderEndpointSink
	s.mu.RUnlock()
	if sink == nil {
		return
	}
	sink.SetLocalProviderEndpoint(normalizedProviderID, normalizedEndpoint, "")
}

func managedEngineProviderEndpoint(info EngineInfo, fallback string) string {
	endpoint := strings.TrimRight(strings.TrimSpace(info.Endpoint), "/")
	if endpoint == "" {
		endpoint = strings.TrimRight(strings.TrimSpace(fallback), "/")
	}
	if endpoint == "" {
		return ""
	}
	if strings.HasSuffix(endpoint, "/v1") {
		return endpoint
	}
	return endpoint + "/v1"
}
