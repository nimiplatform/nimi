//go:build darwin && cgo

package appstorage

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func closeFinderTestResource(t *testing.T, resource io.Closer) {
	t.Helper()
	if err := resource.Close(); err != nil {
		t.Error(err)
	}
}

func newFinderAssetTest(t *testing.T) (*AssetStore, *FinderViews, ManagedOwner, string) {
	t.Helper()
	data := t.TempDir()
	state := t.TempDir()
	store, err := NewAssetStore(data, assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	views, err := NewFinderViews(state)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeFinderTestResource(t, views) })
	store.SetRevealViews(views)
	owner := ManagedOwner{AccountID: "account-a", RegisteredAppSubject: "test-subject"}
	for _, name := range []string{"audio/one.wav", "audio/private.wav"} {
		if _, e := store.Write(context.Background(), owner, name, "audio/wav", false, io.NopCloser(strings.NewReader(name))); e != nil {
			t.Fatal(e)
		}
	}
	return store, views, owner, state
}

func TestFinderViewSameFileAndSessionRevocation(t *testing.T) {
	store, views, owner, _ := newFinderAssetTest(t)
	ctx := context.Background()
	const uid = uint32(1) // macOS daemon; distinct from the normal test runner.
	publish := func(session string) (string, error) {
		_, p, e := store.PublishVerifiedReveal(ctx, owner, "audio/one.wav", session, uid, func(commit func() error) error { return commit() })
		return p, e
	}
	_, original, err := store.ResolveRevealTarget(ctx, owner, "audio/one.wav")
	if err != nil {
		t.Fatal(err)
	}
	view, err := publish("session-a")
	if err != nil {
		t.Fatal(err)
	}
	src, _ := os.Stat(original)
	selected, e := os.Stat(view)
	if e != nil || original == view || filepath.Base(view) != "one.wav" || !os.SameFile(src, selected) {
		t.Fatalf("Finder did not receive the original inode: %v", e)
	}
	names, e := os.ReadDir(filepath.Dir(view))
	if e != nil || len(names) != 1 || names[0].Name() != "one.wav" {
		t.Fatalf("unexpected Finder listing: %v %v", names, e)
	}
	other, e := publish("session-b")
	if e != nil || other == view {
		t.Fatalf("expected separate session pathname, got %q, %v", other, e)
	}
	if err = views.Release("session-a"); err != nil {
		t.Fatal(err)
	}
	if _, e = os.Stat(view); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("first session path survived", e)
	}
	if _, e = os.Stat(other); e != nil {
		t.Fatal("second live session lost its view", e)
	}
	if err = views.Release("session-b"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(view); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("revoked view still present", err)
	}
	f, e := os.Open(original)
	if e != nil {
		t.Fatal(e)
	}
	defer closeFinderTestResource(t, f)
	if read, e := finderReadACE(f, uid, 0); e != nil || read {
		t.Fatal("temporary inode ACL survived", read, e)
	}
	if _, e = store.Stat(ctx, owner, "audio/private.wav"); e != nil {
		t.Fatal(e)
	}
}
func TestFinderViewGuardAndReplacement(t *testing.T) {
	store, _, owner, _ := newFinderAssetTest(t)
	ctx := context.Background()
	refused := errors.New("session rotated")
	if _, p, e := store.PublishVerifiedReveal(ctx, owner, "audio/one.wav", "a", 1, func(func() error) error { return refused }); !errors.Is(e, refused) || p != "" {
		t.Fatal(p, e)
	}
	allow := func(c func() error) error { return c() }
	_, p, e := store.PublishVerifiedReveal(ctx, owner, "audio/one.wav", "a", 1, allow)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.Write(ctx, owner, "audio/one.wav", "audio/wav", true, io.NopCloser(strings.NewReader("new"))); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(p); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("overwritten asset still exposed", e)
	}
	if _, _, e = store.PublishVerifiedReveal(ctx, ManagedOwner{AccountID: "account-b", RegisteredAppSubject: owner.RegisteredAppSubject}, "audio/one.wav", "b", 1, allow); !errors.Is(e, ErrAssetNotFound) {
		t.Fatal("wrong account resolved the asset", e)
	}
}

