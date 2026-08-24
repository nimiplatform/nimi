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
	"time"
)

const sourceRuntimeRealmURL = "http://127.0.0.1:3002"

var errSourceRuntimeAlreadyOwned = errors.New("another source Runtime supervisor is active for the current user")

type supervisorConfig struct {
	repoRoot        string
	runtimePath     string
	desktopPath     string
	realmURL        string
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

func run(args []string) error {
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
	defer func() { _ = ownerLock.Close() }()

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

	select {
	case outcome := <-exited:
		if outcome.err == nil {
			return errors.New("workspace source Runtime exited unexpectedly with code 0")
		}
		return fmt.Errorf("workspace source Runtime exited unexpectedly with code %d: %w", outcome.code, outcome.err)
	case <-shutdown:
		return stopOwnedRuntime(command, exited)
	case <-stdinClosed:
		return stopOwnedRuntime(command, exited)
	}
}

func parseSupervisorConfig(args []string) (supervisorConfig, error) {
	flags := flag.NewFlagSet("nimi-source-supervisor", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	repoRoot := flags.String("repo-root", "", "canonical workspace root")
	desktopPath := flags.String("desktop-executable", "", "canonical Desktop carrier executable")
	realmURL := flags.String("realm-url", sourceRuntimeRealmURL, "source Realm URL")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return supervisorConfig{}, errors.New("source Runtime supervisor accepts only --repo-root, --desktop-executable, and --realm-url")
	}
	root, err := canonicalDirectory(*repoRoot)
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve workspace root: %w", err)
	}
	desktop, err := canonicalExecutable(*desktopPath)
	if err != nil {
		return supervisorConfig{}, fmt.Errorf("resolve Desktop carrier: %w", err)
	}
	if *realmURL != sourceRuntimeRealmURL {
		return supervisorConfig{}, fmt.Errorf("source Runtime Realm URL must be %s", sourceRuntimeRealmURL)
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

func stopOwnedRuntime(command *exec.Cmd, exited <-chan runtimeExit) error {
	if command == nil || command.Process == nil {
		return nil
	}
	_ = requestRuntimeStop(command.Process)
	select {
	case <-exited:
		return nil
	case <-time.After(5 * time.Second):
		_ = command.Process.Kill()
		<-exited
		return nil
	}
}
