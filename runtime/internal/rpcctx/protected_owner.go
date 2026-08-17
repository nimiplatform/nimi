package rpcctx

import "context"

// ProtectedConnectionOwnerToken is an opaque, ingress-issued identity for one
// verified protected transport connection. Product services use it only to
// bind short-lived owner-scoped operations to that exact connection.
type ProtectedConnectionOwnerToken [32]byte

type protectedConnectionOwnerTokenKey struct{}

func WithProtectedConnectionOwnerToken(ctx context.Context, token ProtectedConnectionOwnerToken) context.Context {
	if token == (ProtectedConnectionOwnerToken{}) {
		return ctx
	}
	return context.WithValue(ctx, protectedConnectionOwnerTokenKey{}, token)
}

func ProtectedConnectionOwnerTokenFromContext(ctx context.Context) (ProtectedConnectionOwnerToken, bool) {
	if ctx == nil {
		return ProtectedConnectionOwnerToken{}, false
	}
	token, ok := ctx.Value(protectedConnectionOwnerTokenKey{}).(ProtectedConnectionOwnerToken)
	return token, ok && token != (ProtectedConnectionOwnerToken{})
}