func TestFinderViewsRecoverAfterProcessExit(t *testing.T) {
	root := os.Getenv("NIMI_TEST_FINDER_CRASH_ROOT")
	if root != "" {
		store, e := NewAssetStore(filepath.Join(root, "data"), assetTestPolicy())
		if e != nil {
			t.Fatal(e)
		}
		v, e := NewFinderViews(filepath.Join(root, "state"))
		if e != nil {
			t.Fatal(e)
		}
		store.SetRevealViews(v)
		o := ManagedOwner{AccountID: "account", RegisteredAppSubject: "subject"}
		if _, e = store.Write(context.Background(), o, "test.wav", "audio/wav", false, io.NopCloser(strings.NewReader("recovery"))); e != nil {
			t.Fatal(e)
		}
		_, path, e := store.PublishVerifiedReveal(context.Background(), o, "test.wav", "session", 1, func(c func() error) error { return c() })
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(root, "view"), []byte(path), 0o600); e != nil {
			t.Fatal(e)
		}
		os.Exit(0) // No defer, session callback, or service shutdown is run.
	}
	root = t.TempDir()
	for _, d := range []string{"state", "data"} {
		if e := os.Mkdir(filepath.Join(root, d), 0o700); e != nil {
			t.Fatal(e)
		}
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestFinderViewsRecoverAfterProcessExit$")
	cmd.Env = append(os.Environ(), "NIMI_TEST_FINDER_CRASH_ROOT="+root)
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("child: %v\n%s", e, out)
	}
	raw, e := os.ReadFile(filepath.Join(root, "view"))
	if e != nil {
		t.Fatal(e)
	}
	f, e := os.Open(string(raw))
	if e != nil {
		t.Fatal(e)
	}
	defer closeFinderTestResource(t, f)
	v, e := NewFinderViews(filepath.Join(root, "state"))
	if e != nil {
		t.Fatal(e)
	}
	defer closeFinderTestResource(t, v)
	if _, e = os.Stat(string(raw)); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("stale view survived recovery", e)
	}
	if read, e := finderReadACE(f, 1, 0); e != nil || read {
		t.Fatal("stale ACL survived recovery", read, e)
	}
}

func TestFinderViewMoveAndRemoveWithdrawThePublication(t *testing.T) {
	store, _, owner, _ := newFinderAssetTest(t)
	ctx := context.Background()
	allow := func(commit func() error) error { return commit() }
	_, first, err := store.PublishVerifiedReveal(ctx, owner, "audio/one.wav", "session", 1, allow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Move(ctx, owner, "audio/one.wav", "audio/moved.wav", false); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(first); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("move kept old Finder path", err)
	}
	_, next, err := store.PublishVerifiedReveal(ctx, owner, "audio/moved.wav", "session", 1, allow)
	if err != nil {
		t.Fatal(err)
	}
	if removed, err := store.Remove(ctx, owner, "audio/moved.wav"); err != nil || !removed {
		t.Fatal(removed, err)
	}
	if _, err = os.Stat(next); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("remove kept old Finder path", err)
	}
}

func TestFinderViewPreservesExistingReadGrant(t *testing.T) {
	store, views, owner, _ := newFinderAssetTest(t)
	ctx := context.Background()
	_, original, err := store.ResolveRevealTarget(ctx, owner, "audio/one.wav")
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(original)
	if err != nil {
		t.Fatal(err)
	}
	defer closeFinderTestResource(t, f)
	if _, err = finderReadACE(f, 1, 1); err != nil {
		t.Fatal(err)
	}
	_, _, err = store.PublishVerifiedReveal(ctx, owner, "audio/one.wav", "session", 1, func(commit func() error) error { return commit() })
	if err != nil {
		t.Fatal(err)
	}
	if err = views.Release("session"); err != nil {
		t.Fatal(err)
	}
	if present, err := finderReadACE(f, 1, 0); err != nil || !present {
		t.Fatal("pre-existing read ACL changed", err)
	}
}
