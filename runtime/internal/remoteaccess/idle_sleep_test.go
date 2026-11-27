package remoteaccess

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type memoryBinarySecretStore struct {
	mu   sync.Mutex
	data map[string][]byte
}

func newMemoryBinarySecretStore() *memoryBinarySecretStore {
	return &memoryBinarySecretStore{data: make(map[string][]byte)}
}

func (s *memoryBinarySecretStore) Load(_ context.Context, name string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.data[name]
	if !ok {
		return nil, protectedlocal.ErrProtectedSecretNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *memoryBinarySecretStore) Store(_ context.Context, name string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[name] = append([]byte(nil), data...)
	return nil
}

func (s *memoryBinarySecretStore) Delete(_ context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, name)
	return nil
}

type memoryAccountCustody struct {
	mu       sync.Mutex
	material accountservice.AccountMaterial
	has      bool
}

func (c *memoryAccountCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.has {
		return accountservice.AccountMaterial{}, accountservice.ErrNoStoredAccount
	}
	return c.material, nil
}

func (c *memoryAccountCustody) Store(_ context.Context, _ string, material accountservice.AccountMaterial) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.material = material
	c.has = true
	return nil
}

func (c *memoryAccountCustody) Clear(context.Context, string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.material = accountservice.AccountMaterial{}
	c.has = false
	return nil
}

type staticLoginExchanger struct {
	material accountservice.AccountMaterial
}

func (e staticLoginExchanger) Exchange(context.Context, accountservice.LoginAttempt, string) (accountservice.AccountMaterial, error) {
	return e.material, nil
}

func (e staticLoginExchanger) AuthorizationURL(attempt accountservice.LoginAttempt) string {
	return "https://realm.test/api/auth/oauth/authorize?state=" + attempt.State
}

type remoteAccessTestHarness struct {
	accountSvc    *accountservice.Service
	kernel        *localappkernel.Kernel
	remoteSvc     *Service
	bindingMu     sync.Mutex
	binding       *realmv1.PrimaryRuntimeBindingDto
	prepared      realmv1.PrimaryRuntimePrepareDto
	onRegister    func()
	realmCalls    atomic.Int32
	heartbeats    atomic.Int32
	registrations atomic.Int32
	stepCount     atomic.Int32
	stepActiveCh  chan bool
	server        *httptest.Server
	secrets       *memoryBinarySecretStore
	desktopCaller *runtimev1.AccountCaller
}

