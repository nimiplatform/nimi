package engine

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpeechCommandEnvIncludesDriverConfiguration(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", "python3 /tmp/qwen3_tts_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", "python3 /tmp/qwen3_asr_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", "45000")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if _, ok := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; ok {
		t.Fatal("speech env must not synthesize local model root")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]; ok {
		t.Fatal("speech env must not pass through qwen3_tts driver command")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]; ok {
		t.Fatal("speech env must not pass through qwen3_asr driver command")
	}
	if got := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; got != "45000" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS = %q", got)
	}
}

func TestEnsureSpeechDoesNotMaterializeHiddenDependencies(t *testing.T) {
	baseDir := t.TempDir()
	_, err := ensureSpeech(context.Background(), baseDir, DefaultSpeechConfig())
	if err == nil {
		t.Fatal("expected speech startup to fail closed without selected sources")
	}
	if strings.Contains(err.Error(), "ensure uv") || strings.Contains(err.Error(), "install speech dependencies") {
		t.Fatalf("speech startup attempted hidden materialization: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(baseDir, "uv")); !os.IsNotExist(statErr) {
		t.Fatalf("speech startup created uv root or unexpected stat error: %v", statErr)
	}
}

func TestMaterializePythonPipelineServerScriptDeploysSpeechSiblingModules(t *testing.T) {
	root := t.TempDir()
	if err := materializePythonPipelineServerScript(root, "speech.qwen3-tts.python"); err != nil {
		t.Fatalf("materialize speech pipeline script: %v", err)
	}
	for _, file := range speechServerScriptFiles {
		path := filepath.Join(root, file.Name)
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("speech venv missing deployed file %s: %v", file.Name, err)
		}
		if len(strings.TrimSpace(string(contents))) == 0 {
			t.Fatalf("speech venv deployed empty file %s", file.Name)
		}
	}
	if len(speechServerScriptFiles) < 2 {
		t.Fatalf("speech server requires speech_server.py and its sibling runtime module, got %d files", len(speechServerScriptFiles))
	}
	if _, err := os.Stat(SpeechQwen3TTSDriverPath(root)); err != nil {
		t.Fatalf("speech tts driver missing: %v", err)
	}
	asrRoot := t.TempDir()
	if err := materializePythonPipelineServerScript(asrRoot, "speech.qwen3-asr.python"); err != nil {
		t.Fatalf("materialize speech asr driver: %v", err)
	}
	if _, err := os.Stat(SpeechQwen3ASRDriverPath(asrRoot)); err != nil {
		t.Fatalf("speech asr driver missing: %v", err)
	}
}

