package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunRuntimeModListJSON(t *testing.T) {
	modsDir := t.TempDir()
	createTestModProject(t, filepath.Join(modsDir, "alpha-mod"), "world.nimi.alpha", "Alpha Mod")
	createTestModProject(t, filepath.Join(modsDir, "beta-mod"), "world.nimi.beta", "Beta Mod")
	metadata := modInstallMetadata{
		Source:      "github:someuser/beta-mod",
		InstalledAt: "2026-02-24T12:00:00Z",
		Verified:    true,
	}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	if err := os.WriteFile(filepath.Join(modsDir, "beta-mod", ".nimi-install.json"), metadataRaw, 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeMod([]string{"list", "--mods-dir", modsDir, "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeMod list: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal output: %v output=%q", unmarshalErr, output)
	}
	mods, ok := payload["mods"].([]any)
	if !ok {
		t.Fatalf("mods payload type mismatch: %#v", payload["mods"])
	}
	if len(mods) != 2 {
		t.Fatalf("mods length mismatch: got=%d want=2", len(mods))
	}
	foundVerified := false
	for _, item := range mods {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if asString(record["mod_id"]) == "world.nimi.beta" && record["verified"] == true {
			foundVerified = true
			break
		}
	}
	if !foundVerified {
		t.Fatalf("expected verified mod metadata in list output: %s", output)
	}
}

func TestResolveModsDirPrefersFlagValue(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_MODS_DIR", filepath.Join(t.TempDir(), "env-mods"))
	flagModsDir := filepath.Join(t.TempDir(), "flag-mods")

	got, err := resolveModsDir(flagModsDir)
	if err != nil {
		t.Fatalf("resolveModsDir should accept explicit --mods-dir: %v", err)
	}
	if got != filepath.Clean(flagModsDir) {
		t.Fatalf("resolveModsDir mismatch: got=%q want=%q", got, filepath.Clean(flagModsDir))
	}
}

func TestResolveModsDirFallsBackToRuntimeEnv(t *testing.T) {
	envModsDir := filepath.Join(t.TempDir(), "runtime-env-mods")
	t.Setenv("NIMI_RUNTIME_MODS_DIR", envModsDir)

	got, err := resolveModsDir("")
	if err != nil {
		t.Fatalf("resolveModsDir should accept NIMI_RUNTIME_MODS_DIR: %v", err)
	}
	if got != filepath.Clean(envModsDir) {
		t.Fatalf("resolveModsDir env fallback mismatch: got=%q want=%q", got, filepath.Clean(envModsDir))
	}
}

func TestResolveModsDirRequiresExplicitInput(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_MODS_DIR", "")

	_, err := resolveModsDir("")
	if err == nil {
		t.Fatalf("resolveModsDir should fail when neither --mods-dir nor NIMI_RUNTIME_MODS_DIR is set")
	}
	if !strings.Contains(err.Error(), "MODS_DIR_REQUIRED") {
		t.Fatalf("resolveModsDir error should include MODS_DIR_REQUIRED, got=%v", err)
	}
}

func TestRunRuntimeModAuthorCommandsMovedToNimiMod(t *testing.T) {
	for _, command := range []string{"create", "dev", "build", "publish"} {
		err := runRuntimeMod([]string{command})
		if err == nil {
			t.Fatalf("expected moved error for %s", command)
		}
		if !strings.Contains(err.Error(), "AUTHOR_COMMAND_MOVED") {
			t.Fatalf("missing moved reason code for %s: %v", command, err)
		}
		if !strings.Contains(err.Error(), "use_nimi-mod_"+command) {
			t.Fatalf("missing nimi-mod hint for %s: %v", command, err)
		}
	}
}

func TestRunRuntimeModInstallJSON(t *testing.T) {
	sourceDir := filepath.Join(t.TempDir(), "source-mod")
	createTestModProject(t, sourceDir, "world.nimi.source", "Source Mod")
	modsDir := filepath.Join(t.TempDir(), "installed")

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeMod([]string{
			"install",
			sourceDir,
			"--mods-dir", modsDir,
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeMod install: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal install output: %v output=%q", unmarshalErr, output)
	}
	targetDir := asString(payload["target_dir"])
	if targetDir == "" {
		t.Fatalf("target_dir missing: %s", output)
	}
	if _, statErr := os.Stat(targetDir); statErr != nil {
		t.Fatalf("target dir missing: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(targetDir, ".nimi-install.json")); statErr != nil {
		t.Fatalf("install metadata missing: %v", statErr)
	}
}

func TestRunRuntimeModInstallRejectsLegacyManifestCapability(t *testing.T) {
	sourceDir := filepath.Join(t.TempDir(), "legacy-install")
	modsDir := filepath.Join(t.TempDir(), "installed")
	createLegacyTestModProject(t, sourceDir, "world.nimi.legacy-install", "Legacy Install Mod")

	err := runRuntimeMod([]string{
		"install",
		sourceDir,
		"--mods-dir", modsDir,
	})
	if err == nil {
		t.Fatalf("expected legacy manifest capability reject on install")
	}
	if !strings.Contains(err.Error(), "MOD_MANIFEST_LEGACY_CAPABILITY_UNSUPPORTED") {
		t.Fatalf("missing legacy capability reason code: %v", err)
	}
}

func TestRunRuntimeModInstallFromGitHubTarball(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "ghp_install_token")
	modsDir := filepath.Join(t.TempDir(), "installed")
	tarball := buildGitHubTarball(t, map[string]string{
		"mods/math-quiz/mod.manifest.yaml": strings.Join([]string{
			"id: world.nimi.math-quiz",
			"name: Math Quiz",
			"version: 0.1.0",
			"description: generated",
			"entry: ./dist/index.js",
			"license: MIT",
			"capabilities:",
			"  - runtime.ai.text.generate",
			"",
		}, "\n"),
		"mods/math-quiz/src/index.ts": "export const value = 1;\n",
	})

	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/repos/someuser/nimi-mod-math/tarball" {
			receivedAuth = request.Header.Get("Authorization")
			writer.Header().Set("Content-Type", "application/x-gzip")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(tarball)
			return
		}
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"message":"not found"}`))
	}))
	defer server.Close()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeMod([]string{
			"install",
			"github:someuser/nimi-mod-math/mods/math-quiz",
			"--mods-dir", modsDir,
			"--api-base", server.URL,
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeMod install github: %v", err)
	}
	if receivedAuth != "Bearer ghp_install_token" {
		t.Fatalf("install should forward github token, got=%q", receivedAuth)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal install output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["source"]) != "github:someuser/nimi-mod-math/mods/math-quiz" {
		t.Fatalf("normalized source mismatch: %#v", payload["source"])
	}
	targetDir := asString(payload["target_dir"])
	if targetDir == "" {
		t.Fatalf("target_dir missing: %s", output)
	}
	manifestRaw, readErr := os.ReadFile(filepath.Join(targetDir, "mod.manifest.yaml"))
	if readErr != nil {
		t.Fatalf("read installed manifest: %v", readErr)
	}
	if !strings.Contains(string(manifestRaw), "id: world.nimi.math-quiz") {
		t.Fatalf("manifest content mismatch: %s", string(manifestRaw))
	}
}

func TestRunRuntimeModInstallGitHubRequiresSubpathWhenMultipleManifests(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	tarball := buildGitHubTarball(t, map[string]string{
		"mods/a/mod.manifest.yaml": "id: world.nimi.a\nname: A\nversion: 0.1.0\nentry: ./dist/index.js\nlicense: MIT\n",
		"mods/a/src/index.ts":      "export const a = 1;\n",
		"mods/b/mod.manifest.yaml": "id: world.nimi.b\nname: B\nversion: 0.1.0\nentry: ./dist/index.js\nlicense: MIT\n",
		"mods/b/src/index.ts":      "export const b = 1;\n",
	})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/repos/someuser/nimi-mod-pack/tarball" {
			writer.Header().Set("Content-Type", "application/x-gzip")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(tarball)
			return
		}
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"message":"not found"}`))
	}))
	defer server.Close()

	err := runRuntimeMod([]string{
		"install",
		"github:someuser/nimi-mod-pack",
		"--mods-dir", modsDir,
		"--api-base", server.URL,
	})
	if err == nil {
		t.Fatalf("expected multiple manifests error")
	}
	if !strings.Contains(err.Error(), "MOD_INSTALL_MULTIPLE_MANIFESTS_FOUND") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunRuntimeModInstallFromModCircleByID(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	tarball := buildGitHubTarball(t, map[string]string{
		"mods/tarot/mod.manifest.yaml": strings.Join([]string{
			"id: world.nimi.community-tarot",
			"name: Community Tarot",
			"version: 0.1.0",
			"description: tarot mod",
			"entry: ./dist/index.js",
			"license: MIT",
			"",
		}, "\n"),
		"mods/tarot/src/index.ts": "export const tarot = true;\n",
	})
	entryJSON := `{"id":"world.nimi.community-tarot","name":"Tarot Reading","repo":"github:someuser/nimi-mod-tarot/mods/tarot","verified":true}`
	entryContent := base64.StdEncoding.EncodeToString([]byte(entryJSON))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods":
			if request.URL.Query().Get("ref") != "main" {
				writer.WriteHeader(http.StatusBadRequest)
				_, _ = writer.Write([]byte(`{"message":"missing ref"}`))
				return
			}
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`[{"name":"community-tarot.json","path":"mods/community-tarot.json","type":"file"}]`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/community-tarot.json":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"community-tarot.json","path":"mods/community-tarot.json","encoding":"base64","content":"` + entryContent + `"}`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/someuser/nimi-mod-tarot/tarball":
			writer.Header().Set("Content-Type", "application/x-gzip")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(tarball)
			return
		default:
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"message":"not found"}`))
			return
		}
	}))
	defer server.Close()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeMod([]string{
			"install",
			"mod-circle:world.nimi.community-tarot",
			"--mods-dir", modsDir,
			"--api-base", server.URL,
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeMod install mod-circle: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal install output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["source"]) != "mod-circle:world.nimi.community-tarot" {
		t.Fatalf("source mismatch: %#v", payload["source"])
	}
	if payload["verified"] != true {
		t.Fatalf("verified should be true: %#v", payload["verified"])
	}
	targetDir := asString(payload["target_dir"])
	if targetDir == "" {
		t.Fatalf("target_dir missing: %s", output)
	}
	metadataRaw, readErr := os.ReadFile(filepath.Join(targetDir, ".nimi-install.json"))
	if readErr != nil {
		t.Fatalf("read metadata: %v", readErr)
	}
	var metadata modInstallMetadata
	if unmarshalErr := json.Unmarshal(metadataRaw, &metadata); unmarshalErr != nil {
		t.Fatalf("unmarshal metadata: %v raw=%s", unmarshalErr, string(metadataRaw))
	}
	if metadata.Source != "mod-circle:world.nimi.community-tarot" {
		t.Fatalf("metadata source mismatch: %#v", metadata.Source)
	}
	if !metadata.Verified {
		t.Fatalf("metadata verified should be true")
	}
}

func TestRunRuntimeModInstallModCircleNotFound(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`[{"name":"alpha.json","path":"mods/alpha.json","type":"file"}]`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/alpha.json":
			content := base64.StdEncoding.EncodeToString([]byte(`{"id":"world.nimi.alpha","repo":"github:someuser/alpha-mod"}`))
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"alpha.json","path":"mods/alpha.json","encoding":"base64","content":"` + content + `"}`))
			return
		default:
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"message":"not found"}`))
			return
		}
	}))
	defer server.Close()

	err := runRuntimeMod([]string{
		"install",
		"mod-circle:world.nimi.unknown",
		"--mods-dir", modsDir,
		"--api-base", server.URL,
	})
	if err == nil {
		t.Fatalf("expected mod-circle not found error")
	}
	if !strings.Contains(err.Error(), "MOD_INSTALL_MOD_CIRCLE_NOT_FOUND") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunRuntimeModInstallFromWorldIDAlias(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	tarball := buildGitHubTarball(t, map[string]string{
		"mods/memory/mod.manifest.yaml": strings.Join([]string{
			"id: world.nimi.memory-notes",
			"name: Memory Notes",
			"version: 0.1.0",
			"description: memory mod",
			"entry: ./dist/index.js",
			"license: MIT",
			"",
		}, "\n"),
		"mods/memory/src/index.ts": "export const memory = true;\n",
	})
	entryJSON := `{"id":"world.nimi.memory-notes","name":"Memory Notes","repo":"github:someuser/nimi-mod-memory/mods/memory","verified":false}`
	entryContent := base64.StdEncoding.EncodeToString([]byte(entryJSON))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`[{"name":"memory-notes.json","path":"mods/memory-notes.json","type":"file"}]`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/memory-notes.json":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"memory-notes.json","path":"mods/memory-notes.json","encoding":"base64","content":"` + entryContent + `"}`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/someuser/nimi-mod-memory/tarball":
			writer.Header().Set("Content-Type", "application/x-gzip")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(tarball)
			return
		default:
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"message":"not found"}`))
			return
		}
	}))
	defer server.Close()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeMod([]string{
			"install",
			"world.nimi.memory-notes",
			"--mods-dir", modsDir,
			"--api-base", server.URL,
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeMod install world-id alias: %v", err)
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["source"]) != "mod-circle:world.nimi.memory-notes" {
		t.Fatalf("source mismatch: %#v", payload["source"])
	}
}

func TestRunRuntimeModInstallModCircleAmbiguousSelector(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	entryA := base64.StdEncoding.EncodeToString([]byte(`{"id":"world.nimi.tarot-alpha","name":"Tarot Reading","repo":"github:someuser/tarot-alpha"}`))
	entryB := base64.StdEncoding.EncodeToString([]byte(`{"id":"world.nimi.tarot-beta","name":"Tarot Reading","repo":"github:someuser/tarot-beta"}`))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`[{"name":"tarot-alpha.json","path":"mods/tarot-alpha.json","type":"file"},{"name":"tarot-beta.json","path":"mods/tarot-beta.json","type":"file"}]`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/tarot-alpha.json":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"tarot-alpha.json","path":"mods/tarot-alpha.json","encoding":"base64","content":"` + entryA + `"}`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/tarot-beta.json":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"tarot-beta.json","path":"mods/tarot-beta.json","encoding":"base64","content":"` + entryB + `"}`))
			return
		default:
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"message":"not found"}`))
			return
		}
	}))
	defer server.Close()

	err := runRuntimeMod([]string{
		"install",
		"mod-circle:Tarot Reading",
		"--mods-dir", modsDir,
		"--api-base", server.URL,
	})
	if err == nil {
		t.Fatalf("expected mod-circle ambiguous selector error")
	}
	if !strings.Contains(err.Error(), "MOD_INSTALL_MOD_CIRCLE_AMBIGUOUS") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunRuntimeModInstallModCircleStrictIDDisablesNameFallback(t *testing.T) {
	modsDir := filepath.Join(t.TempDir(), "installed")
	entry := base64.StdEncoding.EncodeToString([]byte(`{"id":"world.nimi.tarot-alpha","name":"Tarot Reading","repo":"github:someuser/tarot-alpha"}`))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`[{"name":"tarot-alpha.json","path":"mods/tarot-alpha.json","type":"file"}]`))
			return
		case request.Method == http.MethodGet && request.URL.Path == "/repos/nimiplatform/mod-circle/contents/mods/tarot-alpha.json":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"name":"tarot-alpha.json","path":"mods/tarot-alpha.json","encoding":"base64","content":"` + entry + `"}`))
			return
		default:
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"message":"not found"}`))
			return
		}
	}))
	defer server.Close()

	err := runRuntimeMod([]string{
		"install",
		"mod-circle:Tarot Reading",
		"--strict-id",
		"--mods-dir", modsDir,
		"--api-base", server.URL,
	})
	if err == nil {
		t.Fatalf("expected strict-id name fallback deny error")
	}
	if !strings.Contains(err.Error(), "MOD_INSTALL_MOD_CIRCLE_NOT_FOUND") {
		t.Fatalf("unexpected error: %v", err)
	}
}


func createTestModProject(t *testing.T, dir string, modID string, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	manifest := modManifest{
		ID:           modID,
		Name:         name,
		Version:      "0.1.0",
		Description:  "test mod",
		License:      "MIT",
		Capabilities: []string{"runtime.ai.text.generate"},
	}
	if err := writeManifestYAML(filepath.Join(dir, "mod.manifest.yaml"), manifest); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte("export const value = 1;\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
}

func createLegacyTestModProject(t *testing.T, dir string, modID string, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	manifestRaw := strings.Join([]string{
		"id: " + modID,
		"name: " + name,
		"version: 0.1.0",
		"description: legacy test mod",
		"entry: ./dist/index.js",
		"license: MIT",
		"capabilities:",
		"  - llm.text.generate",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(dir, "mod.manifest.yaml"), []byte(manifestRaw), 0o644); err != nil {
		t.Fatalf("write legacy manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte("export const value = 1;\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
}

func buildGitHubTarball(t *testing.T, files map[string]string) []byte {
	t.Helper()

	buffer := &bytes.Buffer{}
	gzipWriter := gzip.NewWriter(buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	root := "someuser-repo-sha"

	for relPath, content := range files {
		cleanRel := strings.Trim(strings.ReplaceAll(relPath, "\\", "/"), "/")
		if cleanRel == "" {
			continue
		}
		header := &tar.Header{
			Name: root + "/" + cleanRel,
			Mode: 0o644,
			Size: int64(len(content)),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := io.WriteString(tarWriter, content); err != nil {
			t.Fatalf("write tar content: %v", err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatalf("close tar writer: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}
	return buffer.Bytes()
}
