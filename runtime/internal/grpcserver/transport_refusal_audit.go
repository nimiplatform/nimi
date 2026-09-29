package grpcserver

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	transportRefusalDomain = "runtime.protected_transport"
	transportDesktop       = "desktop"
	transportLocalApp      = "local_app"

	transportRefusalStageRPC       = "rpc"
	transportRefusalStageMessage   = "stream_message"
	transportRefusalStageHandshake = "handshake"
	transportRefusalStagePeer      = "peer_verification"
)

// @nimi-authority: rule.nimi.runtime.protected-session.r021
// transportRefusalAudit records the refusals a production protected transport
// chain decides itself: OS peer verification at the native listener,
// transport handshakes, connection, session, role, and admission checks that
// reject a call before its owner handler runs, and per-message authorization
// on admitted streams. Admitted calls are never logged here, handler results
// belong to their owners, and the store coalesces identical refusals so a
// misbehaving peer cannot evict the rest of the bounded plane.
type transportRefusalAudit struct {
	store     *auditlog.Store
	transport string
	now       func() time.Time
}

func newTransportRefusalAudit(store *auditlog.Store, transport string) *transportRefusalAudit {
	if store == nil {
		return nil
	}
	return &transportRefusalAudit{store: store, transport: transport, now: time.Now}
}

func (audit *transportRefusalAudit) unary(inner grpc.UnaryServerInterceptor) grpc.UnaryServerInterceptor {
	if audit == nil {
		return inner
	}
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		dispatched := false
		response, err := inner(ctx, req, info, func(ctx context.Context, req any) (any, error) {
			dispatched = true
			return handler(ctx, req)
		})
		if err != nil && !dispatched {
			audit.record(ctx, unaryMethod(info), transportRefusalStageRPC, err)
		}
		return response, err
	}
}

func (audit *transportRefusalAudit) stream(inner grpc.StreamServerInterceptor) grpc.StreamServerInterceptor {
	if audit == nil {
		return inner
	}
	return func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		dispatched := false
		method := streamMethod(info)
		err := inner(srv, stream, info, func(srv any, admitted grpc.ServerStream) error {
			dispatched = true
			return handler(srv, &refusalAuditedServerStream{ServerStream: admitted, audit: audit, method: method})
		})
		if err != nil && !dispatched {
			audit.record(stream.Context(), method, transportRefusalStageRPC, err)
		}
		return err
	}
}

// refusalAuditedServerStream records a Runtime-decided refusal of one inbound
// message on an admitted stream. Transport errors, EOF, and cancellation carry
// no Runtime reason and are not refusals.
type refusalAuditedServerStream struct {
	grpc.ServerStream
	audit  *transportRefusalAudit
	method string
}

func (stream *refusalAuditedServerStream) RecvMsg(message any) error {
	err := stream.ServerStream.RecvMsg(message)
	if err != nil {
		if _, typed := grpcerr.ExtractReasonCode(err); typed {
			stream.audit.record(stream.Context(), stream.method, transportRefusalStageMessage, err)
		}
	}
	return err
}

// recordHandshake records a connection the transport credentials refused.
func (audit *transportRefusalAudit) recordHandshake(reason runtimev1.ReasonCode) {
	if audit == nil {
		return
	}
	audit.record(context.Background(), "connection", transportRefusalStageHandshake, grpcerr.WithReasonCode(codes.PermissionDenied, reason))
}

// recordPeerRejection records a process the verified native listener refused
// before any protected transport existed. The bounded stage label is kept;
// the refused process is never attributed to an App or to Desktop.
func (audit *transportRefusalAudit) recordPeerRejection(rejection protectedlocal.PeerRejection) {
	if audit == nil {
		return
	}
	reason := runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE
	if audit.transport == transportLocalApp {
		reason = runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	}
	if value, ok := runtimev1.ReasonCode_value[string(rejection.Reason)]; ok {
		reason = runtimev1.ReasonCode(value)
	}
	audit.record(context.Background(), "connection:"+boundedMethod(rejection.Stage), transportRefusalStagePeer, grpcerr.WithReasonCode(codes.PermissionDenied, reason))
}

func (audit *transportRefusalAudit) record(ctx context.Context, method string, stage string, refusal error) {
	if audit == nil || refusal == nil || errors.Is(refusal, context.Canceled) || errors.Is(refusal, context.DeadlineExceeded) {
		return
	}
	code := status.Code(refusal)
	if code == codes.Canceled || code == codes.DeadlineExceeded {
		return
	}
	reason, typed := grpcerr.ExtractReasonCode(refusal)
	if !typed {
		reason = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	fields := map[string]any{
		"transport":   audit.transport,
		"stage":       stage,
		"grpc_method": method,
		"grpc_code":   code.String(),
	}
	// Calls on an established transport come from its verified peer; a refused
	// handshake or listener peer is unverified and attributed to nobody.
	callerKind := runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED
	appID := ""
	if stage == transportRefusalStageRPC || stage == transportRefusalStageMessage {
		callerKind = runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE
		appID = envelope.ProtectedDesktopAppID
		if audit.transport == transportLocalApp {
			callerKind = runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP
			appID = ""
			if trustClass := localAppPeerTrustClass(ctx); trustClass != "" {
				fields["trust_class"] = trustClass
			}
		}
	}
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		payload = nil
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	if err := audit.store.AppendRefusal(&runtimev1.AuditEventRecord{
		AppId:      appID,
		Domain:     transportRefusalDomain,
		Operation:  method,
		ReasonCode: reason,
		TraceId:    traceID,
		RequestId:  traceID,
		Timestamp:  timestamppb.New(audit.now().UTC()),
		Payload:    payload,
		CallerKind: callerKind,
		SurfaceId:  "runtime.protected_transport." + audit.transport,
	}); err != nil {
		// The refusal itself stands; only its record is missing.
		audit.store.ReportUnrecorded(transportRefusalDomain, method, err)
	}
}

func localAppPeerTrustClass(ctx context.Context) string {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok || peerInfo == nil {
		return ""
	}
	authInfo, ok := peerInfo.AuthInfo.(*protectedLocalAppAuthInfo)
	if !ok || authInfo == nil || authInfo.connection == nil {
		return ""
	}
	return string(authInfo.connection.TrustClass())
}

func unaryMethod(info *grpc.UnaryServerInfo) string {
	if info == nil {
		return "unknown"
	}
	return boundedMethod(info.FullMethod)
}

func streamMethod(info *grpc.StreamServerInfo) string {
	if info == nil {
		return "unknown"
	}
	return boundedMethod(info.FullMethod)
}

// boundedMethod keeps a caller-chosen method name within the audit filter
// alphabet and length so it cannot inflate or corrupt the record.
func boundedMethod(method string) string {
	if method == "" {
		return "unknown"
	}
	if len(method) > 128 {
		method = method[:128]
	}
	for index := 0; index < len(method); index++ {
		char := method[index]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._:/-", rune(char)) {
			continue
		}
		return "invalid:" + strconv.Itoa(len(method))
	}
	return method
}
