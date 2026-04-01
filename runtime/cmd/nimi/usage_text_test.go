package main

import (
	"io"
	"os"
	"regexp"
	"strings"
	"testing"
)

func captureStderrOutput(t *testing.T, fn func()) string {
	t.Helper()

	original := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	os.Stderr = writer

	fn()

	if closeErr := writer.Close(); closeErr != nil {
		t.Fatalf("close writer: %v", closeErr)
	}
	os.Stderr = original

	bytes, readErr := io.ReadAll(reader)
	if readErr != nil {
		t.Fatalf("read stderr: %v", readErr)
	}
	return string(bytes)
}

func TestPrintUsageUsesAppAuthCommand(t *testing.T) {
	output := captureStderrOutput(t, printUsage)
	if !strings.Contains(output, "app-auth") {
		t.Fatalf("usage should include app-auth command: %q", output)
	}
	for _, command := range []string{"doctor", "version", "provider", "run"} {
		if !strings.Contains(output, command) {
			t.Fatalf("usage should include %s command: %q", command, output)
		}
	}
	if regexp.MustCompile(`(?m)^\s+auth\s+`).MatchString(output) {
		t.Fatalf("usage should not expose auth command until account auth is implemented: %q", output)
	}
	if !strings.Contains(output, "mod") {
		t.Fatalf("usage should include mod command group: %q", output)
	}
	if !strings.Contains(output, "config") {
		t.Fatalf("usage should include config command group: %q", output)
	}
	if strings.Contains(output, "local-state") {
		t.Fatalf("usage should not expose local-state command group after hard cut: %q", output)
	}
	for _, command := range []string{
		"pnpm dlx @nimiplatform/dev-tools nimi-mod",
		"pnpm dlx @nimiplatform/dev-tools nimi-app",
	} {
		if !strings.Contains(output, command) {
			t.Fatalf("usage should include author tooling hint %s: %q", command, output)
		}
	}
	for _, command := range []string{"start", "status", "stop", "logs", "health"} {
		if !strings.Contains(output, command) {
			t.Fatalf("usage should include %s command: %q", command, output)
		}
	}
	if strings.Contains(output, "Alias for health") {
		t.Fatalf("usage should not describe status as a health alias: %q", output)
	}
	if strings.Contains(output, "|grant|") {
		t.Fatalf("usage should not include legacy grant command: %q", output)
	}
}

func TestPrintRuntimeAppAuthUsageUsesAppAuthSubcommands(t *testing.T) {
	output := captureStderrOutput(t, printRuntimeAppAuthUsage)
	if !strings.Contains(output, "nimi app-auth authorize") {
		t.Fatalf("runtime app-auth usage missing authorize command: %q", output)
	}
	if strings.Contains(output, "nimi grant authorize") {
		t.Fatalf("runtime app-auth usage should not include legacy grant command: %q", output)
	}
}

func TestPrintRuntimeModUsageIncludesInstalledManagementOnly(t *testing.T) {
	output := captureStderrOutput(t, printRuntimeModUsage)
	required := []string{
		"nimi mod list",
		"nimi mod install",
		"--mod-circle-repo",
		"--mod-circle-ref",
		"--strict-id",
		"pnpm dlx @nimiplatform/dev-tools nimi-mod create|dev|build|doctor|pack",
		"pnpm dlx @nimiplatform/dev-tools nimi-app create",
	}
	for _, command := range required {
		if !strings.Contains(output, command) {
			t.Fatalf("runtime mod usage missing %s: %q", command, output)
		}
	}
	for _, command := range []string{"nimi mod create", "nimi mod dev", "nimi mod build", "nimi mod publish"} {
		if strings.Contains(output, command) {
			t.Fatalf("runtime mod usage should not include author command %s: %q", command, output)
		}
	}
}

func TestPrintRuntimeProviderUsageIncludesSubcommands(t *testing.T) {
	output := captureStderrOutput(t, printRuntimeProviderUsage)
	required := []string{
		"nimi provider list",
		"nimi provider set <provider>",
		"--api-key",
		"--api-key-env",
		"--default-model",
		"--default",
		"nimi provider unset <provider>",
		"nimi provider test <provider>",
	}
	for _, command := range required {
		if !strings.Contains(output, command) {
			t.Fatalf("runtime provider usage missing %s: %q", command, output)
		}
	}
}

func TestPrintRuntimeConfigUsageIncludesSubcommands(t *testing.T) {
	output := captureStderrOutput(t, printRuntimeConfigUsage)
	required := []string{
		"nimi config init",
		"nimi config get",
		"nimi config set",
		"nimi config validate",
	}
	for _, command := range required {
		if !strings.Contains(output, command) {
			t.Fatalf("runtime config usage missing %s: %q", command, output)
		}
	}
	if strings.Contains(output, "nimi config migrate") {
		t.Fatalf("runtime config usage should not include legacy migrate command: %q", output)
	}
}
