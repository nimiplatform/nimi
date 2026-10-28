package remoteexecution

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
)

type RealtimeProviderTarget interface {
	Provider() string
	ProviderModelID() string
	RemoteModelCatalogID() string
}

type RealtimeSession interface {
	Send(context.Context, []byte) error
	Events() <-chan []byte
	Errors() <-chan error
	Close() error
}

type RealtimeHost interface {
	Open(context.Context, string, connector.ConnectorRecord, string, RealtimeProviderTarget, capabilitydriver.CloudRealtimeTransport) (RealtimeSession, error)
}

type ProviderRealtimeHost struct {
	connectors    *connector.ConnectorStore
	allowLoopback bool
}

func NewProviderRealtimeHost(connectors *connector.ConnectorStore, allowLoopback bool) *ProviderRealtimeHost {
	return &ProviderRealtimeHost{connectors: connectors, allowLoopback: allowLoopback}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r114
// Open captures one exact Connector credential generation into the private
// live WebSocket. Its origin comes from that captured managed connection;
// Driver metadata supplies only versioned protocol paths, never an origin.
func (h *ProviderRealtimeHost) Open(
	ctx context.Context,
	accountID string,
	record connector.ConnectorRecord,
	secretPayload string,
	target RealtimeProviderTarget,
	transport capabilitydriver.CloudRealtimeTransport,
) (RealtimeSession, error) {
	if h == nil || h.connectors == nil || target == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	accountID = strings.TrimSpace(accountID)
	if accountID == "" || record.ConnectorID == "" || record.OwnerID != accountID ||
		record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED || record.Provider != target.Provider() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	credential := connector.ResolveCredential(record, secretPayload)
	defer func() {
		credential.APIKey = ""
		for key := range credential.Headers {
			credential.Headers[key] = ""
			delete(credential.Headers, key)
		}
	}()
	if credential.APIKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	endpoint, err := materializeRealtimeEndpoint(record.Endpoint, transport, target.ProviderModelID())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	config, err := websocket.NewConfig(endpoint, "https://runtime.nimi.local")
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	config.Header = make(http.Header)
	if transport.APIKeyHeader != "" {
		if target.Provider() != "gemini" || transport.APIKeyHeader != "x-goog-api-key" {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
		config.Header.Set(transport.APIKeyHeader, credential.APIKey)
	} else {
		config.Header.Set("Authorization", "Bearer "+credential.APIKey)
	}
	for key, value := range credential.Headers {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" && !strings.EqualFold(key, "Authorization") && !strings.EqualFold(key, "x-goog-api-key") {
			config.Header.Set(key, value)
		}
	}
	conn, transportConn, err := endpointsec.DialWebSocket(ctx, config, h.allowLoopback)
	if err != nil {
		return nil, normalizeRealtimeDialError(err)
	}
	session := &providerRealtimeSession{
		conn: conn, transport: transportConn, events: make(chan []byte, 64), errors: make(chan error, 1), done: make(chan struct{}),
	}
	go session.readLoop()
	return session, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.realtime-connection-endpoint
func materializeRealtimeEndpoint(base string, transport capabilitydriver.CloudRealtimeTransport, model string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return "", fmt.Errorf("captured Realtime connection endpoint is invalid")
	}
	parsed.Scheme = "wss"
	// Preserve a custom proxy prefix and captured origin, including workspace
	// or region. Replace only the Driver's declared service base path.
	basePath := strings.TrimRight(parsed.EscapedPath(), "/")
	basePath = strings.TrimSuffix(basePath, transport.BasePath)
	parsed.RawPath = basePath + transport.Path
	parsed.Path, err = url.PathUnescape(parsed.RawPath)
	if err != nil {
		return "", fmt.Errorf("materialize Realtime protocol path: %w", err)
	}
	return realtimeProviderURL(parsed.String(), model, transport.ModelQuery)
}

func realtimeProviderURL(endpoint string, model string, modelQuery bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "wss" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawFragment != "" {
		return "", fmt.Errorf("Realtime Driver endpoint is invalid")
	}
	if strings.TrimSpace(model) == "" || strings.TrimSpace(model) != model {
		return "", fmt.Errorf("Realtime Driver model identity is invalid")
	}
	if modelQuery {
		query := parsed.Query()
		query.Set("model", model)
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

func normalizeRealtimeDialError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, endpointsec.ErrWebSocketEndpoint) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
}

type providerRealtimeSession struct {
	conn      *websocket.Conn
	transport net.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
	events    chan []byte
	errors    chan error
	done      chan struct{}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r116
func (s *providerRealtimeSession) Send(ctx context.Context, payload []byte) error {
	if s == nil || s.conn == nil || len(payload) == 0 {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	default:
	}
	// Cancellation must close the physical transport, not wait for the frame
	// writer's mutex through websocket.Close.
	stop := context.AfterFunc(ctx, func() { _ = s.Close() })
	defer stop()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	default:
	}
	err := websocket.Message.Send(s.conn, string(payload))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	return nil
}

func (s *providerRealtimeSession) Events() <-chan []byte { return s.events }
func (s *providerRealtimeSession) Errors() <-chan error  { return s.errors }

func (s *providerRealtimeSession) Close() error {
	if s == nil {
		return nil
	}
	var closeErr error
	s.closeOnce.Do(func() {
		close(s.done)
		if s.transport != nil {
			closeErr = s.transport.Close()
		}
	})
	return closeErr
}

func (s *providerRealtimeSession) readLoop() {
	defer close(s.events)
	defer close(s.errors)
	for {
		var payload []byte
		if err := websocket.Message.Receive(s.conn, &payload); err != nil {
			select {
			case <-s.done:
				return
			default:
			}
			select {
			case s.errors <- err:
			default:
			}
			_ = s.Close()
			return
		}
		copied := append([]byte(nil), payload...)
		select {
		case s.events <- copied:
		case <-s.done:
			return
		default:
			select {
			case s.errors <- fmt.Errorf("Realtime provider event buffer is full"):
			default:
			}
			_ = s.Close()
			return
		}
	}
}
