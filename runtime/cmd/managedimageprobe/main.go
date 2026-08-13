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
	dst := flag.String("dst", "", "generate destination path; when empty the probe only loads the model")
	prompt := flag.String("prompt", "", "positive prompt for generation")
	negativePrompt := flag.String("negative-prompt", "", "negative prompt for generation")
	width := flag.Int("width", 1024, "generation width")
	height := flag.Int("height", 1024, "generation height")
	steps := flag.Int("steps", 4, "generation steps")
	seed := flag.Int("seed", 1, "generation seed")
	cfgScale := flag.Float64("cfg-scale", 1, "generation CFG scale")
	threads := flag.Int("threads", 0, "backend load thread count")
	timeout := flag.Duration("timeout", 2*time.Minute, "probe timeout")
	flag.Parse()

	if *modelsRoot == "" || *modelPath == "" {
		fmt.Fprintln(os.Stderr, "models-root and model are required")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	options := append([]string(nil), flag.Args()...)
	if *dst == "" {
		_, err := managedimagebackend.LoadModel(ctx, managedimagebackend.LoadModelRequest{
			BackendAddress: *backendAddress,
			Protocol:       managedimagebackend.ProtocolDirectGOSD,
			ModelsRoot:     *modelsRoot,
			ModelPath:      *modelPath,
			DirectOptions:  options,
			DirectCFGScale: float32(*cfgScale),
			Threads:        int32(*threads),
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "LOAD_ERROR: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("LOAD_OK")
		return
	}

	_, err := managedimagebackend.LoadModel(ctx, managedimagebackend.LoadModelRequest{
		BackendAddress: *backendAddress,
		Protocol:       managedimagebackend.ProtocolDirectGOSD,
		ModelsRoot:     *modelsRoot,
		ModelPath:      *modelPath,
		DirectOptions:  options,
		DirectCFGScale: float32(*cfgScale),
		Threads:        int32(*threads),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "LOAD_ERROR: %v\n", err)
		os.Exit(1)
	}

	_, err = managedimagebackend.GenerateImage(ctx, managedimagebackend.ImageRequest{
		BackendAddress: *backendAddress,
		Protocol:       managedimagebackend.ProtocolDirectGOSD,
		Mode:           managedimagebackend.ImageRequestModeTextToImage,
		ModelsRoot:     *modelsRoot,
		ModelPath:      *modelPath,
		CFGScale:       float32(*cfgScale),
		Width:          int32(*width),
		Height:         int32(*height),
		Step:           int32(*steps),
		Seed:           int32(*seed),
		PositivePrompt: *prompt,
		NegativePrompt: *negativePrompt,
		Dst:            *dst,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "GENERATE_ERROR: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("GENERATE_OK")
}
