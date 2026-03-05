package runtimecatalog

import "embed"

// DefaultProvidersFS holds built-in provider catalog YAML files.
//go:embed providers/*.yaml
var DefaultProvidersFS embed.FS
