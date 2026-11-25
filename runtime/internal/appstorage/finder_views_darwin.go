//go:build darwin && cgo

package appstorage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

// The private journal is independent of the selected data volume. It is
// synced before granting access and recovered before accepting another
// protected session. No renderer-supplied path or uid reaches this owner.
type FinderViews struct {
	mu        sync.Mutex
	journal   *os.File
	sessions  map[string]*finderView
	views     map[*finderView]struct{}
	closed    bool
	recovered bool
}
type finderViewKey struct {
	File finderIdentity
	UID  uint32
}
type finderRecord struct {
	Key       finderViewKey
	Base      finderIdentity
	Directory finderIdentity
	Path      string
	Source    string
	AddRead   bool
}
type finderView struct {
	record          finderRecord
	base, dir, file *os.File
	active          bool
}

func openFinderItem(path string, flags int) (*os.File, error) {
	fd, err := unix.Open(path, flags|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

// Recovered reports that launchd's journal activation was serviced. An
// already pending Desktop socket remains queued for the next activation.
func (v *FinderViews) Recovered() bool { return v.recovered }

func NewFinderViews(stateRoot string) (*FinderViews, error) {
	if !filepath.IsAbs(stateRoot) {
		return nil, ErrAssetUnavailable
	}
	path := filepath.Join(stateRoot, "finder-reveal-journal")
	if err := os.Mkdir(path, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	dir, err := openFinderItem(path, unix.O_RDONLY|unix.O_DIRECTORY)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = dir.Close()
		}
	}()
	_, st, err := finderStat(dir)
	if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0o777 != 0o700 {
		return nil, ErrAssetUnavailable
	}
	if err := unix.Flock(int(dir.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return nil, fmt.Errorf("lock Finder recovery journal: %w", err)
	}
	v := &FinderViews{journal: dir, sessions: make(map[string]*finderView), views: make(map[*finderView]struct{})}
	items, err := dir.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	v.recovered = len(items) != 0
	for _, item := range items {
		if strings.HasPrefix(item.Name(), ".base-") && item.IsDir() {
			if err := unix.Unlinkat(int(dir.Fd()), item.Name(), unix.AT_REMOVEDIR); err != nil {
				return nil, err
			}
			continue
		}
		if !item.Type().IsRegular() {
			return nil, ErrAssetUnavailable
		}
		if strings.HasPrefix(item.Name(), ".prepare-") {
			if err := os.Remove(filepath.Join(path, item.Name())); err != nil {
				return nil, err
			}
			continue
		}
		var record finderRecord
		raw, err := os.ReadFile(filepath.Join(path, item.Name()))
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		if record.Key.UID == 0 || !filepath.IsAbs(record.Source) || !filepath.IsAbs(record.Path) || item.Name() != filepath.Base(record.Path)+".json" || !strings.HasPrefix(filepath.Base(record.Path), "Nimi Finder ") {
			return nil, ErrAssetUnavailable
		}
		if err := v.recover(record); err != nil {
			return nil, fmt.Errorf("recover Finder view: %w", err)
		}
	}
	ok = true
	return v, nil
}

func (v *FinderViews) writeRecord(r finderRecord) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(v.journal.Name(), ".prepare-")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	_, err = tmp.Write(raw)
	if err == nil {
		err = tmp.Sync()
	}
	if err = errors.Join(err, tmp.Close()); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), v.recordPath(r)); err != nil {
		return err
	}
	return v.journal.Sync()
}
func (v *FinderViews) recordPath(r finderRecord) string {
	return filepath.Join(v.journal.Name(), filepath.Base(r.Path)+".json")
}
func (v *FinderViews) forget(r finderRecord) error {
	if err := os.Remove(v.recordPath(r)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return v.journal.Sync()
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-027b
func (v *FinderViews) publish(session string, uid uint32, dataRoot string, source *os.File) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed || uid == 0 || session == "" {
		return "", ErrAssetUnavailable
	}
	id, st, err := finderStat(source)
	if err != nil {
		return "", err
	}
	if st.Mode&unix.S_IFMT != unix.S_IFREG {
		return "", ErrAssetCorrupt
	}
	for pending := range v.views {
		if !pending.active {
			if err := v.discard(pending); err != nil {
				return "", err
			}
		}
	}
	key := finderViewKey{id, uid}
	if current := v.sessions[session]; current != nil && current.record.Key == key && current.record.Source == source.Name() {
		if err := current.verifyName(); err != nil {
			return "", errors.Join(err, v.discard(current))
		}
		return current.target(), nil
	}
	if err := v.release(session); err != nil {
		return "", err
	}
	if st.Uid != uint32(os.Geteuid()) || st.Mode&0o077 != 0 {
		return "", ErrAssetUnavailable
	}
	linkedViews := 0
	addRead := false
	for existing := range v.views {
		if existing.record.Key.File != id {
			continue
		}
		if existing.record.Key != key || existing.record.Source != source.Name() {
			return "", ErrAssetCorrupt
		}
		linkedViews++
		addRead = existing.record.AddRead
	}
	if int(st.Nlink) != linkedViews+1 {
		return "", ErrAssetCorrupt
	}
	if err := checkFinderMutationACL(source, uid); err != nil {
		return "", err
	}
	if linkedViews == 0 {
		hasRead, err := finderReadACE(source, uid, 0)
		if err != nil {
			return "", err
		}
		addRead = !hasRead
	}
	base, err := v.openBase(dataRoot, source, id)
	if err != nil {
		return "", err
	}
	keep := false
	defer func() {
		if !keep {
			_ = base.Close()
		}
	}()
	bid, _, err := finderStat(base)
	if err != nil {
		return "", err
	}
	nonce, err := finderNonce()
	if err != nil {
		return "", err
	}
	child := "Nimi Finder " + nonce
	if err = unix.Mkdirat(int(base.Fd()), child, 0o700); err != nil {
		return "", err
	}
	defer func() {
		if !keep {
			_ = unix.Unlinkat(int(base.Fd()), child, unix.AT_REMOVEDIR)
		}
	}()
	dir, err := openFinderDirectoryAt(base, child)
	if err != nil {
		return "", err
	}
	defer func() {
		if !keep {
			_ = dir.Close()
		}
	}()
	did, ds, err := finderStat(dir)
	if err != nil || ds.Uid != uint32(os.Geteuid()) || ds.Mode&0o777 != 0o700 {
		return "", ErrAssetUnavailable
	}
	r := finderRecord{Key: key, Base: bid, Directory: did, Path: dir.Name(), Source: source.Name(), AddRead: addRead}
	if err = base.Sync(); err != nil {
		return "", err
	}
	if err = v.writeRecord(r); err != nil {
		return "", err
	}
	// Duplicate the verified descriptor, not a second open of a pathname.
	fd, err := unix.FcntlInt(source.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return "", errors.Join(err, v.forget(r))
	}
	file := os.NewFile(uintptr(fd), source.Name())
	view := &finderView{record: r, base: base, dir: dir, file: file}
	keep = true
	v.views[view] = struct{}{}
	name := filepath.Base(r.Source)
	err = unix.Linkat(unix.AT_FDCWD, r.Source, int(dir.Fd()), name, 0)
	if err == nil {
		var link unix.Stat_t
		err = unix.Fstatat(int(dir.Fd()), name, &link, unix.AT_SYMLINK_NOFOLLOW)
		if err == nil && (link.Dev != st.Dev || link.Ino != st.Ino || link.Mode&unix.S_IFMT != unix.S_IFREG || int(link.Nlink) != linkedViews+2) {
			err = ErrAssetCorrupt
		}
	}
	if err == nil {
		err = dir.Sync()
	}
	if err == nil && r.AddRead && linkedViews == 0 {
		_, err = finderReadACE(file, uid, 1)
	}
	if err == nil {
		err = setFinderDirectory(dir, uid)
	}
	if err == nil {
		err = view.verifyName()
	}
	if err != nil {
		return "", errors.Join(err, v.discard(view))
	}
	view.active = true
	v.sessions[session] = view
	return view.target(), nil
}
func (v *finderView) target() string {
	return filepath.Join(v.record.Path, filepath.Base(v.record.Source))
}
func (v *finderView) verifyName() error {
	a, e := v.file.Stat()
	if e != nil {
		return e
	}
	b, e := os.Lstat(v.target())
	if e != nil {
		return e
	}
	if !os.SameFile(a, b) {
		return ErrAssetCorrupt
	}
	return nil
}
func (v *FinderViews) Release(session string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.release(session)
}
func (v *FinderViews) release(session string) error {
	x := v.sessions[session]
	if x == nil {
		return nil
	}
	delete(v.sessions, session)
	return v.discard(x)
}
func (v *FinderViews) invalidate(path string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	var failure error
	for x := range v.views {
		if x.record.Source == path {
			failure = errors.Join(failure, v.discard(x))
		}
	}
	return failure
}
func (v *FinderViews) Close() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return nil
	}
	v.closed = true
	var failure error
	for x := range v.views {
		failure = errors.Join(failure, v.discard(x))
	}
	return errors.Join(failure, v.journal.Close())
}
func (v *FinderViews) discard(x *finderView) error {
	for k, entry := range v.sessions {
		if entry == x {
			delete(v.sessions, k)
		}
	}
	x.active = false
	if err := v.revoke(x); err != nil {
		return err
	}
	delete(v.views, x)
	return errors.Join(x.dir.Close(), x.file.Close(), x.base.Close())
}
func (v *FinderViews) revoke(x *finderView) error {
	// Kill the visible pathname and the file permission independently. Keep
	// the private record and descriptor on any error, so cleanup can retry.
	dirErr := setFinderDirectory(x.dir, 0)
	var fileErr error
	last := true
	for other := range v.views {
		if other.active && other.record.Key == x.record.Key {
			last = false
			break
		}
	}
	if last && x.record.AddRead {
		_, fileErr = finderReadACE(x.file, x.record.Key.UID, -1)
	}
	unlinkErr := unix.Unlinkat(int(x.dir.Fd()), filepath.Base(x.record.Source), 0)
	if errors.Is(unlinkErr, unix.ENOENT) {
		unlinkErr = nil
	}
	if err := errors.Join(dirErr, fileErr, unlinkErr, x.file.Sync(), x.dir.Sync()); err != nil {
		return err
	}
	if err := unix.Unlinkat(int(x.base.Fd()), filepath.Base(x.record.Path), unix.AT_REMOVEDIR); err != nil && !errors.Is(err, unix.ENOENT) {
		return err
	}
	if err := x.base.Sync(); err != nil {
		return err
	}
	return v.forget(x.record)
}
func (v *FinderViews) recover(r finderRecord) error {
	base, e := v.recordedBase(r)
	if e != nil {
		return e
	}
	defer func() { _ = base.Close() }()
	if e = validateFinderBase(base, r.Key.File.Volume); e != nil {
		return e
	}
	dir, e := openFinderDirectoryAt(base, filepath.Base(r.Path))
	if e != nil && !errors.Is(e, unix.ENOENT) {
		return e
	}
	var f *os.File
	if dir != nil {
		defer func() { _ = dir.Close() }()
		id, _, err := finderStat(dir)
		if err != nil || id != r.Directory {
			return ErrAssetCorrupt
		}
		if err = setFinderDirectory(dir, 0); err != nil {
			return err
		}
		fd, err := unix.Openat(int(dir.Fd()), filepath.Base(r.Source), unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
		if err != nil && !errors.Is(err, unix.ENOENT) {
			return err
		}
		if err == nil {
			f = os.NewFile(uintptr(fd), r.Source)
		}
	}
	if f == nil {
		f, e = openFinderItem(r.Source, unix.O_RDONLY)
		if e != nil {
			return e
		}
	}
	defer func() { _ = f.Close() }()
	id, st, e := finderStat(f)
	if e != nil || id != r.Key.File || st.Uid != uint32(os.Geteuid()) {
		return ErrAssetCorrupt
	}
	if r.AddRead {
		if _, e = finderReadACE(f, r.Key.UID, -1); e != nil {
			return e
		}
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if dir != nil {
		if e = unix.Unlinkat(int(dir.Fd()), filepath.Base(r.Source), 0); e != nil && !errors.Is(e, unix.ENOENT) {
			return e
		}
		if e = dir.Sync(); e != nil {
			return e
		}
		if e = unix.Unlinkat(int(base.Fd()), filepath.Base(r.Path), unix.AT_REMOVEDIR); e != nil {
			return e
		}
		if e = base.Sync(); e != nil {
			return e
		}
	}
	return v.forget(r)
}

func (v *FinderViews) recordedBase(r finderRecord) (*os.File, error) {
	open := func(path string) (*os.File, error) {
		f, err := openFinderItem(path, unix.O_RDONLY|unix.O_DIRECTORY)
		if err != nil {
			return nil, err
		}
		id, _, err := finderStat(f)
		if err == nil && id == r.Base {
			return f, nil
		}
		return nil, errors.Join(ErrAssetCorrupt, f.Close())
	}
	if base, err := open(filepath.Dir(r.Path)); err == nil {
		return base, nil
	}
	for _, name := range []string{v.journal.Name(), filepath.Dir(filepath.Dir(r.Path)), filepath.Dir(r.Source)} {
		volume, err := openFinderItem(name, unix.O_RDONLY|unix.O_DIRECTORY)
		if err != nil {
			continue
		}
		id, _, err := finderStat(volume)
		if err == nil && id.Volume == r.Base.Volume {
			path, err := recordedFinderPath(volume, r.Base)
			_ = volume.Close()
			if err == nil {
				return open(path)
			}
		} else {
			_ = volume.Close()
		}
	}
	return nil, ErrAssetUnavailable
}
