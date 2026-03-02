package main

import (
	"io"
	"os"
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
	if !strings.Contains(output, "mod") {
		t.Fatalf("usage should include mod command group: %q", output)
	}
	if !strings.Contains(output, "config") {
		t.Fatalf("usage should include config command group: %q", output)
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

func TestPrintRuntimeModUsageIncludesSixCommands(t *testing.T) {
	output := captureStderrOutput(t, printRuntimeModUsage)
	required := []string{
		"nimi mod list",
		"nimi mod install",
		"--mod-circle-repo",
		"--mod-circle-ref",
		"--strict-id",
		"nimi mod create",
		"nimi mod dev",
		"nimi mod build",
		"nimi mod publish",
	}
	for _, command := range required {
		if !strings.Contains(output, command) {
			t.Fatalf("runtime mod usage missing %s: %q", command, output)
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
