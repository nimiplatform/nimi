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

type realmUnaryOperation struct {
	method                  string
	path                    string
	allowedCallerModes      map[runtimev1.AccountCallerMode]struct{}
	allowedSDKAppModes      []string
	requiredAppCapabilities []string
	requiredRuntimeScopes   []string
	allowedPathParameters   map[string]struct{}
	requiredPathParameters  map[string]struct{}
	allowedQueryParameters  map[string]struct{}
	requestBodyAllowed      bool
	requestBodyRequired     bool
	responseMaxBytes        int64
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
	if reason, ok := s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), false); !ok {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	operation, ok := realmBrokerOperations[strings.TrimSpace(req.GetMethodId())]
	if !ok {
		return realmUnaryFailure(runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED, "realm method is not admitted for Runtime mediation", 0), nil
	}
	if !operation.admitsCallerMode(req.GetCaller().GetMode()) {
		return realmUnaryFailure(runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED, "realm method is not admitted for this Runtime caller mode", 0), nil
	}
	if !s.admitRealmBrokerCapabilities(req.GetCaller(), operation) {
		return realmUnaryFailure(runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CAPABILITY_MISSING, "realm broker capability policy is not satisfied", 0), nil
	}
	realmBaseURL, err := s.resolveRealmUnaryBaseURL(req.GetRealmBaseUrl())
	if err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_BASE_DENIED, err.Error(), 0), nil
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
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, err.Error(), 0), nil
	}
	if err := validateRealmUnaryRequestShape(operation, parsedRequest); err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, err.Error(), 0), nil
	}
	targetURL, err := buildRealmUnaryURL(realmBaseURL, operation, parsedRequest)
	if err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, err.Error(), 0), nil
	}

	httpReq, err := buildRealmUnaryHTTPRequest(ctx, targetURL, operation, parsedRequest, accessToken)
	if err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, err.Error(), 0), nil
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
		return realmUnaryFailure(runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_UPSTREAM_FAILED, fmt.Sprintf("realm request failed: %v", err), 0), nil
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, operation.responseMaxBytes+1))
	if readErr != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_UPSTREAM_FAILED, fmt.Sprintf("realm response read failed: %v", readErr), response.StatusCode), nil
	}
	if int64(len(responseBody)) > operation.responseMaxBytes {
		return realmUnaryFailure(runtimev1.ReasonCode_AI_OUTPUT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RESPONSE_TOO_LARGE, "realm broker response exceeds the admitted response limit", response.StatusCode), nil
	}
	responseJSON := strings.TrimSpace(string(responseBody))
	if responseJSON == "" {
		responseJSON = "{}"
	}
	if err := scanRealmBrokerResponseForCredentials(response.Header, []byte(responseJSON)); err != nil {
		return realmUnaryCredentialRejected(err.Error()), nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return realmUnaryFailure(runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_UPSTREAM_FAILED, trimRealmUnaryErrorBody(string(responseBody)), response.StatusCode), nil
	}
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted:          true,
		ResponseJson:      responseJSON,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) realmUnaryAccessToken(ctx context.Context, _ *runtimev1.AccountCaller) (string, runtimev1.AccountReasonCode, bool, error) {
	s.mu.RLock()
	if (s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING) || s.material.RefreshToken == "" {
		s.mu.RUnlock()
		return "", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, false, nil
	}
	needsRefresh := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING ||
		!s.material.AccessTokenExpires.IsZero() && !s.material.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))
	s.mu.RUnlock()
	if needsRefresh {
		refresh, err := s.refreshAccountSessionInternal(ctx, false)
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

func realmUnaryFailure(reason runtimev1.ReasonCode, accountReason runtimev1.AccountReasonCode, message string, httpStatus int) *runtimev1.InvokeRealmUnaryResponse {
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted:          false,
		ReasonCode:        reason,
		AccountReasonCode: accountReason,
		HttpStatus:        int32(httpStatus),
		ErrorMessage:      message,
	}
}

func (s *Service) resolveRealmUnaryBaseURL(value string) (string, error) {
	authorized, err := canonicalRealmUnaryBaseURL(s.realmBaseURL)
	if err != nil {
		return "", fmt.Errorf("runtime Realm base URL is unavailable")
	}
	if strings.TrimSpace(value) == "" {
		return authorized, nil
	}
	requested, err := canonicalRealmUnaryBaseURL(value)
	if err != nil {
		return "", err
	}
	if requested != authorized {
		return "", fmt.Errorf("realm base URL is not admitted")
	}
	return requested, nil
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
