package envelope

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func validMD() metadata.MD {
	return metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "part-1",
		"x-nimi-domain", "test.domain",
		"x-nimi-trace-id", "trace-abc",
		"x-nimi-idempotency-key", "idem-123",
		"x-nimi-caller-kind", "sdk",
		"x-nimi-caller-id", "caller-1",
		"x-nimi-surface-id", "surface-1",
		"x-nimi-app-id", "app-1",
	)
}

func TestValidateSuccess(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), validMD())
	meta, err := Validate(ctx, nil, false)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if meta.ProtocolVersion != PlatformProtocolVersion {
		t.Fatalf("protocol version: got=%q want=%q", meta.ProtocolVersion, PlatformProtocolVersion)
	}
	if meta.ParticipantID != "part-1" {
		t.Fatalf("participant ID: got=%q", meta.ParticipantID)
	}
	if meta.Domain != "test.domain" {
		t.Fatalf("domain: got=%q", meta.Domain)
	}
}

func TestValidateMissingMetadata(t *testing.T) {
	_, err := Validate(context.Background(), nil, false)
	if err == nil {
		t.Fatal("should fail without metadata")
	}
}

func TestValidateMissingRequiredFields(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err := Validate(ctx, nil, false)
	if err == nil {
		t.Fatal("should fail without participant-id and domain")
	}
}

func TestValidateVersionMismatch(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "2.0.0",
		"x-nimi-participant-id", "part-1",
		"x-nimi-domain", "test",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err := Validate(ctx, nil, false)
	if err == nil {
		t.Fatal("should fail on major version mismatch")
	}
}

func TestValidateIdempotencyRequired(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "part-1",
		"x-nimi-domain", "test",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err := Validate(ctx, nil, true)
	if err == nil {
		t.Fatal("should fail when idempotency key is required but missing")
	}
}

func TestValidateIdempotencyRequiresCallerFields(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "part-1",
		"x-nimi-domain", "test",
		"x-nimi-idempotency-key", "idem-1",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err := Validate(ctx, nil, true)
	if err == nil {
		t.Fatal("should fail when caller-kind/caller-id missing with idempotency")
	}
}

func TestValidateRejectsRetiredCallerAIInputMetadata(t *testing.T) {
	for _, header := range []string{
		"x-nimi-key-source",
		"x-nimi-provider-type",
		"x-nimi-provider-endpoint",
		"x-nimi-provider-api-key",
	} {
		t.Run(header, func(t *testing.T) {
			md := validMD()
			md.Set(header, strings.Repeat("x", 16))
			_, err := Validate(metadata.NewIncomingContext(context.Background(), md), nil, false)
			st, ok := status.FromError(err)
			if !ok || st.Message() != "retired caller AI input metadata is not accepted" {
				t.Fatalf("retired metadata %q was not rejected: %v", header, err)
			}
		})
	}
}

func TestValidateRejectsRequestDomainConflictForGenericGetDomain(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "part-1",
		"x-nimi-domain", "runtime.audit",
	))
	_, err := Validate(ctx, &runtimev1.ListAuditEventsRequest{Domain: "runtime.other"}, false)
	if err == nil {
		t.Fatal("should fail on request/envelope domain conflict")
	}
	st, ok := status.FromError(err)
	if !ok || st.Message() != "request domain conflicts with envelope domain" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateAllowsRuntimeAppLifecycleTargetAppIDMismatch(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "desktop-shell",
		"x-nimi-domain", "runtime.rpc",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-caller-id", "desktop.avatar-handoff",
	))

	meta, err := Validate(ctx, &runtimev1.GetAppStorageRequest{AppId: "nimi.avatar"}, false)
	if err != nil {
		t.Fatalf("target app id must not conflict with desktop envelope app id: %v", err)
	}
	if meta.AppID != "nimi.desktop" {
		t.Fatalf("envelope app id = %q, want desktop caller", meta.AppID)
	}
}

func TestValidateRejectsCallerAppIDMismatch(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", PlatformProtocolVersion,
		"x-nimi-participant-id", "desktop-shell",
		"x-nimi-domain", "runtime.rpc",
		"x-nimi-app-id", "nimi.desktop",
	))

	_, err := Validate(ctx, &runtimev1.RemoveModelRequest{AppId: "nimi.avatar"}, false)
	if err == nil {
		t.Fatal("caller app id mismatch must fail")
	}
	st, ok := status.FromError(err)
	if !ok || st.Message() != "request app id conflicts with envelope app id" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestParseMajorMinorSemver(t *testing.T) {
	tests := []struct {
		input string
		major int
		minor int
		ok    bool
	}{
		{"1.0.0", 1, 0, true},
		{"2.3.1", 2, 3, true},
		{"1.0", 0, 0, false},
		{"", 0, 0, false},
		{"abc", 0, 0, false},
		{"1.x.0", 0, 0, false},
	}
	for _, tt := range tests {
		major, minor, ok := parseMajorMinorSemver(tt.input)
		if ok != tt.ok || major != tt.major || minor != tt.minor {
			t.Errorf("parseMajorMinorSemver(%q): got=(%d,%d,%v) want=(%d,%d,%v)", tt.input, major, minor, ok, tt.major, tt.minor, tt.ok)
		}
	}
}

