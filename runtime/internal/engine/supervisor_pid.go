package engine

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
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
	reclaimStaleSupervisedProcess(s.logger, s.cfg.Kind, pidPath, metadataPath)
}

// reclaimStaleSupervisedProcesses ends engines a previous Runtime instance
// left behind under root, for every kind at once, before any engine starts.
func reclaimStaleSupervisedProcesses(logger *slog.Logger, root string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	var wg sync.WaitGroup
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pidPath := filepath.Join(root, entry.Name(), "supervised.pid")
		if _, err := os.Stat(pidPath); err != nil {
			continue
		}
		wg.Add(1)
		go func(kind EngineKind) {
			defer wg.Done()
			reclaimStaleSupervisedProcess(logger, kind, pidPath, pidPath+".meta.json")
		}(EngineKind(entry.Name()))
	}
	wg.Wait()
}

// @nimi-authority: rule.nimi.runtime.local-compute.r035
// reclaimStaleSupervisedProcess ends the process a pid record names only when
// the record proves it is that engine's process instance: same kind, same
// executable and the same kernel start time. Anything less is left alone and
// the record dropped; a pid, a parent of 1, a name or a port never suffice.
func reclaimStaleSupervisedProcess(logger *slog.Logger, kind EngineKind, pidPath string, metadataPath string) {
	removeRecord := func() {
		_ = os.Remove(pidPath)
		_ = os.Remove(metadataPath)
	}
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		removeRecord()
		return
	}
	refuse := func(message string, attrs ...any) {
		logger.Warn(message, append([]any{"engine", kind, "pid", pid}, attrs...)...)
		removeRecord()
	}

	metadata, err := readSupervisorPIDMetadata(metadataPath)
	if err != nil {
		refuse("supervised engine pid metadata missing or invalid; refusing stale kill", "path", metadataPath, "error", err)
		return
	}
	if metadata.PID != pid {
		refuse("supervised engine pid metadata mismatch; refusing stale kill", "metadata_pid", metadata.PID, "path", metadataPath)
		return
	}
	if metadata.EngineKind != kind {
		refuse("supervised engine pid record belongs to another engine; refusing stale kill", "metadata_engine", metadata.EngineKind)
		return
	}

	if !supervisorProcessAlive(pid) {
		removeRecord()
		return
	}

	matchesIdentity, validatedIdentity := supervisorProcessMatchesExpectedPath(pid, metadata.ExpectedExecutablePath)
	if !validatedIdentity {
		refuse("supervised engine identity could not be validated; refusing stale kill",
			"detail", supervisorProcessIdentityValidationDetail(pid, metadata.ExpectedExecutablePath))
		return
	}
	if !matchesIdentity {
		refuse("supervised engine identity mismatch; refusing stale kill",
			"detail", supervisorProcessIdentityValidationDetail(pid, metadata.ExpectedExecutablePath))
		return
	}
	if metadata.ProcessStartTime == "" {
		refuse("supervised engine pid record has no process instance evidence; refusing stale kill")
		return
	}
	if startTime, ok := supervisorProcessStartTime(pid); !ok || startTime != metadata.ProcessStartTime {
		refuse("supervised engine pid now names another process instance; refusing stale kill",
			"recorded_start", metadata.ProcessStartTime, "observed_start", startTime)
		return
	}

	logger.Warn("killing stale engine process",
		"engine", kind,
		"pid", pid,
	)
	if err := signalSupervisorProcess(pid, syscall.SIGTERM); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGTERM)
	}
	if waitSupervisorProcessExit(nil, pid, 2*time.Second) {
		removeRecord()
		return
	}
	if err := signalSupervisorProcess(pid, syscall.SIGKILL); err != nil {
		_ = signalSupervisorProcessDirect(pid, syscall.SIGKILL)
	}
	if waitSupervisorProcessExit(nil, pid, time.Second) {
		removeRecord()
		return
	}
	logger.Warn("stale engine process remained alive after SIGKILL",
		"engine", kind,
		"pid", pid,
	)
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
