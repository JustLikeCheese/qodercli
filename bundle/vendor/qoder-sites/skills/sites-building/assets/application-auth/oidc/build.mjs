import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle dependencies locally; the deployed Function does not fetch npm code.
for (const [entry, target] of [['./index.ts', './dist/function/index.ts'], ['../introspection/index.ts', './dist/introspection/index.ts']]) {
  await build({
    absWorkingDir: fileURLToPath(new URL('.', import.meta.url)), entryPoints: [entry], outfile: target,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    external: ['./_qoder/backend.mjs'], legalComments: 'eof',
  });
}
