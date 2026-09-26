package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

type adapterError string

func (e adapterError) Error() string { return string(e) }
func publicAdapterError(err error) string {
	var typed adapterError
	if errors.As(err, &typed) {
		return string(typed)
	}
	if errors.Is(err, context.Canceled) {
		return "INTEGRATION_CANCELED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "INTEGRATION_TIMEOUT"
	}
	return "INTEGRATION_EXECUTOR_FAILED"
}

// Preserve the failure phase without returning a provider URL, credentials or
// response body. A failure before tools/call remains known not dispatched.
func mcpFailure(err error, phase adapterError) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	var transportError *url.Error
	if errors.As(err, &transportError) {
		return adapterError("INTEGRATION_NETWORK_FAILED")
	}
	return phase
}

type credentialTransport struct {
	base  http.RoundTripper
	token string
}

func (t credentialTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	copy := req.Clone(req.Context())
	copy.Header = req.Header.Clone()
	if t.token != "" {
		copy.Header.Set("Authorization", "Bearer "+t.token)
	}
	response, err := t.base.RoundTrip(copy)
	if err != nil || response == nil {
		return response, err
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if mediaType == "text/event-stream" {
		return response, nil
	}
	// The SDK bounds SSE events. Ordinary JSON responses are bounded here
	// before its decoder allocates provider-controlled response data.
	if response.Body == nil {
		return response, nil
	}
	data, readErr := io.ReadAll(io.LimitReader(response.Body, maxOutput+1))
	closeErr := response.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	if len(data) > maxOutput {
		return nil, adapterError("INTEGRATION_RESULT_BOUNDS")
	}
	if closeErr != nil {
		return nil, closeErr
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	return response, nil
}
func (s *Service) mcpSession(ctx context.Context, endpoint, secret string) (*mcp.ClientSession, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" {
		return nil, adapterError("INTEGRATION_ENDPOINT_INVALID")
	}
	if parsed.Scheme != "https" {
		ip := net.ParseIP(parsed.Hostname())
		if parsed.Scheme != "http" || (parsed.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return nil, adapterError("INTEGRATION_ENDPOINT_INVALID")
		}
	}
	base := s.http.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client := *s.http
	client.Transport = credentialTransport{base: base, token: secret}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("integration redirects unavailable") }
	// Protocol diagnostics can contain remote private content; ordinary Runtime
	// logs contain only our bounded typed adapter errors.
	mcpClient := mcp.NewClient(&mcp.Implementation{Name: "Nimi Integration", Version: "1"}, &mcp.ClientOptions{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		// Input-required and load-shedding results do not authorize a second
		// business invocation. Return them to this owner without SDK retries.
		MultiRoundTrip: &mcp.MultiRoundTripOptions{Disabled: true},
	})
	return mcpClient.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: endpoint, HTTPClient: &client, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: maxOutput}, nil)
}
func (s *Service) configure(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	t := target{Account: account, Endpoint: req.Endpoint, Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: req.Adapter, DisplayName: req.DisplayName, AccountLabel: req.AccountLabel, Kind: req.Adapter, Available: true}}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	switch req.Adapter {
	case "mcp":
		session, err := s.mcpSession(ctx, req.Endpoint, secret)
		if err != nil {
			return target{}, failure(codes.Unavailable, publicAdapterError(err))
		}
		defer func() { _ = session.Close() }()
		for tool, err := range session.Tools(ctx, nil) {
			if err != nil {
				return target{}, failure(codes.Unavailable, "INTEGRATION_DISCOVERY_FAILED")
			}
			input, err := json.Marshal(tool.InputSchema)
			if err != nil {
				return target{}, failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
			}
			output := []byte(`{"type":"object"}`)
			if tool.OutputSchema != nil {
				output, err = json.Marshal(tool.OutputSchema)
				if err != nil {
					return target{}, failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
				}
			}
			effect := "write"
			if tool.Annotations != nil && tool.Annotations.ReadOnlyHint {
				effect = "read"
			}
			t.Public.Operations = append(t.Public.Operations, &runtimev1.IntegrationOperation{Name: tool.Name, Description: tool.Description, InputSchemaJson: string(input), OutputSchemaJson: string(output), Effect: effect, RetryPolicy: "none"})
			if len(t.Public.Operations) > 128 {
				return target{}, failure(codes.InvalidArgument, "INTEGRATION_OPERATIONS_BOUNDS")
			}
		}
	case "telegram":
		if req.Endpoint != "" || secret == "" {
			return target{}, failure(codes.InvalidArgument, "INTEGRATION_TELEGRAM_CONFIGURATION_INVALID")
		}
		var me struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		}
		if _, err := s.telegramRequest(ctx, secret, "getMe", map[string]any{}, &me); err != nil {
			return target{}, failure(codes.Unavailable, publicAdapterError(err))
		}
		if me.ID <= 0 || strings.TrimSpace(me.Username) == "" || len(me.Username) > 255 {
			return target{}, failure(codes.FailedPrecondition, "INTEGRATION_TELEGRAM_IDENTITY_INVALID")
		}
		t.TelegramBotID = me.ID
		var webhook struct {
			URL string `json:"url"`
		}
		if _, err := s.telegramRequest(ctx, secret, "getWebhookInfo", map[string]any{}, &webhook); err != nil {
			return target{}, failure(codes.Unavailable, publicAdapterError(err))
		}
		if webhook.URL != "" {
			return target{}, failure(codes.FailedPrecondition, "INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT")
		}
		t.Public.AccountLabel = "@" + me.Username
		t.Public.Operations = telegramOperations()
	default:
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_ADAPTER_UNSUPPORTED")
	}
	if err := validateOperations(t.Public.Operations); err != nil {
		return target{}, err
	}
	return t, nil
}

