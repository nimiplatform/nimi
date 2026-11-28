package engine

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

//go:embed assets/upscale_frames.dgl
var upscaleFrameProgram string

//go:embed assets/relayvsr_upscale.dgl
var relayVSRProgram string

//go:embed assets/seedvr2_upscale.dgl
var seedVR2Program string

type upscaleCLI struct {
	executable, directory, release string
	env                            map[string]string
}

// @nimi-authority: rule.nimi.runtime.ai-provider.media-upscale-contract
func (cli upscaleCLI) run(ctx context.Context, plan *capabilitydriver.UpscaleInvocationPlan, work, input, output string, frames, fps int) error {
	var args []string
	switch cli.release {
	case "master-1088-32d516c": // Independently pinned Apple Silicon development archive.
		args = []string{"-M", "vid_upscale", "--diffusion-model", plan.Bindings[0].AbsolutePath, "--vae", plan.Bindings[1].AbsolutePath,
			"--upscale-factor", strconv.Itoa(int(plan.Scale)), "--seed", strconv.FormatInt(plan.Seed, 10), "--offload-to-cpu"}
		if plan.Family == "seedvr2" {
			args = append(args, "--vsr-temporal-chunk-size", "1")
		}
		if plan.Video {
			args = append(args, "--input-frames", input, "--fps", strconv.Itoa(fps), "-o", filepath.Join(output, "frame-%06d.png"))
		} else {
			args = append(args, "-i", input, "-o", output)
		}
	case "master-1147-3b0426f":
		program, err := upscaleDGL(plan, input, output, frames, fps)
		if err != nil {
			return err
		}
		path := filepath.Join(work, "upscale.dgl")
		if err := os.WriteFile(path, []byte(program), 0o600); err != nil {
			return fmt.Errorf("write super-resolution program: %w", err)
		}
		// The upstream default embeds the program, including private model paths, in PNGs.
		args = []string{"-M", "dgl", "--script", path, "--offload-to-cpu", "--disable-image-metadata"}
	default:
		return fmt.Errorf("unsupported super-resolution engine release %q", cli.release)
	}
	_, err := runUpscaleCommand(ctx, cli.directory, cli.env, cli.executable, args...)
	return err
}

func upscaleDGL(plan *capabilitydriver.UpscaleInvocationPlan, input, output string, frames, fps int) (string, error) {
	var program strings.Builder
	program.WriteString(upscaleFrameProgram)
	program.WriteByte('\n')
	switch plan.Family {
	case "relayvsr":
		program.WriteString(relayVSRProgram)
	case "seedvr2":
		program.WriteString(seedVR2Program)
	default:
		return "", fmt.Errorf("unsupported super-resolution family %q", plan.Family)
	}
	// DGL uses JSON string literals, including for paths containing quotes or backslashes.
	pathLiteral := func(path string) string {
		literal, _ := json.Marshal(path)
		return string(literal)
	}
	program.WriteString("\nfn main() {\n")
	fmt.Fprintf(&program, "    dit = load_dit(%s)\n    vae = load_vae(%s)\n", pathLiteral(plan.Bindings[0].AbsolutePath), pathLiteral(plan.Bindings[1].AbsolutePath))
	if plan.Video {
		fmt.Fprintf(&program, "    clip = video::load(%s, fps_num = %d)\n    frames = clip.video.frames\n", pathLiteral(input), fps)
	} else {
		fmt.Fprintf(&program, "    frames = tensor::unsqueeze(image::load(%s)[0:3, :, :], axis = 3)\n", pathLiteral(input))
	}
	fmt.Fprintf(&program, "    pixels = enhance_frames(frames, dit, vae, make_rng(\"cuda\", seed = %d), %d)\n", plan.Seed, plan.Scale)
	paths := []string{output}
	if plan.Video {
		paths = make([]string, frames)
		for i := range paths {
			paths[i] = filepath.Join(output, fmt.Sprintf("frame-%06d.png", i))
		}
	}
	// Iterate the actual frames. Extra frames exceed paths; missing frames fail the Host's output check.
	encodedPaths, _ := json.Marshal(paths)
	fmt.Fprintf(&program, "    indices = tensor::to_list(tensor::arange(0, tensor::shape(pixels)[3]))\n    return map(indices, process = save_frame, pixels = pixels, paths = %s)\n}\n", encodedPaths)
	return program.String(), nil
}
