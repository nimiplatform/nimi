package grpcserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
)

func newUnaryProtocolInterceptor(store *idempotency.Store) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		requireIdempotency := isWriteMethod(info.FullMethod)
		meta, err := envelope.Validate(ctx, req, requireIdempotency)
		if err != nil {
			return nil, err
		}

		if requireIdempotency && store != nil {
			appID := strings.TrimSpace(meta.AppID)
			if appID == "" {
				appID = appIDFromRequest(req)
			}
			requestHash := hashRequest(req)
			if replay, hit, conflict := store.Load(info.FullMethod, appID, meta.ParticipantID, meta.IdempotencyKey, requestHash); conflict {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			} else if hit {
				return replay, nil
			}

			resp, callErr := handler(ctx, req)
			if callErr == nil {
				store.Save(info.FullMethod, appID, meta.ParticipantID, meta.IdempotencyKey, requestHash, resp)
			}
			return resp, callErr
		}

		return handler(ctx, req)
	}
}

func newStreamProtocolInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		requireIdempotency := isWriteMethod(info.FullMethod)
		meta, err := envelope.Validate(ss.Context(), nil, requireIdempotency)
		if err != nil {
			return err
		}
		wrapped := &protocolStream{
			ServerStream:   ss,
			metadataAppID:  strings.TrimSpace(meta.AppID),
			checkedRequest: false,
		}
		return handler(srv, wrapped)
	}
}

type protocolStream struct {
	grpc.ServerStream
	metadataAppID  string
	checkedRequest bool
}

func (s *protocolStream) RecvMsg(m any) error {
	if err := s.ServerStream.RecvMsg(m); err != nil {
		return err
	}
	if s.checkedRequest {
		return nil
	}
	s.checkedRequest = true
	if s.metadataAppID == "" {
		return nil
	}
	requestAppID := appIDFromRequest(m)
	if requestAppID == "" {
		return nil
	}
	if requestAppID != s.metadataAppID {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT)
	}
	return nil
}

func hashRequest(req any) string {
	msg, ok := req.(proto.Message)
	if ok && msg != nil {
		raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(msg)
		if err == nil {
			sum := sha256.Sum256(raw)
			return hex.EncodeToString(sum[:])
		}
	}
	fallback := fmt.Sprintf("%#v", req)
	sum := sha256.Sum256([]byte(fallback))
	return hex.EncodeToString(sum[:])
}

func isWriteMethod(fullMethod string) bool {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAiService/Generate",
		"/nimi.runtime.v1.RuntimeAiService/StreamGenerate",
		"/nimi.runtime.v1.RuntimeAiService/Embed",
		"/nimi.runtime.v1.RuntimeAiService/SubmitMediaJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelMediaJob",
		"/nimi.runtime.v1.RuntimeWorkflowService/SubmitWorkflow",
		"/nimi.runtime.v1.RuntimeWorkflowService/CancelWorkflow",
		"/nimi.runtime.v1.RuntimeModelService/PullModel",
		"/nimi.runtime.v1.RuntimeModelService/RemoveModel",
		"/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal",
		"/nimi.runtime.v1.RuntimeGrantService/RevokeAppAccessToken",
		"/nimi.runtime.v1.RuntimeGrantService/IssueDelegatedAccessToken",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeAuthService/OpenSession",
		"/nimi.runtime.v1.RuntimeAuthService/RefreshSession",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeSession",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterExternalPrincipal",
		"/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeKnowledgeService/BuildIndex",
		"/nimi.runtime.v1.RuntimeKnowledgeService/DeleteIndex",
		"/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
		"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return true
	default:
		return false
	}
}
