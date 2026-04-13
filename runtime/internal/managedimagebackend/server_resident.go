package managedimagebackend

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

var managedImageBackendGOOS = runtime.GOOS
var stableDiffusionProgressPattern = regexp.MustCompile(`^\s*(\d+)\s*/\s*(\d+)\b.*s/it`)

type managedImageCommand interface {
	Start() error
	Wait() error
	Interrupt() error
	Kill() error
}

type managedImageCommandFactory func(ctx context.Context, executablePath string, args []string, workingDir string, env []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error)
type managedImageReadinessProbe func(ctx context.Context, client *http.Client, endpoint string) error
type managedImageGenerateRequester func(ctx context.Context, client *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error)

type execManagedImageCommand struct {
	cmd *exec.Cmd
}

func (c *execManagedImageCommand) Start() error {
	if c == nil || c.cmd == nil {
		return fmt.Errorf("managed image command is unavailable")
	}
	return c.cmd.Start()
}

func (c *execManagedImageCommand) Wait() error {
	if c == nil || c.cmd == nil {
		return fmt.Errorf("managed image command is unavailable")
	}
	return c.cmd.Wait()
}

func (c *execManagedImageCommand) Interrupt() error {
	if c == nil || c.cmd == nil || c.cmd.Process == nil {
		return nil
	}
	return c.cmd.Process.Signal(os.Interrupt)
}

func (c *execManagedImageCommand) Kill() error {
	if c == nil || c.cmd == nil || c.cmd.Process == nil {
		return nil
	}
	return c.cmd.Process.Kill()
}

type stableDiffusionCPPResident struct {
	fingerprint    string
	endpoint       string
	startupArgs    []string
	startupSummary string
	command        managedImageCommand
	cancel         context.CancelFunc
	logCapture     *managedImageLogCapture

	done chan struct{}

	mu      sync.RWMutex
	exited  bool
	exitErr error
}

type managedImageLogCapture struct {
	mu      sync.Mutex
	builder strings.Builder
	lines   []string
}

func streamManagedImageCommandOutput(reader io.ReadCloser, stream string, label string, capture *managedImageLogCapture, wg *sync.WaitGroup) {
	defer wg.Done()
	if reader == nil {
		return
	}
	defer reader.Close()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitManagedImageLogToken)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if capture != nil {
			capture.Append(line)
		}
		log.Printf("%s output stream=%s line=%s", defaultManagedImageString(strings.TrimSpace(label), "managed image resident"), stream, line)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("%s output read failed stream=%s error=%v", defaultManagedImageString(strings.TrimSpace(label), "managed image resident"), stream, err)
	}
}

func splitManagedImageLogToken(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		switch data[i] {
		case '\n':
			return i + 1, data[:i], nil
		case '\r':
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func stableDiffusionCPPEnvironment(executablePath string, base []string) []string {
	if managedImageBackendGOOS != "darwin" {
		return nil
	}
	executableDir := strings.TrimSpace(filepath.Dir(strings.TrimSpace(executablePath)))
	if executableDir == "" || executableDir == "." {
		return nil
	}
	env := append([]string(nil), base...)
	env = upsertPathListEnv(env, "DYLD_LIBRARY_PATH", executableDir)
	env = upsertPathListEnv(env, "DYLD_FALLBACK_LIBRARY_PATH", executableDir)
	return env
}

func upsertPathListEnv(env []string, key string, value string) []string {
	trimmedKey := strings.TrimSpace(key)
	trimmedValue := strings.TrimSpace(value)
	if trimmedKey == "" || trimmedValue == "" {
		return env
	}
	prefix := trimmedKey + "="
	for index, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			continue
		}
		current := strings.TrimSpace(strings.TrimPrefix(entry, prefix))
		env[index] = prefix + prependPathListValue(current, trimmedValue)
		return env
	}
	return append(env, prefix+trimmedValue)
}

