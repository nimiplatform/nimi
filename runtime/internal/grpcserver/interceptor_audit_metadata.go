package grpcserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func inferRequestIdentity(req any) (string, string, string) {
	appID := ""
	subjectUserID := ""
	modelID := ""

	switch value := req.(type) {
	case interface{ GetAppId() string }:
		appID = strings.TrimSpace(value.GetAppId())
	}
	switch value := req.(type) {
	case interface{ GetSubjectUserId() string }:
		subjectUserID = strings.TrimSpace(value.GetSubjectUserId())
	}
	switch value := req.(type) {
	case interface{ GetModelId() string }:
		modelID = strings.TrimSpace(value.GetModelId())
	}
	switch value := req.(type) {
	case interface {
		GetHead() *runtimev1.ScenarioRequestHead
	}:
		head := value.GetHead()
		if head != nil {
			if appID == "" {
				appID = strings.TrimSpace(head.GetAppId())
			}
			if subjectUserID == "" {
				subjectUserID = strings.TrimSpace(head.GetSubjectUserId())
			}
			if modelID == "" {
				modelID = strings.TrimSpace(head.GetModelId())
			}
		}
	}
	return appID, subjectUserID, modelID
}

func readCallerMetadata(ctx context.Context) (runtimev1.CallerKind, string, string, string) {
	callerKind := runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED
	callerID := ""
	surfaceID := ""
	traceID := ""

	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return callerKind, callerID, surfaceID, ulid.Make().String()
	}

	if value := firstMetadata(md, "x-nimi-caller-kind"); value != "" {
		callerKind = callerKindFromHeader(value)
	}
	callerID = firstMetadata(md, "x-nimi-caller-id")
	surfaceID = firstMetadata(md, "x-nimi-surface-id")
	traceID = firstMetadata(md, "x-nimi-trace-id")
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	return callerKind, callerID, surfaceID, traceID
}

func validateAppIDConflict(ctx context.Context, req any) error {
	metadataAppID := appIDFromMetadata(ctx)
	if metadataAppID == "" {
		return nil
	}
	requestAppID := appIDFromRequest(req)
	if requestAppID == "" {
		return nil
	}
	if metadataAppID != requestAppID {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT)
	}
	return nil
}

func appIDFromMetadata(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return firstMetadata(md, "x-nimi-app-id")
}

func accessTokenIDFromMetadata(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return firstMetadata(md, "x-nimi-access-token-id")
}

func providerCredentialMetadata(ctx context.Context) (string, string, string) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", "", ""
	}
	source := strings.ToLower(firstMetadata(md, "x-nimi-key-source"))
	endpoint := firstMetadata(md, "x-nimi-provider-endpoint")
	apiKey := firstMetadata(md, "x-nimi-provider-api-key")
	return source, endpoint, secretFingerprint(apiKey)
}

func secretFingerprint(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:8])
}

func appIDFromRequest(req any) string {
	item, ok := req.(interface{ GetAppId() string })
	if ok {
		return strings.TrimSpace(item.GetAppId())
	}
	headCarrier, ok := req.(interface {
		GetHead() *runtimev1.ScenarioRequestHead
	})
	if !ok {
		return ""
	}
	head := headCarrier.GetHead()
	if head == nil {
		return ""
	}
	return strings.TrimSpace(head.GetAppId())
}

func firstMetadata(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func callerKindFromHeader(raw string) runtimev1.CallerKind {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "desktop-core":
		return runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE
	case "desktop-mod":
		return runtimev1.CallerKind_CALLER_KIND_DESKTOP_MOD
	case "third-party-app":
		return runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP
	case "third-party-service":
		return runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_SERVICE
	default:
		return runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED
	}
}

func principalID(callerID string, tokenID string) string {
	if strings.TrimSpace(callerID) != "" {
		return strings.TrimSpace(callerID)
	}
	return strings.TrimSpace(tokenID)
}

func principalType(kind runtimev1.CallerKind, tokenID string) string {
	if kind != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED {
		return strings.ToLower(kind.String())
	}
	if strings.TrimSpace(tokenID) != "" {
		return "external_principal"
	}
	return "unknown"
}

func methodDescriptor(fullMethod string) (string, string, string) {
	method := "unknown"
	service := "unknown"

	parts := strings.Split(fullMethod, "/")
	if len(parts) >= 3 {
		service = parts[1]
		method = parts[2]
	}

	domain := "runtime.rpc"
	switch {
	case strings.Contains(service, "RuntimeAiService"):
		domain = "runtime.ai"
	case strings.Contains(service, "RuntimeWorkflowService"):
		domain = "runtime.workflow"
	case strings.Contains(service, "RuntimeModelService"):
		domain = "runtime.model"
	case strings.Contains(service, "RuntimeLocalRuntimeService"):
		domain = "runtime.local_runtime"
	case strings.Contains(service, "RuntimeGrantService"):
		domain = "runtime.grant"
	case strings.Contains(service, "RuntimeAuthService"):
		domain = "runtime.auth"
	case strings.Contains(service, "RuntimeKnowledgeService"):
		domain = "runtime.knowledge"
	case strings.Contains(service, "RuntimeAppService"):
		domain = "runtime.app"
	case strings.Contains(service, "RuntimeAuditService"):
		domain = "runtime.audit"
	}

	operation := camelToSnake(method)
	capability := domain + "." + operation
	return domain, operation, capability
}

func camelToSnake(input string) string {
	if input == "" {
		return input
	}
	runes := []rune(input)
	out := make([]rune, 0, len(runes)+4)
	for idx, r := range runes {
		if unicode.IsUpper(r) {
			if idx > 0 {
				out = append(out, '_')
			}
			out = append(out, unicode.ToLower(r))
			continue
		}
		out = append(out, unicode.ToLower(r))
	}
	return string(out)
}

func cloneUsage(input *runtimev1.UsageStats) *runtimev1.UsageStats {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copy, ok := cloned.(*runtimev1.UsageStats)
	if !ok {
		return nil
	}
	return copy
}

func cloneAnyProto(input any) any {
	msg, ok := input.(proto.Message)
	if !ok {
		return input
	}
	return proto.Clone(msg)
}
