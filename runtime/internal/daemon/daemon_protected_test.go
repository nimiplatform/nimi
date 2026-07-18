package daemon

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestProtectedDaemonRunFailsClosedWithoutVerifiedNativeListener(t *testing.T) {
	serviceStateRoot := t.TempDir()
	authorities := newDaemonProtectedAuthorities(t)
	grpcAddr := availableTCPAddress(t)
	httpAddr := availableTCPAddress(t)
	protectedDaemon, err := NewProtected(
		config.Config{
			GRPCAddr:             grpcAddr,
			HTTPAddr:             httpAddr,
			ShutdownTimeout:      2 * time.Second,
			AuditRingBufferSize:  64,
			UsageStatsBufferSize: 64,
			IdempotencyCapacity:  32,
		},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		grpcserver.ProtectedServiceBindings{
			ServiceStateRoot:         serviceStateRoot,
			AccountCustody:           daemonProtectedAccountCustody{},
			AccountPartition:         "account=user-alpha;logon=42",
			LocalOSUserIdentity:      verifiedDaemonTestIdentity(t),
			ConnectorSecrets:         daemonProtectedConnectorSecrets{},
			DesktopSessions:          authorities.desktop,
			LocalAppLaunches:         authorities.localApps,
			LocalDevelopmentVerifier: daemonTestLocalDevelopmentVerifier{},
			RuntimeRestartRequester:  func() bool { return true },
		},
	)
	if err != nil {
		t.Fatalf("NewProtected: %v", err)
	}
	closeDaemonForTest(t, protectedDaemon)
	if err := protectedDaemon.Run(context.Background()); err == nil || !strings.Contains(err.Error(), string(protectedlocal.ReasonProtectedLocalTransportUnsupported)) {
		t.Fatalf("protected daemon Run error = %v, want verified native transport failure", err)
	}
	assertTCPAddressAvailable(t, grpcAddr)
	assertTCPAddressAvailable(t, httpAddr)
}

func TestProtectedDaemonRunProtectedUsesNativeCarrierWithoutPublicListeners(t *testing.T) {
	serviceStateRoot := t.TempDir()
	authorities := newDaemonProtectedAuthorities(t)
	grpcAddr := availableTCPAddress(t)
	httpAddr := availableTCPAddress(t)
	protectedDaemon, err := NewProtected(
		config.Config{
			GRPCAddr:             grpcAddr,
			HTTPAddr:             httpAddr,
			ShutdownTimeout:      2 * time.Second,
			AuditRingBufferSize:  64,
			UsageStatsBufferSize: 64,
			IdempotencyCapacity:  32,
		},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		grpcserver.ProtectedServiceBindings{
			ServiceStateRoot:         serviceStateRoot,
			AccountCustody:           daemonProtectedAccountCustody{},
			AccountPartition:         "account=user-alpha;logon=42",
			LocalOSUserIdentity:      verifiedDaemonTestIdentity(t),
			ConnectorSecrets:         daemonProtectedConnectorSecrets{},
			DesktopSessions:          authorities.desktop,
			LocalAppLaunches:         authorities.localApps,
			LocalDevelopmentVerifier: daemonTestLocalDevelopmentVerifier{},
			RuntimeRestartRequester:  func() bool { return true },
		},
	)
	if err != nil {
		t.Fatalf("NewProtected: %v", err)
	}
	closeDaemonForTest(t, protectedDaemon)

	listener := newDaemonBlockingNativeListener()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- protectedDaemon.RunProtected(ctx, listener) }()
	select {
	case <-listener.accepted:
	case <-time.After(5 * time.Second):
		t.Fatal("protected daemon did not start the native carrier")
	}
	assertTCPAddressAvailable(t, grpcAddr)
	assertTCPAddressAvailable(t, httpAddr)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunProtected error = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("protected daemon did not stop after native carrier context cancellation")
	}
}

func availableTCPAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve TCP address: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release TCP address %q: %v", addr, err)
	}
	return addr
}

func assertTCPAddressAvailable(t *testing.T, addr string) {
	t.Helper()
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("protected daemon unexpectedly opened public listener %q: %v", addr, err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close TCP listener %q: %v", addr, err)
	}
}

type daemonBlockingNativeListener struct {
	accepted chan struct{}
	closed   chan struct{}
	close    sync.Once
}

func newDaemonBlockingNativeListener() *daemonBlockingNativeListener {
	return &daemonBlockingNativeListener{
		accepted: make(chan struct{}, 1),
		closed:   make(chan struct{}),
	}
}

func (listener *daemonBlockingNativeListener) Accept() (net.Conn, error) {
	select {
	case listener.accepted <- struct{}{}:
	default:
	}
	<-listener.closed
	return nil, net.ErrClosed
}

