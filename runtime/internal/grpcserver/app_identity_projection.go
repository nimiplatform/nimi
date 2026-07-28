package grpcserver

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appidentityprojection"
)

func loadNimiAppIdentityProjection(path string) (*appidentityprojection.Projection, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, nil
	}
	projection, err := appidentityprojection.LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("load Nimi App identity projection: %w", err)
	}
	return projection, nil
}
