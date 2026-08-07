package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	_ "modernc.org/sqlite"
)

const (
	localDevelopmentLaunchTTL      = 30 * time.Second
	localDevelopmentProcessBindTTL = 10 * time.Second
)

var (
	errLocalDevelopmentInvalid         = errors.New("local-development input is invalid")
	errLocalDevelopmentProjectChanged  = errors.New("local-development source changed")
	errLocalDevelopmentProjectUnstable = errors.New("local-development source changed during observation")
	errLocalDevelopmentLaunchMismatch  = errors.New("local-development launch binding mismatch")
	errLocalDevelopmentLaunchExpired   = errors.New("local-development launch expired")
	errLocalDevelopmentSessionRevoked  = errors.New("local-development protected access unavailable")
	errLocalDevelopmentProcessMismatch = errors.New("local-development process binding changed")
)

type localDevelopmentProjectSnapshot struct {
	AppID                 string
	DisplayName           string
	ProjectRoot           string
	ManifestPath          string
	ShellKind             runtimev1.LocalDevelopmentShellKind
	RawAppAccess          []string
	ActivatedDomains      []string
	SourceGeneration      uint64
	DeclarationGeneration uint64
}

type localDevelopmentMode struct {
	Enabled  bool
	Revision uint64
}

type localDevelopmentLaunchRequest struct {
	RegistrationHandle protectedlocal.Identifier
	SupervisorRunID    protectedlocal.Identifier
	Project            localDevelopmentProjectSnapshot
	HostExecutable     string
	ExpectedHostDigest protectedlocal.Identifier
}

type localDevelopmentLaunchTicket struct {
	LaunchID           protectedlocal.Identifier
	RegistrationHandle protectedlocal.Identifier
	SupervisorRunID    protectedlocal.Identifier
	Project            localDevelopmentProjectSnapshot
	HostExecutable     string
	ExpectedHostDigest protectedlocal.Identifier
	Process            protectedlocal.ProcessTuple
	ExpiresAt          time.Time
	BindDeadline       time.Time
}

type localDevelopmentStore struct {
	db         *sql.DB
	directPeer bool
	random     io.Reader
	now        func() time.Time
	mu         sync.Mutex
	launches   map[protectedlocal.Identifier]localDevelopmentLaunchTicket
}

type LocalDevelopmentStore = localDevelopmentStore

func openLocalDevelopmentStore(path string, bootEpoch protectedlocal.Identifier) (*localDevelopmentStore, error) {
	if bootEpoch == (protectedlocal.Identifier{}) {
		return nil, errLocalDevelopmentInvalid
	}
	return openLocalDevelopmentStoreWithMode(path, false)
}

func openDirectLocalDevelopmentStore(path string) (*localDevelopmentStore, error) {
	return openLocalDevelopmentStoreWithMode(path, true)
}

