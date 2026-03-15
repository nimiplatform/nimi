package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	localHealthProbeTimeout             = 5 * time.Second
	localRecoverySuccessThreshold       = 3
	localRecoveryDefaultProbeInterval   = 30 * time.Second
	localRecoverySlowProbeInterval      = 60 * time.Second
	localRecoveryLongFailProbeInterval  = 5 * time.Minute
	localRecoverySlowFailureThreshold   = 720
	localRecoveryLongFailureWindow      = 24 * time.Hour
	localHealthProbeMaxResponseBodySize = 1 << 20
)

type endpointProbeFunc func(ctx context.Context, endpoint string) endpointProbeResult

type endpointProbeResult struct {
	healthy   bool
	responded bool
	detail    string
	probeURL  string
	models    []string
}

type probeRecoveryState struct {
	consecutiveSuccess int
	consecutiveFailure int
	firstFailureAt     time.Time
	lastProbeAt        time.Time
}

func defaultEndpointProbe(ctx context.Context, endpoint string) endpointProbeResult {
	probeURL, err := buildModelsProbeURL(endpoint)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe endpoint invalid: " + err.Error(),
			probeURL: strings.TrimSpace(endpoint),
		}
	}

	probeCtx, cancel := context.WithTimeout(ctx, localHealthProbeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, probeURL, nil)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request build failed: " + err.Error(),
			probeURL: probeURL,
		}
	}

	resp, err := (&http.Client{Timeout: localHealthProbeTimeout}).Do(req)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request failed: " + err.Error(),
			probeURL: probeURL,
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    fmt.Sprintf("probe status not ok: %d", resp.StatusCode),
			probeURL:  probeURL,
		}
	}

	payload := struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}{}
	if err := json.NewDecoder(io.LimitReader(resp.Body, localHealthProbeMaxResponseBodySize)).Decode(&payload); err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe response parse failed: " + err.Error(),
			probeURL: probeURL,
		}
	}
	hasModel := false
	modelIDs := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		modelID := strings.TrimSpace(item.ID)
		if modelID == "" {
			continue
		}
		hasModel = true
		modelIDs = append(modelIDs, modelID)
	}
	if !hasModel {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    "probe response missing valid models",
			probeURL:  probeURL,
		}
	}
	return endpointProbeResult{
		healthy:   true,
		responded: true,
		detail:    "probe succeeded",
		probeURL:  probeURL,
		models:    modelIDs,
	}
}

func buildModelsProbeURL(endpoint string) (string, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return "", fmt.Errorf("endpoint required")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("endpoint must include scheme and host")
	}

	cleanPath := strings.TrimSpace(parsed.Path)
	if cleanPath == "" {
		cleanPath = "/"
	}
	cleanPath = path.Clean("/" + strings.TrimPrefix(cleanPath, "/"))
	if cleanPath == "." || cleanPath == "/" {
		cleanPath = "/v1/models"
	} else if strings.HasSuffix(cleanPath, "/v1/models") {
		// Keep existing path.
	} else if strings.HasSuffix(cleanPath, "/v1") {
		cleanPath = cleanPath + "/models"
	} else {
		cleanPath = path.Join(cleanPath, "v1", "models")
	}

	parsed.Path = cleanPath
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func (s *Service) probeEndpoint(ctx context.Context, endpoint string) endpointProbeResult {
	s.mu.RLock()
	probeFn := s.endpointProbe
	s.mu.RUnlock()
	if probeFn == nil {
		probeFn = defaultEndpointProbe
	}
	return probeFn(ctx, endpoint)
}

func startupCompatibilityWarnings(engine string, profile *runtimev1.LocalDeviceProfile) []string {
	if profile == nil {
		return []string{}
	}
	normalizedEngine := strings.ToLower(strings.TrimSpace(engine))
	warnings := make([]string, 0, 3)
	if requiresGPU(normalizedEngine) && !profile.GetGpu().GetAvailable() {
		warnings = append(warnings, "WARN_GPU_REQUIRED")
	}
	if requiresPython(normalizedEngine) && !profile.GetPython().GetAvailable() {
		warnings = append(warnings, "WARN_PYTHON_REQUIRED")
	}
	if requiresNPU(normalizedEngine) && (!profile.GetNpu().GetAvailable() || !profile.GetNpu().GetReady()) {
		warnings = append(warnings, "WARN_NPU_REQUIRED")
	}
	for _, warning := range managedEngineSupportWarnings(normalizedEngine, profile) {
		warnings = append(warnings, warning)
	}
	return warnings
}

