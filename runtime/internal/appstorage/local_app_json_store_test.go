package appstorage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newJSONStoreTest(t *testing.T) (*LocalAppJSONStore, ManagedOwner) {
	t.Helper()
	s, err := NewLocalAppJSONStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s, ManagedOwner{AccountID: "account", RegisteredAppSubject: "subject"}
}

func TestJSONStoreStableMutationReadsOnlyTarget(t *testing.T) {
	s, owner := newJSONStoreTest(t)
	ctx := context.Background()
	large := append(append([]byte{'"'}, bytes.Repeat([]byte{'x'}, 200<<10)...), '"')
	for i := range 3 {
		if _, err := s.Write(ctx, owner, fmt.Sprintf("bulk/%d.json", i), large, jsonTestCommit); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Write(ctx, owner, "state.json", []byte(`{"revision":1}`), jsonTestCommit); err != nil {
		t.Fatal(err)
	}
	var readBytes int
	s.readFile = func(path string) ([]byte, error) {
		value, err := os.ReadFile(path)
		readBytes += len(value)
		return value, err
	}
	for i := range 6 {
		value := []byte(fmt.Sprintf(`{"revision":%d}`, 1+i%2))
		if _, err := s.Write(ctx, owner, "state.json", value, jsonTestCommit); err != nil {
			t.Fatal(err)
		}
		got, err := s.Read(ctx, owner, "state.json")
		if err != nil || !bytes.Equal(got.JSONValue, value) {
			t.Fatal("changed read-back", got, err)
		}
	}
	if readBytes != 6*2*14 {
		t.Fatalf("stable writes reread unrelated content: %d bytes", readBytes)
	}
}

func TestJSONStoreOwnerIsolationWaitersAndEviction(t *testing.T) {
	s, owner := newJSONStoreTest(t)
	state, release, err := s.acquire(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	waited := make(chan error, 1)
	go func() { _, err := s.Write(ctx, owner, "waiting.json", []byte(`true`), jsonTestCommit); waited <- err }()
	awaitJSONReferences(t, s, owner, 2)
	for i := range localAppJSONIdleOwners + 2 {
		other := ManagedOwner{AccountID: owner.AccountID, RegisteredAppSubject: fmt.Sprintf("other-%d", i)}
		if _, err := s.Write(context.Background(), other, "value.json", []byte(`true`), jsonTestCommit); err != nil {
			t.Fatal("unrelated owner blocked", err)
		}
	}
	s.mu.Lock()
	same := s.owners[owner] == state
	count := len(s.owners)
	s.mu.Unlock()
	if !same || count > localAppJSONIdleOwners {
		t.Fatalf("live entry replaced or idle cache unbounded: %v %d", same, count)
	}
	cancel()
	select {
	case err := <-waited:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("waiting owner ignored cancel")
	}
	if _, err := s.Read(context.Background(), ManagedOwner{AccountID: "other-account", RegisteredAppSubject: owner.RegisteredAppSubject}, "value.json"); !errors.Is(err, ErrLocalAppJSONNotFound) {
		t.Fatal("cross account", err)
	}
}

func TestJSONStoreOtherOwnerCompletesDuringActualReconciliation(t *testing.T) {
	s, owner := newJSONStoreTest(t)
	ctx := context.Background()
	if _, err := s.Write(ctx, owner, "bulk.json", []byte(`{"previous":true}`), jsonTestCommit); err != nil {
		t.Fatal(err)
	}
	root, _, err := localAppJSONRoot(s.dataRoot, owner, "bulk.json")
	if err != nil {
		t.Fatal(err)
	}
	s.owners[owner].reconciled = false
	entered, resume := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(resume) })
	defer unblock()
	var once sync.Once
	s.readFile = func(path string) ([]byte, error) {
		if strings.HasPrefix(path, root+string(filepath.Separator)) {
			once.Do(func() { close(entered); <-resume })
		}
		return os.ReadFile(path)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := s.Write(ctx, owner, "bulk.json", []byte(`{"previous":false}`), jsonTestCommit)
		finished <- err
	}()
	<-entered
	otherDone := make(chan error, 1)
	go func() {
		other := ManagedOwner{AccountID: owner.AccountID, RegisteredAppSubject: "independent-subject"}
		_, err := s.Write(ctx, other, "value.json", []byte(`true`), jsonTestCommit)
		if err == nil {
			_, err = s.Read(ctx, other, "value.json")
		}
		otherDone <- err
	}()
	select {
	case err := <-otherDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("unrelated owner waited for reconciliation")
	}
	unblock()
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func awaitJSONReferences(t *testing.T, s *LocalAppJSONStore, owner ManagedOwner, expected int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		state := s.owners[owner]
		ready := state != nil && state.refs == expected
		s.mu.Unlock()
		if ready {
			return
		}
		runtime.Gosched()
	}
	t.Fatal("owner waiter did not enter")
}