func openLocalDevelopmentStoreWithMode(path string, direct bool) (*localDevelopmentStore, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(cleaned) || filepath.Base(cleaned) != "local-development.db" {
		return nil, fmt.Errorf("%w: fixed absolute local-development.db path is required", errLocalDevelopmentInvalid)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(cleaned)+"?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open local-development technical store: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &localDevelopmentStore{db: db, directPeer: direct, random: rand.Reader, now: time.Now, launches: make(map[protectedlocal.Identifier]localDevelopmentLaunchTicket)}
	if err := store.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *localDevelopmentStore) initialize(ctx context.Context) error {
	if _, err := store.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS local_development_mode (
		singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
		enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
		revision INTEGER NOT NULL CHECK(revision > 0),
		updated_unix_nano INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("initialize local-development mode: %w", err)
	}
	_, err := store.db.ExecContext(ctx, `INSERT OR IGNORE INTO local_development_mode(singleton, enabled, revision, updated_unix_nano) VALUES (1, 0, 1, ?)`, store.now().UTC().UnixNano())
	return err
}

func (store *localDevelopmentStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func (store *localDevelopmentStore) DeveloperMode(ctx context.Context) (localDevelopmentMode, error) {
	if store == nil || store.db == nil {
		return localDevelopmentMode{}, errLocalDevelopmentInvalid
	}
	var enabled int
	var revision uint64
	if err := store.db.QueryRowContext(ctx, `SELECT enabled, revision FROM local_development_mode WHERE singleton = 1`).Scan(&enabled, &revision); err != nil {
		return localDevelopmentMode{}, err
	}
	return localDevelopmentMode{Enabled: enabled == 1, Revision: revision}, nil
}

func (store *localDevelopmentStore) SetDeveloperMode(ctx context.Context, enabled bool) (localDevelopmentMode, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	mode, err := store.DeveloperMode(ctx)
	if err != nil {
		return localDevelopmentMode{}, err
	}
	if mode.Enabled == enabled {
		return mode, nil
	}
	mode.Enabled = enabled
	mode.Revision++
	value := 0
	if enabled {
		value = 1
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE local_development_mode SET enabled = ?, revision = ?, updated_unix_nano = ? WHERE singleton = 1`, value, mode.Revision, store.now().UTC().UnixNano()); err != nil {
		return localDevelopmentMode{}, err
	}
	if !enabled {
		store.launches = make(map[protectedlocal.Identifier]localDevelopmentLaunchTicket)
	}
	return mode, nil
}

func (store *localDevelopmentStore) RequireDeveloperMode(ctx context.Context) error {
	mode, err := store.DeveloperMode(ctx)
	if err != nil {
		return err
	}
	if !mode.Enabled {
		return errLocalDevelopmentInvalid
	}
	return nil
}

func (store *localDevelopmentStore) PrepareLaunch(_ context.Context, request localDevelopmentLaunchRequest) (localDevelopmentLaunchTicket, error) {
	if store == nil || request.RegistrationHandle == (protectedlocal.Identifier{}) || request.SupervisorRunID == (protectedlocal.Identifier{}) || request.ExpectedHostDigest == (protectedlocal.Identifier{}) || strings.TrimSpace(request.HostExecutable) == "" {
		return localDevelopmentLaunchTicket{}, errLocalDevelopmentInvalid
	}
	launchID, err := readLocalDevelopmentIdentifier(store.random)
	if err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	now := store.now().UTC()
	ticket := localDevelopmentLaunchTicket{LaunchID: launchID, RegistrationHandle: request.RegistrationHandle, SupervisorRunID: request.SupervisorRunID, Project: request.Project, HostExecutable: request.HostExecutable, ExpectedHostDigest: request.ExpectedHostDigest, ExpiresAt: now.Add(localDevelopmentLaunchTTL), BindDeadline: now.Add(localDevelopmentLaunchTTL)}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.removeExpiredLocked(now)
	store.launches[launchID] = ticket
	return ticket, nil
}

func (store *localDevelopmentStore) PendingLaunchPolicy(_ context.Context, launchID protectedlocal.Identifier) (protectedlocal.LocalDevelopmentProcessPolicy, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.removeExpiredLocked(store.now().UTC())
	ticket, ok := store.launches[launchID]
	if !ok || ticket.Process.PID != 0 {
		return protectedlocal.LocalDevelopmentProcessPolicy{}, errLocalDevelopmentLaunchExpired
	}
	return protectedlocal.LocalDevelopmentProcessPolicy{ProjectRoot: ticket.Project.ProjectRoot, HostExecutablePath: ticket.HostExecutable}, nil
}

func (store *localDevelopmentStore) BindLaunch(_ context.Context, launchID protectedlocal.Identifier, process protectedlocal.ProcessTuple) (time.Time, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := store.now().UTC()
	store.removeExpiredLocked(now)
	ticket, ok := store.launches[launchID]
	if !ok || process.PID == 0 || process.ExecutableDigest != ticket.ExpectedHostDigest {
		return time.Time{}, errLocalDevelopmentLaunchMismatch
	}
	ticket.Process = process
	ticket.BindDeadline = now.Add(localDevelopmentProcessBindTTL)
	store.launches[launchID] = ticket
	return ticket.BindDeadline, nil
}

func (store *localDevelopmentStore) RevokeLaunch(_ context.Context, launchID protectedlocal.Identifier) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.launches, launchID)
	return nil
}

func (store *localDevelopmentStore) EndRun(_ context.Context, handle, runID protectedlocal.Identifier) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	for launchID, ticket := range store.launches {
		if ticket.RegistrationHandle == handle && ticket.SupervisorRunID == runID {
			delete(store.launches, launchID)
		}
	}
	return nil
}

func (store *localDevelopmentStore) RevokeRegistration(handle protectedlocal.Identifier) {
	store.mu.Lock()
	defer store.mu.Unlock()
	for launchID, ticket := range store.launches {
		if ticket.RegistrationHandle == handle {
			delete(store.launches, launchID)
		}
	}
}

func (store *localDevelopmentStore) removeExpiredLocked(now time.Time) {
	for launchID, ticket := range store.launches {
		deadline := ticket.ExpiresAt
		if !ticket.BindDeadline.IsZero() && ticket.BindDeadline.Before(deadline) {
			deadline = ticket.BindDeadline
		}
		if !now.Before(deadline) {
			delete(store.launches, launchID)
		}
	}
}

func readLocalDevelopmentIdentifier(source io.Reader) (protectedlocal.Identifier, error) {
	var identifier protectedlocal.Identifier
	if source == nil {
		return identifier, errLocalDevelopmentInvalid
	}
	if _, err := io.ReadFull(source, identifier[:]); err != nil || identifier == (protectedlocal.Identifier{}) {
		return protectedlocal.Identifier{}, errLocalDevelopmentInvalid
	}
	return identifier, nil
}