// captureCredential fixes Runtime-owned custody at invocation acceptance.
// It never puts the credential into target persistence, public calls or logs.
func (s *Service) captureCredential(t target) (string, error) {
	if t.Public.Kind == "app" {
		return "", nil
	}
	secret := ""
	if s.secrets != nil {
		var err error
		secret, _, err = s.secrets.ReadSecret("integration:" + t.Public.TargetRef)
		if err != nil {
			return "", failure(codes.Unavailable, "INTEGRATION_CREDENTIAL_UNAVAILABLE")
		}
	}
	if t.Public.Kind == "telegram" && secret == "" {
		return "", failure(codes.Unavailable, "INTEGRATION_CREDENTIAL_UNAVAILABLE")
	}
	return secret, nil
}
func (s *Service) execute(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	switch t.Public.Kind {
	case "mcp":
		session, err := s.mcpSession(ctx, t.Endpoint, secret)
		if err != nil {
			return "", false, mcpFailure(err, adapterError("INTEGRATION_MCP_INITIALIZE_FAILED"))
		}
		defer func() { _ = session.Close() }()
		if err := ctx.Err(); err != nil {
			return "", false, err
		}
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: op.Name, Arguments: json.RawMessage(input)})
		if err != nil {
			return "", true, mcpFailure(err, adapterError("INTEGRATION_MCP_CALL_FAILED"))
		}
		if result.NeedsInput() || result.InputRequests != nil {
			return "", true, adapterError("INTEGRATION_INTERACTION_UNSUPPORTED")
		}
		if result.IsError {
			return "", true, adapterError("INTEGRATION_PROVIDER_FAILED")
		}
		var encoded []byte
		if result.StructuredContent != nil {
			encoded, err = json.Marshal(result.StructuredContent)
		} else {
			encoded, err = json.Marshal(map[string]any{"content": result.Content})
		}
		return string(encoded), true, err
	case "telegram":
		if secret == "" {
			return "", false, adapterError("INTEGRATION_CREDENTIAL_UNAVAILABLE")
		}
		if op.Name == "telegram.updates.read" {
			result, err := s.readTelegramUpdates(ctx, t, secret, input)
			return result, false, err
		}
		if op.Name == "telegram.sendMessage" {
			var inputValue struct {
				ChatID string `json:"chatId"`
				Text   string `json:"text"`
			}
			if json.Unmarshal([]byte(input), &inputValue) != nil {
				return "", false, adapterError("INTEGRATION_INPUT_INVALID")
			}
			var result struct {
				MessageID int64  `json:"message_id"`
				Date      int64  `json:"date"`
				Text      string `json:"text"`
				Chat      struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			}
			dispatched, err := s.telegramRequest(ctx, secret, "sendMessage", map[string]any{"chat_id": inputValue.ChatID, "text": inputValue.Text}, &result)
			if err != nil {
				return "", dispatched, err
			}
			encoded, err := json.Marshal(map[string]any{"messageId": result.MessageID, "chatId": strconv.FormatInt(result.Chat.ID, 10), "date": result.Date, "text": result.Text})
			return string(encoded), dispatched, err
		}
	}
	return "", false, adapterError("INTEGRATION_ADAPTER_UNSUPPORTED")
}
func (s *Service) telegramRequest(ctx context.Context, token, method string, args any, result any) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if strings.ContainsAny(token, "/\r\n?#") || len(token) > 256 {
		return false, adapterError("INTEGRATION_CREDENTIAL_INVALID")
	}
	body, err := json.Marshal(args)
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return false, adapterError("INTEGRATION_INPUT_INVALID")
	}
	req.Header.Set("Content-Type", "application/json")
	client := *s.http
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("integration redirects unavailable") }
	response, err := client.Do(req)
	if err != nil {
		return true, adapterError("INTEGRATION_TRANSPORT_UNCONFIRMED")
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxOutput+1))
	if err != nil || len(data) > maxOutput {
		return true, adapterError("INTEGRATION_RESULT_BOUNDS")
	}
	var envelope struct {
		OK        bool            `json:"ok"`
		Result    json.RawMessage `json:"result"`
		ErrorCode int             `json:"error_code"`
	}
	if json.Unmarshal(data, &envelope) != nil {
		return true, adapterError("INTEGRATION_RESPONSE_INVALID")
	}
	if !envelope.OK {
		if envelope.ErrorCode == 409 {
			return false, adapterError("INTEGRATION_TELEGRAM_RECEIVER_CONFLICT")
		}
		return false, adapterError("INTEGRATION_PROVIDER_REJECTED")
	}
	if err := json.Unmarshal(envelope.Result, result); err != nil {
		return true, adapterError("INTEGRATION_RESPONSE_INVALID")
	}
	return true, nil
}
func telegramOperations() []*runtimev1.IntegrationOperation {
	return []*runtimev1.IntegrationOperation{
		{Name: "telegram.sendMessage", Description: "Send a message to the selected Telegram chat.", InputSchemaJson: `{"type":"object","additionalProperties":false,"required":["chatId","text"],"properties":{"chatId":{"type":"string","minLength":1,"maxLength":128},"text":{"type":"string","minLength":1,"maxLength":4096}}}`, OutputSchemaJson: `{"type":"object","required":["messageId","chatId","date","text"],"properties":{"messageId":{"type":"integer"},"chatId":{"type":"string"},"date":{"type":"integer"},"text":{"type":"string"}}}`, Effect: "write", RetryPolicy: "none"},
		{Name: "telegram.updates.read", Description: "Read replies from the Runtime-owned shared receiver. Cursor retention is at most 24 hours and 1000 updates; canceling the invocation ends this reader.", InputSchemaJson: `{"type":"object","additionalProperties":false,"required":["chatIds"],"properties":{"cursor":{"type":"string","maxLength":128},"waitMs":{"type":"integer","minimum":0,"maximum":25000},"chatIds":{"type":"array","minItems":1,"maxItems":100,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":128}}}}`, OutputSchemaJson: `{"type":"object","required":["cursor","updates"],"properties":{"cursor":{"type":"string"},"updates":{"type":"array"}}}`, Effect: "read", SupportsCancel: true, RetryPolicy: "safe"},
	}
}
