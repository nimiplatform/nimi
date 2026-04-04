package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func runManagedImageBackend(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("managed-image-backend subcommand is required")
	}
	switch strings.ToLower(strings.TrimSpace(args[0])) {
	case "serve":
		return runManagedImageBackendServe(args[1:])
	default:
		return fmt.Errorf("unsupported managed-image-backend subcommand %q", args[0])
	}
}

func runManagedImageBackendServe(args []string) error {
	fs := flag.NewFlagSet("nimi managed-image-backend serve", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	listen := fs.String("listen", "", "managed image backend listen address")
	driver := fs.String("driver", "", "managed image backend driver")
	backendExecutable := fs.String("backend-executable", "", "managed image backend executable path")
	workingDir := fs.String("working-dir", "", "managed image backend working directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*listen) == "" {
		return fmt.Errorf("--listen is required")
	}
	if strings.TrimSpace(*driver) == "" {
		return fmt.Errorf("--driver is required")
	}
	if strings.TrimSpace(*backendExecutable) == "" {
		return fmt.Errorf("--backend-executable is required")
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected extra managed-image-backend args: %s", strings.Join(fs.Args(), " "))
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	err := managedimagebackend.RunServer(ctx, managedimagebackend.ServerConfig{
		ListenAddress:     strings.TrimSpace(*listen),
		Driver:            strings.TrimSpace(*driver),
		BackendExecutable: strings.TrimSpace(*backendExecutable),
		WorkingDir:        strings.TrimSpace(*workingDir),
	})
	if err == nil || err == context.Canceled {
		return nil
	}
	return err
}
