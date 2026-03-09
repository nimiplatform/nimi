package daemonctl

import (
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	ModeStopped    = "stopped"
	ModeBackground = "background"
	ModeExternal   = "external"
)

type Paths struct {
	LockFile     string
	PIDFile      string
	MetadataFile string
	LogFile      string
}

type Metadata struct {
	PID        int    `json:"pid"`
	Version    string `json:"version,omitempty"`
	GRPCAddr   string `json:"grpcAddr,omitempty"`
	ConfigPath string `json:"configPath,omitempty"`
	LogPath    string `json:"logPath,omitempty"`
	StartedAt  string `json:"startedAt,omitempty"`
	Mode       string `json:"mode"`
}

type Status struct {
	Mode            string `json:"mode"`
	Process         string `json:"process"`
	PID             int    `json:"pid,omitempty"`
	GRPCAddr        string `json:"grpc,omitempty"`
	ConfigPath      string `json:"config,omitempty"`
	LogPath         string `json:"logPath,omitempty"`
	StartedAt       string `json:"startedAt,omitempty"`
	HealthSummary   string `json:"healthSummary,omitempty"`
	HealthReachable bool   `json:"healthReachable"`
	HealthError     string `json:"healthError,omitempty"`
	Version         string `json:"version,omitempty"`
}

func (s Status) ExitCode() int {
	switch {
	case s.Process != "running":
		return 1
	case !s.HealthReachable:
		return 2
	default:
		return 0
	}
}

type StartResult struct {
	Mode          string `json:"mode"`
	PID           int    `json:"pid"`
	GRPCAddr      string `json:"grpc"`
	ConfigPath    string `json:"config"`
	LogPath       string `json:"logPath"`
	StartedAt     string `json:"startedAt"`
	HealthSummary string `json:"healthSummary,omitempty"`
	Version       string `json:"version,omitempty"`
	Warning       string `json:"warning,omitempty"`
}

type StopResult struct {
	AlreadyStopped bool   `json:"alreadyStopped"`
	Stopped        bool   `json:"stopped"`
	PID            int    `json:"pid,omitempty"`
	Mode           string `json:"mode,omitempty"`
}

type Manager struct {
	version        string
	resolvePaths   func() (Paths, error)
	loadConfig     func() (config.Config, error)
	executablePath func() (string, error)
	startProcess   func(executable string, logPath string) (int, error)
	probe          func(grpcAddr string, timeout time.Duration) (map[string]any, error)
	isProcessAlive func(pid int) bool
	stopProcess    func(pid int, force bool) error
	now            func() time.Time
	sleep          func(time.Duration)
	readTail       func(path string, lines int) (string, error)
	writeAtomic    func(path string, content []byte, mode os.FileMode) error
	readFile       func(path string) ([]byte, error)
	removeFile     func(path string) error
	openFile       func(path string) (*os.File, error)
	statFile       func(path string) (os.FileInfo, error)
}

func NewManager(version string) *Manager {
	return &Manager{
		version:        strings.TrimSpace(version),
		resolvePaths:   defaultPaths,
		loadConfig:     config.Load,
		executablePath: os.Executable,
		startProcess:   defaultStartProcess,
		probe:          entrypoint.FetchRuntimeHealthGRPC,
		isProcessAlive: defaultProcessAlive,
		stopProcess:    defaultStopProcess,
		now:            time.Now,
		sleep:          time.Sleep,
		readTail:       readTailLines,
		writeAtomic:    writeBytesAtomic,
		readFile:       os.ReadFile,
		removeFile: func(path string) error {
			if strings.TrimSpace(path) == "" {
				return nil
			}
			err := os.Remove(path)
			if err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		},
		openFile: func(path string) (*os.File, error) {
			return os.Open(path)
		},
		statFile: os.Stat,
	}
}