func (listener *daemonBlockingNativeListener) Close() error {
	listener.close.Do(func() { close(listener.closed) })
	return nil
}

func (*daemonBlockingNativeListener) Addr() net.Addr {
	return daemonBlockingNativeAddress("protected-daemon-native-test")
}

type daemonBlockingNativeAddress string

func (address daemonBlockingNativeAddress) Network() string { return "protected-daemon-native-test" }
func (address daemonBlockingNativeAddress) String() string  { return string(address) }

func TestNewProtectedUsesProtectedServerWithoutPublishingStatePathToEnvironment(t *testing.T) {
	environmentStatePath := filepath.Join(t.TempDir(), "environment", "local-state.json")
	t.Setenv("NIMI_RUNTIME_LOCAL_STATE_PATH", environmentStatePath)
	userWritableStatePath := filepath.Join(t.TempDir(), "user", "local-state.json")
	serviceStateRoot := t.TempDir()
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       userWritableStatePath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	authorities := newDaemonProtectedAuthorities(t)
	protectedDaemon, err := NewProtected(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		grpcserver.ProtectedServiceBindings{
			ServiceStateRoot:         serviceStateRoot,
			AccountCustody:           daemonProtectedAccountCustody{},
			AccountPartition:         "account=user-alpha;logon=42",
			LocalOSUserIdentity:      verifiedDaemonTestIdentity(t),
			ConnectorSecrets:         daemonProtectedConnectorSecrets{},
			DesktopSessions:          authorities.desktop,
			LocalAppLaunches:         authorities.localApps,
			LocalDevelopmentVerifier: daemonTestLocalDevelopmentVerifier{},
			RuntimeRestartRequester:  func() bool { return true },
		},
	)
	if err != nil {
		t.Fatalf("NewProtected: %v", err)
	}
	closeDaemonForTest(t, protectedDaemon)
	if got := os.Getenv("NIMI_RUNTIME_LOCAL_STATE_PATH"); got != environmentStatePath {
		t.Fatalf("protected startup must not publish state path to environment: got=%q want=%q", got, environmentStatePath)
	}
	wantStatePath := filepath.Join(serviceStateRoot, "runtime", "local-state.json")
	if protectedDaemon.cfg.LocalStatePath != wantStatePath {
		t.Fatalf("protected daemon must retain service-owned state path: got=%q want=%q", protectedDaemon.cfg.LocalStatePath, wantStatePath)
	}
	if protectedDaemon.cfg.LocalStatePath == userWritableStatePath {
		t.Fatal("protected daemon retained user-writable state path")
	}
	status, err := protectedDaemon.grpc.AccountService().GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if err != nil {
		t.Fatalf("protected account status: %v", err)
	}
	if status.GetProductionInert() {
		t.Fatal("NewProtected must activate the production account service")
	}
}

func TestNewProtectedWithResourcesClosesOwnedState(t *testing.T) {
	t.Run("after shutdown exactly once", func(t *testing.T) {
		serviceStateRoot := t.TempDir()
		authorities := newDaemonProtectedAuthorities(t)
		closeCalls := 0
		protectedDaemon, err := NewProtectedWithResources(
			config.Config{
				GRPCAddr:             availableTCPAddress(t),
				HTTPAddr:             availableTCPAddress(t),
				ShutdownTimeout:      2 * time.Second,
				AuditRingBufferSize:  64,
				UsageStatsBufferSize: 64,
				IdempotencyCapacity:  32,
			},
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			"test",
			ProtectedRuntimeResources{
				Bindings: grpcserver.ProtectedServiceBindings{
					ServiceStateRoot:         serviceStateRoot,
					AccountCustody:           daemonProtectedAccountCustody{},
					AccountPartition:         "account=user-alpha;logon=42",
					LocalOSUserIdentity:      verifiedDaemonTestIdentity(t),
					ConnectorSecrets:         daemonProtectedConnectorSecrets{},
					DesktopSessions:          authorities.desktop,
					LocalAppLaunches:         authorities.localApps,
					LocalDevelopmentVerifier: daemonTestLocalDevelopmentVerifier{},
					RuntimeRestartRequester:  func() bool { return true },
				},
				Close: func() error {
					closeCalls++
					return nil
				},
			},
		)
		if err != nil {
			t.Fatalf("NewProtectedWithResources: %v", err)
		}
		if err := protectedDaemon.shutdown(); err != nil {
			t.Fatalf("shutdown protected daemon: %v", err)
		}
		if closeCalls != 1 {
			t.Fatalf("protected state close calls after shutdown = %d, want 1", closeCalls)
		}
		if err := protectedDaemon.closeProtectedState(); err != nil {
			t.Fatalf("repeat protected state close: %v", err)
		}
		if closeCalls != 1 {
			t.Fatalf("protected state close calls after repeated close = %d, want 1", closeCalls)
		}
	})

	t.Run("after construction failure", func(t *testing.T) {
		closeCalls := 0
		_, err := NewProtectedWithResources(
			config.Config{},
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			"test",
			ProtectedRuntimeResources{
				Close: func() error {
					closeCalls++
					return nil
				},
			},
		)
		if err == nil {
			t.Fatal("NewProtectedWithResources must reject missing protected bindings")
		}
		if closeCalls != 1 {
			t.Fatalf("protected state close calls after construction failure = %d, want 1", closeCalls)
		}
	})
}

