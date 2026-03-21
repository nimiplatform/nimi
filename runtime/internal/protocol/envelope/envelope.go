package envelope

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const (
	PlatformProtocolVersion = "1.0.0"
)

var ErrEnvelopeMetadataMissing = fmt.Errorf("envelope metadata missing")

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
	ProviderType               string
	ProviderEndpoint           string
	ProviderAPIKey             string
}

func Validate(ctx context.Context, req any, requireIdempotency bool) (Metadata, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "missing protocol envelope metadata")
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
		ProviderType:               first(md, "x-nimi-provider-type"),
		ProviderEndpoint:           first(md, "x-nimi-provider-endpoint"),
		ProviderAPIKey:             first(md, "x-nimi-provider-api-key"),
	}

	if meta.ProtocolVersion == "" || meta.ParticipantProtocolVersion == "" || meta.ParticipantID == "" || meta.Domain == "" {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "missing required protocol envelope headers")
	}
	if !strictVersionCompatible(meta.ProtocolVersion, meta.ParticipantProtocolVersion) {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "protocol versions must share major and minor components")
	}
	if requireIdempotency && meta.IdempotencyKey == "" {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "idempotency key is required")
	}
	if requireIdempotency && (meta.CallerKind == "" || meta.CallerID == "") {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "caller kind and caller id are required with idempotency")
	}

	if requestAppID := appIDFromRequest(req); requestAppID != "" && meta.AppID != "" && requestAppID != meta.AppID {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT, "request app id conflicts with envelope app id")
	}
	if requestDomain := domainFromRequest(req); requestDomain != "" && meta.Domain != "" && requestDomain != meta.Domain {
		return Metadata{}, protocolError(runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT, "request domain conflicts with envelope domain")
	}

	return meta, nil
}

func strictVersionCompatible(platformVersion string, participantVersion string) bool {
	pMajor, pMinor, ok := parseMajorMinorSemver(platformVersion)
	if !ok {
		return false
	}
	cMajor, cMinor, ok := parseMajorMinorSemver(participantVersion)
	if !ok {
		return false
	}
	return pMajor == cMajor && pMinor == cMinor
}

func parseMajorMinorSemver(value string) (int, int, bool) {
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

func protocolError(reason runtimev1.ReasonCode, message string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, reason, grpcerr.ReasonOptions{Message: message})
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
	if _, _, ok := parseMajorMinorSemver(value); !ok {
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
	if providerType := strings.TrimSpace(meta.ProviderType); providerType != "" {
		pairs = append(pairs, "x-nimi-provider-type", providerType)
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
		return "", "", fmt.Errorf("parse access token from context: %w", ErrEnvelopeMetadataMissing)
	}
	tokenID := first(md, "x-nimi-access-token-id")
	secret := first(md, "x-nimi-access-token-secret")
	return tokenID, secret, nil
}

func ParseSessionFromContext(ctx context.Context) (string, string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", "", fmt.Errorf("parse session from context: %w", ErrEnvelopeMetadataMissing)
	}
	sessionID := first(md, "x-nimi-session-id")
	sessionToken := first(md, "x-nimi-session-token")
	return sessionID, sessionToken, nil
}

type CredentialMetadata struct {
	Source       string
	ProviderType string
	Endpoint     string
	APIKey       string
}

func ParseCredentialMetadataFromContext(ctx context.Context) (CredentialMetadata, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return CredentialMetadata{}, fmt.Errorf("parse credential metadata from context: %w", ErrEnvelopeMetadataMissing)
	}
	return CredentialMetadata{
		Source:       strings.ToLower(first(md, "x-nimi-key-source")),
		ProviderType: first(md, "x-nimi-provider-type"),
		Endpoint:     first(md, "x-nimi-provider-endpoint"),
		APIKey:       first(md, "x-nimi-provider-api-key"),
	}, nil
}
