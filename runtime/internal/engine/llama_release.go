package engine

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

var llamaReleaseMu sync.RWMutex

var llamaReleaseBaseURL = "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags"

var llamaReleaseHTTPClient = &http.Client{
	Timeout: 60 * time.Second,
}

type githubReleasePayload struct {
	TagName string               `json:"tag_name"`
	Assets  []githubReleaseAsset `json:"assets"`
}

type githubReleaseAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"browser_download_url"`
	Digest      string `json:"digest"`
}

type managedBinaryReleaseAsset struct {
	Name        string
	DownloadURL string
	SHA256      string
}

func llamaReleaseTagURL(version string) string {
	trimmedBase := strings.TrimSuffix(strings.TrimSpace(currentLlamaReleaseBaseURL()), "/")
	trimmedVersion := strings.TrimSpace(version)
	return fmt.Sprintf("%s/%s", trimmedBase, trimmedVersion)
}

func llamaReleaseAsset(version string) (managedBinaryReleaseAsset, error) {
	assetName, err := llamaAssetName(version)
	if err != nil {
		return managedBinaryReleaseAsset{}, err
	}

	release, err := fetchGitHubReleaseByTag(llamaReleaseTagURL(version), currentLlamaReleaseHTTPClient())
	if err != nil {
		return managedBinaryReleaseAsset{}, err
	}

	for _, asset := range release.Assets {
		if strings.TrimSpace(asset.Name) != assetName {
			continue
		}
		sha256, err := normalizeGitHubAssetDigest(asset.Digest)
		if err != nil {
			return managedBinaryReleaseAsset{}, err
		}
		downloadURL := strings.TrimSpace(asset.DownloadURL)
		if downloadURL == "" {
			return managedBinaryReleaseAsset{}, fmt.Errorf("%w: missing browser_download_url for %s", ErrEngineBinaryDownloadFailed, assetName)
		}
		return managedBinaryReleaseAsset{
			Name:        assetName,
			DownloadURL: downloadURL,
			SHA256:      sha256,
		}, nil
	}

	return managedBinaryReleaseAsset{}, fmt.Errorf("%w: release asset %s not found for %s", ErrEngineBinaryDownloadFailed, assetName, strings.TrimSpace(version))
}

func llamaExpectedSHA256(version string, assetName string) (string, error) {
	releaseAsset, err := llamaReleaseAsset(version)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseAsset.Name) != strings.TrimSpace(assetName) {
		return "", fmt.Errorf("%w: release asset mismatch for %s", ErrEngineBinaryDownloadFailed, strings.TrimSpace(assetName))
	}
	return releaseAsset.SHA256, nil
}

func fetchGitHubReleaseByTag(tagURL string, client *http.Client) (githubReleasePayload, error) {
	resp, err := doEngineDownloadRequest(tagURL, client, 60*time.Second)
	if err != nil {
		return githubReleasePayload{}, fmt.Errorf("%w: fetch release metadata: %v", ErrEngineBinaryDownloadFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return githubReleasePayload{}, fmt.Errorf("%w: release metadata HTTP %d from %s", ErrEngineBinaryDownloadFailed, resp.StatusCode, tagURL)
	}

	var payload githubReleasePayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return githubReleasePayload{}, fmt.Errorf("%w: decode release metadata: %v", ErrEngineBinaryDownloadFailed, err)
	}
	return payload, nil
}

func normalizeGitHubAssetDigest(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: release asset digest is required", ErrEngineBinaryDownloadFailed)
	}
	lower := strings.ToLower(trimmed)
	if !strings.HasPrefix(lower, "sha256:") {
		return "", fmt.Errorf("%w: unsupported release asset digest %q", ErrEngineBinaryDownloadFailed, trimmed)
	}
	hash := strings.TrimSpace(trimmed[len("sha256:"):])
	if len(hash) != 64 {
		return "", fmt.Errorf("%w: invalid release asset digest %q", ErrEngineBinaryDownloadFailed, trimmed)
	}
	return strings.ToLower(hash), nil
}

func currentLlamaReleaseBaseURL() string {
	llamaReleaseMu.RLock()
	defer llamaReleaseMu.RUnlock()
	return llamaReleaseBaseURL
}

func currentLlamaReleaseHTTPClient() *http.Client {
	llamaReleaseMu.RLock()
	defer llamaReleaseMu.RUnlock()
	return llamaReleaseHTTPClient
}

func setLlamaReleaseSourceForTest(baseURL string, client *http.Client) func() {
	llamaReleaseMu.Lock()
	prevBaseURL := llamaReleaseBaseURL
	prevClient := llamaReleaseHTTPClient
	llamaReleaseBaseURL = baseURL
	llamaReleaseHTTPClient = client
	llamaReleaseMu.Unlock()
	return func() {
		llamaReleaseMu.Lock()
		llamaReleaseBaseURL = prevBaseURL
		llamaReleaseHTTPClient = prevClient
		llamaReleaseMu.Unlock()
	}
}
