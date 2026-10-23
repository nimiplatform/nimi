package appstorage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const localAppJSONIdleOwners = 64

// JSONCommitGuard invokes commit synchronously under the caller's current
// Account, registration and technical-session fences. No preparation or scan
// runs under those shared fences.
type JSONCommitGuard func(commit func() error) error

type jsonOwnerState struct {
	writer     chan struct{}
	refs       int // holders AND waiters; guarded by LocalAppJSONStore.mu
	lastUsed   uint64
	rootInfo   os.FileInfo
	usage      int64
	reconciled bool
}

// LocalAppJSONStore belongs to one Runtime data-root activation. Runtime is
// the sole supported online writer of these private records. Offline restore
// requires root quiescence/re-activation; owner inspection explicitly rebuilds
// this disposable projection. We never infer content integrity from mtime.
// @nimi-authority: rule.nimi.runtime.app-surface.r043
type LocalAppJSONStore struct {
	dataRoot string
	rootInfo os.FileInfo
	mu       sync.Mutex
	owners   map[ManagedOwner]*jsonOwnerState
	clock    uint64
	closed   bool
	done     chan struct{}
	active   sync.WaitGroup
	readFile func(string) ([]byte, error)
	replace  func(string, string) error
}

func NewLocalAppJSONStore(dataRoot string) (*LocalAppJSONStore, error) {
	dataRoot = filepath.Clean(strings.TrimSpace(dataRoot))
	if !filepath.IsAbs(dataRoot) || ensureDirectoryNoSymlink(dataRoot) != nil {
		return nil, ErrLocalAppJSONUnavailable
	}
	info, err := snapshotJSONDirectoryIdentity(dataRoot)
	if err != nil {
		return nil, ErrLocalAppJSONUnavailable
	}
	return &LocalAppJSONStore{
		dataRoot: dataRoot, rootInfo: info, owners: make(map[ManagedOwner]*jsonOwnerState),
		done: make(chan struct{}), readFile: os.ReadFile, replace: replaceLocalAppJSONFile,
	}, nil
}

func (s *LocalAppJSONStore) acquire(ctx context.Context, owner ManagedOwner) (*jsonOwnerState, func(), error) {
	normalized, err := owner.normalized()
	if err != nil || normalized != owner {
		return nil, nil, ErrLocalAppJSONUnavailable
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, nil, ErrLocalAppJSONUnavailable
	}
	state := s.owners[owner]
	if state == nil {
		state = &jsonOwnerState{writer: make(chan struct{}, 1)}
		s.owners[owner] = state
	}
	state.refs++
	s.active.Add(1)
	s.mu.Unlock()
	releaseRef := func() {
		s.mu.Lock()
		state.refs--
		s.clock++
		state.lastUsed = s.clock
		// Idle projections are bounded. An entry with ANY waiter is never
		// removed, so the same owner cannot acquire a second writer.
		for len(s.owners) > localAppJSONIdleOwners {
			var oldestOwner ManagedOwner
			var oldest *jsonOwnerState
			for key, candidate := range s.owners {
				if candidate.refs == 0 && (oldest == nil || candidate.lastUsed < oldest.lastUsed) {
					oldestOwner, oldest = key, candidate
				}
			}
			if oldest == nil {
				break
			}
			delete(s.owners, oldestOwner)
		}
		s.mu.Unlock()
		s.active.Done()
	}
	select {
	case state.writer <- struct{}{}:
		if err := s.current(ctx); err != nil {
			<-state.writer
			releaseRef()
			return nil, nil, err
		}
		return state, func() { <-state.writer; releaseRef() }, nil
	case <-ctx.Done():
		releaseRef()
		return nil, nil, ctx.Err()
	case <-s.done:
		releaseRef()
		return nil, nil, ErrLocalAppJSONUnavailable
	}
}

func (s *LocalAppJSONStore) current(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case <-s.done:
		return ErrLocalAppJSONUnavailable
	default:
		return nil
	}
}

