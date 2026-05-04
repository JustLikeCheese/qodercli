#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const platform = process.platform;
const arch = process.arch;
const target = `${platform}-${arch}`;
const pkgName = `@qoder-ai/qodercli-${target}`;
const subPkgDir = pkgName.split('/')[1]; // e.g. "qodercli-win32-x64"

// 查找平台子包中的二进制
const BINARY_NAME = platform === 'win32' ? 'qodercli.exe' : 'qodercli';

// __dirname = .../node_modules/@qoder-ai/qodercli/bin/
// npm global install 结构:
//   prefix/node_modules/@qoder-ai/qodercli/       (主包)
//   prefix/node_modules/@qoder-ai/qodercli-win32-x64/  (子包, 同级)
// npm local install 结构:
//   project/node_modules/@qoder-ai/qodercli/
//   project/node_modules/@qoder-ai/qodercli-win32-x64/  (hoisted)
//   或 project/node_modules/@qoder-ai/qodercli/node_modules/@qoder-ai/qodercli-win32-x64/  (nested)

const candidates = [
  // 同级 scope 目录下 (global + hoisted local)
  path.join(__dirname, '..', '..', subPkgDir, 'bin', BINARY_NAME),
  // nested in main package's node_modules
  path.join(__dirname, '..', 'node_modules', pkgName, 'bin', BINARY_NAME),
  // 3 levels up (some pnpm/yarn structures)
  path.join(__dirname, '..', '..', '..', 'node_modules', pkgName, 'bin', BINARY_NAME),
  // npm global on Windows may place under node_modules directly
  path.join(__dirname, '..', '..', '..', subPkgDir, 'bin', BINARY_NAME),
  // resolve from require (most reliable for complex layouts)
];

// Also try require.resolve to find the sub-package
try {
  const subPkgJson = require.resolve(`${pkgName}/package.json`, { paths: [path.join(__dirname, '..')] });
  const subPkgBin = path.join(path.dirname(subPkgJson), 'bin', BINARY_NAME);
  candidates.push(subPkgBin);
} catch {}

let binPath = null;
for (const p of candidates) {
  try {
    if (fs.existsSync(p)) {
      binPath = p;
      break;
    }
  } catch {}
}

if (!binPath) {
  console.error(`Error: Cannot find qodercli binary for your platform (${target})`);
  console.error('');
  console.error(`The platform-specific package "${pkgName}" does not appear to be installed.`);
  console.error('');
  console.error('__dirname:', __dirname);
  console.error('Searched paths:');
  candidates.forEach(p => console.error(`  - ${p} [${fs.existsSync(p) ? 'EXISTS' : 'NOT FOUND'}]`));
  console.error('');
  // List what's actually in the scope directory
  const scopeDir = path.join(__dirname, '..', '..');
  try {
    console.error('Contents of scope dir (' + scopeDir + '):');
    fs.readdirSync(scopeDir).forEach(f => console.error('  ' + f));
  } catch (e) { console.error('  (cannot read: ' + e.message + ')'); }
  console.error('');
  console.error('Supported platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64');
  console.error('Try: npm install -g @qoder-ai/qodercli --include=optional');
  process.exit(1);
}

// Use spawnSync for reliable cross-platform behavior
const result = spawnSync(binPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  console.error('Failed to execute qodercli:', result.error.message);
  process.exit(1);
}

process.exit(result.status !== null ? result.status : 1);
