package runtimeagent

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"sync"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

const sourceMaterializationTransportTestRuntimeID = "runtime-instance-materializer-1"

func openSourceMaterializationTransportTestService(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: localStatePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("runtimeagent.New: %v", err)
	}
	if err := svc.SetSourceMaterializationRuntimeIdentity(sourceMaterializationTransportTestRuntimeID); err != nil {
		svc.Close()
		_ = memorySvc.Close()
		t.Fatalf("SetSourceMaterializationRuntimeIdentity: %v", err)
	}
	var once sync.Once
	closeFn := func() {
		once.Do(func() {
			svc.Close()
			if err := memorySvc.Close(); err != nil {
				t.Fatalf("memory.Close: %v", err)
			}
		})
	}
	return svc, closeFn
}

func sourceMaterializationTransportTestContext(accountID string) context.Context {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: accountID})
}

var (
	sourceMaterializationTestKey, sourceMaterializationTestKeyErr = rsa.GenerateKey(cryptorand.Reader, 2048)
)

func sourceMaterializationTestPrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	if sourceMaterializationTestKeyErr != nil {
		t.Fatalf("generate Realm source materialization test key: %v", sourceMaterializationTestKeyErr)
	}
	return sourceMaterializationTestKey
}
