# Security

- Do not store Realm credentials or app-owned bearer credentials in this repository.
- Use `createNimiClient` plus SDK Runtime / Realm surfaces for platform projection.
- Treat raw `app_access` declarations as inert input until Runtime activates a supported domain through protected ingress.
- Never project registration handles or Registered App Subjects into the renderer.
