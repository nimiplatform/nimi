package remoteexecution

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

type ProviderRealtimeHost struct {
	connectors    *connector.ConnectorStore
	allowLoopback bool
}

func NewProviderRealtimeHost(connectors *connector.ConnectorStore, allowLoopback bool) *ProviderRealtimeHost {
	return &ProviderRealtimeHost{connectors: connectors, allowLoopback: allowLoopback}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r114
// Open captures one exact Connector credential generation into the private
// live WebSocket. The endpoint is Driver-owned input and never comes from the
// Connector, AIConfig, App, or environment.
func (h *ProviderRealtimeHost) Open(
	ctx context.Context,
	accountID string,
	record connector.ConnectorRecord,
	secretPayload string,
	target RealtimeProviderTarget,
	driverEndpoint string,
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
	endpoint, err := realtimeProviderURL(driverEndpoint, target.ProviderModelID())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	if err := endpointsec.ValidateWebSocketEndpoint(ctx, endpoint, h.allowLoopback); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	config, err := websocket.NewConfig(endpoint, "https://runtime.nimi.local")
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{})
	}
	config.Header = make(http.Header)
	config.Header.Set("Authorization", "Bearer "+credential.APIKey)
	for key, value := range credential.Headers {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			config.Header.Set(key, value)
		}
	}
	conn, err := config.DialContext(ctx)
	if err != nil {
		return nil, normalizeRealtimeDialError(err)
	}
	session := &providerRealtimeSession{
		conn: conn, events: make(chan []byte, 64), errors: make(chan error, 1), done: make(chan struct{}),
	}
	go session.readLoop()
	return session, nil
}

func realtimeProviderURL(endpoint string, model string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "wss" || parsed.Host == "" || parsed.User != nil || parsed.RawFragment != "" {
		return "", fmt.Errorf("Realtime Driver endpoint is invalid")
	}
	if strings.TrimSpace(model) == "" || strings.TrimSpace(model) != model {
		return "", fmt.Errorf("Realtime Driver model identity is invalid")
	}
	query := parsed.Query()
	query.Set("model", model)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func normalizeRealtimeDialError(err error) error {
	if err == nil {
		return nil
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
}

type providerRealtimeSession struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
	events    chan []byte
	errors    chan error
	done      chan struct{}
}

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
	s.writeMu.Lock()
	err := websocket.Message.Send(s.conn, string(payload))
	s.writeMu.Unlock()
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
		if s.conn != nil {
			closeErr = s.conn.Close()
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
