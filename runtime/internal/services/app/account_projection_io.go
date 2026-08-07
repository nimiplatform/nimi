package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type runtimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

type runtimeCurrentUserDisplayProvider interface {
	CurrentUserDisplay(context.Context) (accountservice.CurrentUserDisplay, error)
}

func defaultNimiDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory for ~/.nimi: %w", err)
	}
	home = strings.TrimSpace(home)
	if home == "" {
		return "", errors.New("home directory is empty; cannot resolve ~/.nimi")
	}
	return filepath.Join(home, ".nimi"), nil
}

func readRequiredJSON(path string, out any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%s is missing; Runtime projection fails closed", filepath.Base(path))
		}
		return fmt.Errorf("%s is not readable: %w", filepath.Base(path), err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%s is not valid JSON: %w", filepath.Base(path), err)
	}
	return nil
}

func accountPathSegment(accountID string) string {
	var out strings.Builder
	for _, value := range []byte(accountID) {
		switch {
		case value >= 'A' && value <= 'Z', value >= 'a' && value <= 'z', value >= '0' && value <= '9',
			value == '-' || value == '_' || value == '.':
			out.WriteByte(value)
		default:
			out.WriteString(fmt.Sprintf("%%%02X", value))
		}
	}
	return out.String()
}
