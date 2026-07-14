//go:build windows

package account

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
)

func openExternalURL(ctx context.Context, rawURL string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(rawURL) == "" {
		return fmt.Errorf("open Realm presence URL: URL is empty")
	}
	systemDirectory, err := windows.GetSystemDirectory()
	if err != nil {
		return fmt.Errorf("resolve Windows system directory: %w", err)
	}
	rundll32Path := systemDirectory + `\rundll32.exe`
	if err := startWindowsProcessInActiveSession(
		rundll32Path,
		[]string{"url.dll,FileProtocolHandler", rawURL},
	); err != nil {
		return fmt.Errorf("open Realm presence URL in active Windows session: %w", err)
	}
	return nil
}
