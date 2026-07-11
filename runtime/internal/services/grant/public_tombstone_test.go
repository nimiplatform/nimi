package grant

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestA0PublicGrantFamilyRejectsBeforeRequestParsing(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer portable-token",
		"x-nimi-access-token-id", "portable-grant",
		"x-nimi-access-token-secret", "portable-secret",
		"x-nimi-source-host", "desktop-electron-account-host",
	))

	tests := []struct {
		name string
		call func() (bool, error)
	}{
		{name: "AuthorizeExternalPrincipal", call: func() (bool, error) {
			resp, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{})
			return resp != nil, err
		}},
		{name: "ValidateAppAccessToken", call: func() (bool, error) {
			resp, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{})
			return resp != nil, err
		}},
		{name: "RevokeAppAccessToken", call: func() (bool, error) {
			resp, err := svc.RevokeAppAccessToken(ctx, &runtimev1.RevokeAppAccessTokenRequest{})
			return resp != nil, err
		}},
		{name: "IssueDelegatedAccessToken", call: func() (bool, error) {
			resp, err := svc.IssueDelegatedAccessToken(ctx, &runtimev1.IssueDelegatedAccessTokenRequest{})
			return resp != nil, err
		}},
		{name: "ListTokenChain", call: func() (bool, error) {
			resp, err := svc.ListTokenChain(ctx, &runtimev1.ListTokenChainRequest{})
			return resp != nil, err
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hasResponse, err := test.call()
			if hasResponse {
				t.Fatal("deny-all Grant method returned a response")
			}
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("status code = %v, want %v: %v", status.Code(err), codes.PermissionDenied, err)
			}
			if got := status.Convert(err).Message(); got != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH.String() {
				t.Fatalf("reason = %q, want %q", got, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH.String())
			}
		})
	}

	svc.mu.RLock()
	defer svc.mu.RUnlock()
	if len(svc.tokens) != 0 || len(svc.parentChildren) != 0 || len(svc.policyTokens) != 0 {
		t.Fatalf("deny-all Grant family mutated credential state: tokens=%d children=%d policies=%d", len(svc.tokens), len(svc.parentChildren), len(svc.policyTokens))
	}
}
