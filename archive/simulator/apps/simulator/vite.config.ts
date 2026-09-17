import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createSimulatorCssProfileVitePlugin } from '@nimiplatform/app-tools/simulator-css-profile';
import { defineConfig, type Plugin } from 'vite';
import { readSimulatorPublicEnvironment } from './build/public-env.mjs';

const simulatorRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(simulatorRoot, '../..');
const generatedRoot = path.join(simulatorRoot, '.generated');

function selectedSourcePlugin(): Plugin {
  const buildMap = JSON.parse(readFileSync(path.join(generatedRoot, 'build-map.json'), 'utf8')) as Record<string, string>;
  return {
    name: 'nimi-simulator-selected-source',
    enforce: 'pre',
    resolveId(id) {
      const workspacePath = buildMap[id];
      if (!workspacePath) return null;
      if (!/^virtual:nimi-simulator\/[^/]+\/(?:renderer|adapter|style)$/u.test(id)) {
        throw new Error(`Invalid selected-source virtual ID ${id}`);
      }
      return path.join(repoRoot, ...workspacePath.split('/'));
    },
  };
}

function selectedCssProfiles() {
  const buildMap = JSON.parse(readFileSync(path.join(generatedRoot, 'build-map.json'), 'utf8')) as Record<string, string>;
  return Object.entries(buildMap)
    .filter(([id]) => id.endsWith('/style'))
    .map(([id]) => {
      const moduleId = id.split('/').at(-2);
      if (!moduleId) throw new Error(`Invalid selected style virtual ID: ${id}`);
      const validation = JSON.parse(readFileSync(path.join(generatedRoot, 'style-inputs', `${moduleId}.json`), 'utf8'));
      return {
        rootDir: path.join(repoRoot, ...validation.root.split('/')),
        style: validation.style,
      };
    });
}

function secureDevWithoutViteClient(): Plugin {
  const stripCssHmr = (code: string, id: string): string => {
    if (!code.includes('from "/@vite/client"')
      || !code.includes('const __vite__css = ')
      || !code.includes('__vite__updateStyle(__vite__id, __vite__css)')) return code;
    const withoutClient = code
      .replace(/^import \{ createHotContext[^\n]+from "\/@vite\/client"\n/u, '')
      .replace(
        '__vite__updateStyle(__vite__id, __vite__css)',
        'const __nimiStyle = document.createElement("style"); __nimiStyle.dataset.nimiControlledDevStyle = __vite__id; __nimiStyle.textContent = __vite__css; document.head.appendChild(__nimiStyle)',
      )
      .replace(/\nimport\.meta\.hot\.accept\(\)\nimport\.meta\.hot\.prune\([^\n]+\)\s*$/u, '\n');
    if (withoutClient.includes('/@vite/client') || withoutClient.includes('import.meta.hot')) {
      throw new Error(`SIM_DEV_CSS_HMR_TRANSFORM_DRIFT:${id}`);
    }
    return withoutClient;
  };
  const stripModuleHmr = (code: string): string => code
    .replace(
      /import \{ injectQuery as __vite__injectQuery \} from "\/@vite\/client";/gu,
      'const __vite__injectQuery = (url, query) => { if (url[0] !== "." && url[0] !== "/") return url; const pathname = url.replace(/[?#].*$/, ""); const parsed = new URL(url, "http://vite.dev"); return `${pathname}?${query}${parsed.search ? `&${parsed.search.slice(1)}` : ""}${parsed.hash || ""}`; };',
    )
    .replace(
      /import \{ createHotContext as __vite__createHotContext \} from "\/@vite\/client";import\.meta\.hot = __vite__createHotContext\([^;]+\);/gu,
      '',
    );
  return {
    name: 'nimi-simulator-secure-dev-no-vite-client',
    apply: 'serve',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const withoutClient = html.replace(/\s*<script type="module" src="\/@vite\/client"><\/script>\s*/u, '\n');
        const withSelectedSourceAssets = withoutClient.replace(
          "img-src 'none'",
          "img-src 'self' data:",
        );
        if (!withSelectedSourceAssets.includes("connect-src 'none'")) {
          throw new Error('SIM_DEV_CSP_FLOOR_DRIFT');
        }
        return withSelectedSourceAssets;
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (!/\.(?:css|js|jsx|mjs|ts|tsx)$/u.test(pathname)
          && !pathname.startsWith('/node_modules/.vite/deps/')) {
          return next();
        }
        const chunks: Buffer[] = [];
        const originalWrite = response.write.bind(response);
        const originalEnd = response.end.bind(response);
        response.write = ((chunk: unknown) => {
          if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        }) as typeof response.write;
        response.end = ((chunk?: unknown) => {
          if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          try {
            const source = Buffer.concat(chunks).toString('utf8');
            const transformed = stripModuleHmr(stripCssHmr(source, pathname));
            response.removeHeader('content-length');
            return originalEnd(transformed);
          } catch (error) {
            response.write = originalWrite;
            throw error;
          }
        }) as typeof response.end;
        return next();
      });
    },
  };
}

export default defineConfig(() => {
  const publicEnvironment = readSimulatorPublicEnvironment();
  return {
    root: simulatorRoot,
    envPrefix: '__NIMI_SIMULATOR_BROWSER_ENV_DISABLED__',
    define: {
      __NIMI_SIMULATOR_PUBLIC_CONFIG__: JSON.stringify(publicEnvironment),
    },
    plugins: [
      selectedSourcePlugin(),
      createSimulatorCssProfileVitePlugin({
        compilerRoot: simulatorRoot,
        foundationEntry: path.join(simulatorRoot, 'src/styles.css'),
        apps: selectedCssProfiles(),
      }),
      react(),
      tailwindcss(),
      secureDevWithoutViteClient(),
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '127.0.0.1',
      strictPort: false,
      hmr: false,
    },
    // Selected App roots use the Simulator compiler settings rather than
    // inheriting host-specific application tsconfig settings.
    esbuild: {
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          useDefineForClassFields: true,
          verbatimModuleSyntax: true,
        },
      }),
    },
    build: {
      outDir: path.join(simulatorRoot, 'dist'),
      emptyOutDir: true,
      sourcemap: false,
      manifest: 'vite-manifest.json',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