func (m *Manager) Start(timeout time.Duration) (StartResult, error) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	cfg, err := m.loadConfig()
	if err != nil {
		return StartResult{}, err
	}
	status, err := m.statusWithConfig(cfg, config.RuntimeConfigPath(), false)
	if err != nil {
		return StartResult{}, err
	}
	if status.Process == "running" {
		return StartResult{}, fmt.Errorf("runtime is already running (%s)", status.Mode)
	}

	executable, err := m.executablePath()
	if err != nil {
		return StartResult{}, fmt.Errorf("resolve nimi executable: %w", err)
	}
	if !isInstalledOrBuiltBinary(executable) {
		return StartResult{}, fmt.Errorf("nimi start requires an installed or built binary. Use 'go run ./cmd/nimi serve' for source development.")
	}

	paths, err := m.resolvePaths()
	if err != nil {
		return StartResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(paths.LogFile), 0o755); err != nil {
		return StartResult{}, fmt.Errorf("create runtime log directory: %w", err)
	}

	pid, err := m.startProcess(executable, paths.LogFile)
	if err != nil {
		return StartResult{}, err
	}

	startedAt := m.now().UTC().Format(time.RFC3339Nano)
	deadline := m.now().Add(timeout)
	for {
		payload, probeErr := m.probe(cfg.GRPCAddr, minDuration(timeout, 3*time.Second))
		if probeErr == nil {
			healthSummary := normalizeHealthSummary(payload)
			warning := ""
			if statusValue := strings.TrimSpace(fmt.Sprint(payload["status"])); statusValue != "" && statusValue != "RUNTIME_HEALTH_STATUS_READY" {
				warning = fmt.Sprintf("runtime is reachable but reported %s", statusValue)
			}
			metadata := Metadata{
				PID:        pid,
				Version:    m.version,
				GRPCAddr:   cfg.GRPCAddr,
				ConfigPath: config.RuntimeConfigPath(),
				LogPath:    paths.LogFile,
				StartedAt:  startedAt,
				Mode:       ModeBackground,
			}
			if writeErr := m.writeMetadata(paths, metadata); writeErr != nil {
				_ = m.stopProcess(pid, true)
				_ = m.cleanupStaleFiles(paths, pid)
				return StartResult{}, writeErr
			}
			return StartResult{
				Mode:          ModeBackground,
				PID:           pid,
				GRPCAddr:      cfg.GRPCAddr,
				ConfigPath:    config.RuntimeConfigPath(),
				LogPath:       paths.LogFile,
				StartedAt:     startedAt,
				HealthSummary: healthSummary,
				Version:       m.version,
				Warning:       warning,
			}, nil
		}
		if m.now().After(deadline) {
			_ = m.stopProcess(pid, true)
			_ = m.cleanupStaleFiles(paths, pid)
			tail, tailErr := m.readTail(paths.LogFile, 40)
			if tailErr != nil || strings.TrimSpace(tail) == "" {
				return StartResult{}, fmt.Errorf("runtime did not become reachable within %s", timeout)
			}
			return StartResult{}, fmt.Errorf("runtime did not become reachable within %s\n\nLast log lines:\n%s", timeout, tail)
		}
		m.sleep(150 * time.Millisecond)
	}
}

func (m *Manager) Stop(timeout time.Duration, force bool) (StopResult, error) {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	cfg, cfgErr := m.loadStatusConfig()
	if cfgErr != nil {
		cfg = defaultStatusConfig()
	}
	status, err := m.statusWithConfig(cfg, config.RuntimeConfigPath(), false)
	if err != nil {
		return StopResult{}, err
	}
	if status.Process != "running" {
		return StopResult{AlreadyStopped: true, Stopped: true}, nil
	}

	paths, err := m.resolvePaths()
	if err != nil {
		return StopResult{}, err
	}

	if err := m.stopProcess(status.PID, force); err != nil && m.isProcessAlive(status.PID) {
		return StopResult{}, err
	}
	deadline := m.now().Add(timeout)
	for m.isProcessAlive(status.PID) {
		if m.now().After(deadline) {
			if force {
				return StopResult{}, fmt.Errorf("runtime process %d did not exit after force stop", status.PID)
			}
			return StopResult{}, fmt.Errorf("runtime process %d did not exit within %s. Re-run with --force.", status.PID, timeout)
		}
		m.sleep(100 * time.Millisecond)
	}
	if err := m.cleanupStaleFiles(paths, status.PID); err != nil {
		return StopResult{}, err
	}
	return StopResult{
		AlreadyStopped: false,
		Stopped:        true,
		PID:            status.PID,
		Mode:           status.Mode,
	}, nil
}

func (m *Manager) Status() (Status, error) {
	cfg, cfgErr := m.loadStatusConfig()
	if cfgErr != nil {
		cfg = defaultStatusConfig()
	}
	return m.statusWithConfig(cfg, config.RuntimeConfigPath(), true)
}

func (m *Manager) PrintLogs(w io.Writer, tail int, follow bool) error {
	if tail <= 0 {
		tail = 200
	}
	cfg, cfgErr := m.loadStatusConfig()
	if cfgErr != nil {
		cfg = defaultStatusConfig()
	}
	status, err := m.statusWithConfig(cfg, config.RuntimeConfigPath(), false)
	if err != nil {
		return err
	}
	if status.Mode != ModeBackground {
		return fmt.Errorf("managed logs are only available for background mode. Run 'nimi start' first.")
	}
	if strings.TrimSpace(status.LogPath) == "" {
		return fmt.Errorf("managed runtime log path is unavailable")
	}

	initial, err := m.readTail(status.LogPath, tail)
	if err != nil {
		return err
	}
	if initial != "" {
		if _, err := io.WriteString(w, initial); err != nil {
			return err
		}
		if !strings.HasSuffix(initial, "\n") {
			if _, err := io.WriteString(w, "\n"); err != nil {
				return err
			}
		}
	}
	if !follow {
		return nil
	}
	return m.followLogFile(status.LogPath, w)
}

