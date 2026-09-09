package engine

import (
	"embed"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r116
const VisionLocateConsumerID = capabilitydriver.LocateAnythingConsumerID
const visionDriverProtocolVersion = capabilitydriver.LocateAnythingProtocol

//go:embed assets/vision_server.py assets/vision_locate.py assets/locateanything_loader/*
var visionDriverBundle embed.FS

func visionPythonBackend(platformTuple, acceleratorPlane string) (string, error) {
	switch platformTuple {
	case "windows/amd64":
		if acceleratorPlane == "cuda" {
			return "transformers", nil
		}
	case "darwin/arm64":
		if acceleratorPlane == "cpu" {
			return "mlx", nil
		}
	}
	return "", fmt.Errorf("Locate profile is not admitted for %s/%s", platformTuple, acceleratorPlane)
}

func visionDriverStaticFiles() ([]PythonDependencyProfileStaticFile, error) {
	var files []PythonDependencyProfileStaticFile
	err := fs.WalkDir(visionDriverBundle, "assets", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		content, err := visionDriverBundle.ReadFile(name)
		if err != nil {
			return err
		}
		files = append(files, PythonDependencyProfileStaticFile{
			RelativePath: strings.TrimPrefix(name, "assets/"), Content: content,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read embedded Locate Driver bundle: %w", err)
	}
	return files, nil
}

func materializeVisionDriverBundle(root string) error {
	files, err := visionDriverStaticFiles()
	if err != nil {
		return err
	}
	for _, file := range files {
		path := filepath.Join(root, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("create Locate Driver directory: %w", err)
		}
		if err := os.WriteFile(path, file.Content, 0o444); err != nil {
			return fmt.Errorf("write Locate Driver file %s: %w", file.RelativePath, err)
		}
	}
	return nil
}

func verifyVisionDriverBundle(root string) error {
	files, err := visionDriverStaticFiles()
	if err != nil {
		return err
	}
	for _, file := range files {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "Locate Driver bundle"); err != nil {
			return err
		}
	}
	return nil
}
