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

type endpointProbeFunc func(ctx context.Context, engine string, endpoint string) endpointProbeResult

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

func defaultEndpointProbe(ctx context.Context, engine string, endpoint string) endpointProbeResult {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "media", "media.diffusers":
		return probeNimiMediaEndpoint(ctx, endpoint)
	default:
		return probeOpenAICompatibleEndpoint(ctx, endpoint)
	}
}

func probeOpenAICompatibleEndpoint(ctx context.Context, endpoint string) endpointProbeResult {
	probeURL, err := buildOpenAIModelsProbeURL(endpoint)
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

func probeNimiMediaEndpoint(ctx context.Context, endpoint string) endpointProbeResult {
	healthURL, err := buildNimiMediaHealthProbeURL(endpoint)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe endpoint invalid: " + err.Error(),
			probeURL: strings.TrimSpace(endpoint),
		}
	}
	catalogURL, err := buildNimiMediaCatalogProbeURL(endpoint)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe endpoint invalid: " + err.Error(),
			probeURL: strings.TrimSpace(endpoint),
		}
	}

	probeCtx, cancel := context.WithTimeout(ctx, localHealthProbeTimeout)
	defer cancel()

	healthReq, err := http.NewRequestWithContext(probeCtx, http.MethodGet, healthURL, nil)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request build failed: " + err.Error(),
			probeURL: healthURL,
		}
	}
	healthResp, err := (&http.Client{Timeout: localHealthProbeTimeout}).Do(healthReq)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request failed: " + err.Error(),
			probeURL: healthURL,
		}
	}
	defer healthResp.Body.Close()

	healthBody, _ := io.ReadAll(io.LimitReader(healthResp.Body, localHealthProbeMaxResponseBodySize))
	if healthResp.StatusCode != http.StatusOK {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    nimiMediaProbeDetailFromBody(healthBody, fmt.Sprintf("probe status not ok: %d", healthResp.StatusCode)),
			probeURL:  healthURL,
		}
	}

	healthPayload := struct {
		Status string `json:"status"`
		Ready  bool   `json:"ready"`
		Detail string `json:"detail"`
	}{}
	if err := json.Unmarshal(healthBody, &healthPayload); err != nil {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    "probe response parse failed: " + err.Error(),
			probeURL:  healthURL,
		}
	}
	if strings.ToLower(strings.TrimSpace(healthPayload.Status)) != "ok" || !healthPayload.Ready {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    defaultString(strings.TrimSpace(healthPayload.Detail), "media engine not ready"),
			probeURL:  healthURL,
		}
	}

	catalogReq, err := http.NewRequestWithContext(probeCtx, http.MethodGet, catalogURL, nil)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "catalog request build failed: " + err.Error(),
			probeURL: catalogURL,
		}
	}
	catalogResp, err := (&http.Client{Timeout: localHealthProbeTimeout}).Do(catalogReq)
	if err != nil {
		return endpointProbeResult{
			healthy:  false,
			detail:   "catalog request failed: " + err.Error(),
			probeURL: catalogURL,
		}
	}
	defer catalogResp.Body.Close()

	catalogBody, _ := io.ReadAll(io.LimitReader(catalogResp.Body, localHealthProbeMaxResponseBodySize))
	if catalogResp.StatusCode != http.StatusOK {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    nimiMediaProbeDetailFromBody(catalogBody, fmt.Sprintf("catalog status not ok: %d", catalogResp.StatusCode)),
			probeURL:  catalogURL,
		}
	}

	catalogPayload := struct {
		Models []struct {
			ID    string `json:"id"`
			Ready bool   `json:"ready"`
		} `json:"models"`
		Detail string `json:"detail"`
	}{}
	if err := json.Unmarshal(catalogBody, &catalogPayload); err != nil {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    "catalog parse failed: " + err.Error(),
			probeURL:  catalogURL,
		}
	}
	modelIDs := make([]string, 0, len(catalogPayload.Models))
	for _, item := range catalogPayload.Models {
		if strings.TrimSpace(item.ID) == "" || !item.Ready {
			continue
		}
		modelIDs = append(modelIDs, strings.TrimSpace(item.ID))
	}
	if len(modelIDs) == 0 {
		return endpointProbeResult{
			healthy:   false,
			responded: true,
			detail:    defaultString(strings.TrimSpace(catalogPayload.Detail), "catalog missing ready models"),
			probeURL:  catalogURL,
		}
	}
	return endpointProbeResult{
		healthy:   true,
		responded: true,
		detail:    "probe succeeded",
		probeURL:  catalogURL,
		models:    modelIDs,
	}
}

