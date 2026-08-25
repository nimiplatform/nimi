package grpcserver

import (
	"testing"
	"time"
)

func TestProtectedGRPCKeepalivePolicyAdmitsProtectedIdleClientPings(t *testing.T) {
	policy := protectedGRPCKeepalivePolicy()
	if policy.MinTime != 10*time.Second {
		t.Fatalf("protected keepalive minimum = %s, want 10s", policy.MinTime)
	}
	if !policy.PermitWithoutStream {
		t.Fatal("protected keepalive policy rejects idle client pings")
	}
}