func appendWarnings(detail string, warnings []string) string {
	base := strings.TrimSpace(detail)
	if len(warnings) == 0 {
		return base
	}
	if base == "" {
		return "warnings=" + strings.Join(warnings, ",")
	}
	return base + "; warnings=" + strings.Join(warnings, ",")
}

func modelProbeEndpoint(model *runtimev1.LocalModelRecord) string {
	if model == nil {
		return defaultLocalEndpoint
	}
	endpoint := strings.TrimSpace(model.GetEndpoint())
	if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "nimi_media") {
		return defaultString(endpoint, defaultNimiMediaEndpoint)
	}
	return defaultString(endpoint, defaultLocalEndpoint)
}

func shouldUseManagedLocalAIEndpoint(endpoint string) bool {
	trimmed := strings.TrimSpace(endpoint)
	return trimmed == "" || strings.EqualFold(trimmed, defaultLocalEndpoint)
}

func shouldUseManagedNimiMediaEndpoint(endpoint string) bool {
	trimmed := strings.TrimSpace(endpoint)
	return trimmed == "" || strings.EqualFold(trimmed, defaultNimiMediaEndpoint)
}

func (s *Service) managedLocalAIEndpoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.localAIManagedEndpoint)
}

func (s *Service) managedNimiMediaEndpoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.nimiMediaManagedEndpoint)
}

func (s *Service) effectiveLocalModelEndpoint(model *runtimev1.LocalModelRecord) string {
	if model == nil {
		return defaultLocalEndpoint
	}
	endpoint := strings.TrimSpace(model.GetEndpoint())
	if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
		if managedEndpoint := s.managedLocalAIEndpoint(); managedEndpoint != "" && shouldUseManagedLocalAIEndpoint(endpoint) {
			return managedEndpoint
		}
	}
	if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "nimi_media") {
		if managedEndpoint := s.managedNimiMediaEndpoint(); managedEndpoint != "" && shouldUseManagedNimiMediaEndpoint(endpoint) {
			return managedEndpoint
		}
		return defaultString(endpoint, defaultNimiMediaEndpoint)
	}
	return defaultString(endpoint, defaultLocalEndpoint)
}

func (s *Service) normalizeRequestedLocalModelEndpoint(engine string, endpoint string) string {
	trimmedEndpoint := strings.TrimSpace(endpoint)
	if strings.EqualFold(strings.TrimSpace(engine), "localai") {
		if managedEndpoint := s.managedLocalAIEndpoint(); managedEndpoint != "" && shouldUseManagedLocalAIEndpoint(trimmedEndpoint) {
			return managedEndpoint
		}
	}
	if strings.EqualFold(strings.TrimSpace(engine), "nimi_media") {
		if managedEndpoint := s.managedNimiMediaEndpoint(); managedEndpoint != "" && shouldUseManagedNimiMediaEndpoint(trimmedEndpoint) {
			return managedEndpoint
		}
		if trimmedEndpoint == "" {
			return defaultNimiMediaEndpoint
		}
	}
	return trimmedEndpoint
}

func serviceProbeEndpoint(service *runtimev1.LocalServiceDescriptor) string {
	if service == nil {
		return defaultServiceEndpoint
	}
	return defaultString(strings.TrimSpace(service.GetEndpoint()), defaultServiceEndpoint)
}

func (s *Service) modelByID(localModelID string) *runtimev1.LocalModelRecord {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneLocalModel(s.models[id])
}

func (s *Service) serviceByID(serviceID string) *runtimev1.LocalServiceDescriptor {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneServiceDescriptor(s.services[id])
}

func (s *Service) modelRecoveryFailure(localModelID string, now time.Time) (int, time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.modelProbeState[localModelID]
	if state == nil {
		state = &probeRecoveryState{}
		s.modelProbeState[localModelID] = state
	}
	state.consecutiveFailure++
	state.consecutiveSuccess = 0
	if state.firstFailureAt.IsZero() {
		state.firstFailureAt = now
	}
	state.lastProbeAt = now
	return state.consecutiveFailure, recoveryProbeInterval(now, state)
}

