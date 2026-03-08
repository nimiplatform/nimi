package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func resolveExistingDir(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "github:") || strings.HasPrefix(trimmed, "https://github.com/") {
		return "", false
	}
	if strings.Contains(trimmed, "/") || strings.Contains(trimmed, "\\") {
		if info, err := os.Stat(trimmed); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(trimmed)
			if abs != "" {
				return abs, true
			}
			return trimmed, true
		}
	}
	if info, err := os.Stat(trimmed); err == nil && info.IsDir() {
		abs, _ := filepath.Abs(trimmed)
		if abs != "" {
			return abs, true
		}
		return trimmed, true
	}
	return "", false
}

func deriveInstallTargetName(source string) string {
	if localDir, ok := resolveExistingDir(source); ok {
		return slugify(filepath.Base(localDir))
	}
	if modCircleSelector, ok := parseModCircleInstallSelector(source); ok {
		return slugify(modCircleSelector)
	}
	owner, repo, subpath, err := parseGitHubRepoReference(source)
	if err != nil {
		return ""
	}
	if subpath != "" {
		parts := strings.Split(subpath, "/")
		last := strings.TrimSpace(parts[len(parts)-1])
		if last != "" {
			return slugify(last)
		}
	}
	if repo != "" {
		return slugify(repo)
	}
	return slugify(owner)
}

func parseGitHubRepoReference(raw string) (string, string, string, error) {
	normalized := normalizeGitHubRepoToken(raw)
	parts := strings.Split(normalized, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		clean = append(clean, trimmed)
	}
	if len(clean) < 2 {
		return "", "", "", fmt.Errorf("invalid GitHub repo reference %q (expected owner/repo)", raw)
	}
	owner := clean[0]
	repo := strings.TrimSuffix(clean[1], ".git")
	subpath := ""
	if len(clean) > 2 {
		subpath = strings.Join(clean[2:], "/")
	}
	if owner == "" || repo == "" {
		return "", "", "", fmt.Errorf("invalid GitHub repo reference %q", raw)
	}
	return owner, repo, subpath, nil
}

func normalizeGitHubRepoToken(raw string) string {
	normalized := strings.TrimSpace(raw)
	normalized = strings.TrimPrefix(normalized, "github:")
	normalized = strings.TrimPrefix(normalized, "https://github.com/")
	normalized = strings.TrimPrefix(normalized, "http://github.com/")
	normalized = strings.TrimSuffix(normalized, ".git")
	normalized = strings.Trim(normalized, "/")
	return normalized
}

func slugify(input string) string {
	trimmed := strings.ToLower(strings.TrimSpace(input))
	if trimmed == "" {
		return "mod"
	}
	replacer := strings.NewReplacer(
		" ", "-",
		"_", "-",
		"/", "-",
		"\\", "-",
		".", "-",
		":", "-",
	)
	trimmed = replacer.Replace(trimmed)
	builder := strings.Builder{}
	lastDash := false
	for _, char := range trimmed {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "mod"
	}
	return result
}

func titleFromSlug(input string) string {
	parts := strings.Split(slugify(input), "-")
	words := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		words = append(words, strings.ToUpper(part[:1])+part[1:])
	}
	if len(words) == 0 {
		return "My Mod"
	}
	return strings.Join(words, " ")
}

func trimQuotes(input string) string {
	trimmed := strings.TrimSpace(input)
	trimmed = strings.TrimPrefix(trimmed, `"`)
	trimmed = strings.TrimSuffix(trimmed, `"`)
	trimmed = strings.TrimPrefix(trimmed, "'")
	trimmed = strings.TrimSuffix(trimmed, "'")
	return strings.TrimSpace(trimmed)
}

func defaultString(input string, fallback string) string {
	if strings.TrimSpace(input) == "" {
		return fallback
	}
	return input
}