func TestJSONStoreCloseRejectsWaitersAndWaitsForActualHolder(t *testing.T) {
	s, owner := newJSONStoreTest(t)
	entered, resume := make(chan struct{}), make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		_, err := s.Write(context.Background(), owner, "value.json", []byte(`true`), func(commit func() error) error { close(entered); <-resume; return commit() })
		finished <- err
	}()
	<-entered
	waited := make(chan error, 1)
	go func() { _, err := s.Read(context.Background(), owner, "value.json"); waited <- err }()
	awaitJSONReferences(t, s, owner, 2)
	closed := make(chan struct{})
	go func() { s.Close(); close(closed) }()
	<-s.done
	select {
	case <-closed:
		t.Fatal("close returned while filesystem holder was live")
	default:
	}
	select {
	case err := <-waited:
		if !errors.Is(err, ErrLocalAppJSONUnavailable) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("close did not wake waiter")
	}
	close(resume)
	if err := <-finished; !errors.Is(err, ErrLocalAppJSONUnavailable) {
		t.Fatal("closed owner committed", err)
	}
	<-closed
	if _, err := s.Read(context.Background(), owner, "value.json"); !errors.Is(err, ErrLocalAppJSONUnavailable) {
		t.Fatal("closed owner reopened", err)
	}
	if len(s.owners) != 0 {
		t.Fatal("closed owner cache retained")
	}
}

func TestJSONStoreConcurrentQuotaAndRemoveAccounting(t *testing.T) {
	s, owner := newJSONStoreTest(t)
	ctx := context.Background()
	for i := range 64 {
		n := LocalAppJSONMaxDocumentBytes
		if i == 63 {
			n -= 4
		}
		value := append(append([]byte{'"'}, bytes.Repeat([]byte{'x'}, n-2)...), '"')
		if _, err := s.Write(ctx, owner, fmt.Sprintf("bulk/%d.json", i), value, jsonTestCommit); err != nil {
			t.Fatal(err)
		}
	}
	type result struct {
		path string
		err  error
	}
	results := make(chan result, 2)
	for _, path := range []string{"first.json", "second.json"} {
		go func() {
			_, err := s.Write(ctx, owner, path, []byte(`null`), jsonTestCommit)
			results <- result{path, err}
		}()
	}
	var winner string
	for range 2 {
		got := <-results
		if got.err == nil {
			if winner != "" {
				t.Fatal("quota oversubscribed")
			}
			winner = got.path
		} else if !errors.Is(got.err, ErrLocalAppJSONQuota) {
			t.Fatal(got.err)
		}
	}
	if winner == "" {
		t.Fatal("no admitted write")
	}
	if removed, err := s.Remove(ctx, owner, winner, jsonTestCommit); !removed || err != nil {
		t.Fatal(removed, err)
	}
	if removed, err := s.Remove(ctx, owner, winner, jsonTestCommit); removed || err != nil {
		t.Fatal(removed, err)
	}
	if _, err := s.Write(ctx, owner, "replacement.json", []byte(`null`), jsonTestCommit); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(ctx, owner, "overflow.json", []byte(`0`), jsonTestCommit); !errors.Is(err, ErrLocalAppJSONQuota) {
		t.Fatal("remove double-debited quota", err)
	}
	if _, err := s.Write(ctx, owner, "bulk/0.json", []byte(`0`), jsonTestCommit); err != nil {
		t.Fatal("shrink", err)
	}
	if _, err := s.Inspect(ctx, owner); err != nil {
		t.Fatal(err)
	}
	root, _, _ := localAppJSONRoot(s.dataRoot, owner, "replacement.json")
	actual, err := localAppJSONPartitionUsage(root)
	if err != nil || actual != s.owners[owner].usage {
		t.Fatal("quota projection drift", actual, err)
	}
}

