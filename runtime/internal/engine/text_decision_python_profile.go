package engine

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision
const TextDecisionConsumerID = capabilitydriver.LayaConsumerID

const textDecisionServerScriptName = "text_decision_server.py"

//go:embed assets/laya_text_decision.py
var textDecisionScript string

//go:embed assets/text_decision_server.py
var textDecisionServerScript string

func textDecisionDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{
		{RelativePath: "laya_text_decision.py", Content: []byte(textDecisionScript)},
		{RelativePath: textDecisionServerScriptName, Content: []byte(textDecisionServerScript)},
	}
}

// textDecisionPythonSourceLabel selects the exact frozen profile input. CUDA
// uses the PyTorch cu128 wheel plane; every admitted host may use the CPU plane.
func textDecisionPythonSourceLabel(platformTuple string, acceleratorPlane string) (string, error) {
	switch {
	case platformTuple == "windows/amd64" && acceleratorPlane == "cuda":
		return "text-laya-cu128", nil
	case (platformTuple == "windows/amd64" || platformTuple == "darwin/arm64") && acceleratorPlane == "cpu":
		return "text-laya-cpu", nil
	default:
		return "", fmt.Errorf("Laya decision profile is not admitted for %s/%s", platformTuple, acceleratorPlane)
	}
}

func textDecisionDriverBundleDigest(driverProtocol string) string {
	lines := []string{"driver_protocol=" + driverProtocol}
	for _, file := range textDecisionDriverStaticFiles() {
		lines = append(lines, "file="+file.RelativePath, string(file.Content))
	}
	return sha256Hex([]byte(strings.Join(lines, "\n") + "\n"))
}

func verifyTextDecisionDriverBundle(root string) error {
	for _, file := range textDecisionDriverStaticFiles() {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "text decision Driver"); err != nil {
			return err
		}
	}
	return nil
}

func materializeTextDecisionDriverBundle(root string) error {
	for _, file := range textDecisionDriverStaticFiles() {
		if err := os.WriteFile(filepath.Join(root, file.RelativePath), file.Content, 0o444); err != nil {
			return fmt.Errorf("materialize text decision Driver: %w", err)
		}
	}
	return nil
}

func textDecisionPythonImportProbes() []string {
	return []string{"fastapi", "uvicorn", "laya", "laya.common", "safetensors", "tokenizers", "transformers", "laya_text_decision"}
}
