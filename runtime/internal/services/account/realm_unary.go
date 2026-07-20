package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

const (
	realmUnaryDefaultTimeout     = 30 * time.Second
	realmUnaryMaxTimeout         = 5 * time.Minute
	realmUnaryRequestJSONMaxSize = 2 * 1024 * 1024
)

type realmUnaryOperation struct {
	method                 string
	path                   string
	allowedCallerModes     map[runtimev1.AccountCallerMode]struct{}
	authorizationProfile   string
	pathParameterKinds     map[string]realmUnaryParameterKind
	requiredPathParameters map[string]struct{}
	queryParameterKinds    map[string]realmUnaryParameterKind
	requestBodyAllowed     bool
	requestBodyRequired    bool
	responseMaxBytes       int64
}

type realmUnaryParameterKind uint8

const (
	realmUnaryParameterString realmUnaryParameterKind = iota + 1
	realmUnaryParameterNumber
	realmUnaryParameterInteger
	realmUnaryParameterBoolean
)

type realmUnaryRequestJSON struct {
	Path  map[string]any  `json:"path"`
	Query map[string]any  `json:"query"`
	Body  json.RawMessage `json:"body"`
}

func (s *Service) InvokeRealmUnary(ctx context.Context, req *runtimev1.InvokeRealmUnaryRequest) (*runtimev1.InvokeRealmUnaryResponse, error) {
	timeout := realmUnaryDefaultTimeout
	invalidTimeout := req.GetTimeoutMs() < 0 || int64(req.GetTimeoutMs()) > int64(realmUnaryMaxTimeout/time.Millisecond)
	if req.GetTimeoutMs() > 0 && !invalidTimeout {
		timeout = time.Duration(req.GetTimeoutMs()) * time.Millisecond
	}
	operationCtx, operationCancel := context.WithTimeout(ctx, timeout)
	defer operationCancel()

	if !s.isActivated() {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(ctx, req.GetCaller(), false); !ok {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	if invalidTimeout {
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, "realm operation timeout is outside the admitted bound", 0), nil
	}
	operation, ok := realmBrokerOperations[strings.TrimSpace(req.GetMethodId())]
	if !ok {
		return realmUnaryFailure(runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED, "realm method is not admitted for Runtime mediation", 0), nil
	}
	if !operation.admitsProtectedSourceReadinessCaller(req.GetCaller()) {
		return realmUnaryFailure(runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED, "realm method is not admitted for this Runtime caller mode", 0), nil
	}
	realmBaseURL, err := s.resolveRealmUnaryBaseURL(req.GetRealmBaseUrl())
	if err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_BASE_DENIED, err.Error(), 0), nil
	}
	accessToken, reason, ok, err := s.realmUnaryAccessToken(operationCtx, req.GetCaller())
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

	client := s.realmHTTP
	if client == nil {
		client = &http.Client{Timeout: realmUnaryDefaultTimeout}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	clientCopy.Timeout = timeout
	client = &clientCopy
	result := s.doRealmUnaryHTTP(operationCtx, client, targetURL, operation, parsedRequest, accessToken)
	if result.err != nil {
		if callerErr := ctx.Err(); callerErr != nil {
			return nil, callerErr
		}
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE, fmt.Sprintf("Realm request failed: %v", result.err), 0), nil
	}
	if result.failure != nil {
		return result.failure, nil
	}
	if result.status == http.StatusUnauthorized {
		refresh, refreshErr := s.refreshAccountSessionAfterUnauthorized(operationCtx, accessToken)
		if refreshErr != nil {
			return nil, refreshErr
		}
		if !refresh.accepted {
			return realmUnaryFailure(refresh.reasonCode, refresh.accountReasonCode, "Realm credential refresh did not complete", http.StatusUnauthorized), nil
		}
		s.mu.RLock()
		refreshedToken := s.material.AccessToken
		s.mu.RUnlock()
		result = s.doRealmUnaryHTTP(operationCtx, client, targetURL, operation, parsedRequest, refreshedToken)
		if result.err != nil {
			if callerErr := ctx.Err(); callerErr != nil {
				return nil, callerErr
			}
			return realmUnaryFailure(runtimev1.ReasonCode_REALM_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE, fmt.Sprintf("Realm request failed: %v", result.err), 0), nil
		}
		if result.failure != nil {
			return result.failure, nil
		}
		if result.status == http.StatusUnauthorized {
			s.invalidateAccountAfterRealmUnauthorized(operationCtx)
			return realmUnaryFailure(runtimev1.ReasonCode_AUTH_TOKEN_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID, "Realm rejected the refreshed account session", result.status), nil
		}
	}
	return projectRealmUnaryHTTPResult(result), nil
}

type realmUnaryHTTPResult struct {
	status  int
	header  http.Header
	body    []byte
	failure *runtimev1.InvokeRealmUnaryResponse
	err     error
}

