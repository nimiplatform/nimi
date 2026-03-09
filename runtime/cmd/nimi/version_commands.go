package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	goruntime "runtime"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func runRuntimeVersion(args []string) error {
	fs := flag.NewFlagSet("nimi version", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	payload := map[string]any{
		"nimi":   Version,
		"go":     goruntime.Version(),
		"osArch": fmt.Sprintf("%s/%s", goruntime.GOOS, goruntime.GOARCH),
		"config": config.RuntimeConfigPath(),
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("nimi %s\n", Version)
	fmt.Printf("go      %s\n", goruntime.Version())
	fmt.Printf("os/arch %s/%s\n", goruntime.GOOS, goruntime.GOARCH)
	fmt.Printf("config  %s\n", config.RuntimeConfigPath())
	return nil
}
