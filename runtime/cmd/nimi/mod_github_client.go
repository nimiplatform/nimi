package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type githubRESTClient struct {
	baseURL string
	token   string
	client  *http.Client
}

type githubPullRequest struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
}

type githubContentItem struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

type githubContentFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

func newGitHubRESTClient(baseURL string, token string) *githubRESTClient {
	normalized := strings.TrimSpace(baseURL)
	if normalized == "" {
		normalized = defaultGitHubAPIBase
	}
	return &githubRESTClient{
		baseURL: strings.TrimRight(normalized, "/"),
		token:   strings.TrimSpace(token),
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *githubRESTClient) getBranchSHA(ctx context.Context, owner string, repo string, branch string) (string, error) {
	var payload struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return "", fmt.Errorf("resolve base branch sha failed: invalid owner/repo")
	}
	normalizedBranch, err := normalizeGitHubRelativePath(branch)
	if err != nil {
		return "", fmt.Errorf("resolve base branch sha failed: %w", err)
	}
	if err := c.do(ctx, http.MethodGet, joinGitHubAPIPath("repos", owner, repo, "git", "ref", "heads", normalizedBranch), nil, &payload); err != nil {
		return "", fmt.Errorf("resolve base branch sha failed: %w", err)
	}
	if strings.TrimSpace(payload.Object.SHA) == "" {
		return "", fmt.Errorf("resolve base branch sha failed: empty sha")
	}
	return payload.Object.SHA, nil
}

func (c *githubRESTClient) createBranch(ctx context.Context, owner string, repo string, branch string, sha string) error {
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return fmt.Errorf("create publish branch failed: invalid owner/repo")
	}
	normalizedBranch, err := normalizeGitHubRelativePath(branch)
	if err != nil {
		return fmt.Errorf("create publish branch failed: %w", err)
	}
	body := map[string]any{
		"ref": "refs/heads/" + normalizedBranch,
		"sha": sha,
	}
	if err := c.do(ctx, http.MethodPost, joinGitHubAPIPath("repos", owner, repo, "git", "refs"), body, nil); err != nil {
		return fmt.Errorf("create publish branch failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) putFile(ctx context.Context, owner string, repo string, path string, branch string, message string, content []byte) error {
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return fmt.Errorf("commit mod index file failed: invalid owner/repo")
	}
	normalizedPath, err := normalizeGitHubRelativePath(path)
	if err != nil {
		return fmt.Errorf("commit mod index file failed: %w", err)
	}
	normalizedBranch, err := normalizeGitHubRelativePath(branch)
	if err != nil {
		return fmt.Errorf("commit mod index file failed: %w", err)
	}
	body := map[string]any{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(content),
		"branch":  normalizedBranch,
	}
	if err := c.do(ctx, http.MethodPut, joinGitHubAPIPath("repos", owner, repo, "contents", normalizedPath), body, nil); err != nil {
		return fmt.Errorf("commit mod index file failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) createPullRequest(ctx context.Context, owner string, repo string, title string, head string, base string, body string) (githubPullRequest, error) {
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: invalid owner/repo")
	}
	normalizedHead, err := normalizeGitHubRelativePath(head)
	if err != nil {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: %w", err)
	}
	normalizedBase, err := normalizeGitHubRelativePath(base)
	if err != nil {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: %w", err)
	}
	request := map[string]any{
		"title": title,
		"head":  normalizedHead,
		"base":  normalizedBase,
		"body":  body,
	}
	var response githubPullRequest
	if err := c.do(ctx, http.MethodPost, joinGitHubAPIPath("repos", owner, repo, "pulls"), request, &response); err != nil {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: %w", err)
	}
	if response.Number <= 0 || strings.TrimSpace(response.HTMLURL) == "" {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: invalid response")
	}
	return response, nil
}

func (c *githubRESTClient) listDirectory(ctx context.Context, owner string, repo string, path string, ref string) ([]githubContentItem, error) {
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return nil, fmt.Errorf("list directory failed: invalid owner/repo")
	}
	normalizedPath, err := normalizeGitHubRelativePath(path)
	if err != nil {
		return nil, fmt.Errorf("list directory failed: %w", err)
	}
	query := ""
	if strings.TrimSpace(ref) != "" {
		normalizedRef, refErr := normalizeGitHubRelativePath(ref)
		if refErr != nil {
			return nil, fmt.Errorf("list directory failed: %w", refErr)
		}
		query = "?ref=" + url.QueryEscape(normalizedRef)
	}
	endpoint := joinGitHubAPIPath("repos", owner, repo, "contents", normalizedPath) + query
	var response []githubContentItem
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("list directory failed: %w", err)
	}
	return response, nil
}

func (c *githubRESTClient) getFileContent(ctx context.Context, owner string, repo string, path string, ref string) ([]byte, error) {
	if !isValidGitHubName(owner) || !isValidGitHubName(repo) {
		return nil, fmt.Errorf("fetch file content failed: invalid owner/repo")
	}
	normalizedPath, err := normalizeGitHubRelativePath(path)
	if err != nil {
		return nil, fmt.Errorf("fetch file content failed: %w", err)
	}
	query := ""
	if strings.TrimSpace(ref) != "" {
		normalizedRef, refErr := normalizeGitHubRelativePath(ref)
		if refErr != nil {
			return nil, fmt.Errorf("fetch file content failed: %w", refErr)
		}
		query = "?ref=" + url.QueryEscape(normalizedRef)
	}
	endpoint := joinGitHubAPIPath("repos", owner, repo, "contents", normalizedPath) + query
	var response githubContentFile
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("fetch file content failed: %w", err)
	}
	if strings.TrimSpace(response.Encoding) != "base64" {
		return nil, fmt.Errorf("fetch file content failed: unsupported encoding=%s", response.Encoding)
	}
	normalized := strings.ReplaceAll(response.Content, "\n", "")
	normalized = strings.TrimSpace(normalized)
	content, err := base64.StdEncoding.DecodeString(normalized)
	if err != nil {
		return nil, fmt.Errorf("fetch file content failed: decode base64: %w", err)
	}
	return content, nil
}

func joinGitHubAPIPath(segments ...string) string {
	clean := make([]string, 0, len(segments))
	for _, segment := range segments {
		for _, part := range strings.Split(segment, "/") {
			trimmed := strings.TrimSpace(part)
			if trimmed == "" {
				continue
			}
			clean = append(clean, url.PathEscape(trimmed))
		}
	}
	return "/" + strings.Join(clean, "/")
}

func (c *githubRESTClient) do(ctx context.Context, method string, path string, requestBody any, responseBody any) error {
	var bodyReader io.Reader
	if requestBody != nil {
		raw, err := json.Marshal(requestBody)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}

	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	raw, err := readAllBounded(response.Body, maxGitHubResponseBodyBytes, "github api response body")
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("status=%d body=%s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	if responseBody == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, responseBody); err != nil {
		return err
	}
	return nil
}