func TestQwenSpeechDriversResolveManagedBundleDirectory(t *testing.T) {
	bundleDir := t.TempDir()
	for _, name := range []string{"model.safetensors", "config.json", "tokenizer_config.json"} {
		if err := os.WriteFile(filepath.Join(bundleDir, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("write bundle file %s: %v", name, err)
		}
	}
	request := `{"bundle_dir":` + quotePythonJSON(bundleDir) + `,"entry_path":` + quotePythonJSON(filepath.Join(bundleDir, "model.safetensors")) + `,"declared_files":["model.safetensors","config.json","tokenizer_config.json"]}`

	if got := runPythonDriverResolveModelRef(t, "qwen3_asr_driver.py", speechQwen3ASRDriverScript, request, "Qwen/Qwen3-ASR-0.6B"); got != bundleDir {
		t.Fatalf("asr resolve_model_ref = %q, want managed bundle dir %q", got, bundleDir)
	}
	if got := runPythonDriverResolveModelRef(t, "qwen3_tts_driver.py", speechQwen3TTSDriverScript, request, "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"); got != bundleDir {
		t.Fatalf("tts resolve_model_ref = %q, want managed bundle dir %q", got, bundleDir)
	}
}

func TestQwenSpeechDriversFailClosedForIncompleteManagedBundle(t *testing.T) {
	bundleDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(bundleDir, "model.safetensors"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write bundle file: %v", err)
	}
	request := `{"bundle_dir":` + quotePythonJSON(bundleDir) + `,"entry_path":` + quotePythonJSON(filepath.Join(bundleDir, "model.safetensors")) + `,"declared_files":["model.safetensors","missing.json"]}`
	got := runPythonDriverResolveModelRefExpectFailure(t, "qwen3_asr_driver.py", speechQwen3ASRDriverScript, request, "Qwen/Qwen3-ASR-0.6B")
	if !strings.Contains(got, "managed speech bundle missing declared file: missing.json") {
		t.Fatalf("expected missing declared file failure, got %q", got)
	}
}

func TestQwenASRDriverAllowsEmptyTranscriptOnlyForFirstRunProbe(t *testing.T) {
	response := runPythonASRDriverFakeTranscribe(t, map[string]any{
		"operation":  "audio.transcribe",
		"audio_path": "AUDIO_PATH",
		"extensions": map[string]any{
			"nimi_first_run_baseline_probe": true,
			"nimi_allow_empty_transcript":   true,
		},
	}, false)
	if text, ok := response["text"].(string); !ok || text != "" {
		t.Fatalf("expected empty transcript to be preserved, got %#v", response)
	}
	if empty, ok := response["empty_transcript"].(bool); !ok || !empty {
		t.Fatalf("expected empty_transcript marker, got %#v", response)
	}

	failure := runPythonASRDriverFakeTranscribe(t, map[string]any{
		"operation":  "audio.transcribe",
		"audio_path": "AUDIO_PATH",
	}, true)
	if !strings.Contains(failure["error"].(string), "qwen3_asr transcribe result missing text") {
		t.Fatalf("expected unmarked empty transcript to fail closed, got %#v", failure)
	}
}

func TestSpeechServerOffloadsBlockingDriverCallsFromAsyncEndpoints(t *testing.T) {
	if !strings.Contains(speechServerScript, "from starlette.concurrency import run_in_threadpool") {
		t.Fatal("speech server must import run_in_threadpool for blocking driver calls")
	}
	if !strings.Contains(speechServerScript, "await run_in_threadpool(\n                synthesize_with_driver") {
		t.Fatal("speech synthesize endpoint must run blocking driver work in a threadpool")
	}
	if !strings.Contains(speechServerScript, "await run_in_threadpool(\n                    transcribe_with_driver") {
		t.Fatal("speech transcribe endpoint must run blocking driver work in a threadpool")
	}
}

func TestSpeechServerRuntimeRequiresExplicitEmptyTranscriptMarker(t *testing.T) {
	if !strings.Contains(speechServerRuntimeScript, "def allow_empty_transcript_request") {
		t.Fatal("speech runtime must gate empty transcripts behind an explicit request extension")
	}
	if !strings.Contains(speechServerRuntimeScript, "nimi_first_run_baseline_probe") {
		t.Fatal("speech runtime must require the private first-run probe marker before accepting empty text")
	}
	if !strings.Contains(speechServerRuntimeScript, `truthy_payload_value(response.get("empty_transcript"))`) {
		t.Fatal("speech runtime must require the driver empty_transcript marker before accepting empty text")
	}
	if !strings.Contains(speechServerRuntimeScript, `raise RuntimeError("speech driver response missing transcription text")`) {
		t.Fatal("speech runtime must keep ordinary empty transcripts fail-closed")
	}
}

func quotePythonJSON(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func runPythonDriverResolveModelRef(t *testing.T, name string, script string, request string, fallback string) string {
	t.Helper()
	out, err := runPythonDriverResolveModelRefCommand(t, name, script, request, fallback)
	if err != nil {
		t.Fatalf("resolve_model_ref failed: %v: %s", err, strings.TrimSpace(out))
	}
	return strings.TrimSpace(out)
}

func runPythonDriverResolveModelRefExpectFailure(t *testing.T, name string, script string, request string, fallback string) string {
	t.Helper()
	out, err := runPythonDriverResolveModelRefCommand(t, name, script, request, fallback)
	if err == nil {
		t.Fatalf("resolve_model_ref unexpectedly succeeded: %s", strings.TrimSpace(out))
	}
	return strings.TrimSpace(out)
}

func runPythonDriverResolveModelRefCommand(t *testing.T, name string, script string, request string, fallback string) (string, error) {
	t.Helper()
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	driverPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(driverPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write driver script: %v", err)
	}
	code := strings.Join([]string{
		"import importlib.util, json, sys",
		"spec = importlib.util.spec_from_file_location('driver_under_test', sys.argv[1])",
		"mod = importlib.util.module_from_spec(spec)",
		"spec.loader.exec_module(mod)",
		"print(mod.resolve_model_ref(json.loads(sys.argv[2]), sys.argv[3]))",
	}, "\n")
	cmd := exec.Command(python, "-c", code, driverPath, request, fallback)
	output, runErr := cmd.CombinedOutput()
	return string(output), runErr
}

func runPythonASRDriverFakeTranscribe(t *testing.T, request map[string]any, expectFailure bool) map[string]any {
	t.Helper()
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	tempDir := t.TempDir()
	audioPath := filepath.Join(tempDir, "probe.wav")
	if err := os.WriteFile(audioPath, []byte("audio-bytes"), 0o644); err != nil {
		t.Fatalf("write fake audio: %v", err)
	}
	request["audio_path"] = audioPath
	requestPayload, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	driverPath := filepath.Join(tempDir, "qwen3_asr_driver.py")
	if err := os.WriteFile(driverPath, []byte(speechQwen3ASRDriverScript), 0o755); err != nil {
		t.Fatalf("write driver script: %v", err)
	}
	code := strings.Join([]string{
		"import importlib.util, json, sys",
		"spec = importlib.util.spec_from_file_location('driver_under_test', sys.argv[1])",
		"mod = importlib.util.module_from_spec(spec)",
		"spec.loader.exec_module(mod)",
		"class FakeModel:",
		"    def transcribe(self, **kwargs):",
		"        return [{'text': ''}]",
		"mod.load_qwen3_asr_model = lambda model_ref, return_time_stamps: FakeModel()",
		"try:",
		"    print(json.dumps(mod.handle_request(json.loads(sys.argv[2]), 'Qwen/Qwen3-ASR-0.6B')))",
		"except Exception as error:",
		"    print(json.dumps({'error': str(error)}))",
		"    sys.exit(2)",
	}, "\n")
	cmd := exec.Command(python, "-c", code, driverPath, string(requestPayload))
	output, runErr := cmd.CombinedOutput()
	if expectFailure {
		if runErr == nil {
			t.Fatalf("fake ASR transcribe unexpectedly succeeded: %s", strings.TrimSpace(string(output)))
		}
	} else if runErr != nil {
		t.Fatalf("fake ASR transcribe failed: %v: %s", runErr, strings.TrimSpace(string(output)))
	}
	var response map[string]any
	if err := json.Unmarshal(output, &response); err != nil {
		t.Fatalf("unmarshal fake ASR response %q: %v", strings.TrimSpace(string(output)), err)
	}
	return response
}

func TestEnsureSpeechRefreshesRuntimeOwnedSpeechScripts(t *testing.T) {
	cfg := DefaultSpeechConfig()
	root := t.TempDir()
	asrRoot := t.TempDir()
	cfg.ModelsPath = t.TempDir()
	cfg.SpeechQwen3TTSPackageSetRoot = root
	cfg.SpeechQwen3ASRPackageSetRoot = asrRoot
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("create speech engine root: %v", err)
	}
	if err := os.MkdirAll(asrRoot, 0o755); err != nil {
		t.Fatalf("create speech asr root: %v", err)
	}
	// Stage managed interpreters plus stale/missing runtime-owned scripts. Engine
	// startup must refresh those scripts from the current embedded assets.
	pythonPath := managedPythonPath(root)
	if err := os.MkdirAll(filepath.Dir(pythonPath), 0o755); err != nil {
		t.Fatalf("create managed python dir: %v", err)
	}
	if err := os.WriteFile(pythonPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("stage managed python: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "speech_server.py"), []byte("print('stale')\n"), 0o755); err != nil {
		t.Fatalf("stage stale speech_server.py: %v", err)
	}
	asrPythonPath := managedPythonPath(asrRoot)
	if err := os.MkdirAll(filepath.Dir(asrPythonPath), 0o755); err != nil {
		t.Fatalf("create managed asr python dir: %v", err)
	}
	if err := os.WriteFile(asrPythonPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("stage managed asr python: %v", err)
	}
	if err := os.WriteFile(SpeechQwen3ASRDriverPath(asrRoot), []byte("print('stale-asr')\n"), 0o755); err != nil {
		t.Fatalf("stage stale speech asr driver: %v", err)
	}

	if _, err := ensureSpeech(context.Background(), t.TempDir(), cfg); err != nil {
		t.Fatalf("ensureSpeech rejected refreshable runtime-owned scripts: %v", err)
	}
	for _, tc := range []struct {
		path string
		want string
	}{
		{path: filepath.Join(root, "speech_server.py"), want: speechServerScript},
		{path: filepath.Join(root, "speech_server_runtime.py"), want: speechServerRuntimeScript},
		{path: SpeechQwen3TTSDriverPath(root), want: speechQwen3TTSDriverScript},
		{path: SpeechQwen3ASRDriverPath(asrRoot), want: speechQwen3ASRDriverScript},
	} {
		got, err := os.ReadFile(tc.path)
		if err != nil {
			t.Fatalf("read refreshed script %s: %v", tc.path, err)
		}
		if string(got) != tc.want {
			t.Fatalf("script %s was not refreshed from embedded runtime asset", tc.path)
		}
	}
}

func TestSpeechCommandEnvDoesNotFallbackToDefaultModelsRoot(t *testing.T) {
	originalValue, hadOriginal := os.LookupEnv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	originalTTS, hadTTS := os.LookupEnv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
	originalSTT, hadSTT := os.LookupEnv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
	originalTimeout, hadTimeout := os.LookupEnv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.Setenv("NIMI_RUNTIME_LOCAL_MODELS_PATH", originalValue)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
		}
		if hadTTS {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", originalTTS)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
		}
		if hadSTT {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", originalSTT)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
		}
		if hadTimeout {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", originalTimeout)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
		}
	})
	_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if _, ok := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; ok {
		t.Fatal("unexpected default models root")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]; ok {
		t.Fatal("unexpected qwen3_tts driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]; ok {
		t.Fatal("unexpected qwen3_asr driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; ok {
		t.Fatal("unexpected speech driver timeout when env is unset")
	}
}
