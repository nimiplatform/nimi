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
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s/git/ref/heads/%s", owner, repo, branch), nil, &payload); err != nil {
		return "", fmt.Errorf("resolve base branch sha failed: %w", err)
	}
	if strings.TrimSpace(payload.Object.SHA) == "" {
		return "", fmt.Errorf("resolve base branch sha failed: empty sha")
	}
	return payload.Object.SHA, nil
}

func (c *githubRESTClient) createBranch(ctx context.Context, owner string, repo string, branch string, sha string) error {
	body := map[string]any{
		"ref": "refs/heads/" + branch,
		"sha": sha,
	}
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/git/refs", owner, repo), body, nil); err != nil {
		return fmt.Errorf("create publish branch failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) putFile(ctx context.Context, owner string, repo string, path string, branch string, message string, content []byte) error {
	body := map[string]any{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(content),
		"branch":  branch,
	}
	if err := c.do(ctx, http.MethodPut, fmt.Sprintf("/repos/%s/%s/contents/%s", owner, repo, path), body, nil); err != nil {
		return fmt.Errorf("commit mod index file failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) createPullRequest(ctx context.Context, owner string, repo string, title string, head string, base string, body string) (githubPullRequest, error) {
	request := map[string]any{
		"title": title,
		"head":  head,
		"base":  base,
		"body":  body,
	}
	var response githubPullRequest
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/pulls", owner, repo), request, &response); err != nil {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: %w", err)
	}
	if response.Number <= 0 || strings.TrimSpace(response.HTMLURL) == "" {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: invalid response")
	}
	return response, nil
}

func (c *githubRESTClient) listDirectory(ctx context.Context, owner string, repo string, path string, ref string) ([]githubContentItem, error) {
	query := ""
	if strings.TrimSpace(ref) != "" {
		query = "?ref=" + url.QueryEscape(strings.TrimSpace(ref))
	}
	endpoint := fmt.Sprintf("/repos/%s/%s/contents/%s%s", owner, repo, strings.Trim(path, "/"), query)
	var response []githubContentItem
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("list directory failed: %w", err)
	}
	return response, nil
}

func (c *githubRESTClient) getFileContent(ctx context.Context, owner string, repo string, path string, ref string) ([]byte, error) {
	query := ""
	if strings.TrimSpace(ref) != "" {
		query = "?ref=" + url.QueryEscape(strings.TrimSpace(ref))
	}
	endpoint := fmt.Sprintf("/repos/%s/%s/contents/%s%s", owner, repo, strings.Trim(path, "/"), query)
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

	raw, err := io.ReadAll(response.Body)
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
