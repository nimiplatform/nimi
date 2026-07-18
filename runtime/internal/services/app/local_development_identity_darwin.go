//go:build darwin

package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// localDevelopmentCanonicalProjectFileID binds project authority to the
// opened directory vnode rather than its pathname. The O_NOFOLLOW open and
// fstat happen on one descriptor; later launch preparation repeats the check,
// so path or volume replacement invalidates the authorization.
func localDevelopmentCanonicalProjectFileID(projectRoot string) (string, error) {
	fd, err := unix.Open(filepath.Clean(projectRoot), unix.O_RDONLY|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return "", errLocalDevelopmentProjectChanged
	}
	defer func() { _ = unix.Close(fd) }()

	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil || stat.Mode&unix.S_IFMT != unix.S_IFDIR || stat.Ino == 0 {
		return "", errLocalDevelopmentProjectChanged
	}
	var identity [40]byte
	binary.BigEndian.PutUint32(identity[0:4], uint32(stat.Dev))
	binary.BigEndian.PutUint64(identity[4:12], stat.Ino)
	binary.BigEndian.PutUint32(identity[12:16], stat.Gen)
	binary.BigEndian.PutUint64(identity[16:24], uint64(stat.Btim.Sec))
	binary.BigEndian.PutUint64(identity[24:32], uint64(stat.Btim.Nsec))
	binary.BigEndian.PutUint32(identity[32:36], stat.Uid)
	binary.BigEndian.PutUint32(identity[36:40], stat.Gid)
	digest := sha256.Sum256(append([]byte("nimi.macos-project-vnode-id.v1\x00"), identity[:]...))
	return "lacpf_v1_" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}
