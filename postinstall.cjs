#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * npm postinstall script for @qoder-ai/qodercli (pure JS bundle).
 *
 * On all platforms: verifies that either the platform ripgrep package or a
 * system rg is available.
 * On Windows: ensures npm's global bin directory is on the user's PATH.
 *
 * IMPORTANT: This script must NEVER cause `npm install` to fail.
 * All operations are wrapped in try/catch and errors are silently ignored.
 */

try {
  warnIfRipgrepUnavailable();
} catch {
  // Silent — never break npm install
}

// --- Windows PATH registration ---
if (process.platform === 'win32') {
  try {
    ensureNpmBinOnPath();
  } catch {
    // Silent — never break npm install
  }
}

// --- Dispatcher + PATH configuration (all platforms) ---
// `qoder` should resolve to the entry-point dispatcher rather than the npm
// shim so multi-channel users (npm + IDE) get consistent routing. We invoke
// the freshly-installed CLI's hidden `configure-path` subcommand which
// writes `~/.qoder/entry/<brand>` and prepends the entry dir onto PATH.
//
// Brand-neutral: we read the CLI bin path from the package's own
// package.json `bin` field so the same script handles Global (qodercli) and
// CN (qoderclicn) without publish-time sed rendering.
try {
  configurePathBestEffort();
} catch {
  // Never break npm install
}

function configurePathBestEffort() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');

  const pkgJsonPath = path.resolve(__dirname, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const bins = pkgJson.bin || {};
  const cliBinName = ['qodercli', 'qoderclicn'].find((name) => bins[name]);
  if (!cliBinName) return;

  const cliPath = path.resolve(__dirname, bins[cliBinName]);
  if (!fs.existsSync(cliPath)) return;

  // Run synchronously so the install banner reflects post-config state.
  // stdio: 'inherit' is fine here — the CLI's configure-path command always
  // returns exit code 0, and its stdout banner is the user-facing signal.
  spawnSync(process.execPath, [cliPath, 'configure-path'], {
    stdio: 'inherit',
    timeout: 30_000,
  });
}

function warnIfRipgrepUnavailable() {
  const { execFileSync } = require('node:child_process');
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(
    readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
  );
  const packageSuffix = `-ripgrep-${process.platform}-${process.arch}`;
  const ripgrepPackage = Object.keys(manifest.optionalDependencies || {}).find(
    (packageName) => packageName.endsWith(packageSuffix),
  );
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';

  if (ripgrepPackage) {
    try {
      require.resolve(`${ripgrepPackage}/bin/${binaryName}`, {
        paths: [__dirname],
      });
      return;
    } catch {
      // The optional dependency may have been explicitly omitted.
    }
  }

  try {
    execFileSync('rg', ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  } catch {
    // Fall through to an actionable, non-fatal warning.
  }

  console.log(
    '\n  ripgrep is unavailable. Reinstall without --omit=optional, or install rg on PATH.' +
      '\n  Glob and Grep require ripgrep.\n',
  );
}

function ensureNpmBinOnPath() {
  const { execSync } = require('node:child_process');
  const path = require('node:path');

  // 1. Determine npm's global bin directory.
  //    On Windows, npm places .cmd shims directly in the prefix directory
  //    (not in a /bin subfolder like Unix).
  let npmBinDir;
  if (process.env.npm_config_prefix) {
    // npm sets this env var during lifecycle scripts
    npmBinDir = process.env.npm_config_prefix;
  } else {
    // Fallback: ask npm directly
    try {
      npmBinDir = execSync('npm prefix -g', {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
    } catch {
      return; // Can't determine prefix — bail silently
    }
  }

  if (!npmBinDir) return;

  // Normalize path for consistent comparison
  npmBinDir = path.normalize(npmBinDir);

  // 2. Read current user PATH from Windows Registry (HKCU\Environment)
  let currentPath = '';
  try {
    const output = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    // Output format:
    // HKEY_CURRENT_USER\Environment
    //     Path    REG_EXPAND_SZ    value
    const match = output.match(/Path\s+REG_(?:EXPAND_SZ|SZ)\s+(.*)/i);
    if (match) currentPath = match[1].trim();
  } catch {
    // Key might not exist — start fresh
  }

  // 3. Check if already present (case-insensitive, normalized comparison)
  const entries = currentPath
    .split(';')
    .map((p) => path.normalize(p.trim()).toLowerCase())
    .filter((p) => p.length > 0);

  if (entries.includes(npmBinDir.toLowerCase())) {
    return; // Already on PATH — no-op
  }

  // 4. Append to PATH (not prepend — preserve existing priority so that
  //    curl-bash installed versions at ~/.qoder/bin/ remain preferred)
  const newPath = currentPath ? currentPath + ';' + npmBinDir : npmBinDir;

  // 5. Write to registry as REG_EXPAND_SZ (preserves %variables%)
  const escaped = newPath.replace(/"/g, '\\"');
  execSync(
    `reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${escaped}" /f`,
    { encoding: 'utf-8', timeout: 10000, stdio: 'ignore' },
  );

  // 6. Broadcast WM_SETTINGCHANGE so new Explorer/shell windows pick up
  //    the change without requiring a reboot.
  //    Note: Already-open PowerShell/CMD windows will NOT refresh.
  try {
    const ps = [
      "Add-Type -Namespace Win32 -Name NM -MemberDefinition '",
      '[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)]',
      'public static extern IntPtr SendMessageTimeout(',
      'IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,',
      "uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);';",
      '$r=[UIntPtr]::Zero;',
      '[Win32.NM]::SendMessageTimeout(',
      '[IntPtr]0xFFFF,0x001A,[UIntPtr]::Zero,"Environment",',
      '2,5000,[ref]$r)|Out-Null',
    ].join(' ');
    execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: 'ignore',
    });
  } catch {
    // Non-fatal — PATH change is persisted in registry regardless
  }

  // 7. User-facing hint
  console.log(
    '\n  \u2713 Added npm global bin directory to PATH.' +
      '\n    Please restart your terminal to use "qodercli".\n',
  );
}
