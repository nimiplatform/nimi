package engine

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var ErrSupervisorPortUnavailable = errors.New("supervisor port unavailable")

// portReclaimWait bounds how long Start waits for a just-released listener
// socket to free up after stale-process cleanup before failing closed.
const portReclaimWait = 3 * time.Second

// pidFilePath resolves the supervised-engine pid file under the data-plane
// `environments` root stamped on the EngineConfig by the Manager. An empty
// SupervisedRoot returns an empty path (pid tracking is skipped) rather than
// falling back to a home-directory root. (K-CFG-018, K-LENG-004)
func (s *Supervisor) pidFilePath() string {
	root := strings.TrimSpace(s.cfg.SupervisedRoot)
	if root == "" || !filepath.IsAbs(root) {
		return ""
	}
	return filepath.Join(root, string(s.cfg.Kind), "supervised.pid")
}

func (s *Supervisor) writePIDFile() {
	pidPath := s.pidFilePath()
	metadataPath := s.pidMetadataPath()
	if pidPath == "" || metadataPath == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		s.logger.Warn("failed to create engine pid directory", "engine", s.cfg.Kind, "path", pidPath, "error", err)
		return
	}

	metadata := s.currentPIDMetadata()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(metadata.PID)), 0o644); err != nil {
		s.logger.Warn("failed to write engine pid file", "engine", s.cfg.Kind, "path", pidPath, "error", err)
		return
	}

	encodedMetadata, err := encodeSupervisorPIDMetadata(metadata)
	if err != nil {
		s.logger.Warn("failed to encode engine pid metadata", "engine", s.cfg.Kind, "path", metadataPath, "error", err)
		return
	}
	if err := os.WriteFile(metadataPath, encodedMetadata, 0o644); err != nil {
		s.logger.Warn("failed to write engine pid metadata", "engine", s.cfg.Kind, "path", metadataPath, "error", err)
	}
}

func (s *Supervisor) removePIDFile() {
	pidPath := s.pidFilePath()
	if pidPath != "" {
		_ = os.Remove(pidPath)
	}
	metadataPath := s.pidMetadataPath()
	if metadataPath != "" {
		_ = os.Remove(metadataPath)
	}
}

func (s *Supervisor) cleanStalePID() {
	pidPath := s.pidFilePath()
	metadataPath := s.pidMetadataPath()
	if pidPath == "" || metadataPath == "" {
		return
	}
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		s.removePIDFile()
		return
	}

	metadata, err := readSupervisorPIDMetadata(metadataPath)
	if err != nil {
		s.logger.Warn("supervised engine pid metadata missing or invalid; refusing stale kill",
			"engine", s.cfg.Kind,
			"pid", pid,
			"path", metadataPath,
			"error", err,
		)
		s.removePIDFile()
		return
	}
	if metadata.PID != pid {
		s.logger.Warn("supervised engine pid metadata mismatch; refusing stale kill",
			"engine", s.cfg.Kind,
			"pid", pid,
			"metadata_pid", metadata.PID,
			"path", metadataPath,
		)
		s.removePIDFile()
		return
	}

	if !supervisorProcessAlive(pid) {
		s.removePIDFile()
		return
	}

	matchesIdentity, validatedIdentity := supervisorProcessMatchesExpectedPath(pid, metadata.ExpectedExecutablePath)
	if !validatedIdentity {
		s.logger.Warn("supervised engine identity could not be validated; refusing stale kill",
			"engine", s.cfg.Kind,
			"pid", pid,
			"detail", supervisorProcessIdentityValidationDetail(pid, metadata.ExpectedExecutablePath),
		)
		s.removePIDFile()
		return
	}
	if !matchesIdentity {
		s.logger.Warn("supervised engine identity mismatch; refusing stale kill",
			"engine", s.cfg.Kind,
			"pid", pid,
			"detail", supervisorProcessIdentityValidationDetail(pid, metadata.ExpectedExecutablePath),
		)
		s.removePIDFile()
		return
	}

	s.logger.Warn("killing stale engine process",
		"engine", s.cfg.Kind,
		"pid", pid,
	)
	if err := signalSupervisorProcess(pid, syscall.SIGTERM); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGTERM)
	}
	if waitSupervisorProcessExit(nil, pid, 2*time.Second) {
		s.removePIDFile()
		return
	}
	if err := signalSupervisorProcess(pid, syscall.SIGKILL); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGKILL)
	}
	if waitSupervisorProcessExit(nil, pid, time.Second) {
		s.removePIDFile()
		return
	}
	s.logger.Warn("stale engine process remained alive after SIGKILL",
		"engine", s.cfg.Kind,
		"pid", pid,
	)
	return
}

func resolvePort(desired int) (int, error) {
	return resolvePortWithReclaim(desired, 0)
}

// resolvePortWithReclaim verifies the desired supervised-engine port is bindable,
// retrying for up to reclaimWait so a listener socket released by a process the
// supervisor just terminated has a chance to free up. It fails closed with
// ErrSupervisorPortUnavailable if the port is still occupied after the wait —
// no fallback to an alternate port, since supervised engines bind a fixed
// contract port.
func resolvePortWithReclaim(desired int, reclaimWait time.Duration) (int, error) {
	if desired <= 0 || desired > 65535 {
		return 0, fmt.Errorf("%w: configured port must be between 1 and 65535", ErrSupervisorPortUnavailable)
	}
	if portAvailable(desired) {
		return desired, nil
	}
	if reclaimWait <= 0 {
		return 0, fmt.Errorf("%w: configured port %d is unavailable", ErrSupervisorPortUnavailable, desired)
	}
	deadline := time.Now().Add(reclaimWait)
	for {
		time.Sleep(100 * time.Millisecond)
		if portAvailable(desired) {
			return desired, nil
		}
		if time.Now().After(deadline) {
			return 0, fmt.Errorf("%w: configured port %d is still in use after %s reclaim wait", ErrSupervisorPortUnavailable, desired, reclaimWait)
		}
	}
}

func portAvailable(port int) bool {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}
