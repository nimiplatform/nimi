package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	_ "modernc.org/sqlite"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "convert-chat-storage:", err)
		os.Exit(1)
	}
}
func run() error {
	file := flag.String("db", "", "explicit path to the Runtime database")
	apply := flag.Bool("apply", false, "convert inline conversation storage; default is read-only inspection")
	stopped := flag.Bool("confirm-runtime-stopped", false, "confirm that the Runtime is stopped")
	backup := flag.String("backup", "", "backup file (apply only); defaults to a timestamped sibling")
	flag.Parse()
	if *file == "" || !*stopped {
		return fmt.Errorf("--db and --confirm-runtime-stopped are required")
	}
	if *backup != "" && !*apply {
		return fmt.Errorf("--backup requires --apply")
	}
	abs, err := filepath.Abs(*file)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("database must be a regular file")
	}
	mode := "ro"
	if *apply {
		mode = "rw"
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=" + mode}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)
	needed, err := runtimeagent.ConvertConversationStorage(context.Background(), db, false)
	if err != nil {
		return err
	}
	if !needed {
		fmt.Println("Conversation storage needs no conversion.")
		return nil
	}
	if !*apply {
		fmt.Println("Inline conversation storage found. Apply preserves all conversations and writes a backup first.")
		return nil
	}
	if *backup == "" {
		*backup = abs + ".before-conversation-rows-" + time.Now().UTC().Format("20060102T150405.000000000") + ".db"
	}
	backupAbs, err := filepath.Abs(*backup)
	if err != nil {
		return err
	}
	if _, err := os.Stat(backupAbs); !os.IsNotExist(err) {
		return fmt.Errorf("backup path must not exist")
	}
	reserved, err := os.OpenFile(backupAbs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("reserve private backup: %w", err)
	}
	if err := reserved.Close(); err != nil {
		return err
	}
	if _, err := db.Exec("VACUUM INTO '" + strings.ReplaceAll(backupAbs, "'", "''") + "'"); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	if _, err := runtimeagent.ConvertConversationStorage(context.Background(), db, true); err != nil {
		return err
	}
	fmt.Println("Conversation storage converted; backup:", backupAbs)
	return nil
}