func newRemoteAccessTestHarness(t *testing.T, opts ...accountservice.Option) *remoteAccessTestHarness {
	t.Helper()
	h := &remoteAccessTestHarness{
		stepActiveCh: make(chan bool, 256),
		secrets:      newMemoryBinarySecretStore(),
		desktopCaller: &runtimev1.AccountCaller{
			AppId:         "nimi.desktop",
			AppInstanceId: "desktop-1",
			DeviceId:      "device-1",
			Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
		},
	}

	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.realmCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case realmv1.GetMyPrimaryRuntimePath:
			h.bindingMu.Lock()
			binding := h.binding
			h.bindingMu.Unlock()
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{
				AccountId:  "acct-1",
				Binding:    binding,
				ServerTime: time.Now().UTC().Format(time.RFC3339Nano),
			})
		case realmv1.PrepareMyPrimaryRuntimePath:
			var req realmv1.PrimaryRuntimePrepareDto
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			h.bindingMu.Lock()
			h.prepared = req
			h.bindingMu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeIntentDto{
				IntentId:          "6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7",
				ExpectedAccountId: "acct-1",
				RuntimeId:         req.RuntimeId,
				DisplayName:       req.DisplayName,
				Operation:         req.Operation,
				ExpiresAt:         time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
				ConfirmationUrl:   "https://nimi.ai/account/runtime?intent=6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7",
			})
		case realmv1.RegisterPrimaryRuntimeControlPath:
			h.registrations.Add(1)
			h.bindingMu.Lock()
			onRegister := h.onRegister
			h.bindingMu.Unlock()
			if onRegister != nil {
				onRegister()
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlRegisterResultDto{
				ControlSessionId: "2893d76e-607e-446c-bb9d-52a634ea3514",
			})
		case realmv1.HeartbeatPrimaryRuntimeControlPath:
			h.heartbeats.Add(1)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlHeartbeatResultDto{Status: "idle"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(h.server.Close)

	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	db, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), db, identity, localappkernel.Options{HostInstallID: "remote-idle-unit", DataRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	h.kernel = kernel

	custody := &memoryAccountCustody{}
	loginMaterial := accountservice.AccountMaterial{
		AccountID:          "acct-1",
		DisplayName:        "Nimi User",
		RealmEnvironmentID: "realm-local",
		RealmOrigin:        h.server.URL,
		AccessToken:        "access-1",
		AccessTokenExpires: time.Now().UTC().Add(10 * time.Minute),
		RefreshToken:       "refresh-1",
	}
	registry := appregistry.New()
	if err := registry.UpsertInstance(h.desktopCaller.AppId, h.desktopCaller.AppInstanceId, h.desktopCaller.DeviceId, []string{"account.session.read"}); err != nil {
		t.Fatal(err)
	}
	auditStore := auditlog.New(128, 128)
	baseOpts := []accountservice.Option{
		accountservice.WithNonProductionHarnessMode(),
		accountservice.WithCustody(custody),
		accountservice.WithCustodyPartition("remote-idle-test"),
		accountservice.WithLoginExchanger(staticLoginExchanger{material: loginMaterial}),
		accountservice.WithRealmBaseURL(h.server.URL),
		accountservice.WithRealmHTTPClient(h.server.Client()),
		accountservice.WithAppRegistry(registry),
		accountservice.WithAuditStore(auditStore),
		accountservice.WithPrimaryHostSecrets(h.secrets, "install-remote\x00os-user"),
	}
	baseOpts = append(baseOpts, opts...)
	h.accountSvc = accountservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)), baseOpts...)

	var instance protectedlocal.Identifier
	instance[0] = 7
	dispatch := func(context.Context, *Peer, Call, func([]byte) error) ([]byte, bool, error) {
		return nil, false, errors.New("unused")
	}
	h.remoteSvc = New(h.accountSvc, kernel, instance, dispatch, slog.New(slog.NewTextHandler(io.Discard, nil)), auditStore)
	h.remoteSvc.stepDelay = func() time.Duration { return 20 * time.Millisecond }
	h.remoteSvc.onStep = func(active bool) {
		h.stepCount.Add(1)
		select {
		case h.stepActiveCh <- active:
		default:
		}
	}
	t.Cleanup(h.remoteSvc.Close)
	return h
}

func (h *remoteAccessTestHarness) loginErr() error {
	begin, err := h.accountSvc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: h.desktopCaller})
	if err != nil || !begin.GetAccepted() {
		return errors.New("BeginLogin rejected")
	}
	complete, err := h.accountSvc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         h.desktopCaller,
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil || !complete.GetAccepted() {
		return errors.New("CompleteLogin rejected")
	}
	return nil
}

func (h *remoteAccessTestHarness) login(t *testing.T) {
	t.Helper()
	if err := h.loginErr(); err != nil {
		t.Fatal(err)
	}
}

func (h *remoteAccessTestHarness) desktopPrincipalCtx(t *testing.T) context.Context {
	t.Helper()
	proj, gen, invalidated, ok := h.accountSvc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("account not authenticated for desktop principal")
	}
	p := protectedprincipal.NewDirect("nimi.desktop", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductProfileID, proj, gen, invalidated, make(chan struct{}))
	return protectedprincipal.With(context.Background(), p)
}

func (h *remoteAccessTestHarness) prepareAndPromotePrimaryBinding(t *testing.T, bindingID string) {
	t.Helper()
	ctx := h.desktopPrincipalCtx(t)
	if _, err := h.accountSvc.PreparePrimaryRuntime(ctx, &runtimev1.PreparePrimaryRuntimeRequest{
		Action:      "bind",
		DisplayName: "Test PC",
	}); err != nil {
		t.Fatalf("PreparePrimaryRuntime: %v", err)
	}
	h.bindingMu.Lock()
	h.binding = &realmv1.PrimaryRuntimeBindingDto{
		BindingId:   bindingID,
		RuntimeId:   h.prepared.RuntimeId,
		PublicKey:   h.prepared.PublicKey,
		DisplayName: h.prepared.DisplayName,
		ValidAfter:  time.Now().UTC().Format(time.RFC3339Nano),
	}
	h.bindingMu.Unlock()
	state, err := h.accountSvc.GetPrimaryRuntimeState(ctx, &runtimev1.GetPrimaryRuntimeStateRequest{})
	if err != nil || !state.GetThisRuntime() {
		t.Fatalf("GetPrimaryRuntimeState promote = (%+v, %v)", state, err)
	}
}

