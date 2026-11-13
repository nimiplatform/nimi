package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/nimiplatform/nimi/runtime/internal/devenv"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeinstance"
)

const sourceRuntimeRealmURL = "https://realm.nimi.ai"

var errSourceRuntimeAlreadyOwned = errors.New("another source Runtime supervisor is active for the current user")

type supervisorConfig struct {
	repoRoot        string
	runtimePath     string
	desktopPath     string
	realmURL        string
	realmName       string
	supervisorPath  string
	runtimeBuildTag string
	runtimeCGO      string
	platformProfile string
	lockDescription string
}

type runtimeExit struct {
	err  error
	code int
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		if errors.Is(err, errSourceRuntimeNotRunning) {
			os.Exit(3)
		}
		failure := map[string]any{
			"status":     "failed",
			"reasonCode": "source-runtime-supervisor-failed",
			"actionHint": "inspect_source_runtime_supervisor_failure",
			"message":    err.Error(),
		}
		if errors.Is(err, errSourceRuntimeAlreadyOwned) {
			failure["reasonCode"] = "source-runtime-supervisor-active"
			failure["actionHint"] = "use_the_existing_dev_runtime_owner_terminal"
		}
		encoded, _ := json.Marshal(failure)
		_, _ = fmt.Fprintln(os.Stderr, string(encoded))
		os.Exit(1)
	}
}

func run(args []string) (runErr error) {
	if len(args) > 0 && args[0] == "stop" {
		return stopSourceRuntime(args[1:])
	}
	config, err := parseSupervisorConfig(args)
	if err != nil {
		return err
	}
	if err := validateSourceSupervisorPrincipal(); err != nil {
		return fmt.Errorf("validate current-user non-elevated supervisor: %w", err)
	}
	ownerLock, err := acquireSourceRuntimeOwnerLock("")
	if err != nil {
		return err
	}
	control := newSupervisorControl(ownerLock)
	defer func() { control.finish(runErr) }()

	// Reject an active installed Runtime before rebuilding the source binary.
	// The child acquires the same lease for its full lifetime; this preflight
	// alone cannot authorize startup across the intervening build.
	release, err := runtimeinstance.AcquireLock()
	if err != nil {
		return err
	}
	if err := release(); err != nil {
		return fmt.Errorf("release Runtime startup preflight: %w", err)
	}

	if err := buildSourceRuntime(config); err != nil {
		return err
	}
	if err := validateBuiltRuntime(config.runtimePath); err != nil {
		return fmt.Errorf("validate workspace source Runtime: %w", err)
	}

	command := exec.Command(config.runtimePath, "serve")
	command.Dir = filepath.Dir(config.runtimePath)
	command.Env = sourceRuntimeEnvironment(config)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	configureRuntimeCommand(command)
	if err := command.Start(); err != nil {
		return fmt.Errorf("start workspace source Runtime: %w", err)
	}

	starting := map[string]any{
		"status":            "starting",
		"topology":          "source-local-development",
		"realm":             config.realmName,
		"realmOrigin":       config.realmURL,
		"supervisorPid":     os.Getpid(),
		"runtimePid":        command.Process.Pid,
		"runtimeExecutable": config.runtimePath,
		"desktopExecutable": config.desktopPath,
		"runtimeArgv":       []string{"serve"},
		"nonElevated":       true,
		"ownerLock":         config.lockDescription,
	}
	encoded, _ := json.Marshal(starting)
	_, _ = fmt.Fprintln(os.Stdout, string(encoded))

	exited := make(chan runtimeExit, 1)
	go func() {
		err := command.Wait()
		code := 0
		if err != nil {
			var exitError *exec.ExitError
			if errors.As(err, &exitError) {
				code = exitError.ExitCode()
			} else {
				code = -1
			}
		}
		exited <- runtimeExit{err: err, code: code}
	}()

	shutdown := make(chan os.Signal, 2)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(shutdown)
	stdinClosed := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		close(stdinClosed)
	}()

	return waitForOwnedRuntimeExit(command, exited, shutdown, stdinClosed, control.requests)
}