func TestJSONStoreAmbiguousCommitReconcilesActualFiles(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(fmt.Sprint(committed), func(t *testing.T) {
			s, owner := newJSONStoreTest(t)
			ctx := context.Background()
			if _, err := s.Write(ctx, owner, "value.json", []byte(`true`), jsonTestCommit); err != nil {
				t.Fatal(err)
			}
			s.replace = func(from, to string) error {
				if committed {
					if err := replaceLocalAppJSONFile(from, to); err != nil {
						return err
					}
				}
				return errors.New("lost local confirmation")
			}
			if _, err := s.Write(ctx, owner, "value.json", []byte(`{"longer":true}`), jsonTestCommit); !errors.Is(err, ErrLocalAppJSONUnavailable) {
				t.Fatal(err)
			}
			if s.owners[owner].reconciled {
				t.Fatal("ambiguous projection trusted")
			}
			s.replace = replaceLocalAppJSONFile
			var reads atomic.Int32
			s.readFile = func(path string) ([]byte, error) { reads.Add(1); return os.ReadFile(path) }
			if _, err := s.Write(ctx, owner, "next.json", []byte(`null`), jsonTestCommit); err != nil {
				t.Fatal(err)
			}
			want := int64(8)
			if committed {
				want = int64(len(`{"longer":true}`) + 4)
			}
			if reads.Load() == 0 || s.owners[owner].usage != want {
				t.Fatalf("did not reconcile actual commit: reads=%d usage=%d", reads.Load(), s.owners[owner].usage)
			}
		})
	}
}

func TestJSONStoreInspectionAndReactivationRejectCorruptSibling(t *testing.T) {
	for _, corrupt := range []string{`{"a": 1}`, `{"a":xx}`} {
		t.Run(corrupt, func(t *testing.T) {
			s, owner := newJSONStoreTest(t)
			ctx := context.Background()
			if _, err := s.Write(ctx, owner, "sibling.json", []byte(`{"a":10}`), jsonTestCommit); err != nil {
				t.Fatal(err)
			}
			root, _, _ := localAppJSONRoot(s.dataRoot, owner, "sibling.json")
			target, _, _ := resolveLocalAppJSONTarget(root, "sibling.json", false)
			before, _ := os.Stat(target)
			if err := os.WriteFile(target, []byte(corrupt), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(target, before.ModTime(), before.ModTime()); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Inspect(ctx, owner); err == nil {
				t.Fatal("inspection trusted size/mtime")
			}
			if s.owners[owner].reconciled {
				t.Fatal("failed inspection retained old projection")
			}
			if _, err := s.Write(ctx, owner, "other.json", []byte(`true`), jsonTestCommit); err == nil {
				t.Fatal("mutation ignored known corrupt sibling")
			}
			s.Close()
			reopened, err := NewLocalAppJSONStore(s.dataRoot)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if _, err := reopened.Write(ctx, owner, "other.json", []byte(`true`), jsonTestCommit); err == nil {
				t.Fatal("reactivation ignored sibling corruption")
			}
		})
	}
}

func TestJSONStoreInspectionChecksActivationBeforeMissingBranches(t *testing.T) {
	for _, present := range []bool{false, true} {
		t.Run(fmt.Sprint(present), func(t *testing.T) {
			parent := t.TempDir()
			root := filepath.Join(parent, "active")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			s, err := NewLocalAppJSONStore(root)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			owner := ManagedOwner{AccountID: "account", RegisteredAppSubject: "subject"}
			if present {
				ownerRoot, _, err := managedOwnerRoot(root, owner)
				if err != nil {
					t.Fatal(err)
				}
				if exists, err := s.Inspect(context.Background(), owner); !exists || err != nil {
					t.Fatal(exists, err)
				}
				if _, err := os.Stat(filepath.Join(ownerRoot, "json")); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("inspection materialized JSON", err)
				}
			}
			if err := os.Rename(root, filepath.Join(parent, "retired")); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Inspect(context.Background(), owner); !errors.Is(err, ErrLocalAppJSONUnavailable) {
				t.Fatal("missing owner bypassed activation identity", err)
			}
		})
	}
}
