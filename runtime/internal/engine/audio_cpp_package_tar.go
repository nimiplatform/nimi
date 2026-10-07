package engine

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func extractAudioCppPackageFiles(archive, destination string, identity AudioCppPackageIdentity) error {
	if identity.Platform == "windows/amd64" {
		return extractAudioCppAdmittedPackageFiles(archive, destination)
	}
	if identity.Platform != "darwin/arm64" {
		return fmt.Errorf("unsupported audio.cpp archive platform")
	}
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer func() { _ = gz.Close() }()
	reader := tar.NewReader(gz)
	wanted := make(map[string]bool, len(identity.AdmittedFiles))
	for _, name := range identity.AdmittedFiles {
		wanted[name] = false
	}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(header.Name, "./")
		seen, admitted := wanted[name]
		if !admitted {
			continue
		}
		if seen || header.Typeflag != tar.TypeReg || header.Size <= 0 || header.Size > identity.ArchiveBytes*8 {
			return fmt.Errorf("audio.cpp artifact %s is duplicated or invalid", name)
		}
		mode := os.FileMode(0644)
		if name == identity.ExecutableName {
			mode = 0755
		}
		target, err := os.OpenFile(filepath.Join(destination, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(target, reader)
		closeErr := target.Close()
		if copyErr != nil || closeErr != nil {
			return fmt.Errorf("copy audio.cpp artifact %s", name)
		}
		wanted[name] = true
	}
	for name, seen := range wanted {
		if !seen {
			return fmt.Errorf("audio.cpp artifact %s is missing", name)
		}
	}
	return nil
}
