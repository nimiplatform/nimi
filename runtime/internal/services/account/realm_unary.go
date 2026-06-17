package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const realmUnaryDefaultTimeout = 30 * time.Second

const (
	realmPersonaStudioAppID = "nimi.realm-persona-studio"
	realmWorldStudioAppID   = "nimi.realm-world-studio"
)

type realmUnaryOperation struct {
	method        string
	path          string
	allowedAppIDs []string
}

var realmUnaryOperations = map[string]realmUnaryOperation{
	"WorldCoreController_bootstrapOasisWorld":         worldStudioRealmUnaryOperation(http.MethodPost, "/api/realm/core/worlds/oasis/bootstrap"),
	"WorldCoreController_createRealmPersona":          personaStudioRealmUnaryOperation(http.MethodPost, "/api/realm/core/personas"),
	"WorldCoreController_createRuntimeSourceSnapshot": studioRealmUnaryOperation(http.MethodPost, "/api/realm/core/runtime-source-snapshots", realmPersonaStudioAppID, realmWorldStudioAppID),
	"WorldCoreController_createWorldCharacter":        worldStudioRealmUnaryOperation(http.MethodPost, "/api/realm/core/worlds/{worldId}/characters"),
	"WorldCoreController_createWorldCore":             worldStudioRealmUnaryOperation(http.MethodPost, "/api/realm/core/worlds"),
	"WorldCoreController_getOasisWorld":               studioRealmUnaryOperation(http.MethodGet, "/api/realm/core/worlds/oasis", realmPersonaStudioAppID, realmWorldStudioAppID),
	"WorldCoreController_getRealmPersona":             personaStudioRealmUnaryOperation(http.MethodGet, "/api/realm/core/personas/{personaId}"),
	"WorldCoreController_getWorldCharacter":           worldStudioRealmUnaryOperation(http.MethodGet, "/api/realm/core/world-characters/{characterId}"),
	"WorldCoreController_getWorldCore":                studioRealmUnaryOperation(http.MethodGet, "/api/realm/core/worlds/{worldId}", realmPersonaStudioAppID, realmWorldStudioAppID),
	"WorldCoreController_listRealmPersonas":           personaStudioRealmUnaryOperation(http.MethodGet, "/api/realm/core/personas"),
	"WorldCoreController_listWorldCharacters":         worldStudioRealmUnaryOperation(http.MethodGet, "/api/realm/core/worlds/{worldId}/characters"),
	"WorldCoreController_listWorldCores":              studioRealmUnaryOperation(http.MethodGet, "/api/realm/core/worlds", realmPersonaStudioAppID, realmWorldStudioAppID),
	"WorldCoreController_replaceRealmPersona":         personaStudioRealmUnaryOperation(http.MethodPut, "/api/realm/core/personas/{personaId}"),
	"WorldCoreController_replaceWorldCharacter":       worldStudioRealmUnaryOperation(http.MethodPut, "/api/realm/core/world-characters/{characterId}"),
	"WorldCoreController_replaceWorldCore":            worldStudioRealmUnaryOperation(http.MethodPut, "/api/realm/core/worlds/{worldId}"),
	"createPost":                                      personaStudioRealmUnaryOperation(http.MethodPost, "/api/world/posts"),
	"listResources":                                   personaStudioRealmUnaryOperation(http.MethodGet, "/api/resources"),
	"createImageDirectUpload":                         studioRealmUnaryOperation(http.MethodPost, "/api/resources/images/direct-upload", realmPersonaStudioAppID, realmWorldStudioAppID),
	"createVideoDirectUpload":                         studioRealmUnaryOperation(http.MethodPost, "/api/resources/videos/direct-upload", realmPersonaStudioAppID, realmWorldStudioAppID),
	"createAudioDirectUpload":                         studioRealmUnaryOperation(http.MethodPost, "/api/resources/audio/direct-upload", realmPersonaStudioAppID, realmWorldStudioAppID),
	"finalizeResource":                                studioRealmUnaryOperation(http.MethodPost, "/api/resources/{resourceId}/finalize", realmPersonaStudioAppID, realmWorldStudioAppID),
	"createTextResource":                              studioRealmUnaryOperation(http.MethodPost, "/api/resources/texts", realmPersonaStudioAppID, realmWorldStudioAppID),
}