func (m *Manager) loadStatusConfig() (config.Config, error) {
	return m.loadConfig()
}

func (m *Manager) statusWithConfig(cfg config.Config, configPath string, probe bool) (Status, error) {
	paths, err := m.resolvePaths()
	if err != nil {
		return Status{}, err
	}

	lockPID, lockExists, err := m.readPID(paths.LockFile)
	if err != nil {
		return Status{}, err
	}
	lockLive := lockExists && lockPID > 0 && m.isProcessAlive(lockPID)
	if lockExists && !lockLive {
		if err := m.removeFile(paths.LockFile); err != nil {
			return Status{}, fmt.Errorf("remove stale runtime lock: %w", err)
		}
		lockExists = false
		lockPID = 0
	}

	metadata, metadataExists, err := m.loadMetadata(paths.MetadataFile)
	if err != nil {
		return Status{}, err
	}
	if metadataExists {
		metadataLive := metadata.PID > 0 && m.isProcessAlive(metadata.PID)
		if !metadataLive || !lockExists || lockPID != metadata.PID {
			if err := m.removeFile(paths.MetadataFile); err != nil {
				return Status{}, fmt.Errorf("remove stale runtime metadata: %w", err)
			}
			if err := m.removeFile(paths.PIDFile); err != nil {
				return Status{}, fmt.Errorf("remove stale runtime pid file: %w", err)
			}
			metadataExists = false
			metadata = Metadata{}
		}
	}

	if !lockExists || lockPID <= 0 {
		if err := m.removeFile(paths.PIDFile); err != nil {
			return Status{}, fmt.Errorf("remove stale runtime pid file: %w", err)
		}
		return Status{
			Mode:       ModeStopped,
			Process:    "stopped",
			GRPCAddr:   strings.TrimSpace(cfg.GRPCAddr),
			ConfigPath: configPath,
		}, nil
	}

	status := Status{
		Mode:       ModeExternal,
		Process:    "running",
		PID:        lockPID,
		GRPCAddr:   strings.TrimSpace(cfg.GRPCAddr),
		ConfigPath: configPath,
	}
	if metadataExists && metadata.PID == lockPID {
		status.Mode = ModeBackground
		status.GRPCAddr = firstNonEmptyString(strings.TrimSpace(metadata.GRPCAddr), status.GRPCAddr)
		status.ConfigPath = firstNonEmptyString(strings.TrimSpace(metadata.ConfigPath), status.ConfigPath)
		status.LogPath = strings.TrimSpace(metadata.LogPath)
		status.StartedAt = strings.TrimSpace(metadata.StartedAt)
		status.Version = strings.TrimSpace(metadata.Version)
	}

	if !probe {
		return status, nil
	}
	payload, probeErr := m.probe(status.GRPCAddr, 3*time.Second)
	if probeErr != nil {
		status.HealthReachable = false
		status.HealthSummary = "unreachable"
		status.HealthError = probeErr.Error()
		return status, nil
	}
	status.HealthReachable = true
	status.HealthSummary = normalizeHealthSummary(payload)
	return status, nil
}

func (m *Manager) followLogFile(path string, w io.Writer) error {
	file, err := m.openFile(path)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}
	offset := info.Size()
	buffer := make([]byte, 8192)

	for {
		stat, err := m.statFile(path)
		if err != nil {
			return err
		}
		size := stat.Size()
		if size < offset {
			if _, err := file.Seek(0, io.SeekStart); err != nil {
				return err
			}
			offset = 0
		}
		if size > offset {
			if _, err := file.Seek(offset, io.SeekStart); err != nil {
				return err
			}
			remaining := size - offset
			for remaining > 0 {
				readLen := len(buffer)
				if int64(readLen) > remaining {
					readLen = int(remaining)
				}
				n, readErr := file.Read(buffer[:readLen])
				if n > 0 {
					if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
						return writeErr
					}
					offset += int64(n)
					remaining -= int64(n)
				}
				if readErr != nil && readErr != io.EOF {
					return readErr
				}
				if n == 0 {
					break
				}
			}
		}
		m.sleep(250 * time.Millisecond)
	}
}

