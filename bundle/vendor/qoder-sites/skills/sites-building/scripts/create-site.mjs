import '../templates/react-starter/scripts/check-node.mjs';
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy only into a new or empty project. Dependency installation stays explicit.
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) {
  console.error('Usage: node create-site.mjs <project-root>');
  process.exit(1);
}
const target = resolve(destination);
try {
  const stat = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error('The project root must be a real directory.');
  }
  const entries = stat ? await readdir(target) : [];
  if (entries.some((entry) => entry !== '.git' && entry !== '.DS_Store')) {
    throw new Error('The project already contains files. Preserve its setup and adapt it in place.');
  }
  await mkdir(target, { recursive: true });
  const source = fileURLToPath(new URL('../templates/react-starter/', import.meta.url));
  for (const entry of await readdir(source)) {
    await cp(join(source, entry), join(target, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (path) => !['node_modules', 'dist', '.DS_Store'].includes(path.split('/').at(-1)),
    });
  }
  console.log(`Created ${target}. Run npm ci and npm run dev from that directory.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
