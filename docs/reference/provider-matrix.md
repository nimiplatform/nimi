# Provider Matrix

Nimi runtime can route AI requests to local engines and cloud providers.

## Local engines

- LocalAI
- Nexa

## Cloud provider families

- OpenAI-compatible
- Gemini
- DashScope
- Volcengine / OpenSpeech
- MiniMax
- GLM
- Kimi

## How to validate in your environment

```bash
cd runtime
go run ./cmd/nimi providers --source grpc
```

For runnable provider examples, see `examples/sdk/providers/*.ts`.