func (m *Manager) loadMetadata(path string) (Metadata, bool, error) {
	content, err := m.readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Metadata{}, false, nil
		}
		return Metadata{}, false, fmt.Errorf("read runtime metadata: %w", err)
	}
	var metadata Metadata
	if err := json.Unmarshal(content, &metadata); err != nil {
		return Metadata{}, false, fmt.Errorf("parse runtime metadata: %w", err)
	}
	return metadata, true, nil
}

func (m *Manager) writeMetadata(paths Paths, metadata Metadata) error {
	pidContent := []byte(strconv.Itoa(metadata.PID) + "\n")
	if err := m.writeAtomic(paths.PIDFile, pidContent, 0o600); err != nil {
		return fmt.Errorf("write runtime pid file: %w", err)
	}
	raw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := m.writeAtomic(paths.MetadataFile, raw, 0o600); err != nil {
		return fmt.Errorf("write runtime metadata: %w", err)
	}
	return nil
}

func (m *Manager) cleanupStaleFiles(paths Paths, pid int) error {
	if pid > 0 {
		lockPID, lockExists, err := m.readPID(paths.LockFile)
		if err != nil {
			return err
		}
		if lockExists && lockPID == pid && !m.isProcessAlive(lockPID) {
			if err := m.removeFile(paths.LockFile); err != nil {
				return err
			}
		}
	}
	if err := m.removeFile(paths.PIDFile); err != nil {
		return err
	}
	if err := m.removeFile(paths.MetadataFile); err != nil {
		return err
	}
	return nil
}

func (m *Manager) readPID(path string) (int, bool, error) {
	content, err := m.readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("read pid file %s: %w", path, err)
	}
	value := strings.TrimSpace(string(content))
	if value == "" {
		return 0, false, nil
	}
	pid, err := strconv.Atoi(value)
	if err != nil {
		return 0, false, fmt.Errorf("parse pid file %s: %w", path, err)
	}
	return pid, true, nil
}

func defaultPaths() (Paths, error) {
	lockPath, err := entrypoint.RuntimeInstanceLockPath()
	if err != nil {
		return Paths{}, err
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, fmt.Errorf("resolve user home for daemon state: %w", err)
	}
	return Paths{
		LockFile:     lockPath,
		PIDFile:      filepath.Join(homeDir, ".nimi", "runtime", "daemon.pid"),
		MetadataFile: filepath.Join(homeDir, ".nimi", "runtime", "daemon.json"),
		LogFile:      filepath.Join(homeDir, ".nimi", "logs", "runtime.log"),
	}, nil
}

func defaultStatusConfig() config.Config {
	fileCfg := config.DefaultFileConfig()
	return config.Config{
		GRPCAddr: fileCfg.GRPCAddr,
	}
}

func defaultStartProcess(executable string, logPath string) (int, error) {
	logFile, err := os.OpenFile(logPath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return 0, fmt.Errorf("open runtime log file: %w", err)
	}
	defer logFile.Close()

	cmd := exec.Command(executable, "serve")
	detachCommand(cmd)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	cmd.Env = os.Environ()

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("start background runtime: %w", err)
	}
	if cmd.Process == nil {
		return 0, fmt.Errorf("start background runtime: process handle unavailable")
	}
	return cmd.Process.Pid, nil
}

func normalizeHealthSummary(payload map[string]any) string {
	status := strings.TrimSpace(fmt.Sprint(payload["status"]))
	reason := strings.TrimSpace(fmt.Sprint(payload["reason"]))
	switch {
	case status != "" && reason != "":
		return fmt.Sprintf("%s (%s)", status, reason)
	case status != "":
		return status
	case reason != "":
		return reason
	default:
		return "reachable"
	}
}

func isInstalledOrBuiltBinary(path string) bool {
	executable := strings.TrimSpace(path)
	if executable == "" {
		return false
	}
	cleaned := filepath.Clean(executable)
	tempDir := filepath.Clean(os.TempDir())
	if strings.Contains(cleaned, string(filepath.Separator)+"go-build") {
		return false
	}
	if tempDir != "." && (cleaned == tempDir || strings.HasPrefix(cleaned, tempDir+string(filepath.Separator))) {
		return false
	}
	return true
}

func readTailLines(path string, lines int) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	parts := strings.Split(text, "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	if lines > 0 && len(parts) > lines {
		parts = parts[len(parts)-lines:]
	}
	return strings.Join(parts, "\n"), nil
}

func writeBytesAtomic(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create directory for %s: %w", path, err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func minDuration(left time.Duration, right time.Duration) time.Duration {
	if left <= 0 {
		return right
	}
	if left < right {
		return left
	}
	return right
}
