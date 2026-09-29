package engine

import (
	"archive/zip"
	"context"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
)

const MediaCodecDependencyID = "ffmpeg.codec"

//go:embed assets/media-codec-LICENSE.txt
var mediaCodecLicense string

type mediaCodecArchive struct {
	url, sha256 string
	bytes       int64
	files       map[string]string
}
type mediaCodecSpec struct {
	version, directory, suffix string
	archives                   []mediaCodecArchive
	hashes                     map[string]string
}
type MediaCodecDependencyStatus struct {
	Version, CanonicalRoot string
	VerifiedArtifacts      []string
	Hashes                 map[string]string
}

// Release URLs are immutable build identities, never a rolling latest alias.
// Sources: https://www.gyan.dev/ffmpeg/builds/ and https://ffmpeg.martin-riedl.de/.
// Both selected builds identify as GPLv3+; notices accompany the managed tools.
func mediaCodecSpecFor(goos, goarch string) (mediaCodecSpec, error) {
	switch goos + "/" + goarch {
	case "windows/amd64":
		return mediaCodecSpec{version: "8.1.2-gyan", directory: "ffmpeg-8.1.2-windows-amd64", suffix: ".exe", archives: []mediaCodecArchive{{
			url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip", sha256: "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec", bytes: 109728040,
			files: map[string]string{"ffmpeg-8.1.2-essentials_build/bin/ffmpeg.exe": "bin/ffmpeg.exe", "ffmpeg-8.1.2-essentials_build/bin/ffprobe.exe": "bin/ffprobe.exe", "ffmpeg-8.1.2-essentials_build/README.txt": "upstream-README.txt"},
		}}, hashes: map[string]string{"bin/ffmpeg.exe": "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e", "bin/ffprobe.exe": "b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07"}}, nil
	case "darwin/arm64":
		return mediaCodecSpec{version: "9.0.2-martin-riedl-1789931890", directory: "ffmpeg-9.0.2-darwin-arm64", archives: []mediaCodecArchive{
			{url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip", sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924", bytes: 28395699, files: map[string]string{"ffmpeg": "bin/ffmpeg"}},
			{url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip", sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6", bytes: 28317701, files: map[string]string{"ffprobe": "bin/ffprobe"}},
		}, hashes: map[string]string{"bin/ffmpeg": "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384", "bin/ffprobe": "2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059"}}, nil
	default:
		return mediaCodecSpec{}, fmt.Errorf("managed media codec unsupported on %s/%s", goos, goarch)
	}
}

func MediaCodecVersionMatches(goos, goarch, version string) bool {
	spec, err := mediaCodecSpecFor(goos, goarch)
	return err == nil && version == spec.version
}

func MediaCodecSupported(goos, goarch string) bool {
	_, err := mediaCodecSpecFor(goos, goarch)
	return err == nil
}

