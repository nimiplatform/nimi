package authn

import "context"

// Identity represents a verified JWT identity extracted from the request.
type Identity struct {
	SubjectUserID string // sub claim
	Issuer        string // iss claim
	Audience      string // aud claim (first audience)
	SessionID     string // sid claim, if present
}

type contextKey struct{}

// WithIdentity attaches a verified identity to the context.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// IdentityFromContext extracts the identity from the context.
// Returns nil if the request is anonymous (no JWT provided).
func IdentityFromContext(ctx context.Context) *Identity {
	id, _ := ctx.Value(contextKey{}).(*Identity)
	return id
}