func waitForCondition(t *testing.T, timeout time.Duration, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", desc)
}

func TestRemoteAccessZeroTicksWhileDisabledAndPromptWakeupOnEnable(t *testing.T) {
	h := newRemoteAccessTestHarness(t)
	h.login(t)
	const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"
	h.prepareAndPromotePrimaryBinding(t, bindingID)

	// Start with remote access disabled.
	h.remoteSvc.Start()
	select {
	case active := <-h.stepActiveCh:
		if active {
			t.Fatal("initial disabled step requested periodic ticking")
		}
	case <-time.After(time.Second):
		t.Fatal("initial startup step did not execute")
	}

	stepsAtIdle := h.stepCount.Load()
	realmCallsAtIdle := h.realmCalls.Load()
	// Wait 10x the active tick cadence: disabled loop must perform zero ticks and zero Realm calls.
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsAtIdle {
		t.Fatalf("disabled remote access polled %d extra times while idle", got-stepsAtIdle)
	}
	if got := h.realmCalls.Load(); got != realmCallsAtIdle {
		t.Fatalf("disabled remote access made %d Realm calls while idle", got-realmCallsAtIdle)
	}

	// Re-enable remote access: must wake promptly and reach LISTENING with active cadence.
	ctx := h.desktopPrincipalCtx(t)
	enableStart := time.Now()
	resp, err := h.remoteSvc.SetRemoteAccessEnabled(ctx, &runtimev1.SetRemoteAccessEnabledRequest{
		ExpectedBindingId: bindingID,
		Enabled:           true,
	})
	if err != nil || !resp.GetState().GetEnabled() {
		t.Fatalf("SetRemoteAccessEnabled(true) = (%+v, %v)", resp, err)
	}
	waitForCondition(t, 500*time.Millisecond, "remote access to register and send heartbeats", func() bool {
		return h.registrations.Load() >= 1 && h.heartbeats.Load() >= 2
	})
	if elapsed := time.Since(enableStart); elapsed > 400*time.Millisecond {
		t.Fatalf("enable wakeup was too slow: %v", elapsed)
	}
	stateResp, err := h.remoteSvc.GetRemoteAccessState(ctx, &runtimev1.GetRemoteAccessStateRequest{})
	if err != nil || stateResp.GetConnectionState() != runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING {
		t.Fatalf("enabled remote access state = (%+v, %v), want LISTENING", stateResp, err)
	}

	// Disable remote access again: must return to zero-tick idle sleep immediately.
	resp, err = h.remoteSvc.SetRemoteAccessEnabled(ctx, &runtimev1.SetRemoteAccessEnabledRequest{
		ExpectedBindingId: bindingID,
		Enabled:           false,
	})
	if err != nil || resp.GetState().GetEnabled() {
		t.Fatalf("SetRemoteAccessEnabled(false) = (%+v, %v)", resp, err)
	}
	waitForCondition(t, 500*time.Millisecond, "disabled step to park idle", func() bool {
		h.remoteSvc.mu.Lock()
		run := h.remoteSvc.run
		h.remoteSvc.mu.Unlock()
		return run == nil
	})
	// Drain any transition step, then assert zero ticks over 200ms (10x active interval).
	time.Sleep(30 * time.Millisecond)
	stepsAfterDisable := h.stepCount.Load()
	heartbeatsAfterDisable := h.heartbeats.Load()
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsAfterDisable {
		t.Fatalf("re-disabled remote access polled %d extra times", got-stepsAfterDisable)
	}
	if got := h.heartbeats.Load(); got != heartbeatsAfterDisable {
		t.Fatalf("re-disabled remote access sent %d extra heartbeats", got-heartbeatsAfterDisable)
	}
}

