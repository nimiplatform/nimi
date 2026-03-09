# Runtime Reference

Nimi Runtime is the local AI execution daemon used by apps and desktop.

## Command entry

```bash
nimi start
```

## Operational commands

```bash
nimi doctor
nimi status
nimi health --source grpc
nimi logs --tail 100
nimi stop
nimi version
nimi model list --json
nimi provider list --json
nimi run "Hello from Nimi"
nimi run "Hello from Nimi" --provider gemini
nimi run "Hello from Nimi" --cloud
```

Foreground mode remains available when you want direct daemon logs:

```bash
nimi serve
```

## Source development entry

If you are developing Nimi from source instead of consuming the released binary:

```bash
cd runtime
go run ./cmd/nimi serve
```

## Health endpoints

- `GET /livez`
- `GET /readyz`
- `GET /v1/runtime/health`

## Source references

- Runtime implementation notes: [`runtime/README.md`](../../runtime/README.md)
- Runtime spec domain docs: [`spec/runtime`](../../spec/runtime)
- Runtime kernel contracts: [`spec/runtime/kernel`](../../spec/runtime/kernel)
