package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Only the provider transport is a fixture. Open, Driver readiness, resource
// binding, owner Close/removal, authorization and receipt lookup are production.
type closeRecoveryTransport struct {
	events chan []byte
	errors chan error
	closes atomic.Int32
}

func (p *closeRecoveryTransport) Send(context.Context, []byte) error { return nil }
func (p *closeRecoveryTransport) Events() <-chan []byte              { return p.events }
func (p *closeRecoveryTransport) Errors() <-chan error               { return p.errors }
func (p *closeRecoveryTransport) Close() error                       { p.closes.Add(1); return nil }

type closeRecoveryHost struct{ sessions []*closeRecoveryTransport }

func (h *closeRecoveryHost) Open(context.Context, string, connector.ConnectorRecord, string, remoteexecution.RealtimeProviderTarget, capabilitydriver.CloudRealtimeTransport) (remoteexecution.RealtimeSession, error) {
	p := &closeRecoveryTransport{events: make(chan []byte, 1), errors: make(chan error)}
	p.events <- []byte(`{"type":"session.updated"}`)
	h.sessions = append(h.sessions, p)
	return p, nil
}

func TestProtectedRealtimeCloseLostReplyUsesActualOwnerTerminal(t *testing.T) {
	for _, releaseBinding := range []bool{true, false} {
		t.Run(map[bool]string{true: "reply-lost-after-release", false: "owner-gone-binding-remains"}[releaseBinding], func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
			created, err := store.Create(connector.ConnectorRecord{ConnectorID: "realtime-close-fixture", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account", Provider: "dashscope", Endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "fixture-only-key")
			if err != nil {
				t.Fatal(err)
			}
			catalogCtx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs("x-nimi-app-id", "app.test"))
			models, err := connector.New(logger, store, nil).ListConnectorModels(catalogCtx, &runtimev1.ListConnectorModelsRequest{ConnectorId: created.ConnectorID, PageSize: 200})
			if err != nil {
				t.Fatal(err)
			}
			var descriptor *runtimev1.ConnectorModelDescriptor
			for _, model := range models.GetModels() {
				if model.GetProviderModelId() == "qwen3.5-omni-flash-realtime" {
					descriptor = model
				}
			}
			if descriptor == nil {
				t.Fatal("admitted realtime target not found")
			}
			owner, err := aiservice.New(logger, nil, store, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "state.json")})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(owner.ShutdownRealtime)
			host := &closeRecoveryHost{}
			owner.SetRemoteRealtimeExecutionHost(host)
			connection := newGRPCLocalAppConnection(t, 0x40)
			handle := protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x41), SessionProof: grpcLocalAppIdentifier(0x42)}
			if err := connection.BindSession(handle); err != nil {
				t.Fatal(err)
			}
			invalidated, _ := connection.SessionInvalidated(handle)
			decision := accountservice.LocalAppCallerDecision{SessionID: handle.SessionID, AccountID: "account", AppID: "app.test", RegisteredAppSubject: "subject", SessionInvalidated: invalidated}
			admission := &localAppAdmissionStub{decision: &decision}
			target, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": descriptor.GetProviderModelId(), "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId()})
			ctx := executionintent.WithIntent(peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}}), executionintent.Intent{CapabilityContract: "realtime.interact", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: created.ConnectorID, CloudImplementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.realtime.interact.dashscope", DriverId: "nimi.runtime.driver.dashscope", DriverDialect: "dashscope/realtime/v1"}, ProviderModelTarget: target})
			intercept := newUnaryProtectedLocalAppTransportInterceptor(admission)
			open := func() *runtimev1.OpenRealtimeSessionResponse {
				response, err := intercept(ctx, &runtimev1.OpenRealtimeSessionRequest{InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}}, &grpc.UnaryServerInfo{FullMethod: protectedOpenAIRealtimeMethod, Server: owner}, func(ctx context.Context, req any) (any, error) {
					return owner.OpenRealtimeSession(ctx, req.(*runtimev1.OpenRealtimeSessionRequest))
				})
				if err != nil {
					t.Fatal(err)
				}
				return response.(*runtimev1.OpenRealtimeSessionResponse)
			}
			opened := open()
			req := &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: opened.GetRealtimeSessionId(), Generation: opened.GetGeneration()}
			closeViaIngress := func(request *runtimev1.CloseRealtimeSessionRequest) (any, error) {
				return intercept(ctx, request, &grpc.UnaryServerInfo{FullMethod: protectedCloseAIRealtimeMethod, Server: owner}, func(ctx context.Context, req any) (any, error) {
					return owner.CloseRealtimeSession(ctx, req.(*runtimev1.CloseRealtimeSessionRequest))
				})
			}
			var first any
			admission.err = grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
			if _, err := closeViaIngress(req); err == nil || host.sessions[0].closes.Load() != 0 {
				t.Fatal("undelivered first Close changed owner")
			}
			admission.err = nil
			if releaseBinding {
				first, err = closeViaIngress(req)
			} else {
				first, err = owner.CloseRealtimeSession(accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), req)
			}
			if err != nil {
				t.Fatal(err)
			}
			if host.sessions[0].closes.Load() != 1 {
				t.Fatal("actual provider not released")
			}
			// Drop the response. No owner remains, while the binding may or may not.
			_, missing := owner.AppendRealtimeInput(accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: req.RealtimeSessionId, Generation: req.Generation})
			if localAppTransportReason(missing) != runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND {
				t.Fatalf("owner still exists: %v", missing)
			}
			second, err := closeViaIngress(req)
			if err != nil {
				t.Fatalf("same protected scope retry: %v", err)
			}
			if !proto.Equal(first.(proto.Message), second.(proto.Message)) || host.sessions[0].closes.Load() != 1 {
				t.Fatal("retry changed receipt or repeated provider work")
			}
			wrong := proto.Clone(req).(*runtimev1.CloseRealtimeSessionRequest)
			wrong.Generation++
			if _, err := closeViaIngress(wrong); localAppTransportReason(err) != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
				t.Fatalf("wrong generation admitted: %v", err)
			}
			admission.err = grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
			if _, err := closeViaIngress(req); localAppTransportReason(err) != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
				t.Fatal("permanent denial became success")
			}
			admission.err = nil
			next := open()
			if _, err := closeViaIngress(req); err != nil {
				t.Fatal(err)
			}
			if next.RealtimeSessionId == req.RealtimeSessionId || host.sessions[1].closes.Load() != 0 {
				t.Fatal("old receipt affected new session")
			}
			newHandle := protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x43), SessionProof: grpcLocalAppIdentifier(0x44)}
			if err := connection.RotateSession(handle, newHandle); err != nil {
				t.Fatal(err)
			}
			decision.SessionID = newHandle.SessionID
			decision.SessionInvalidated, _ = connection.SessionInvalidated(newHandle)
			if _, err := closeViaIngress(req); localAppTransportReason(err) != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
				t.Fatalf("new technical session borrowed old receipt: %v", err)
			}
		})
	}
}