func waitForOwnedRuntimeExit(command *exec.Cmd, exited <-chan runtimeExit, shutdown <-chan os.Signal, stdinClosed <-chan struct{}, requests <-chan bool) error {
	select {
	case outcome := <-exited:
		if outcome.err == nil {
			// Runtime can finish normally through its admitted remote stop operation.
			// The supervisor observes that exit; it neither reauthorizes nor restarts it.
			return nil
		}
		return fmt.Errorf("workspace source Runtime exited unexpectedly with code %d: %w", outcome.code, outcome.err)
	case <-shutdown:
		return stopOwnedRuntime(command, exited, shutdown, requests, false)
	case <-stdinClosed:
		return stopOwnedRuntime(command, exited, shutdown, requests, false)
	case force := <-requests:
		return stopOwnedRuntime(command, exited, shutdown, requests, force)
	}
}

func parseSupervisorConfig(args []string) (supervisorConfig, error) {
	flags := flag.NewFlagSet("nimi-source-supervisor", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	repoRoot := flags.String("repo-root", "", "canonical workspace root")
	desktopPath := flags.String("desktop-executable", "", "canonical Desktop carrier executable")
	realmURL := flags.String("realm-url", sourceRuntimeRealmURL, "source Realm URL")
	realmName := flags.String("realm", "official", "official or local Realm")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return supervisorConfig{}, errors.New("source Runtime supervisor accepts only --repo-root, --desktop-executable, --realm, and --realm-url")
	}
	root, err := canonicalDirectory(*repoRoot)
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve workspace root: %w", err)
	}
	desktop, err := canonicalExecutable(*desktopPath)
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve Desktop carrier: %w", err)
	}
	_, selected, realmErr := devenv.Resolve(func(key string) string {
		if key == "NIMI_DEV_REALM" {
			return *realmName
		}
		if key == "NIMI_DEV_REALM_URL" {
			return *realmURL
		}
		return os.Getenv(key)
	})
	if realmErr != nil {
		return supervisorConfig{}, realmErr
	}
	if selected.APIOrigin != *realmURL {
		return supervisorConfig{}, fmt.Errorf("source Runtime Realm URL does not match selected environment")
	}
	supervisor, err := os.Executable()
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve supervisor executable: %w", err)
	}
	supervisor, err = canonicalExecutable(supervisor)
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve canonical supervisor executable: %w", err)
	}

	config := supervisorConfig{
		repoRoot:        root,
		desktopPath:     desktop,
		realmURL:        *realmURL,
		realmName:       *realmName,
		supervisorPath:  supervisor,
		platformProfile: runtime.GOOS,
	}
	switch runtime.GOOS {
	case "windows":
		if runtime.GOARCH != "amd64" {
			return supervisorConfig{}, fmt.Errorf("Windows source Runtime is not admitted for %s", runtime.GOARCH)
		}
		config.runtimePath = filepath.Join(root, ".nimi", "local", "imp6", "runtime-local-development", "nimi.exe")
		config.runtimeBuildTag = "nimi_windows_source_local_development"
		config.runtimeCGO = "0"
		config.lockDescription = "current-user-named-pipe"
	case "darwin":
		if runtime.GOARCH != "arm64" {
			return supervisorConfig{}, fmt.Errorf("macOS source Runtime is not admitted for %s", runtime.GOARCH)
		}
		config.runtimePath = filepath.Join(root, ".nimi", "local", "imp3", "runtime-local-development", "nimi-runtime")
		config.runtimeBuildTag = "nimi_macos_source_local_development"
		config.runtimeCGO = "1"
		config.lockDescription = "current-user-file-lock"
	default:
		return supervisorConfig{}, fmt.Errorf("source Runtime supervisor is unavailable on %s", runtime.GOOS)
	}
	return config, nil
}