func (s *Service) doRealmUnaryHTTP(
	ctx context.Context,
	client *http.Client,
	targetURL string,
	operation realmUnaryOperation,
	request realmUnaryRequestJSON,
	accessToken string,
) realmUnaryHTTPResult {
	httpReq, err := buildRealmUnaryHTTPRequest(ctx, targetURL, operation, request, accessToken)
	if err != nil {
		return realmUnaryHTTPResult{failure: realmUnaryFailure(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID, err.Error(), 0)}
	}
	response, err := client.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return realmUnaryHTTPResult{err: err}
		}
		return realmUnaryHTTPResult{failure: realmUnaryFailure(runtimev1.ReasonCode_REALM_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE, fmt.Sprintf("Realm request failed: %v", err), 0)}
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, operation.responseMaxBytes+1))
	if readErr != nil {
		if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
			return realmUnaryHTTPResult{err: readErr}
		}
		return realmUnaryHTTPResult{failure: realmUnaryFailure(runtimev1.ReasonCode_REALM_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE, fmt.Sprintf("Realm response read failed: %v", readErr), response.StatusCode)}
	}
	if int64(len(responseBody)) > operation.responseMaxBytes {
		return realmUnaryHTTPResult{failure: realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RESPONSE_TOO_LARGE, "Realm broker response exceeds the admitted response limit", response.StatusCode)}
	}
	return realmUnaryHTTPResult{status: response.StatusCode, header: response.Header.Clone(), body: responseBody}
}

func projectRealmUnaryHTTPResult(result realmUnaryHTTPResult) *runtimev1.InvokeRealmUnaryResponse {
	if err := scanRealmBrokerResponseForCredentials(result.header, result.body); err != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CREDENTIAL_RESPONSE_FORBIDDEN, err.Error(), result.status)
	}
	if json.Valid(result.body) && jsonstrict.RejectDuplicateKeys(result.body) != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, "Realm response violates the JSON contract", result.status)
	}
	message := trimRealmUnaryErrorBody(string(result.body))
	switch result.status {
	case http.StatusRequestTimeout, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE, message, result.status)
	case http.StatusUnauthorized:
		return realmUnaryFailure(runtimev1.ReasonCode_AUTH_TOKEN_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID, message, result.status)
	case http.StatusForbidden:
		return realmUnaryFailure(runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_FORBIDDEN, message, result.status)
	case http.StatusNotFound:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_NOT_FOUND, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_NOT_FOUND, message, result.status)
	case http.StatusConflict:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONFLICT, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONFLICT, message, result.status)
	case http.StatusTooManyRequests:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_RATE_LIMITED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RATE_LIMITED, message, result.status)
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_REQUEST_REJECTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED, message, result.status)
	case http.StatusMethodNotAllowed, http.StatusUnsupportedMediaType:
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, message, result.status)
	}
	if result.status >= 300 && result.status < 400 {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, message, result.status)
	}
	if result.status >= 500 {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_OPERATION_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_FAILED, message, result.status)
	}
	if result.status < 200 || result.status >= 300 {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, message, result.status)
	}
	mediaType, _, err := mime.ParseMediaType(result.header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" || len(bytes.TrimSpace(result.body)) == 0 || !json.Valid(result.body) || jsonstrict.RejectDuplicateKeys(result.body) != nil {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, "Realm success response violates the JSON contract", result.status)
	}
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted:          true,
		ResponseJson:      strings.TrimSpace(string(result.body)),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		HttpStatus:        int32(result.status),
	}
}

func (s *Service) invalidateAccountAfterRealmUnauthorized(ctx context.Context) {
	if err := s.custody.Clear(ctx, s.partition); err != nil {
		s.markCustodyUnavailable()
		return
	}
	s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID)
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
		if !refresh.accepted {
			return "", refresh.accountReasonCode, false, nil
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
	if parsed.User != nil || parsed.Opaque != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("realm base URL authority is invalid")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = strings.TrimRight(parsed.RawPath, "/")
	return parsed.String(), nil
}

func parseRealmUnaryRequest(raw string) (realmUnaryRequestJSON, error) {
	if strings.TrimSpace(raw) == "" || len(raw) > realmUnaryRequestJSONMaxSize {
		return realmUnaryRequestJSON{}, fmt.Errorf("realm request JSON is missing or exceeds the admitted bound")
	}
	var parsed realmUnaryRequestJSON
	if err := jsonstrict.Decode([]byte(raw), &parsed); err != nil {
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
	trimmed := strings.TrimSpace(strings.ToValidUTF8(value, "\uFFFD"))
	if len(trimmed) > 512 {
		return strings.ToValidUTF8(trimmed[:512], "\uFFFD")
	}
	return trimmed
}
