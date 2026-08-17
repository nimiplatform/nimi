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

func TestPrintUsageOmitsPublicAppAuthCommand(t *testing.T) {
	output := captureStderrOutput(t, printUsage)
	for _, heading := range []string{"Quick Start:", "Runtime Operations:", "Advanced/Admin:", "Author tooling:"} {
		if !strings.Contains(output, heading) {
			t.Fatalf("usage should include %s heading: %q", heading, output)
		}
	}
	if strings.Contains(output, "app-auth") {
		t.Fatalf("usage must not expose public app-auth command: %q", output)
	}
	for _, command := range []string{"doctor", "version"} {
		if !strings.Contains(output, command) {
			t.Fatalf("usage should include %s command: %q", command, output)
		}
	}
	for _, retired := range []string{"run         Generate", "chat", "Advanced AI operations", "nimi ai"} {
		if strings.Contains(output, retired) {
			t.Fatalf("usage must not expose retired generation command %q: %q", retired, output)
		}
	}
	if regexp.MustCompile(`(?m)^\s+auth\s+`).MatchString(output) {
		t.Fatalf("usage should not expose auth command until account auth is implemented: %q", output)
	}
	if regexp.MustCompile(`(?m)^\s+mod\s+`).MatchString(output) {
		t.Fatalf("usage should not expose retired mod command group: %q", output)
	}
	for _, protectedCommand := range []string{"model", "provider", "providers"} {
		if regexp.MustCompile(`(?m)^\s+` + regexp.QuoteMeta(protectedCommand) + `\s+`).MatchString(output) {
			t.Fatalf("usage must not expose protected %s command group: %q", protectedCommand, output)
		}
	}
	for _, protectedHeading := range []string{"Asset Management:", "Connector Custody:"} {
		if strings.Contains(output, protectedHeading) {
			t.Fatalf("usage must not expose protected product group %q: %q", protectedHeading, output)
		}
	}
	if !strings.Contains(output, "config") {
		t.Fatalf("usage should include config command group: %q", output)
	}
	if strings.Contains(output, "local-state") {
		t.Fatalf("usage should not expose local-state command group after hard cut: %q", output)
	}
	for _, command := range []string{
		"pnpm dlx @nimiplatform/app-tools nimi-app",
	} {
		if !strings.Contains(output, command) {
			t.Fatalf("usage should include author tooling hint %s: %q", command, output)
		}
	}
	if strings.Contains(output, "pnpm dlx @nimiplatform/app-tools retired-authoring") {
		t.Fatalf("usage should not expose removed mod author tooling: %q", output)
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
