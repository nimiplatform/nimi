# Nimi hosted Web apps

The platform Worker serves reviewed static releases at `https://<slug>.nimi.xyz`. The public site uses its `APP_HOST` service binding to read `GET /.well-known/nimi-apps` and `GET /.well-known/nimi-apps/<slug>`. Registry chooses the production release. D1 holds the actual serving pointer. R2 keys include the product ID and the approved archive digest.

## Provision once

1. In the Nimi Cloudflare account create the private R2 Standard bucket `nimi-hosted-web-assets` and D1 database `nimi-hosted-web`. Disable public R2 access. Provide the actual account ID, database UUID and bucket name as `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_HOSTED_WEB_DATABASE_ID` and `CLOUDFLARE_HOSTED_WEB_BUCKET`.
2. From the Nimi repository root, generate the Wrangler config with `node apps/hosted-web/configure.mjs .nimi/local/hosted-web.wrangler.json`. Run `pnpm dlx wrangler@4.127.1 d1 execute nimi-hosted-web --remote --file apps/hosted-web/schema.sql --config .nimi/local/hosted-web.wrangler.json`.
3. Create the proxied wildcard record `AAAA * → 100::` in `nimi.xyz`. Deploy with `pnpm dlx wrangler@4.127.1 deploy --config .nimi/local/hosted-web.wrangler.json`. The config attaches the ordinary HTTPS wildcard Route and disables Workers development and preview URLs. Retire only the reviewed historical host records and rules. Keep the apex redirect and unrelated mail records with their owners.
4. On the official `nimi` Pages project bind the service `nimi-hosted-web` as `APP_HOST` in production and deploy the updated portal. Keep production data out of previews.
5. In the platform repository's main-only GitHub Environment `hosted-web-production`, set those three variables and secret `CLOUDFLARE_HOSTED_WEB_API_TOKEN` for the dedicated D1 write and R2 object writes. The separate provisioning identity owns DNS, Worker deployment and resource bindings. Set repository variable `HOSTED_WEB_ENABLED=true`. The publisher workflow consumes only artifact bytes, never an App-supplied Worker or build script.
6. To notify the platform on merge, configure the Registry's main-only `hosted-web-notify` Environment with `HOSTED_WEB_DISPATCH_TOKEN` for dispatch of the platform workflow (Actions write on `nimiplatform/nimi`), and its own repository variable `HOSTED_WEB_ENABLED=true`. The platform also reconciles every 15 minutes, and supports manual dispatch.

## Publish and recover

App publishers produce a stored ZIP as `nimi-web-<version>.zip` in an immutable Release on a protected `web-v<version>` tag. The GitHub build attestation must identify that commit and `.github/workflows/nimi-web-release.yml`. Use the Registry candidate preparer, then have a Registry maintainer approve the exact descriptor. New Web sources and first releases can share that PR. Native tags and releases remain independent.

The policy job runs separately from uploads. On a successful first deployment or source change it is the publisher that checks the current source and verifies the real host. Release requests never bypass the per-product policy check. During short Registry outages, eligible static deployments retain a 24-hour grace period measured from the last successful global check; Realm applies its own 30-second identity rule. Known suspension is enforced before serving cached network requests. For an exact suspended origin the existing context query and context-end paths remain available.

A bad upload leaves the prior pointer in place. A failed post-switch probe reports a CI failure. A maintainer can select a compatible previously approved version in the source record, then let the same workflow switch conditionally using the already retained R2 bytes. Do not delete retained objects needed by old open tabs or rollback. No per-tenant DNS or script provisioning is involved.

Run the focused gateway and release tests with `pnpm --filter @nimiplatform/hosted-web test`. These use local workerd, D1 and R2. Production DNS, source admission, personal account confirmation and a real primary Runtime are separate acceptance prerequisites.