func (s *Service) modelRecoverySuccess(localModelID string, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.modelProbeState[localModelID]
	if state == nil {
		state = &probeRecoveryState{}
		s.modelProbeState[localModelID] = state
	}
	state.consecutiveSuccess++
	state.consecutiveFailure = 0
	state.firstFailureAt = time.Time{}
	state.lastProbeAt = now
	return state.consecutiveSuccess
}

func (s *Service) resetModelRecovery(localModelID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.modelProbeState, localModelID)
}

func (s *Service) serviceRecoveryFailure(serviceID string, now time.Time) (int, time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.serviceProbeState[serviceID]
	if state == nil {
		state = &probeRecoveryState{}
		s.serviceProbeState[serviceID] = state
	}
	state.consecutiveFailure++
	state.consecutiveSuccess = 0
	if state.firstFailureAt.IsZero() {
		state.firstFailureAt = now
	}
	state.lastProbeAt = now
	return state.consecutiveFailure, recoveryProbeInterval(now, state)
}

func (s *Service) serviceRecoverySuccess(serviceID string, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.serviceProbeState[serviceID]
	if state == nil {
		state = &probeRecoveryState{}
		s.serviceProbeState[serviceID] = state
	}
	state.consecutiveSuccess++
	state.consecutiveFailure = 0
	state.firstFailureAt = time.Time{}
	state.lastProbeAt = now
	return state.consecutiveSuccess
}

func (s *Service) resetServiceRecovery(serviceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.serviceProbeState, serviceID)
}

func recoveryProbeInterval(now time.Time, state *probeRecoveryState) time.Duration {
	if state == nil {
		return localRecoveryDefaultProbeInterval
	}
	if !state.firstFailureAt.IsZero() && now.Sub(state.firstFailureAt) >= localRecoveryLongFailureWindow {
		return localRecoveryLongFailProbeInterval
	}
	if state.consecutiveFailure >= localRecoverySlowFailureThreshold {
		return localRecoverySlowProbeInterval
	}
	return localRecoveryDefaultProbeInterval
}

func (s *Service) bootstrapEngineIfManaged(ctx context.Context, engine string, endpoint string) error {
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return nil
	}
	port, shouldManage, err := parseManagedEndpointPort(engine, endpoint)
	if err != nil {
		return err
	}
	if !shouldManage {
		return nil
	}
	profile := collectDeviceProfile()
	if classification, detail := classifyManagedEngineSupport(engine, profile); classification != localEngineSupportSupportedSupervised {
		if strings.TrimSpace(detail) != "" {
			return fmt.Errorf("%s", detail)
		}
		return fmt.Errorf("%s managed mode is unavailable on this host", strings.TrimSpace(engine))
	}
	if err := mgr.StartEngine(ctx, strings.ToLower(strings.TrimSpace(engine)), port, ""); err != nil {
		lower := strings.ToLower(strings.TrimSpace(err.Error()))
		if strings.Contains(lower, "already running") {
			return nil
		}
		return err
	}
	return nil
}

func (s *Service) engineManagerOrNil() EngineManager {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.engineMgr
}

func parseManagedEndpointPort(engine string, endpoint string) (int, bool, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		def := defaultEnginePort(engine)
		if def <= 0 {
			return 0, false, nil
		}
		return def, true, nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0, false, fmt.Errorf("parse endpoint: %w", err)
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return 0, false, fmt.Errorf("parse endpoint host: empty")
	}
	if !isLoopbackHost(host) {
		return 0, false, nil
	}

	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		def := defaultEnginePort(engine)
		if def <= 0 {
			return 0, false, nil
		}
		return def, true, nil
	}
	value, err := strconv.Atoi(port)
	if err != nil || value <= 0 {
		return 0, false, fmt.Errorf("parse endpoint port: %q", port)
	}
	return value, true, nil
}

func isLoopbackHost(host string) bool {
	normalized := strings.ToLower(strings.TrimSpace(host))
	switch normalized {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	ip := net.ParseIP(normalized)
	return ip != nil && ip.IsLoopback()
}

func defaultEnginePort(engine string) int {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "localai":
		return 1234
	case "nexa":
		return 8000
	case "nimi_media":
		return 8321
	default:
		return 0
	}
}
