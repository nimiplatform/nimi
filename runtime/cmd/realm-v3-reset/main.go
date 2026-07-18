package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("runtime:realm-v3:reset", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataRoot := flags.String("data-root", "", "absolute Runtime data root containing memory.db")
	dryRun := flags.Bool("dry-run", false, "inventory the scoped reset without mutation")
	confirmation := flags.String("confirm", "", "exact destructive reset confirmation")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "runtime:realm-v3:reset does not accept positional arguments")
		return 2
	}
	if strings.TrimSpace(*dataRoot) == "" {
		fmt.Fprintln(stderr, "runtime:realm-v3:reset requires --data-root")
		return 2
	}
	report, err := runtimepersistence.ResetRealmSourceMaterializationV3(context.Background(), runtimepersistence.RealmSourceMaterializationResetOptions{
		DataRoot:     *dataRoot,
		DryRun:       *dryRun,
		Confirmation: *confirmation,
	})
	if err != nil {
		fmt.Fprintf(stderr, "runtime:realm-v3:reset failed: %v\n", err)
		return 1
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fmt.Fprintf(stderr, "runtime:realm-v3:reset encode report: %v\n", err)
		return 1
	}
	return 0
}
