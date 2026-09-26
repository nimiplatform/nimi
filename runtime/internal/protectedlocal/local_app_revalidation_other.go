//go:build (!darwin && !windows) || (darwin && !cgo)

package protectedlocal

import (
	"context"
	"fmt"
)

func RevalidateDirectLocalAppProcess(context.Context, *LocalAppConnection) error {
	return fmt.Errorf("direct App process revalidation unavailable on this platform")
}
func VerifyLocalAppProcessParent(context.Context, uint32, *Connection) error {
	return fmt.Errorf("App supervisor revalidation unavailable on this platform")
}

func RevalidateDesktopConnectionProcess(context.Context, *Connection) error {
	return fmt.Errorf("Desktop process revalidation unavailable on this platform")
}