func prependPathListValue(current string, prepend string) string {
	trimmedPrepend := strings.TrimSpace(prepend)
	if trimmedPrepend == "" {
		return strings.TrimSpace(current)
	}
	trimmedCurrent := strings.TrimSpace(current)
	if trimmedCurrent == "" {
		return trimmedPrepend
	}
	for _, candidate := range strings.Split(trimmedCurrent, string(os.PathListSeparator)) {
		if strings.TrimSpace(candidate) == trimmedPrepend {
			return trimmedCurrent
		}
	}
	return trimmedPrepend + string(os.PathListSeparator) + trimmedCurrent
}

func (c *managedImageLogCapture) Append(line string) {
	if c == nil {
		return
	}
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.builder.Len() > 0 {
		c.builder.WriteString("\n")
	}
	c.builder.WriteString(trimmed)
	c.lines = append(c.lines, trimmed)
}

func (c *managedImageLogCapture) String() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(c.builder.String())
}

func (c *managedImageLogCapture) SnapshotCursor() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.lines)
}

func (c *managedImageLogCapture) LinesSince(cursor int) ([]string, int) {
	if c == nil {
		return nil, 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if cursor < 0 {
		cursor = 0
	}
	if cursor > len(c.lines) {
		cursor = len(c.lines)
	}
	out := append([]string(nil), c.lines[cursor:]...)
	return out, len(c.lines)
}

func (r *stableDiffusionCPPResident) markExited(err error) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.exited = true
	r.exitErr = err
	r.mu.Unlock()
	close(r.done)
}

func (r *stableDiffusionCPPResident) hasExited() bool {
	if r == nil {
		return true
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.exited
}

func (r *stableDiffusionCPPResident) wait(timeout time.Duration) bool {
	if r == nil {
		return true
	}
	if timeout <= 0 {
		<-r.done
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-r.done:
		return true
	case <-timer.C:
		return false
	}
}

func (r *stableDiffusionCPPResident) stop(timeout time.Duration) error {
	if r == nil {
		return nil
	}
	if r.cancel != nil {
		r.cancel()
	}
	if r.command != nil {
		_ = r.command.Interrupt()
	}
	if r.wait(timeout) {
		return nil
	}
	if r.command != nil {
		_ = r.command.Kill()
	}
	if r.wait(timeout) {
		return nil
	}
	return fmt.Errorf("timed out stopping managed image resident process")
}

func defaultManagedImageCommandFactory(ctx context.Context, executablePath string, args []string, workingDir string, env []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error) {
	command := exec.CommandContext(ctx, executablePath, args...)
	command.Dir = workingDir
	if len(env) > 0 {
		command.Env = env
	}
	stdoutPipe, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("capture stable-diffusion.cpp stdout: %w", err)
	}
	stderrPipe, err := command.StderrPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("capture stable-diffusion.cpp stderr: %w", err)
	}
	return &execManagedImageCommand{cmd: command}, stdoutPipe, stderrPipe, nil
}

