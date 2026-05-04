#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const platform = process.platform;
const arch = process.arch;
const target = `${platform}-${arch}`;
const pkgName = `@qoder-ai/qodercli-${target}`;

// 查找平台子包中的二进制
const BINARY_NAME = platform === 'win32' ? 'qodercli.exe' : 'qodercli';

// 尝试多种路径：
// 1. node_modules 中的子包（npm install 场景）
// 2. 同级目录（开发/调试场景）
const candidates = [
  path.join(__dirname, '..', 'node_modules', pkgName, 'bin', BINARY_NAME),
  path.join(__dirname, '..', '..', pkgName.split('/')[1], 'bin', BINARY_NAME),
  path.join(__dirname, '..', '..', '..', 'node_modules', pkgName, 'bin', BINARY_NAME),
  path.join(__dirname, target, BINARY_NAME),
];

let binPath = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    binPath = p;
    break;
  }
}

if (!binPath) {
  console.error(`Error: Cannot find qodercli binary for your platform (${target})`);
  console.error('');
  console.error(`The platform-specific package "${pkgName}" does not appear to be installed.`);
  console.error('');
  console.error('This usually means:');
  console.error('  1. Your platform is not supported, or');
  console.error('  2. The optional dependency was not installed (try: npm install --include=optional)');
  console.error('');
  console.error('Supported platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64');
  process.exit(1);
}

const child = spawn(binPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => {
  process.exit(code !== null ? code : 1);
});

child.on('error', (error) => {
  console.error('Failed to execute qodercli:', error.message);
  process.exit(1);
});
