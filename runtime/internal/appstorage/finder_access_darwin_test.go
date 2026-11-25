//go:build darwin && cgo

package appstorage

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Run the child as the actual service account and the file operations as the
// login user. The opt-in coordinator needs privilege only to drop credentials.
func TestFinderViewCrossUIDReadOnly(t *testing.T) {
	root := os.Getenv("NIMI_TEST_FINDER_CROSS_UID_ROOT")
	if root != "" {
		runFinderServiceFixture(t, root)
		return
	}
	name := os.Getenv("NIMI_TEST_FINDER_LOGIN_USER")
	if name == "" || os.Geteuid() != 0 {
		t.Skip("requires two real OS identities and a privileged test coordinator")
	}
	credentials := func(name string) *syscall.Credential {
		u, err := user.Lookup(name)
		if err != nil {
			t.Fatal(err)
		}
		uid, err := strconv.ParseUint(u.Uid, 10, 32)
		if err != nil || uid == 0 {
			t.Fatal("non-root test uid required")
		}
		gid, err := strconv.ParseUint(u.Gid, 10, 32)
		if err != nil {
			t.Fatal(err)
		}
		return &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid), Groups: []uint32{uint32(gid)}}
	}
	service, login := credentials("_nimiruntime"), credentials(name)
	if service.Uid == login.Uid {
		t.Fatal("distinct identities required")
	}
	root, err := os.MkdirTemp("/Users/Shared", "nimi-finder-uid-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	if err = os.Chmod(root, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"state", "data"} {
		p := filepath.Join(root, dir)
		if err = os.Mkdir(p, 0o700); err != nil {
			t.Fatal(err)
		}
		if err = os.Chown(p, int(service.Uid), int(service.Gid)); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.Chmod(filepath.Join(root, "data"), 0o711); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestFinderViewCrossUIDReadOnly$")
	cmd.Env = append(os.Environ(), "NIMI_TEST_FINDER_CROSS_UID_ROOT="+root, "NIMI_TEST_FINDER_CROSS_UID_READER="+strconv.Itoa(int(login.Uid)))
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: service}
	cmd.Stderr = os.Stderr
	stdin, e := cmd.StdinPipe()
	if e != nil {
		t.Fatal(e)
	}
	defer func() { _ = stdin.Close() }()
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = cmd.Start(); e != nil {
		t.Fatal(e)
	}
	reader := bufio.NewReader(stdout)
	line, e := reader.ReadString('\n')
	if e != nil {
		t.Fatal(e)
	}
	var selected []string
	if e = json.Unmarshal([]byte(line), &selected); e != nil || len(selected) != 2 {
		t.Fatalf("service did not create view: %s", line)
	}
	original, view := selected[0], selected[1]
	run := func(bin string, args ...string) (string, error) {
		p := exec.CommandContext(ctx, bin, args...)
		p.SysProcAttr = &syscall.SysProcAttr{Credential: login}
		out, err := p.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	if text, e := run("/bin/cat", view); e != nil || text != "test audio" {
		t.Fatal("read approved file", text, e)
	}
	if entries, e := run("/bin/ls", "-A", filepath.Dir(view)); e != nil || entries != "one.wav" {
		t.Fatal("visible entries", entries, e)
	}
	if _, e := run("/bin/cat", original); e == nil {
		t.Fatal("private storage became accessible")
	}
	if _, e := run("/bin/sh", "-c", `test ! -w "$1" && test ! -w "$2"`, "sh", view, filepath.Dir(view)); e != nil {
		t.Fatal("view was writable", e)
	}
	a, e := os.Stat(original)
	if e != nil {
		t.Fatal(e)
	}
	b, e := os.Stat(view)
	if e != nil || !os.SameFile(a, b) {
		t.Fatal("inode identity")
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if _, e = io.Copy(io.Discard, reader); e != nil {
		t.Fatal(e)
	}
	if e = cmd.Wait(); e != nil {
		t.Fatal(e)
	}
	if _, e = run("/bin/cat", view); e == nil {
		t.Fatal("released view remained readable")
	}
	t.Logf("service UID %d, reader UID %d: one readable inode, private source inaccessible, writes denied, view revoked", service.Uid, login.Uid)
}

func runFinderServiceFixture(t *testing.T, root string) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Fatal("asset fixture must run unprivileged")
	}
	uid, e := strconv.ParseUint(os.Getenv("NIMI_TEST_FINDER_CROSS_UID_READER"), 10, 32)
	if e != nil {
		t.Fatal(e)
	}
	store, e := NewAssetStore(filepath.Join(root, "data"), assetTestPolicy())
	if e != nil {
		t.Fatal(e)
	}
	v, e := NewFinderViews(filepath.Join(root, "state"))
	if e != nil {
		t.Fatal(e)
	}
	defer closeFinderTestResource(t, v)
	store.SetRevealViews(v)
	o := ManagedOwner{AccountID: "isolated", RegisteredAppSubject: "audio"}
	for _, n := range []string{"audio/one.wav", "audio/other.wav"} {
		if _, e = store.Write(context.Background(), o, n, "audio/wav", false, io.NopCloser(strings.NewReader("test audio"))); e != nil {
			t.Fatal(e)
		}
	}
	_, original, e := store.ResolveRevealTarget(context.Background(), o, "audio/one.wav")
	if e != nil {
		t.Fatal(e)
	}
	_, view, e := store.PublishVerifiedReveal(context.Background(), o, "audio/one.wav", "test", uint32(uid), func(c func() error) error { return c() })
	if e != nil {
		t.Fatal(e)
	}
	raw, e := json.Marshal([]string{original, view})
	if e != nil {
		t.Fatal(e)
	}
	fmt.Println(string(raw))
	_, _ = io.Copy(io.Discard, os.Stdin)
	if e = v.Release("test"); e != nil {
		t.Fatal(e)
	}
}

func TestFinderViewOnSeparateDataVolume(t *testing.T) {
	volume := os.Getenv("NIMI_TEST_FINDER_DATA_VOLUME")
	if volume == "" {
		t.Skip("requires a separate macOS data volume")
	}
	data, err := os.MkdirTemp(volume, "nimi-finder-volume-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(data); err != nil {
			t.Error(err)
		}
	})
	store, err := NewAssetStore(data, assetTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	views, err := NewFinderViews(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer closeFinderTestResource(t, views)
	owner := ManagedOwner{AccountID: "a", RegisteredAppSubject: "s"}
	store.SetRevealViews(views)
	ctx := context.Background()
	if _, err := store.Write(ctx, owner, "one.wav", "audio/wav", false, io.NopCloser(strings.NewReader("external-volume"))); err != nil {
		t.Fatal(err)
	}
	_, src, err := store.ResolveRevealTarget(ctx, owner, "one.wav")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer closeFinderTestResource(t, source)
	sid, _, err := finderStat(source)
	if err != nil {
		t.Fatal(err)
	}
	jid, _, err := finderStat(views.journal)
	if err != nil || sid.Volume == jid.Volume {
		t.Fatal("test requires different volume UUIDs", err)
	}
	_, view, err := store.PublishVerifiedReveal(ctx, owner, "one.wav", "one", 1, func(c func() error) error { return c() })
	if err != nil {
		t.Fatal(err)
	}
	a, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.Stat(view)
	if err != nil || !os.SameFile(a, b) {
		t.Fatal("data-volume view is not the pinned inode", err)
	}
	if err := views.Release("one"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(view); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("data-volume view remained after release", err)
	}
}
