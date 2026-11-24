# Security

- Do not store Realm credentials or app-owned bearer credentials in this repository.
- Use `createNimiClient` plus SDK Runtime / Realm surfaces for platform projection.
- Treat the App Access domain declaration as registration input, never operation authority.