func TestNormalizeProtocolVersion(t *testing.T) {
	if got := NormalizeProtocolVersion(""); got != PlatformProtocolVersion {
		t.Fatalf("empty should default: got=%q", got)
	}
	if got := NormalizeProtocolVersion("invalid"); got != PlatformProtocolVersion {
		t.Fatalf("invalid should default: got=%q", got)
	}
	if got := NormalizeProtocolVersion("2.1.0"); got != "2.1.0" {
		t.Fatalf("valid should pass through: got=%q", got)
	}
}

func TestHeaderPairs(t *testing.T) {
	meta := Metadata{
		ProtocolVersion:            PlatformProtocolVersion,
		ParticipantProtocolVersion: PlatformProtocolVersion,
		ParticipantID:              "part-1",
		Domain:                     "test",
		CallerKind:                 "sdk",
		CallerID:                   "caller-1",
		AppID:                      "app-1",
		TraceID:                    "trace-1",
	}
	pairs := HeaderPairs(meta)
	if len(pairs)%2 != 0 {
		t.Fatal("header pairs must have even length")
	}
	found := make(map[string]string)
	for i := 0; i < len(pairs); i += 2 {
		found[pairs[i]] = pairs[i+1]
	}
	if found["x-nimi-app-id"] != "app-1" {
		t.Fatalf("app-id header: got=%q", found["x-nimi-app-id"])
	}
	if found["x-nimi-trace-id"] != "trace-1" {
		t.Fatalf("trace-id header: got=%q", found["x-nimi-trace-id"])
	}
}

func TestParseTraceIDFromContext(t *testing.T) {
	md := metadata.Pairs("x-nimi-trace-id", "trace-xyz")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	if got := ParseTraceIDFromContext(ctx); got != "trace-xyz" {
		t.Fatalf("trace ID: got=%q want=%q", got, "trace-xyz")
	}
	if got := ParseTraceIDFromContext(context.Background()); got != "" {
		t.Fatalf("no metadata: got=%q want empty", got)
	}
}

func TestParseParticipantIDFromContext(t *testing.T) {
	md := metadata.Pairs("x-nimi-participant-id", "part-abc")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	if got := ParseParticipantIDFromContext(ctx); got != "part-abc" {
		t.Fatalf("participant ID: got=%q", got)
	}
}

func TestParseDomainFromContext(t *testing.T) {
	md := metadata.Pairs("x-nimi-domain", "my.domain")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	if got := ParseDomainFromContext(ctx); got != "my.domain" {
		t.Fatalf("domain: got=%q", got)
	}
}

func TestParseAccessTokenFromContext(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-access-token-id", "tok-id",
		"x-nimi-access-token-secret", "tok-secret",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	id, secret, err := ParseAccessTokenFromContext(ctx)
	if err != nil {
		t.Fatalf("ParseAccessTokenFromContext: %v", err)
	}
	if id != "tok-id" || secret != "tok-secret" {
		t.Fatalf("token: id=%q secret=%q", id, secret)
	}
}

func TestParseAccessTokenFromContextMissingMetadata(t *testing.T) {
	_, _, err := ParseAccessTokenFromContext(context.Background())
	if err == nil {
		t.Fatal("should fail without metadata")
	}
	if !errors.Is(err, ErrEnvelopeMetadataMissing) {
		t.Fatalf("expected wrapped metadata missing error, got=%v", err)
	}
}

func TestParseAccessTokenFromContextRejectsEmptyValues(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-id",
		"x-nimi-access-token-secret", " ",
	))
	_, _, err := ParseAccessTokenFromContext(ctx)
	if err == nil {
		t.Fatal("should fail when token secret is empty")
	}
	if !errors.Is(err, ErrEnvelopeMetadataMissing) {
		t.Fatalf("expected wrapped metadata missing error, got=%v", err)
	}
}

func TestParseSessionFromContext(t *testing.T) {
	md := metadata.Pairs(
		"x-nimi-session-id", "sess-id",
		"x-nimi-session-token", "sess-token",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	sessionID, sessionToken, err := ParseSessionFromContext(ctx)
	if err != nil {
		t.Fatalf("ParseSessionFromContext: %v", err)
	}
	if sessionID != "sess-id" || sessionToken != "sess-token" {
		t.Fatalf("session: id=%q token=%q", sessionID, sessionToken)
	}
}

func TestParseSessionFromContextMissingMetadata(t *testing.T) {
	_, _, err := ParseSessionFromContext(context.Background())
	if err == nil {
		t.Fatal("should fail without metadata")
	}
	if !errors.Is(err, ErrEnvelopeMetadataMissing) {
		t.Fatalf("expected wrapped metadata missing error, got=%v", err)
	}
}

func TestParseSessionFromContextRejectsEmptyValues(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-session-id", "sess-id",
		"x-nimi-session-token", "",
	))
	_, _, err := ParseSessionFromContext(ctx)
	if err == nil {
		t.Fatal("should fail when session token is empty")
	}
	if !errors.Is(err, ErrEnvelopeMetadataMissing) {
		t.Fatalf("expected wrapped metadata missing error, got=%v", err)
	}
}
