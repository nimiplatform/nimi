package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

const (
	formalAppPayloadMaxFiles = 20_000
	formalAppPayloadMaxBytes = int64(1 << 30)
)

var formalAppPayloadExcludedDirectories = map[string]struct{}{
	".git": {}, ".cache": {}, ".nimi": {}, "node_modules": {}, "target": {},
}

type localDevelopmentExecutionObservation struct {
	CanonicalProjectFileID string
	HostExecutableDigest   string
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-036b
func (s *Service) observeLocalDevelopmentExecution(project localDevelopmentProjectSnapshot) (localDevelopmentExecutionObservation, error) {
	projectFileID, err := localDevelopmentCanonicalProjectFileID(project.ProjectRoot)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	hostExecutable, err := localDevelopmentHostExecutable(project)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	hostDigest, err := localDevelopmentFileDigest(hostExecutable)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	hostRef := localDevelopmentDigestRef("host", hostDigest)
	return localDevelopmentExecutionObservation{
		CanonicalProjectFileID: projectFileID,
		HostExecutableDigest:   hostRef,
	}, nil
}

func (s *Service) registerLocalDevelopmentProject(ctx context.Context, project localDevelopmentProjectSnapshot, existingHandle string) (localappkernel.Registration, error) {
	if s == nil || s.localAppKernel == nil {
		return localappkernel.Registration{}, localappkernel.ErrNotFound
	}
	observation, err := s.observeLocalDevelopmentExecution(project)
	if err != nil {
		return localappkernel.Registration{}, err
	}
	registration, err := s.localAppKernel.Registrations().RegisterDevelopment(ctx, localappkernel.RegisterDevelopmentInput{
		ExistingRegistrationHandle: existingHandle,
		AppID:                      project.AppID, DisplayName: project.DisplayName,
		SourceRef: observation.CanonicalProjectFileID, ProjectRoot: project.ProjectRoot,
		ManifestPath: project.ManifestPath, ShellKind: int32(project.ShellKind),
		RawDeclaration:       project.RawAppAccess,
		HostExecutableDigest: observation.HostExecutableDigest,
	})
	if err != nil {
		return localappkernel.Registration{}, err
	}
	s.invalidateLocalAppSessionsForRegistration(registration, false)
	return registration, nil
}

func localDevelopmentRegistrationHandleRef(identifier protectedlocal.Identifier) string {
	return "rar_v1_" + base64.RawURLEncoding.EncodeToString(identifier[:])
}

func localDevelopmentRegistrationIdentifier(value string) (protectedlocal.Identifier, bool) {
	const prefix = "rar_v1_"
	if !strings.HasPrefix(value, prefix) {
		return protectedlocal.Identifier{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil || len(decoded) != protectedlocal.IdentifierBytes {
		return protectedlocal.Identifier{}, false
	}
	var identifier protectedlocal.Identifier
	copy(identifier[:], decoded)
	return identifier, identifier != (protectedlocal.Identifier{})
}

func localDevelopmentDigestRef(kind string, digest protectedlocal.Identifier) string {
	return "lad_v1_" + kind + "_" + base64.RawURLEncoding.EncodeToString(digest[:])
}

func localDevelopmentDigestIdentifier(kind string, value string) (protectedlocal.Identifier, error) {
	prefix := "lad_v1_" + kind + "_"
	if !strings.HasPrefix(value, prefix) {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil || len(decoded) != protectedlocal.IdentifierBytes {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	var result protectedlocal.Identifier
	copy(result[:], decoded)
	if result == (protectedlocal.Identifier{}) {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	return result, nil
}

func localDevelopmentFileDigest(path string) (protectedlocal.Identifier, error) {
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return protectedlocal.Identifier{}, err
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return protectedlocal.Identifier{}, err
	}
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result, nil
}

// formalAppImmutablePayloadDigest is package-lifecycle evidence for a formal
// immutable release. Mutable local-development registration never calls it.
func formalAppImmutablePayloadDigest(root string) (protectedlocal.Identifier, error) {
	canonical := filepath.Clean(root)
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.local-development-payload.v1\x00"))
	files := 0
	var totalBytes int64
	err := filepath.WalkDir(canonical, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == canonical {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if _, excluded := formalAppPayloadExcludedDirectories[name]; excluded {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errLocalDevelopmentProjectChanged
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errLocalDevelopmentProjectChanged
		}
		files++
		totalBytes += info.Size()
		if files > formalAppPayloadMaxFiles || totalBytes > formalAppPayloadMaxBytes {
			return errLocalDevelopmentProjectChanged
		}
		relative, err := filepath.Rel(canonical, path)
		if err != nil || strings.HasPrefix(relative, "..") {
			return errLocalDevelopmentProjectChanged
		}
		_, _ = hash.Write([]byte(filepath.ToSlash(relative)))
		_, _ = hash.Write([]byte{0})
		var size [8]byte
		binary.LittleEndian.PutUint64(size[:], uint64(info.Size()))
		_, _ = hash.Write(size[:])
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		after, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if after.Mode()&os.ModeSymlink != 0 || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
			return errLocalDevelopmentProjectUnstable
		}
		return nil
	})
	if err != nil {
		return protectedlocal.Identifier{}, err
	}
	if files == 0 {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result, nil
}
