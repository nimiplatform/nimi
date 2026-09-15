package engine

import (
	_ "embed"
	"fmt"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation
const TextAnnotationConsumerID = capabilitydriver.SpacyConsumerID

//go:embed assets/spacy_text_annotation.py
var textAnnotationScript string

//go:embed assets/text_annotation_server.py
var textAnnotationServerScript string

func textAnnotationDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{
		{RelativePath: "spacy_text_annotation.py", Content: []byte(textAnnotationScript)},
		{RelativePath: "text_annotation_server.py", Content: []byte(textAnnotationServerScript)},
	}
}

func verifyTextAnnotationDriverBundle(root string) error {
	for _, file := range textAnnotationDriverStaticFiles() {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "text annotation Driver"); err != nil {
			return err
		}
	}
	return nil
}

func verifyTextAnnotationProfileProbe(probe pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	if identity.AcceleratorPlane != "cpu" || identity.CUDAABI != "" || identity.TorchVersion != "" ||
		probe.TorchVersion != "" || probe.CUDAABI != "" || probe.Device != "cpu" || probe.Allocation != 1 || len(probe.InstalledDistributions) == 0 {
		return fmt.Errorf("text annotation dependency profile did not execute its CPU composition")
	}
	return nil
}
