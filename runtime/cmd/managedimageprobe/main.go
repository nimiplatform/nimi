package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func main() {
	backendAddress := flag.String("backend", "127.0.0.1:50052", "managed image backend address")
	modelsRoot := flag.String("models-root", "", "runtime models root")
	modelPath := flag.String("model", "", "image model path")
	timeout := flag.Duration("timeout", 2*time.Minute, "probe timeout")
	flag.Parse()

	if *modelsRoot == "" || *modelPath == "" {
		fmt.Fprintln(os.Stderr, "models-root and model are required")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	err := managedimagebackend.LoadModel(ctx, managedimagebackend.LoadModelRequest{
		BackendAddress: *backendAddress,
		ModelsRoot:     *modelsRoot,
		ModelPath:      *modelPath,
		Options:        append([]string(nil), flag.Args()...),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "LOAD_ERROR: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("LOAD_OK")
}
