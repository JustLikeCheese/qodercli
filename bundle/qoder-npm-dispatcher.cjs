#!/usr/bin/env node
// Qoder npm-channel dispatcher.
// Routes `qoder ...` to either Qoder CLI or Qoder IDE.

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { accessSync, constants, existsSync, statSync } = fs;
const {
  delimiter,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require('node:path');
const os = require('node:os');

const args = process.argv.slice(2);

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return resolve(p || '');
  }
}

function isNpmShimForSelf(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf8');
    return head.includes('qoder-npm-dispatcher.cjs');
  } catch {
    return false;
  }
}

function isCliDispatcherWrapper(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf8');
    return head.includes('qoder-dispatcher.ps1');
  } catch {
    return false;
  }
}

function isIdeLauncher(filePath) {
  try {
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile())
      return false;
    if (process.platform !== 'win32') accessSync(filePath, constants.X_OK);
  } catch {
    return false;
  }
  if (safeRealpath(filePath) === safeRealpath(__filename)) return false;
  if (isNpmShimForSelf(filePath)) return false;
  if (isCliDispatcherWrapper(filePath)) return false;
  return true;
}

function findIdeLauncher(candidates) {
  return candidates.find(isIdeLauncher) || null;
}

function macIdeLauncher(app) {
  const launcher = join(app, 'Contents', 'Resources', 'app', 'bin', 'code');
  if (!isIdeLauncher(launcher)) return null;

  const plist = join(app, 'Contents', 'Info.plist');
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist],
    { encoding: 'utf8' },
  );
  if (
    !result.error &&
    result.status === 0 &&
    result.stdout.trim() === 'com.qoder.ide'
  ) {
    return launcher;
  }
  return null;
}

function isWithinDirectory(root, candidate) {
  const rel = relative(safeRealpath(root), safeRealpath(candidate));
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function findMacIde() {
  const roots = [join(os.homedir(), 'Applications'), '/Applications'];
  const appNames = ['Qoder IDE.app', 'Qoder.app'];

  // Known package paths are deterministic and do not depend on Spotlight.
  for (const root of roots) {
    for (const appName of appNames) {
      const launcher = macIdeLauncher(join(root, appName));
      if (launcher) return launcher;
    }
  }

  // Fall back to bundle identity so future app renames remain discoverable.
  // Query supported roots separately and sort results because mdfind does not
  // define its output order. Direct Info.plist validation remains authoritative
  // in case Spotlight metadata is stale.
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const result = spawnSync(
      '/usr/bin/mdfind',
      [
        '-onlyin',
        root,
        "kMDItemCFBundleIdentifier == 'com.qoder.ide'",
      ],
      { encoding: 'utf8' },
    );
    if (
      result.error ||
      result.status !== 0 ||
      typeof result.stdout !== 'string'
    )
      continue;

    const apps = result.stdout.split(/\r?\n/).filter(Boolean).sort();
    for (const app of apps) {
      if (!isWithinDirectory(root, app)) continue;
      const launcher = macIdeLauncher(app);
      if (launcher) return launcher;
    }
  }
  return null;
}

function samePath(left, right) {
  if (!left || !right) return false;
  const a = safeRealpath(left).replace(/[\\/]+$/, '');
  const b = safeRealpath(right).replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function runCliBundle(passArgs) {
  const bundleEntry = resolve(__dirname, 'qodercli.js');
  if (!existsSync(bundleEntry)) {
    process.stderr.write(
      'Qoder CLI is not installed. Install: https://qoder.com\n',
    );
    process.stderr.write(
      'Tip: `qoder ide` is available if the IDE is installed.\n',
    );
    process.exit(127);
  }
  const r = spawnSync(process.execPath, [bundleEntry, ...passArgs], {
    stdio: 'inherit',
  });
  if (r.error) {
    process.stderr.write(String(r.error) + '\n');
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

function findWindowsIde() {
  const dispatcherDir = join(os.homedir(), '.qoder', 'entry');
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    if (samePath(dir, dispatcherDir)) continue;

    const publicLauncher = findIdeLauncher([
      join(dir, 'qoder.cmd'),
      join(dir, 'qoder'),
      join(dir, 'qoder.exe'),
      join(dir, 'qoder.bat'),
    ]);
    if (!publicLauncher) continue;

    const nativeLauncher = findIdeLauncher([
      join(dir, 'code.cmd'),
      join(dir, 'code'),
      join(dir, 'code.exe'),
    ]);
    return nativeLauncher || publicLauncher;
  }
  return null;
}

function findRemoteIde() {
  // VS Code-compatible remote terminals bind the injected remote CLI to the
  // active IDE session through this IPC handle. Requiring both the handle and
  // a PATH directory named remote-cli leaves local discovery unchanged.
  if (!process.env.VSCODE_IPC_HOOK_CLI) return null;

  const commandNames = [
    'qoder',
    'qoder',
  ];
  const extensions =
    process.platform === 'win32' ? ['.cmd', '', '.exe', '.bat'] : [''];

  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    if (!/(^|[\\/])remote-cli[\\/]*$/i.test(dir)) continue;
    for (const name of commandNames) {
      for (const extension of extensions) {
        const launcher = findIdeLauncher([join(dir, name + extension)]);
        if (launcher) return launcher;
      }
    }
  }
  return null;
}

function findIde() {
  // The remote launcher is tied to the current IDE session and must take
  // precedence over a machine-local IDE installation.
  const remoteIde = findRemoteIde();
  if (remoteIde) return remoteIde;

  if (process.platform === 'darwin') {
    return findMacIde();
  }
  if (process.platform === 'linux') {
    return findIdeLauncher([
      '/usr/share/qoder/bin/code',
      '/usr/share/qoder/bin/qoder',
    ]);
  }
  if (process.platform === 'win32') return findWindowsIde();
  return null;
}

function runIde(passArgs) {
  const bin = findIde();
  if (!bin) {
    process.stderr.write(
      'Qoder IDE is not installed. Download: https://qoder.com\n',
    );
    process.stderr.write(
      'Tip: `qoder` (CLI) is still available - run `qoder --help`.\n',
    );
    process.exit(127);
  }
  let r;
  if (/\.(cmd|bat)$/i.test(bin)) {
    // .cmd/.bat must be invoked through cmd.exe. With /s, cmd.exe strips
    // the outermost quote pair before parsing - wrap the complete command.
    const comSpec = process.env.ComSpec || 'cmd.exe';
    const escapeCmd = (s) => '"' + s.replace(/([()%!^"<>&|])/g, '^$1') + '"';
    const inner = [escapeCmd(bin), ...passArgs.map(escapeCmd)].join(' ');
    r = spawnSync(comSpec, ['/d', '/s', '/c', '"' + inner + '"'], {
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
  } else {
    r = spawnSync(bin, passArgs, { stdio: 'inherit' });
  }
  if (r.error) {
    process.stderr.write(String(r.error) + '\n');
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

function isExistingPath(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

if (args.length === 0) {
  runCliBundle([]);
} else {
  const first = args[0];
  if (first === 'ide') {
    runIde(args.slice(1));
  } else if (first === 'chat' || first === 'serve-web' || first === 'tunnel') {
    runIde(args);
  } else if (first.startsWith('-')) {
    runCliBundle(args);
  } else if (isExistingPath(first)) {
    runIde(args);
  } else {
    runCliBundle(args);
  }
}