func nimiMediaProbeDetailFromBody(body []byte, fallback string) string {
	payload := struct {
		Detail string `json:"detail"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
	}{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return fallback
	}
	if detail := strings.TrimSpace(payload.Detail); detail != "" {
		return detail
	}
	if detail := strings.TrimSpace(payload.Error.Message); detail != "" {
		return detail
	}
	return fallback
}

func buildOpenAIModelsProbeURL(endpoint string) (string, error) {
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

func buildNimiMediaHealthProbeURL(endpoint string) (string, error) {
	parsed, rootPath, err := parseCanonicalProbeBaseURL(endpoint)
	if err != nil {
		return "", err
	}
	parsed.Path = path.Join(rootPath, "healthz")
	return parsed.String(), nil
}

func buildNimiMediaCatalogProbeURL(endpoint string) (string, error) {
	parsed, rootPath, err := parseCanonicalProbeBaseURL(endpoint)
	if err != nil {
		return "", err
	}
	parsed.Path = path.Join(rootPath, "v1", "catalog")
	return parsed.String(), nil
}

func parseCanonicalProbeBaseURL(endpoint string) (*url.URL, string, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return nil, "", fmt.Errorf("endpoint required")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, "", err
	}
	if strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return nil, "", fmt.Errorf("endpoint must include scheme and host")
	}

	cleanPath := strings.TrimSpace(parsed.Path)
	if cleanPath == "" {
		cleanPath = "/"
	}
	cleanPath = path.Clean("/" + strings.TrimPrefix(cleanPath, "/"))
	switch {
	case cleanPath == "." || cleanPath == "/":
		cleanPath = "/"
	case strings.HasSuffix(cleanPath, "/v1/catalog"):
		cleanPath = strings.TrimSuffix(cleanPath, "/v1/catalog")
	case strings.HasSuffix(cleanPath, "/v1/models"):
		cleanPath = strings.TrimSuffix(cleanPath, "/v1/models")
	case strings.HasSuffix(cleanPath, "/v1"):
		cleanPath = strings.TrimSuffix(cleanPath, "/v1")
	}
	if cleanPath == "" {
		cleanPath = "/"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed, cleanPath, nil
}

func buildEndpointProbeURL(engine string, endpoint string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "media", "media.diffusers":
		return buildNimiMediaCatalogProbeURL(endpoint)
	default:
		return buildOpenAIModelsProbeURL(endpoint)
	}
}

func (s *Service) probeEndpoint(ctx context.Context, engine string, endpoint string) endpointProbeResult {
	s.mu.RLock()
	probeFn := s.endpointProbe
	s.mu.RUnlock()
	if probeFn == nil {
		probeFn = defaultEndpointProbe
	}
	return probeFn(ctx, engine, endpoint)
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
		return ""
	}
	return s.effectiveEndpointForRuntimeMode(model.GetEngine(), s.modelRuntimeMode(model.GetLocalModelId()), model.GetEndpoint())
}

func (s *Service) serviceProbeEndpoint(service *runtimev1.LocalServiceDescriptor) string {
	if service == nil {
		return ""
	}
	return s.effectiveEndpointForRuntimeMode(service.GetEngine(), s.serviceRuntimeMode(service.GetServiceId()), service.GetEndpoint())
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

func (s *Service) bootstrapEngineIfManaged(ctx context.Context, engine string, mode runtimev1.LocalEngineRuntimeMode, endpoint string) error {
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return nil
	}
	if normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return nil
	}
	port, err := parseManagedEndpointPort(engine, endpoint)
	if err != nil {
		return err
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

func parseManagedEndpointPort(engine string, endpoint string) (int, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		def := defaultEnginePort(engine)
		if def <= 0 {
			return 0, fmt.Errorf("managed endpoint unavailable")
		}
		return def, nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0, fmt.Errorf("parse endpoint: %w", err)
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return 0, fmt.Errorf("parse endpoint host: empty")
	}
	if !isLoopbackHost(host) {
		return 0, fmt.Errorf("managed endpoint must resolve to loopback")
	}

	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		def := defaultEnginePort(engine)
		if def <= 0 {
			return 0, fmt.Errorf("managed endpoint port unavailable")
		}
		return def, nil
	}
	value, err := strconv.Atoi(port)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("parse endpoint port: %q", port)
	}
	return value, nil
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
	case "llama":
		return 1234
	case "media":
		return 8321
	default:
		return 0
	}
}
