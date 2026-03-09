package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type initTemplateFile struct {
	Path    string
	Content string
}

func runRuntimeInit(args []string) error {
	fs := flag.NewFlagSet("nimi init", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	targetDir := fs.String("dir", ".", "target directory")
	templateName := fs.String("template", "basic", "template: basic|vercel-ai")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	dir := strings.TrimSpace(*targetDir)
	if dir == "" {
		return fmt.Errorf("dir is required")
	}
	files, err := initTemplateFiles(strings.TrimSpace(*templateName))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	created := make([]string, 0, len(files))
	for _, file := range files {
		targetPath := filepath.Join(dir, file.Path)
		if fileExists(targetPath) {
			return fmt.Errorf("refusing to overwrite existing file: %s", targetPath)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(targetPath, []byte(file.Content), 0o644); err != nil {
			return err
		}
		created = append(created, file.Path)
	}

	payload := map[string]any{
		"dir":      dir,
		"template": *templateName,
		"created":  created,
		"next": []string{
			"npm install",
			"nimi start",
			"npx tsx index.ts",
		},
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Println("Created:")
	for _, item := range created {
		fmt.Printf("  %s\n", item)
	}
	fmt.Println()
	fmt.Println("Next: npm install && nimi start && npx tsx index.ts")
	return nil
}

func initTemplateFiles(templateName string) ([]initTemplateFile, error) {
	switch templateName {
	case "basic":
		return []initTemplateFile{
			{
				Path: "package.json",
				Content: "{\n" +
					"  \"name\": \"my-nimi-app\",\n" +
					"  \"private\": true,\n" +
					"  \"type\": \"module\",\n" +
					"  \"scripts\": {\n" +
					"    \"start\": \"tsx index.ts\"\n" +
					"  },\n" +
					"  \"dependencies\": {\n" +
					"    \"@nimiplatform/sdk\": \"latest\"\n" +
					"  },\n" +
					"  \"devDependencies\": {\n" +
					"    \"tsx\": \"^4.21.0\",\n" +
					"    \"typescript\": \"^5.9.3\"\n" +
					"  }\n" +
					"}\n",
			},
			{
				Path: "tsconfig.json",
				Content: "{\n" +
					"  \"compilerOptions\": {\n" +
					"    \"target\": \"ES2022\",\n" +
					"    \"module\": \"NodeNext\",\n" +
					"    \"moduleResolution\": \"NodeNext\",\n" +
					"    \"strict\": true,\n" +
					"    \"skipLibCheck\": true\n" +
					"  }\n" +
					"}\n",
			},
			{
				Path: "index.ts",
				Content: "import { Runtime } from '@nimiplatform/sdk';\n\n" +
					"const runtime = new Runtime();\n\n" +
					"const result = await runtime.generate({\n" +
					"  prompt: 'What is Nimi in one sentence?',\n" +
					"});\n\n" +
					"console.log(result.text);\n",
			},
			{
				Path: ".env.example",
				Content: "NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371\n" +
					"NIMI_RUNTIME_CLOUD_OPENAI_API_KEY=\n" +
					"NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=\n",
			},
		}, nil
	case "vercel-ai":
		return []initTemplateFile{
			{
				Path: "package.json",
				Content: "{\n" +
					"  \"name\": \"my-nimi-app\",\n" +
					"  \"private\": true,\n" +
					"  \"type\": \"module\",\n" +
					"  \"scripts\": {\n" +
					"    \"start\": \"tsx index.ts\"\n" +
					"  },\n" +
					"  \"dependencies\": {\n" +
					"    \"@nimiplatform/sdk\": \"latest\",\n" +
					"    \"ai\": \"^6.0.85\"\n" +
					"  },\n" +
					"  \"devDependencies\": {\n" +
					"    \"tsx\": \"^4.21.0\",\n" +
					"    \"typescript\": \"^5.9.3\"\n" +
					"  }\n" +
					"}\n",
			},
			{
				Path: "tsconfig.json",
				Content: "{\n" +
					"  \"compilerOptions\": {\n" +
					"    \"target\": \"ES2022\",\n" +
					"    \"module\": \"NodeNext\",\n" +
					"    \"moduleResolution\": \"NodeNext\",\n" +
					"    \"strict\": true,\n" +
					"    \"skipLibCheck\": true\n" +
					"  }\n" +
					"}\n",
			},
			{
				Path: "index.ts",
				Content: "import { Runtime } from '@nimiplatform/sdk';\n" +
					"import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';\n" +
					"import { generateText } from 'ai';\n\n" +
					"const runtime = new Runtime();\n" +
					"const nimi = createNimiAiProvider({ runtime });\n\n" +
					"const { text } = await generateText({\n" +
					"  model: nimi.text('gemini/default'),\n" +
					"  prompt: 'Hello from Vercel AI SDK + Nimi',\n" +
					"});\n\n" +
					"console.log(text);\n",
			},
			{
				Path: ".env.example",
				Content: "NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371\n" +
					"NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=\n",
			},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported template %q", templateName)
	}
}