func personaStudioRealmUnaryOperation(method string, path string) realmUnaryOperation {
	return studioRealmUnaryOperation(method, path, realmPersonaStudioAppID)
}

func worldStudioRealmUnaryOperation(method string, path string) realmUnaryOperation {
	return studioRealmUnaryOperation(method, path, realmWorldStudioAppID)
}

func studioRealmUnaryOperation(method string, path string, appIDs ...string) realmUnaryOperation {
	return realmUnaryOperation{method: method, path: path, allowedAppIDs: appIDs}
}

func (operation realmUnaryOperation) admitsApp(appID string) bool {
	for _, allowed := range operation.allowedAppIDs {
		if strings.TrimSpace(appID) == allowed {
			return true
		}
	}
	return false
}

type realmUnaryRequestJSON struct {
	Path  map[string]any  `json:"path"`
	Query map[string]any  `json:"query"`
	Body  json.RawMessage `json:"body"`
}

func (s *Service) InvokeRealmUnary(ctx context.Context, req *runtimev1.InvokeRealmUnaryRequest) (*runtimev1.InvokeRealmUnaryResponse, error) {
	if !s.isActivated() {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(req.GetCaller()); !ok {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	operation, ok := realmUnaryOperations[strings.TrimSpace(req.GetMethodId())]
	if !ok {
		return realmUnaryRejected("realm method is not admitted for Runtime mediation"), nil
	}
	if !operation.admitsApp(req.GetCaller().GetAppId()) {
		return &runtimev1.InvokeRealmUnaryResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
			ErrorMessage:      "realm method is not admitted for this Runtime app",
		}, nil
	}
	if err := s.validateRealmBaseURL(req.GetRealmBaseUrl()); err != nil {
		return realmUnaryRejected(err.Error()), nil
	}
	accessToken, reason, ok, err := s.realmUnaryAccessToken(ctx, req.GetCaller())
	if err != nil {
		return nil, err
	}
	if !ok {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}

	parsedRequest, err := parseRealmUnaryRequest(req.GetRequestJson())
	if err != nil {
		return realmUnaryRejected(err.Error()), nil
	}
	targetURL, err := buildRealmUnaryURL(req.GetRealmBaseUrl(), operation, parsedRequest)
	if err != nil {
		return realmUnaryRejected(err.Error()), nil
	}

	httpReq, err := buildRealmUnaryHTTPRequest(ctx, targetURL, operation, parsedRequest, accessToken)
	if err != nil {
		return realmUnaryRejected(err.Error()), nil
	}
	client := s.realmHTTP
	if client == nil {
		client = &http.Client{Timeout: realmUnaryDefaultTimeout}
	}
	if req.GetTimeoutMs() > 0 {
		copy := *client
		copy.Timeout = time.Duration(req.GetTimeoutMs()) * time.Millisecond
		client = &copy
	}
	response, err := client.Do(httpReq)
	if err != nil {
		return &runtimev1.InvokeRealmUnaryResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
			ErrorMessage:      fmt.Sprintf("realm request failed: %v", err),
		}, nil
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if readErr != nil {
		return &runtimev1.InvokeRealmUnaryResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
			HttpStatus:        int32(response.StatusCode),
			ErrorMessage:      fmt.Sprintf("realm response read failed: %v", readErr),
		}, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &runtimev1.InvokeRealmUnaryResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
			HttpStatus:        int32(response.StatusCode),
			ErrorMessage:      trimRealmUnaryErrorBody(string(responseBody)),
		}, nil
	}
	responseJSON := strings.TrimSpace(string(responseBody))
	if responseJSON == "" {
		responseJSON = "{}"
	}
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted:          true,
		ResponseJson:      responseJSON,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) realmUnaryAccessToken(ctx context.Context, caller *runtimev1.AccountCaller) (string, runtimev1.AccountReasonCode, bool, error) {
	s.mu.RLock()
	if (s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED) || s.material.RefreshToken == "" {
		s.mu.RUnlock()
		return "", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, false, nil
	}
	needsRefresh := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED || !s.material.AccessTokenExpires.IsZero() && !s.material.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))
	s.mu.RUnlock()
	if needsRefresh {
		refresh, err := s.RefreshAccountSession(ctx, &runtimev1.RefreshAccountSessionRequest{Caller: caller})
		if err != nil {
			return "", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED, false, err
		}
		if !refresh.GetAccepted() {
			return "", refresh.GetAccountReasonCode(), false, nil
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || strings.TrimSpace(s.material.AccessToken) == "" {
		return "", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, false, nil
	}
	return s.material.AccessToken, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true, nil
}

func realmUnaryRejected(message string) *runtimev1.InvokeRealmUnaryResponse {
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted:          false,
		ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		ErrorMessage:      message,
	}
}

