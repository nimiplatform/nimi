package envelope

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const (
	PlatformProtocolVersion = "1.0.0"
)

type Metadata struct {
	ProtocolVersion            string
	ParticipantProtocolVersion string
	ParticipantID              string
	Domain                     string
	AppID                      string
	TraceID                    string
	IdempotencyKey             string
	CallerKind                 string
	CallerID                   string
	SurfaceID                  string
	CredentialSource           string
	ProviderEndpoint           string
	ProviderAPIKey             string
}

func Validate(ctx context.Context, req any, requireIdempotency bool) (Metadata, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	meta := Metadata{
		ProtocolVersion:            first(md, "x-nimi-protocol-version"),
		ParticipantProtocolVersion: first(md, "x-nimi-participant-protocol-version"),
		ParticipantID:              first(md, "x-nimi-participant-id"),
		Domain:                     first(md, "x-nimi-domain"),
		AppID:                      first(md, "x-nimi-app-id"),
		TraceID:                    first(md, "x-nimi-trace-id"),
		IdempotencyKey:             first(md, "x-nimi-idempotency-key"),
		CallerKind:                 first(md, "x-nimi-caller-kind"),
		CallerID:                   first(md, "x-nimi-caller-id"),
		SurfaceID:                  first(md, "x-nimi-surface-id"),
		CredentialSource:           strings.ToLower(first(md, "x-nimi-key-source")),
		ProviderEndpoint:           first(md, "x-nimi-provider-endpoint"),
		ProviderAPIKey:             first(md, "x-nimi-provider-api-key"),
	}

	if meta.ProtocolVersion == "" || meta.ParticipantProtocolVersion == "" || meta.ParticipantID == "" || meta.Domain == "" {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if !strictVersionCompatible(meta.ProtocolVersion, meta.ParticipantProtocolVersion) {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if requireIdempotency && meta.IdempotencyKey == "" {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if requireIdempotency && (meta.CallerKind == "" || meta.CallerID == "") {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	if requestAppID := appIDFromRequest(req); requestAppID != "" && meta.AppID != "" && requestAppID != meta.AppID {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT)
	}
	if requestDomain := domainFromRequest(req); requestDomain != "" && meta.Domain != "" && requestDomain != meta.Domain {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT)
	}

	return meta, nil
}

func strictVersionCompatible(platformVersion string, participantVersion string) bool {
	pMajor, pMinor, ok := parseSemver(platformVersion)
	if !ok {
		return false
	}
	cMajor, cMinor, ok := parseSemver(participantVersion)
	if !ok {
		return false
	}
	return pMajor == cMajor && pMinor == cMinor
}

func parseSemver(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) != 3 {
		return 0, 0, false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	return major, minor, true
}

func first(md metadata.MD, key string) string {
	values := md.Get(strings.ToLower(strings.TrimSpace(key)))
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func protocolError(reason runtimev1.ReasonCode) error {
	return status.Error(codes.InvalidArgument, reason.String())
}

func appIDFromRequest(req any) string {
	if req == nil {
		return ""
	}
	item, ok := req.(interface{ GetAppId() string })
	if !ok {
		return ""
	}
	return strings.TrimSpace(item.GetAppId())
}

func domainFromRequest(req any) string {
	switch value := req.(type) {
	case *runtimev1.AuthorizeExternalPrincipalRequest:
		return strings.TrimSpace(value.GetDomain())
	default:
		return ""
	}
}

func NormalizeProtocolVersion(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return PlatformProtocolVersion
	}
	if _, _, ok := parseSemver(value); !ok {
		return PlatformProtocolVersion
	}
	return value
}

func HeaderPairs(meta Metadata) []string {
	pairs := []string{
		"x-nimi-protocol-version", NormalizeProtocolVersion(meta.ProtocolVersion),
		"x-nimi-participant-protocol-version", NormalizeProtocolVersion(meta.ParticipantProtocolVersion),
		"x-nimi-participant-id", strings.TrimSpace(meta.ParticipantID),
		"x-nimi-domain", strings.TrimSpace(meta.Domain),
		"x-nimi-caller-kind", strings.TrimSpace(meta.CallerKind),
		"x-nimi-caller-id", strings.TrimSpace(meta.CallerID),
		"x-nimi-surface-id", strings.TrimSpace(meta.SurfaceID),
		"x-nimi-idempotency-key", strings.TrimSpace(meta.IdempotencyKey),
	}
	if appID := strings.TrimSpace(meta.AppID); appID != "" {
		pairs = append(pairs, "x-nimi-app-id", appID)
	}
	if traceID := strings.TrimSpace(meta.TraceID); traceID != "" {
		pairs = append(pairs, "x-nimi-trace-id", traceID)
	}
	if source := strings.TrimSpace(meta.CredentialSource); source != "" {
		pairs = append(pairs, "x-nimi-key-source", source)
	}
	if endpoint := strings.TrimSpace(meta.ProviderEndpoint); endpoint != "" {
		pairs = append(pairs, "x-nimi-provider-endpoint", endpoint)
	}
	if apiKey := strings.TrimSpace(meta.ProviderAPIKey); apiKey != "" {
		pairs = append(pairs, "x-nimi-provider-api-key", apiKey)
	}
	return pairs
}

func ParseTraceIDFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return first(md, "x-nimi-trace-id")
}

func ParseParticipantIDFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return first(md, "x-nimi-participant-id")
}

func ParseDomainFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return first(md, "x-nimi-domain")
}

func ParseAccessTokenFromContext(ctx context.Context) (string, string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", "", fmt.Errorf("metadata missing")
	}
	tokenID := first(md, "x-nimi-access-token-id")
	secret := first(md, "x-nimi-access-token-secret")
	return tokenID, secret, nil
}

func ParseCredentialMetadataFromContext(ctx context.Context) (string, string, string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", "", "", fmt.Errorf("metadata missing")
	}
	source := strings.ToLower(first(md, "x-nimi-key-source"))
	endpoint := first(md, "x-nimi-provider-endpoint")
	apiKey := first(md, "x-nimi-provider-api-key")
	return source, endpoint, apiKey, nil
}