func TestNewProtectedFromWindowsSecurityStateFailsClosedWithoutVerifiedState(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             availableTCPAddress(t),
		HTTPAddr:             availableTCPAddress(t),
		ShutdownTimeout:      2 * time.Second,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for name, state := range map[string]*protectedlocal.WindowsRuntimeSecurityState{
		"missing":    nil,
		"unverified": {},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewProtectedFromWindowsSecurityState(cfg, logger, "test", state, func() bool { return true }); err == nil {
				t.Fatal("production daemon must reject missing or unverified Windows security state")
			}
		})
	}
}

func TestResolveProtectedServiceDataRootAdmitsOnlyDescendants(t *testing.T) {
	root := t.TempDir()
	for _, localStatePath := range []string{
		filepath.Join(root, "runtime", "local-state.json"),
		filepath.Join(root, "acceptance-runs", "dev-kernel-checkpoint", "dev-kernel-runtime-0123456789abcdef0123456789abcdef", "dev-kernel-round-0123456789abcdef0123456789abcdef", "runtime", "local-state.json"),
	} {
		resolved, err := resolveProtectedServiceDataRoot(root, localStatePath)
		if err != nil || !strings.HasPrefix(resolved, root) {
			t.Fatalf("resolve protected data root %q = %q, %v", localStatePath, resolved, err)
		}
	}
	if _, err := resolveProtectedServiceDataRoot(root, filepath.Join(filepath.Dir(root), "escape", "runtime", "local-state.json")); err == nil {
		t.Fatal("protected data root escaped the verified service root")
	}
}

type daemonProtectedAuthorities struct {
	desktop   *protectedlocal.DesktopSessionManager
	localApps *protectedlocal.LocalAppLaunchRegistry
}

func verifiedDaemonTestIdentity(t *testing.T) localappkernel.VerifiedLocalOSUserIdentity {
	t.Helper()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatalf("validate daemon test OS-user identity: %v", err)
	}
	return identity
}

func newDaemonProtectedAuthorities(t *testing.T) daemonProtectedAuthorities {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(
		filepath.Join(directory, "protected_local.anchor"),
		bytes.Repeat([]byte{0xa1}, protectedlocal.IdentifierBytes),
	)
	if err != nil {
		t.Fatalf("create protected daemon test anchor: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0xa2}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open protected daemon test ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	bootEpoch, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start protected daemon test Runtime: %v", err)
	}
	desktop, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader)
	if err != nil {
		t.Fatalf("create protected daemon test Desktop session manager: %v", err)
	}
	localApps, err := protectedlocal.NewLocalAppLaunchRegistry(bootEpoch)
	if err != nil {
		t.Fatalf("create protected daemon local-app launch registry: %v", err)
	}
	return daemonProtectedAuthorities{desktop: desktop, localApps: localApps}
}

type daemonTestLocalDevelopmentVerifier struct{}

func (daemonTestLocalDevelopmentVerifier) VerifyLocalDevelopmentProcess(context.Context, uint32, protectedlocal.LocalDevelopmentProcessPolicy) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
	return protectedlocal.ProcessTuple{}, nil, context.Canceled
}

type daemonProtectedAccountCustody struct{}

func (daemonProtectedAccountCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	return accountservice.AccountMaterial{}, accountservice.ErrNoStoredAccount
}

func (daemonProtectedAccountCustody) Store(context.Context, string, accountservice.AccountMaterial) error {
	return nil
}

func (daemonProtectedAccountCustody) Clear(context.Context, string) error { return nil }

type daemonProtectedConnectorSecrets struct{}

func (daemonProtectedConnectorSecrets) WriteSecret(string, string) error { return nil }

func (daemonProtectedConnectorSecrets) ReadSecret(string) (string, bool, error) {
	return "", false, nil
}

func (daemonProtectedConnectorSecrets) DeleteSecret(string) error { return nil }
