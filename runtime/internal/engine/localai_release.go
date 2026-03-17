package engine

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var localAIReleaseBaseURL = "https://github.com/mudler/LocalAI/releases/download"

var localAIReleaseHTTPClient = &http.Client{
	Timeout: 60 * time.Second,
}

func localAIReleaseAssetURL(version string, assetName string) string {
	trimmedBase := strings.TrimSuffix(strings.TrimSpace(localAIReleaseBaseURL), "/")
	trimmedVersion := strings.TrimSpace(version)
	trimmedAsset := strings.TrimSpace(assetName)
	return fmt.Sprintf("%s/v%s/%s", trimmedBase, trimmedVersion, trimmedAsset)
}

func localAIChecksumAssetName(version string) string {
	return fmt.Sprintf("LocalAI-v%s-checksums.txt", strings.TrimSpace(version))
}

func localAIChecksumURL(version string) string {
	return localAIReleaseAssetURL(version, localAIChecksumAssetName(version))
}

func localAIExpectedSHA256(version string, assetName string) (string, error) {
	trimmedAsset := strings.TrimSpace(assetName)
	if trimmedAsset == "" {
		return "", fmt.Errorf("%w: llama asset is required", ErrEngineBinaryDownloadFailed)
	}
	checksumURL := localAIChecksumURL(version)
	resp, err := localAIReleaseHTTPClient.Get(checksumURL)
	if err != nil {
		return "", fmt.Errorf("%w: fetch llama checksums: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: llama checksums HTTP %d from %s", ErrEngineBinaryDownloadFailed, resp.StatusCode, checksumURL)
	}
	return parseLocalAIChecksum(resp.Body, trimmedAsset)
}

func parseLocalAIChecksum(r io.Reader, assetName string) (string, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 8*1024), 1024*1024)
	needle := strings.TrimSpace(assetName)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		fileName := strings.TrimPrefix(strings.TrimSpace(fields[len(fields)-1]), "*")
		if fileName != needle {
			continue
		}
		hash := strings.ToLower(strings.TrimSpace(fields[0]))
		if len(hash) != 64 {
			return "", fmt.Errorf("%w: invalid checksum format for %s", ErrEngineBinaryDownloadFailed, needle)
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return "", fmt.Errorf("%w: invalid checksum hex for %s", ErrEngineBinaryDownloadFailed, needle)
		}
		return hash, nil
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("%w: read checksums: %v", ErrEngineBinaryDownloadFailed, err)
	}
	return "", fmt.Errorf("%w: checksum for %s not found", ErrEngineBinaryDownloadFailed, needle)
}