func TestRemoteAccessSleepsWhileAnonymousAndWakesPromptlyOnAccountLoginAndLogout(t *testing.T) {
	h := newRemoteAccessTestHarness(t)
	const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"

	// Pre-configure enabled remote access in kernel for acct-1, then log out so service starts anonymous.
	h.login(t)
	h.prepareAndPromotePrimaryBinding(t, bindingID)
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-local", AccountID: "acct-1", BindingID: bindingID}
	if err := h.kernel.RemoteAccess().SetEnabled(context.Background(), scope, true); err != nil {
		t.Fatal(err)
	}
	if resp, err := h.accountSvc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: h.desktopCaller}); err != nil || !resp.GetAccepted() {
		t.Fatalf("initial Logout = (%+v, %v)", resp, err)
	}

	h.remoteSvc.Start()
	select {
	case active := <-h.stepActiveCh:
		if active {
			t.Fatal("anonymous startup step requested periodic ticking")
		}
	case <-time.After(time.Second):
		t.Fatal("anonymous startup step did not execute")
	}

	stepsAnonymous := h.stepCount.Load()
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsAnonymous {
		t.Fatalf("anonymous remote access polled %d extra times", got-stepsAnonymous)
	}

	// Account login must wake the sleeping remote access loop promptly without waiting for a long timer.
	h.login(t)
	waitForCondition(t, 500*time.Millisecond, "remote access wakeup on account login", func() bool {
		return h.registrations.Load() >= 1 && h.heartbeats.Load() >= 1
	})

	// Account logout must wake remote access immediately, stop active run, and return to zero-tick sleep.
	if resp, err := h.accountSvc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: h.desktopCaller}); err != nil || !resp.GetAccepted() {
		t.Fatalf("Logout = (%+v, %v)", resp, err)
	}
	waitForCondition(t, 500*time.Millisecond, "remote access stopRun on logout", func() bool {
		h.remoteSvc.mu.Lock()
		run := h.remoteSvc.run
		h.remoteSvc.mu.Unlock()
		return run == nil
	})
	time.Sleep(30 * time.Millisecond)
	stepsAfterLogout := h.stepCount.Load()
	heartbeatsAfterLogout := h.heartbeats.Load()
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsAfterLogout {
		t.Fatalf("post-logout remote access polled %d extra times", got-stepsAfterLogout)
	}
	if got := h.heartbeats.Load(); got != heartbeatsAfterLogout {
		t.Fatalf("post-logout remote access sent %d extra heartbeats", got-heartbeatsAfterLogout)
	}
}

func TestRemoteAccessBlockedHostIdentitySleepsUntilPromoted(t *testing.T) {
	h := newRemoteAccessTestHarness(t)
	h.login(t)
	const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-local", AccountID: "acct-1", BindingID: bindingID}
	if err := h.kernel.RemoteAccess().SetEnabled(context.Background(), scope, true); err != nil {
		t.Fatal(err)
	}

	// Binding is not yet present on Realm -> BindPrimaryRuntimeControl returns FailedPrecondition -> blocked sleep.
	h.remoteSvc.Start()
	select {
	case active := <-h.stepActiveCh:
		if active {
			t.Fatal("blocked remote access step requested periodic ticking")
		}
	case <-time.After(time.Second):
		t.Fatal("initial blocked step did not execute")
	}

	stepsBlocked := h.stepCount.Load()
	realmCallsBlocked := h.realmCalls.Load()
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsBlocked {
		t.Fatalf("blocked remote access polled %d extra times", got-stepsBlocked)
	}
	if got := h.realmCalls.Load(); got != realmCallsBlocked {
		t.Fatalf("blocked remote access probed Realm %d extra times", got-realmCallsBlocked)
	}

	// Promoting the primary host key must wake the sleeping loop promptly and establish LISTENING.
	h.prepareAndPromotePrimaryBinding(t, bindingID)
	waitForCondition(t, 500*time.Millisecond, "remote access wakeup after host key promotion", func() bool {
		return h.registrations.Load() >= 1 && h.heartbeats.Load() >= 1
	})
}