func (s *Service) validateRealmBaseURL(value string) error {
	requested, err := canonicalRealmUnaryBaseURL(value)
	if err != nil {
		return err
	}
	authorized, err := canonicalRealmUnaryBaseURL(s.realmBaseURL)
	if err != nil {
		return fmt.Errorf("runtime Realm base URL is unavailable")
	}
	if requested != authorized {
		return fmt.Errorf("realm base URL is not admitted")
	}
	return nil
}

func canonicalRealmUnaryBaseURL(value string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
	if trimmed == "" {
		return "", fmt.Errorf("realm base URL is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("realm base URL is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("realm base URL scheme is not admitted")
	}
	parsed.Path = strings.TrimRight(parsed.EscapedPath(), "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func parseRealmUnaryRequest(raw string) (realmUnaryRequestJSON, error) {
	if strings.TrimSpace(raw) == "" {
		return realmUnaryRequestJSON{}, nil
	}
	var parsed realmUnaryRequestJSON
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return realmUnaryRequestJSON{}, fmt.Errorf("realm request JSON is invalid")
	}
	if parsed.Path == nil {
		parsed.Path = map[string]any{}
	}
	if parsed.Query == nil {
		parsed.Query = map[string]any{}
	}
	return parsed, nil
}

func buildRealmUnaryURL(baseURL string, operation realmUnaryOperation, request realmUnaryRequestJSON) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	path, err := expandRealmUnaryPath(operation.path, request.Path)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(base + path)
	if err != nil {
		return "", fmt.Errorf("realm operation URL is invalid")
	}
	query := parsed.Query()
	for key, value := range request.Query {
		appendRealmUnaryQueryValue(query, key, value)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func expandRealmUnaryPath(template string, values map[string]any) (string, error) {
	result := template
	for {
		start := strings.Index(result, "{")
		if start < 0 {
			return result, nil
		}
		end := strings.Index(result[start:], "}")
		if end < 0 {
			return "", fmt.Errorf("realm operation path template is invalid")
		}
		key := result[start+1 : start+end]
		value := strings.TrimSpace(fmt.Sprint(values[key]))
		if value == "" || value == "<nil>" {
			return "", fmt.Errorf("realm operation path parameter is missing: %s", key)
		}
		result = result[:start] + url.PathEscape(value) + result[start+end+1:]
	}
}

func appendRealmUnaryQueryValue(query url.Values, key string, value any) {
	if strings.TrimSpace(key) == "" || value == nil {
		return
	}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			appendRealmUnaryQueryValue(query, key, item)
		}
	default:
		query.Add(key, fmt.Sprint(typed))
	}
}

func buildRealmUnaryHTTPRequest(ctx context.Context, targetURL string, operation realmUnaryOperation, request realmUnaryRequestJSON, accessToken string) (*http.Request, error) {
	var body io.Reader
	if operation.method != http.MethodGet && operation.method != http.MethodHead && len(request.Body) > 0 && string(request.Body) != "null" {
		body = bytes.NewReader(request.Body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, operation.method, targetURL, body)
	if err != nil {
		return nil, fmt.Errorf("realm request construction failed")
	}
	httpReq.Header.Set("accept", "application/json")
	httpReq.Header.Set("authorization", "Bearer "+accessToken)
	if body != nil {
		httpReq.Header.Set("content-type", "application/json")
	}
	return httpReq, nil
}

func trimRealmUnaryErrorBody(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > 512 {
		return trimmed[:512]
	}
	return trimmed
}
