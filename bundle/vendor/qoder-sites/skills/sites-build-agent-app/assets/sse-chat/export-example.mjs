// Export static assets and a fail-closed Function entry into a NEW directory.
import { cp, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const argument = process.argv[2];
if (!argument || process.argv.length !== 3) throw Error('Usage: node export-example.mjs <new-output-directory>');
const output = resolve(argument);
await mkdir(dirname(output), { recursive: true });
try { await mkdir(output); }
catch (error) {
  if (error.code === 'EEXIST') throw Error('Choose a new output directory; existing files are never overwritten.');
  throw error;
}
const copy = (source, destination, options = {}) => cp(source, destination, { ...options, force: false, errorOnExist: true });
await mkdir(join(output, 'functions/sse-chat'), { recursive: true });
await copy(new URL('./web/', import.meta.url), join(output, 'web'), { recursive: true });
await mkdir(join(output, 'web/helpers'));
for (const filename of ['conversation-stream.mjs', 'sse.mjs']) await copy(new URL(`../${filename}`, import.meta.url), join(output, 'web/helpers', filename));
for (const filename of ['cloud-agents.mjs', 'sse.mjs']) await copy(new URL(`../${filename}`, import.meta.url), join(output, 'functions', filename));
for (const filename of ['handler.mjs', 'managed-transport.mjs']) await copy(new URL(`./${filename}`, import.meta.url), join(output, 'functions/sse-chat', filename));
await copy(new URL('./function-entry.ts', import.meta.url), join(output, 'functions/index.ts'));
console.log(`Exported ${output}\nweb/: static frontend, no build step\nfunctions/: returns 503 until the application service is implemented\ndev/ fixtures were not copied.`);