// ResolveMediaCodecDependency is read-only: ordinary requests never download.
func (m *Manager) ResolveMediaCodecDependency(ctx context.Context) (string, string, error) {
	spec, err := mediaCodecSpecFor(currentGOOS(), currentGOARCH())
	if err != nil {
		return "", "", err
	}
	root := filepath.Join(m.depsDir, "media-codec", spec.directory)
	if _, err := mediaCodecStatus(root, spec); err != nil {
		return "", "", err
	}
	ffmpeg, probe := filepath.Join(root, "bin", "ffmpeg"+spec.suffix), filepath.Join(root, "bin", "ffprobe"+spec.suffix)
	if err := videomedia.VerifyCodecRuns(ctx, ffmpeg, probe); err != nil {
		return "", "", err
	}
	return ffmpeg, probe, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.media-codec-dependency
// Called only by the explicit RuntimeLocalService dependency job executor.
func (m *Manager) EnsureMediaCodecDependency(ctx context.Context) (MediaCodecDependencyStatus, error) {
	spec, err := mediaCodecSpecFor(currentGOOS(), currentGOARCH())
	if err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	m.mediaCodecMu.Lock()
	defer m.mediaCodecMu.Unlock()
	if err := ctx.Err(); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	target := filepath.Join(m.depsDir, "media-codec", spec.directory)
	if status, err := mediaCodecStatus(target, spec); err == nil {
		if err := videomedia.VerifyCodecRuns(ctx, filepath.Join(target, "bin", "ffmpeg"+spec.suffix), filepath.Join(target, "bin", "ffprobe"+spec.suffix)); err == nil {
			return status, nil
		}
	}
	stage, err := os.MkdirTemp(m.depsDir, ".media-codec-*")
	if err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	defer os.RemoveAll(stage)
	payload := filepath.Join(stage, "payload")
	for index, archive := range spec.archives {
		file := filepath.Join(stage, fmt.Sprintf("%d.zip", index))
		hash, err := downloadURLToFileWithProgress(ctx, archive.url, file, downloadProgressFromContext(ctx))
		if err != nil {
			return MediaCodecDependencyStatus{}, err
		}
		stat, err := os.Stat(file)
		if err != nil || stat.Size() != archive.bytes || hash != archive.sha256 {
			return MediaCodecDependencyStatus{}, fmt.Errorf("media codec archive identity mismatch")
		}
		if err := extractMediaCodecArchive(file, payload, archive.files); err != nil {
			return MediaCodecDependencyStatus{}, err
		}
	}
	if err := os.WriteFile(filepath.Join(payload, "LICENSE.txt"), []byte(mediaCodecLicense), 0644); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	notices := "FFmpeg " + spec.version + " — GPL-3.0-or-later\nFFmpeg source: https://github.com/FFmpeg/FFmpeg\nBuild sources: https://git.martin-riedl.de/ffmpeg/build-script and https://www.gyan.dev/ffmpeg/builds/\n"
	for _, a := range spec.archives {
		notices += "Source: " + a.url + "\nSHA256: " + a.sha256 + "\n"
	}
	if err := os.WriteFile(filepath.Join(payload, "NOTICE.txt"), []byte(notices), 0644); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	if _, err := mediaCodecStatus(payload, spec); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	if err := videomedia.VerifyCodecRuns(ctx, filepath.Join(payload, "bin", "ffmpeg"+spec.suffix), filepath.Join(payload, "bin", "ffprobe"+spec.suffix)); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	if err := installManagedBinaryPayload(target, payload); err != nil {
		return MediaCodecDependencyStatus{}, err
	}
	return mediaCodecStatus(target, spec)
}

func mediaCodecStatus(root string, spec mediaCodecSpec) (MediaCodecDependencyStatus, error) {
	status := MediaCodecDependencyStatus{Version: spec.version, CanonicalRoot: root, Hashes: map[string]string{}}
	for relative, expected := range spec.hashes {
		path := filepath.Join(root, filepath.FromSlash(relative))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return MediaCodecDependencyStatus{}, fmt.Errorf("managed media codec artifact unavailable: %s", relative)
		}
		hash, err := sha256File(path)
		if err != nil || hash != expected {
			return MediaCodecDependencyStatus{}, fmt.Errorf("managed media codec artifact identity mismatch: %s", relative)
		}
		status.VerifiedArtifacts = append(status.VerifiedArtifacts, path)
		status.Hashes[relative] = hash
	}
	return status, nil
}

func extractMediaCodecArchive(file, root string, files map[string]string) error {
	archive, err := zip.OpenReader(file)
	if err != nil {
		return err
	}
	defer archive.Close()
	found := map[string]bool{}
	for _, entry := range archive.File {
		relative, ok := files[entry.Name]
		if !ok {
			continue
		}
		if found[relative] || !entry.Mode().IsRegular() || entry.UncompressedSize64 > 256<<20 || strings.Contains(relative, "..") || filepath.IsAbs(relative) {
			return fmt.Errorf("invalid media codec archive entry")
		}
		found[relative] = true
		target := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if len(found) != len(files) {
		return fmt.Errorf("media codec archive missing required files")
	}
	return nil
}