func (s *LocalAppJSONStore) root(state *jsonOwnerState, owner ManagedOwner, relativePath string) (string, string, error) {
	if s.validateActivation() != nil {
		state.reconciled = false
		return "", "", ErrLocalAppJSONUnavailable
	}
	root, normalized, err := localAppJSONRoot(s.dataRoot, owner, relativePath)
	if err != nil {
		state.reconciled = false
		return "", "", err
	}
	info, err := os.Lstat(root)
	if err != nil || (state.rootInfo != nil && !os.SameFile(state.rootInfo, info)) {
		state.reconciled = false
		return "", "", ErrLocalAppJSONUnavailable
	}
	if state.rootInfo == nil {
		info, err = snapshotJSONDirectoryIdentity(root)
		if err != nil {
			state.reconciled = false
			return "", "", ErrLocalAppJSONUnavailable
		}
		state.rootInfo = info
	}
	return root, normalized, nil
}

// Windows Lstat can defer loading the file ID until SameFile is called. A
// retained path-based FileInfo could therefore identify a replacement later.
// Stat an open directory now so activation identity is captured immediately.
func snapshotJSONDirectoryIdentity(path string) (os.FileInfo, error) {
	directory, err := os.Open(path)
	if err != nil {
		return nil, ErrLocalAppJSONUnavailable
	}
	defer directory.Close()
	info, err := directory.Stat()
	if err != nil || !info.IsDir() {
		return nil, ErrLocalAppJSONUnavailable
	}
	return info, nil
}

func (s *LocalAppJSONStore) validateActivation() error {
	info, err := os.Lstat(s.dataRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !os.SameFile(s.rootInfo, info) {
		return ErrLocalAppJSONUnavailable
	}
	return nil
}

func (s *LocalAppJSONStore) inspectDirectory(target string) (bool, error) {
	relative, err := filepath.Rel(s.dataRoot, target)
	if err != nil || !within(s.dataRoot, target) {
		return false, ErrLocalAppJSONUnavailable
	}
	current := s.dataRoot
	for _, segment := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, segment)
		if err := ensureDirectoryNoSymlink(current); errors.Is(err, os.ErrNotExist) {
			return false, nil
		} else if err != nil {
			return false, ErrLocalAppJSONUnavailable
		}
	}
	return true, nil
}

func (s *LocalAppJSONStore) reconcile(state *jsonOwnerState, root string) error {
	state.reconciled = false
	usage, err := localAppJSONPartitionUsageWithReader(root, s.readFile)
	if err != nil {
		return err
	}
	state.usage, state.reconciled = usage, true
	return nil
}

func (s *LocalAppJSONStore) Read(ctx context.Context, owner ManagedOwner, relativePath string) (LocalAppJSONDocument, error) {
	state, release, err := s.acquire(ctx, owner)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	defer release()
	root, normalized, err := s.root(state, owner, relativePath)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	doc, err := readLocalAppJSON(root, normalized, s.readFile)
	if err != nil && !errors.Is(err, ErrLocalAppJSONNotFound) {
		state.reconciled = false
	}
	if err == nil {
		err = s.current(ctx)
	}
	return doc, err
}