func (d *stableDiffusionCPPDriver) startResidentLocked(config stableDiffusionCPPResidentConfig, fingerprint string) (*stableDiffusionCPPResident, error) {
	if d == nil {
		return nil, fmt.Errorf("managed image backend driver unavailable")
	}
	port, err := reserveManagedImageLoopbackPort()
	if err != nil {
		return nil, err
	}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	startupArgs := stableDiffusionCPPResidentStartupArgs(config, port)
	startupSummary := stableDiffusionCPPResidentStartupSummary(config)
	env := stableDiffusionCPPEnvironment(d.serverExecutablePath, os.Environ())
	processCtx, cancel := context.WithCancel(context.Background())
	command, stdoutPipe, stderrPipe, err := d.commandFactory(processCtx, d.serverExecutablePath, startupArgs, d.workingDir, env)
	if err != nil {
		cancel()
		return nil, err
	}
	startedAt := time.Now()
	log.Printf("managed image resident process start executable=%s endpoint=%s fingerprint=%s startup_flags=%s",
		strings.TrimSpace(d.serverExecutablePath),
		endpoint,
		fingerprint,
		startupSummary,
	)
	if err := command.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start stable-diffusion.cpp resident server: %w", err)
	}
	resident := &stableDiffusionCPPResident{
		fingerprint:    fingerprint,
		endpoint:       endpoint,
		startupArgs:    append([]string(nil), startupArgs...),
		startupSummary: startupSummary,
		command:        command,
		cancel:         cancel,
		logCapture:     &managedImageLogCapture{},
		done:           make(chan struct{}),
	}
	var streamWG sync.WaitGroup
	streamWG.Add(2)
	go streamManagedImageCommandOutput(stdoutPipe, "stdout", "managed image resident", resident.logCapture, &streamWG)
	go streamManagedImageCommandOutput(stderrPipe, "stderr", "managed image resident", resident.logCapture, &streamWG)
	go func() {
		err := command.Wait()
		streamWG.Wait()
		resident.markExited(err)
		if err != nil {
			log.Printf("managed image resident process exited endpoint=%s fingerprint=%s error=%v",
				endpoint,
				fingerprint,
				err,
			)
			return
		}
		log.Printf("managed image resident process exited endpoint=%s fingerprint=%s", endpoint, fingerprint)
	}()

	readyCtx, readyCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer readyCancel()
	if err := d.readinessProbe(readyCtx, d.httpClient, endpoint); err != nil {
		_ = resident.stop(5 * time.Second)
		message := strings.TrimSpace(resident.logCapture.String())
		if message == "" {
			return nil, fmt.Errorf("wait for stable-diffusion.cpp resident server: %w", err)
		}
		return nil, fmt.Errorf("wait for stable-diffusion.cpp resident server: %w: %s", err, message)
	}
	log.Printf("managed image resident process ready endpoint=%s fingerprint=%s duration_ms=%d startup_flags=%s",
		endpoint,
		fingerprint,
		time.Since(startedAt).Milliseconds(),
		startupSummary,
	)
	return resident, nil
}

func (d *stableDiffusionCPPDriver) stopResidentLocked(reason string) error {
	if d == nil || d.resident == nil {
		return nil
	}
	resident := d.resident
	d.resident = nil
	startedAt := time.Now()
	log.Printf("managed image resident process stop endpoint=%s fingerprint=%s reason=%s",
		resident.endpoint,
		resident.fingerprint,
		defaultManagedImageString(strings.TrimSpace(reason), "unspecified"),
	)
	if err := resident.stop(5 * time.Second); err != nil {
		log.Printf("managed image resident process stop failed endpoint=%s fingerprint=%s duration_ms=%d error=%v",
			resident.endpoint,
			resident.fingerprint,
			time.Since(startedAt).Milliseconds(),
			err,
		)
		return err
	}
	log.Printf("managed image resident process stopped endpoint=%s fingerprint=%s duration_ms=%d",
		resident.endpoint,
		resident.fingerprint,
		time.Since(startedAt).Milliseconds(),
	)
	return nil
}

func reserveManagedImageLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve managed image loopback port: %w", err)
	}
	defer listener.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("resolve managed image loopback port: unexpected address type %T", listener.Addr())
	}
	return address.Port, nil
}

func defaultStableDiffusionCPPReadinessProbe(ctx context.Context, client *http.Client, endpoint string) error {
	if client == nil {
		client = &http.Client{}
	}
	target := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/v1/models"
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return fmt.Errorf("create readiness request: %w", err)
		}
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			if err != nil {
				return fmt.Errorf("probe resident readiness: %w", err)
			}
			return fmt.Errorf("probe resident readiness: status %d", resp.StatusCode)
		case <-time.After(200 * time.Millisecond):
		}
	}
}