func buildSourceRuntime(config supervisorConfig) error {
	if err := os.MkdirAll(filepath.Dir(config.runtimePath), 0o700); err != nil {
		return fmt.Errorf("create workspace Runtime output directory: %w", err)
	}
	command := exec.Command("go", "build", "-tags", config.runtimeBuildTag, "-o", config.runtimePath, "./cmd/nimi")
	command.Dir = filepath.Join(config.repoRoot, "runtime")
	command.Env = replaceEnvironment(os.Environ(), "CGO_ENABLED", config.runtimeCGO)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("build workspace source Runtime: %w", err)
	}
	return nil
}

func sourceRuntimeEnvironment(config supervisorConfig) []string {
	environment := replaceEnvironment(os.Environ(), "NIMI_REALM_URL", config.realmURL)
	environment = replaceEnvironment(environment, "NIMI_DEV_REALM", config.realmName)
	environment = replaceEnvironment(environment, "NIMI_DEV_REALM_URL", config.realmURL)
	environment = replaceEnvironment(environment, "NIMI_SOURCE_RUNTIME_REPO_ROOT", config.repoRoot)
	switch config.platformProfile {
	case "windows":
		environment = replaceEnvironment(environment, "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT", "1")
		environment = replaceEnvironment(environment, "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE", config.runtimePath)
		environment = replaceEnvironment(environment, "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE", config.desktopPath)
		environment = replaceEnvironment(environment, "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_SUPERVISOR_EXECUTABLE", config.supervisorPath)
	case "darwin":
		environment = replaceEnvironment(environment, "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT", "1")
		environment = replaceEnvironment(environment, "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE", config.runtimePath)
		environment = replaceEnvironment(environment, "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE", config.desktopPath)
		environment = replaceEnvironment(environment, "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_SUPERVISOR_EXECUTABLE", config.supervisorPath)
	}
	return environment
}

func replaceEnvironment(environment []string, name, value string) []string {
	prefix := strings.ToUpper(name) + "="
	result := make([]string, 0, len(environment)+1)
	for _, entry := range environment {
		if strings.HasPrefix(strings.ToUpper(entry), prefix) {
			continue
		}
		result = append(result, entry)
	}
	return append(result, name+"="+value)
}

func canonicalDirectory(path string) (string, error) {
	if path == "" || strings.TrimSpace(path) != path || !filepath.IsAbs(path) {
		return "", errors.New("exact absolute directory is required")
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.IsDir() {
		return "", errors.New("canonical directory is unavailable")
	}
	return filepath.Clean(canonical), nil
}

func canonicalExecutable(path string) (string, error) {
	if path == "" || strings.TrimSpace(path) != path || !filepath.IsAbs(path) {
		return "", errors.New("exact absolute executable is required")
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("canonical executable is unavailable")
	}
	return filepath.Clean(canonical), nil
}

func validateBuiltRuntime(path string) error {
	canonical, err := canonicalExecutable(path)
	if err != nil {
		return err
	}
	if !samePlatformPath(canonical, path) {
		return errors.New("workspace Runtime output is not canonical")
	}
	return nil
}

func samePlatformPath(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

// The Runtime bounds its own shutdown by its configured timeout and stops its
// engines within it; the supervisor never cuts that short. Another interrupt
// from the developer forces the stop.
func stopOwnedRuntime(command *exec.Cmd, exited <-chan runtimeExit, force <-chan os.Signal, requests <-chan bool, forceStop bool) error {
	if command == nil || command.Process == nil {
		return nil
	}
	var err error
	if forceStop {
		err = command.Process.Kill()
	} else {
		err = requestRuntimeStop(command.Process)
	}
	if err != nil {
		// Retain ownership until Wait observes an exit, even if the OS could
		// not deliver the stop. The caller can time out or request --force.
		_, _ = fmt.Fprintf(os.Stderr, "request owned Runtime shutdown: %v\n", err)
	}
	for {
		select {
		case <-exited:
			return nil
		case <-force:
			_ = command.Process.Kill()
			<-exited
			return nil
		case requestedForce := <-requests:
			if requestedForce {
				_ = command.Process.Kill()
				<-exited
				return nil
			}
		}
	}
}