func (s *LocalAppJSONStore) Write(ctx context.Context, owner ManagedOwner, relativePath string, value []byte, guard JSONCommitGuard) (LocalAppJSONDocument, error) {
	canonical, err := canonicalLocalAppJSON(value)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	if guard == nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	state, release, err := s.acquire(ctx, owner)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	defer release()
	root, normalized, err := s.root(state, owner, relativePath)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	if !state.reconciled {
		if err := s.reconcile(state, root); err != nil {
			return LocalAppJSONDocument{}, err
		}
	}
	previous, readErr := readLocalAppJSON(root, normalized, s.readFile)
	if readErr != nil && !errors.Is(readErr, ErrLocalAppJSONNotFound) {
		state.reconciled = false
		return LocalAppJSONDocument{}, readErr
	}
	nextUsage := state.usage - previous.SizeBytes + int64(len(canonical))
	if nextUsage < 0 {
		state.reconciled = false
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if nextUsage > LocalAppJSONPartitionQuotaBytes {
		return LocalAppJSONDocument{}, ErrLocalAppJSONQuota
	}
	target, _, err := resolveLocalAppJSONTarget(root, normalized, true)
	if err != nil {
		state.reconciled = false
		return LocalAppJSONDocument{}, err
	}
	temporary, err := prepareLocalAppJSON(target, canonical)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	defer os.Remove(temporary)
	err = guard(func() error {
		if err := s.current(ctx); err != nil {
			return err
		}
		// Invalidate before attempting the only durable commit. Even an error
		// after rename must force reconciliation, never a guessed quota delta.
		state.reconciled = false
		if err := s.replace(temporary, target); err != nil {
			return ErrLocalAppJSONUnavailable
		}
		state.usage, state.reconciled = nextUsage, true
		return nil
	})
	if err != nil {
		state.reconciled = false
		return LocalAppJSONDocument{}, err
	}
	return LocalAppJSONDocument{JSONValue: canonical, SizeBytes: int64(len(canonical))}, nil
}

func (s *LocalAppJSONStore) Remove(ctx context.Context, owner ManagedOwner, relativePath string, guard JSONCommitGuard) (bool, error) {
	if guard == nil {
		return false, ErrLocalAppJSONUnavailable
	}
	state, release, err := s.acquire(ctx, owner)
	if err != nil {
		return false, err
	}
	defer release()
	root, normalized, err := s.root(state, owner, relativePath)
	if err != nil {
		return false, err
	}
	if !state.reconciled {
		if err := s.reconcile(state, root); err != nil {
			return false, err
		}
	}
	previous, err := readLocalAppJSON(root, normalized, s.readFile)
	if errors.Is(err, ErrLocalAppJSONNotFound) {
		return false, guard(func() error { return s.current(ctx) })
	}
	if err != nil {
		state.reconciled = false
		return false, err
	}
	target, _, err := resolveLocalAppJSONTarget(root, normalized, false)
	if err != nil {
		state.reconciled = false
		return false, err
	}
	err = guard(func() error {
		if err := s.current(ctx); err != nil {
			return err
		}
		state.reconciled = false
		if err := os.Remove(target); err != nil {
			return ErrLocalAppJSONUnavailable
		}
		state.usage -= previous.SizeBytes
		if state.usage < 0 {
			return ErrLocalAppJSONUnavailable
		}
		state.reconciled = true
		return nil
	})
	if err != nil {
		state.reconciled = false
	}
	return err == nil, err
}

// Inspect never treats a cached total as evidence of disk integrity. It shares
// the mutation writer and refreshes the projection only after a complete scan.
func (s *LocalAppJSONStore) Inspect(ctx context.Context, owner ManagedOwner) (bool, error) {
	state, release, err := s.acquire(ctx, owner)
	if err != nil {
		return false, err
	}
	defer release()
	state.reconciled = false
	if err := s.validateActivation(); err != nil {
		return false, err
	}
	ownerRoot, err := managedOwnerPath(s.dataRoot, owner)
	if err != nil {
		return true, ErrLocalAppJSONUnavailable
	}
	exists, err := s.inspectDirectory(ownerRoot)
	if err != nil || !exists {
		return exists, err
	}
	if exists, err := s.inspectDirectory(filepath.Join(ownerRoot, "json", "objects")); err != nil {
		return true, err
	} else if !exists {
		return true, nil // Read-only inspection must not materialize an empty JSON partition.
	}
	root, _, err := s.root(state, owner, "inspection.json")
	if err != nil {
		return true, err
	}
	return true, s.reconcile(state, root)
}

func (s *LocalAppJSONStore) Close() {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.done)
	}
	s.mu.Unlock()
	s.active.Wait()
	s.mu.Lock()
	clear(s.owners)
	s.mu.Unlock()
}