func TestRemoteAccessRebindsAfterSameAccountLogoutAndReloginWhileEnabled(t *testing.T) {
	t.Run("coalesced same-account logout and relogin before step rebinds immediately", func(t *testing.T) {
		h := newRemoteAccessTestHarness(t)
		const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"
		h.login(t)
		h.prepareAndPromotePrimaryBinding(t, bindingID)
		scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-local", AccountID: "acct-1", BindingID: bindingID}
		if err := h.kernel.RemoteAccess().SetEnabled(context.Background(), scope, true); err != nil {
			t.Fatal(err)
		}

		// Use a long active interval so rebind must happen promptly on accountWake
		// rather than waiting on a short test ticker.
		h.remoteSvc.stepDelay = func() time.Duration { return 5 * time.Second }

		step1Reached := make(chan struct{})
		releaseStep1 := make(chan struct{})
		var gateOnce sync.Once
		origOnStep := h.remoteSvc.onStep
		h.remoteSvc.onStep = func(active bool) {
			origOnStep(active)
			if active && h.heartbeats.Load() >= 1 {
				gateOnce.Do(func() {
					close(step1Reached)
					<-releaseStep1
				})
			}
		}

		h.remoteSvc.Start()
		select {
		case <-step1Reached:
		case <-time.After(time.Second):
			t.Fatal("initial enabled step did not complete")
		}

		h.remoteSvc.mu.Lock()
		if h.remoteSvc.run == nil || h.remoteSvc.run.control == nil {
			h.remoteSvc.mu.Unlock()
			t.Fatal("expected bound control after initial step")
		}
		gen1 := h.remoteSvc.run.control.State().AccountGeneration
		h.remoteSvc.mu.Unlock()
		regsBefore := h.registrations.Load()
		hbsBefore := h.heartbeats.Load()

		// While the loop goroutine is paused before select, log out and log back
		// in as the exact same account so both transitions coalesce into one
		// buffered accountWake signal with identical scope and primaryHostEpoch.
		if resp, err := h.accountSvc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: h.desktopCaller}); err != nil || !resp.GetAccepted() {
			t.Fatalf("Logout = (%+v, %v)", resp, err)
		}
		h.login(t)
		close(releaseStep1)

		waitForCondition(t, 500*time.Millisecond, "remote access rebind on same-account logout+relogin", func() bool {
			h.remoteSvc.mu.Lock()
			run := h.remoteSvc.run
			var currentGen uint64
			if run != nil && run.control != nil {
				currentGen = run.control.State().AccountGeneration
			}
			h.remoteSvc.mu.Unlock()
			return h.registrations.Load() > regsBefore && h.heartbeats.Load() > hbsBefore && currentGen > gen1
		})

		stateResp, err := h.remoteSvc.GetRemoteAccessState(h.desktopPrincipalCtx(t), &runtimev1.GetRemoteAccessStateRequest{})
		if err != nil || stateResp.GetConnectionState() != runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING {
			t.Fatalf("post-relogin state = (%+v, %v), want LISTENING", stateResp, err)
		}
	})

	t.Run("mid-step invalidation during register recovers instead of sleeping when relogged in", func(t *testing.T) {
		h := newRemoteAccessTestHarness(t)
		const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"
		h.login(t)
		h.prepareAndPromotePrimaryBinding(t, bindingID)
		scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-local", AccountID: "acct-1", BindingID: bindingID}
		if err := h.kernel.RemoteAccess().SetEnabled(context.Background(), scope, true); err != nil {
			t.Fatal(err)
		}

		// Trigger logout + same-account relogin inside the first RegisterPrimaryRuntimeControl
		// call so bound.Invalidated is closed right when step() reaches the post-register
		// invalidation check.
		var once sync.Once
		h.bindingMu.Lock()
		h.onRegister = func() {
			once.Do(func() {
				if resp, err := h.accountSvc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: h.desktopCaller}); err != nil || !resp.GetAccepted() {
					t.Errorf("mid-register Logout = (%+v, %v)", resp, err)
					return
				}
				if err := h.loginErr(); err != nil {
					t.Errorf("mid-register relogin: %v", err)
				}
			})
		}
		h.bindingMu.Unlock()

		h.remoteSvc.Start()
		waitForCondition(t, time.Second, "remote access recovery after mid-step invalidation", func() bool {
			h.remoteSvc.mu.Lock()
			run := h.remoteSvc.run
			bound := run != nil && run.control != nil && run.state == runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING
			h.remoteSvc.mu.Unlock()
			return bound && h.registrations.Load() >= 2 && h.heartbeats.Load() >= 1
		})
	})
}

type controllableRemoteClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *controllableRemoteClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *controllableRemoteClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

type funcRemoteRefresher struct {
	fn func(context.Context, accountservice.AccountMaterial) (accountservice.AccountMaterial, error)
}

func (r funcRemoteRefresher) Refresh(ctx context.Context, current accountservice.AccountMaterial) (accountservice.AccountMaterial, error) {
	return r.fn(ctx, current)
}

func TestRemoteAccessLeavesListeningAndSleepsOnAccessTokenExpiryThenResumesOnRefresh(t *testing.T) {
	clock := &controllableRemoteClock{now: time.Now().UTC()}
	var (
		mu                sync.Mutex
		expired           bool
		lastBearer        string
		expiredBearerSeen atomic.Bool
		refreshCalls      atomic.Int32
	)
	var h *remoteAccessTestHarness
	refresher := funcRemoteRefresher{
		fn: func(_ context.Context, current accountservice.AccountMaterial) (accountservice.AccountMaterial, error) {
			refreshCalls.Add(1)
			next := current
			next.AccessToken = "access-2"
			next.RefreshToken = "refresh-2"
			next.AccessTokenExpires = clock.Now().Add(10 * time.Minute)
			return next, nil
		},
	}

	h = newRemoteAccessTestHarness(t,
		accountservice.WithClock(clock.Now),
		accountservice.WithRefresher(refresher),
	)
	// Wrap the harness server client transport to inspect Authorization headers on every Realm request.
	baseTransport := h.server.Client().Transport
	inspectClient := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			auth := req.Header.Get("Authorization")
			mu.Lock()
			isExpired := expired
			if auth != "" {
				lastBearer = auth
			}
			mu.Unlock()
			if isExpired && auth == "Bearer access-1" {
				expiredBearerSeen.Store(true)
			}
			return baseTransport.RoundTrip(req)
		}),
	}
	loginMaterial := accountservice.AccountMaterial{
		AccountID:          "acct-1",
		DisplayName:        "Nimi User",
		RealmEnvironmentID: "realm-local",
		RealmOrigin:        h.server.URL,
		AccessToken:        "access-1",
		AccessTokenExpires: clock.Now().Add(5 * time.Minute),
		RefreshToken:       "refresh-1",
	}
	// Re-create accountSvc & remoteSvc bound to the inspecting HTTP client and clock-relative login material.
	registry := appregistry.New()
	if err := registry.UpsertInstance(h.desktopCaller.AppId, h.desktopCaller.AppInstanceId, h.desktopCaller.DeviceId, []string{"account.session.read"}); err != nil {
		t.Fatal(err)
	}
	auditStore := auditlog.New(128, 128)
	h.accountSvc = accountservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)),
		accountservice.WithNonProductionHarnessMode(),
		accountservice.WithCustody(&memoryAccountCustody{}),
		accountservice.WithCustodyPartition("remote-expiry-test"),
		accountservice.WithLoginExchanger(staticLoginExchanger{material: loginMaterial}),
		accountservice.WithRefresher(refresher),
		accountservice.WithRealmBaseURL(h.server.URL),
		accountservice.WithRealmHTTPClient(inspectClient),
		accountservice.WithAppRegistry(registry),
		accountservice.WithAuditStore(auditStore),
		accountservice.WithPrimaryHostSecrets(h.secrets, "install-remote\x00os-user"),
		accountservice.WithClock(clock.Now),
	)
	var instance protectedlocal.Identifier
	instance[0] = 9
	h.remoteSvc = New(h.accountSvc, h.kernel, instance, func(context.Context, *Peer, Call, func([]byte) error) ([]byte, bool, error) {
		return nil, false, errors.New("unused")
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), auditStore)
	h.remoteSvc.stepDelay = func() time.Duration { return 20 * time.Millisecond }
	h.remoteSvc.onStep = func(active bool) {
		h.stepCount.Add(1)
		select {
		case h.stepActiveCh <- active:
		default:
		}
	}
	t.Cleanup(h.remoteSvc.Close)

	const bindingID = "14e92c91-d872-4a0e-9d72-4ea05bbea917"
	h.login(t)
	h.prepareAndPromotePrimaryBinding(t, bindingID)
	ctx := h.desktopPrincipalCtx(t)
	if resp, err := h.remoteSvc.SetRemoteAccessEnabled(ctx, &runtimev1.SetRemoteAccessEnabledRequest{
		ExpectedBindingId: bindingID,
		Enabled:           true,
	}); err != nil || !resp.GetState().GetEnabled() {
		t.Fatalf("SetRemoteAccessEnabled(true) = (%+v, %v)", resp, err)
	}

	h.remoteSvc.Start()
	waitForCondition(t, 500*time.Millisecond, "remote access to reach LISTENING", func() bool {
		return h.registrations.Load() >= 1 && h.heartbeats.Load() >= 2
	})
	stateResp, err := h.remoteSvc.GetRemoteAccessState(ctx, &runtimev1.GetRemoteAccessStateRequest{})
	if err != nil || stateResp.GetConnectionState() != runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING {
		t.Fatalf("initial remote access state = (%+v, %v), want LISTENING", stateResp, err)
	}

	proj1, gen1, fence1, live1 := h.accountSvc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !live1 || proj1.GetAccountId() != "acct-1" {
		t.Fatalf("baseline local identity = (%+v, %d, %v)", proj1, gen1, live1)
	}
	h.remoteSvc.mu.Lock()
	boundControl := h.remoteSvc.run.control
	h.remoteSvc.mu.Unlock()
	if boundControl == nil || !h.accountSvc.PrimaryControlOnlineCredentialsLive(boundControl) {
		t.Fatal("baseline bound control must report live online credentials")
	}

	// Advance controlled clock past access-token expiry while local login stays live.
	mu.Lock()
	expired = true
	mu.Unlock()
	clock.Advance(10 * time.Minute)

	// Local login remains live, while online eligibility & GetRemoteAccessState immediately leave LISTENING.
	projExpired, genExpired, fenceExpired, liveExpired := h.accountSvc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !liveExpired || projExpired.GetAccountId() != "acct-1" || genExpired != gen1 || fenceExpired != fence1 {
		t.Fatalf("access-token expiry disrupted local login: proj=%+v gen=%d(want %d) live=%v", projExpired, genExpired, gen1, liveExpired)
	}
	select {
	case <-fence1:
		t.Fatal("access-token expiry closed local identity fence")
	default:
	}
	if h.accountSvc.PrimaryControlOnlineCredentialsLive(boundControl) {
		t.Fatal("PrimaryControlOnlineCredentialsLive must be false after access-token expiry")
	}
	if _, _, selected := h.accountSvc.RemoteAccessSettingsOwner(); selected {
		t.Fatal("RemoteAccessSettingsOwner must be false after access-token expiry")
	}
	expiredState, err := h.remoteSvc.GetRemoteAccessState(ctx, &runtimev1.GetRemoteAccessStateRequest{})
	if err != nil || expiredState.GetConnectionState() == runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING {
		t.Fatalf("GetRemoteAccessState after token expiry = (%+v, %v), must not report LISTENING", expiredState, err)
	}

	// Wait for the control loop to stop the active run and enter clean zero-tick sleep (no tight-loop heartbeats).
	waitForCondition(t, 500*time.Millisecond, "remote access to stop run after token expiry", func() bool {
		h.remoteSvc.mu.Lock()
		run := h.remoteSvc.run
		h.remoteSvc.mu.Unlock()
		return run == nil
	})
	time.Sleep(30 * time.Millisecond)
	stepsAtSleep := h.stepCount.Load()
	heartbeatsAtSleep := h.heartbeats.Load()
	realmCallsAtSleep := h.realmCalls.Load()
	time.Sleep(200 * time.Millisecond)
	if got := h.stepCount.Load(); got != stepsAtSleep {
		t.Fatalf("expired remote access tight-looped %d extra steps", got-stepsAtSleep)
	}
	if got := h.heartbeats.Load(); got != heartbeatsAtSleep {
		t.Fatalf("expired remote access sent %d extra heartbeats", got-heartbeatsAtSleep)
	}
	if got := h.realmCalls.Load(); got != realmCallsAtSleep {
		t.Fatalf("expired remote access made %d extra Realm calls while sleeping", got-realmCallsAtSleep)
	}
	if got := refreshCalls.Load(); got != 0 {
		t.Fatalf("sleeping remote access triggered %d unexpected refresh calls", got)
	}

	// Peer admission and bound control operations must fail closed without sending an expired bearer.
	if _, err := h.accountSvc.HeartbeatPrimaryRuntimeControl(context.Background(), boundControl, ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired HeartbeatPrimaryRuntimeControl = %v, want Unauthenticated", err)
	}
	if _, err := h.accountSvc.SyncPrimaryRuntimeConnections(context.Background(), boundControl, nil); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired SyncPrimaryRuntimeConnections = %v, want Unauthenticated", err)
	}
	if err := h.accountSvc.AnswerPrimaryRuntimeConnection(context.Background(), boundControl, "feb29b08-c6b3-46c4-a1fb-afb0a7344184", "v=0\r\ns=answer\r\n", ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expired AnswerPrimaryRuntimeConnection = %v, want Unauthenticated", err)
	}
	staleRun := &hostRun{
		ctx:     context.Background(),
		control: boundControl,
		pending: make(map[string]pendingOffer),
		working: make(map[string]peerWork),
		peers:   make(map[string]*Peer),
	}
	connectCtx, connectCancel := context.WithCancel(context.Background())
	h.remoteSvc.wg.Add(1)
	h.remoteSvc.connect(staleRun, connectCtx, connectCancel, pendingOffer{
		offer: realmv1.RuntimeConnectionOfferDto{
			ConnectionId: "feb29b08-c6b3-46c4-a1fb-afb0a7344184",
			OfferSdp:     "v=0\r\ns=offer\r\n",
			Context:      &realmv1.RuntimeClientContextDto{ContextId: "43515b26-263b-40f6-875e-04b022c37039"},
		},
		deadline: time.Now().Add(time.Minute),
	}, localappkernel.Registration{}, localappkernel.RemoteSource{})
	if len(staleRun.peers) != 0 {
		t.Fatalf("expired connect admitted %d peer(s)", len(staleRun.peers))
	}
	if h.realmCalls.Load() != realmCallsAtSleep || expiredBearerSeen.Load() {
		t.Fatalf("expired peer admission leaked Realm traffic: calls=%d->%d expiredBearerSeen=%v",
			realmCallsAtSleep, h.realmCalls.Load(), expiredBearerSeen.Load())
	}

	// Refresh/restore live online token for the same account -> account state event wakes remote access to LISTENING.
	regsBeforeRecovery := h.registrations.Load()
	hbsBeforeRecovery := h.heartbeats.Load()
	if _, err := h.accountSvc.GetPrimaryRuntimeState(ctx, &runtimev1.GetPrimaryRuntimeStateRequest{}); err != nil {
		t.Fatalf("GetPrimaryRuntimeState recovery refresh: %v", err)
	}
	if refreshCalls.Load() != 1 {
		t.Fatalf("recovery refresh calls = %d, want 1", refreshCalls.Load())
	}
	waitForCondition(t, 500*time.Millisecond, "remote access to wake and resume LISTENING after token refresh", func() bool {
		return h.registrations.Load() > regsBeforeRecovery && h.heartbeats.Load() > hbsBeforeRecovery
	})
	recoveredState, err := h.remoteSvc.GetRemoteAccessState(ctx, &runtimev1.GetRemoteAccessStateRequest{})
	if err != nil || recoveredState.GetConnectionState() != runtimev1.RemoteAccessConnectionState_REMOTE_ACCESS_CONNECTION_STATE_LISTENING {
		t.Fatalf("recovered remote access state = (%+v, %v), want LISTENING", recoveredState, err)
	}
	if expiredBearerSeen.Load() {
		t.Fatal("expired access token was sent to Realm at some point after expiry")
	}
	mu.Lock()
	finalBearer := lastBearer
	mu.Unlock()
	if finalBearer != "Bearer access-2" {
		t.Fatalf("post-recovery bearer = %q, want Bearer access-2", finalBearer)
	}
	_, genAfter, fenceAfter, liveAfter := h.accountSvc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !liveAfter || genAfter != gen1 || fenceAfter != fence1 {
		t.Fatalf("same-account token recovery disrupted local identity: gen=%d(want %d) live=%v", genAfter, gen1, liveAfter)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
