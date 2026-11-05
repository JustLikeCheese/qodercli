#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/cli/src/installation/install/windowsRegistryPath.ts
var windowsRegistryPath_exports = {};
__export(windowsRegistryPath_exports, {
  readWindowsRegistryPath: () => readWindowsRegistryPath
});
function readWindowsRegistryPath(runReg) {
  const directory = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "qoder-registry-path-"));
  try {
    const file = (0, import_node_path.join)(directory, "environment.reg");
    runReg(["export", "HKCU\\Environment", file, "/y"]);
    return parseRegistryPathExport((0, import_node_fs.readFileSync)(file));
  } finally {
    (0, import_node_fs.rmSync)(directory, { recursive: true, force: true });
  }
}
function parseRegistryPathExport(bytes) {
  if (bytes.length % 2 !== 0 || bytes[0] !== 255 || bytes[1] !== 254) {
    throw new Error("Registry export is not BOM-marked UTF-16LE");
  }
  const text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (!text.startsWith("Windows Registry Editor Version 5.00\r\n") || !text.endsWith("\r\n\r\n")) {
    throw new Error("Unexpected registry export header");
  }
  const lines = text.replace(/\\\r?\n[ \t]*/g, "").split(/\r?\n/);
  let inEnvironment = false;
  let foundEnvironment = false;
  let entry = null;
  for (const line of lines) {
    if (line.startsWith("[")) {
      inEnvironment = /^\[HKEY_CURRENT_USER\\Environment\]$/i.test(line);
      foundEnvironment ||= inEnvironment;
      continue;
    }
    if (!inEnvironment || !/^"Path"/i.test(line)) continue;
    if (!/^"Path"=/i.test(line)) {
      throw new Error("Malformed PATH entry in registry export");
    }
    if (entry !== null) throw new Error("Duplicate PATH in registry export");
    const data = line.slice('"Path"='.length);
    if (data.startsWith('"')) {
      const value2 = JSON.parse(data);
      if (typeof value2 !== "string" || value2.includes("\0")) {
        throw new Error("Invalid registry PATH string");
      }
      entry = { value: value2, type: "REG_SZ" };
      continue;
    }
    const hex = /^hex\(([12])\):((?:[0-9a-f]{2},)*[0-9a-f]{2})$/i.exec(data);
    if (!hex) throw new Error("Unsupported or malformed registry PATH value");
    const valueBytes = Buffer.from(hex[2].replace(/,/g, ""), "hex");
    if (valueBytes.length < 2 || valueBytes.length % 2 !== 0 || valueBytes.readUInt16LE(valueBytes.length - 2) !== 0) {
      throw new Error("Invalid registry PATH string terminator");
    }
    const value = new TextDecoder("utf-16le", {
      fatal: true,
      ignoreBOM: true
    }).decode(valueBytes.subarray(0, -2));
    if (value.includes("\0")) throw new Error("Invalid registry PATH string");
    entry = { value, type: hex[1] === "2" ? "REG_EXPAND_SZ" : "REG_SZ" };
  }
  if (!foundEnvironment) throw new Error("Registry export omitted Environment");
  return entry;
}
var import_node_fs, import_node_os, import_node_path;
var init_windowsRegistryPath = __esm({
  "packages/cli/src/installation/install/windowsRegistryPath.ts"() {
    "use strict";
    import_node_fs = require("node:fs");
    import_node_os = require("node:os");
    import_node_path = require("node:path");
  }
});

// scripts/postinstall-npm-bundle.cjs
try {
  warnIfRipgrepUnavailable();
} catch {
}
if (process.platform === "win32") {
  try {
    ensureNpmBinOnPath();
  } catch {
  }
}
try {
  configurePathBestEffort();
} catch {
}
function configurePathBestEffort() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const pkgJsonPath = path.resolve(__dirname, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return;
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const bins = pkgJson.bin || {};
  const cliBinName = ["qodercli", "qoderclicn"].find((name) => bins[name]);
  if (!cliBinName) return;
  const cliPath = path.resolve(__dirname, bins[cliBinName]);
  if (!fs.existsSync(cliPath)) return;
  spawnSync(process.execPath, [cliPath, "configure-path"], {
    stdio: "inherit",
    timeout: 3e4
  });
}
function warnIfRipgrepUnavailable() {
  const { execFileSync } = require("node:child_process");
  const { readFileSync: readFileSync2 } = require("node:fs");
  const path = require("node:path");
  const manifest = JSON.parse(
    readFileSync2(path.join(__dirname, "package.json"), "utf8")
  );
  const packageSuffix = `-ripgrep-${process.platform}-${process.arch}`;
  const ripgrepPackage = Object.keys(manifest.optionalDependencies || {}).find(
    (packageName) => packageName.endsWith(packageSuffix)
  );
  const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
  if (ripgrepPackage) {
    try {
      require.resolve(`${ripgrepPackage}/bin/${binaryName}`, {
        paths: [__dirname]
      });
      return;
    } catch {
    }
  }
  try {
    execFileSync("rg", ["--version"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  } catch {
  }
  console.log(
    "\n  ripgrep is unavailable. Reinstall without --omit=optional, or install rg on PATH.\n  Glob and Grep require ripgrep.\n"
  );
}
function ensureNpmBinOnPath() {
  const { execFileSync, execSync } = require("node:child_process");
  const {
    readWindowsRegistryPath: readWindowsRegistryPath2
  } = (init_windowsRegistryPath(), __toCommonJS(windowsRegistryPath_exports));
  const path = require("node:path");
  let npmBinDir;
  if (process.env.npm_config_prefix) {
    npmBinDir = process.env.npm_config_prefix;
  } else {
    try {
      npmBinDir = execSync("npm prefix -g", {
        encoding: "utf-8",
        timeout: 1e4
      }).trim();
    } catch {
      return;
    }
  }
  if (!npmBinDir) return;
  npmBinDir = path.normalize(npmBinDir);
  const registry = readWindowsRegistryPath2(
    (args) => execFileSync("reg.exe", args, {
      timeout: 1e4,
      windowsHide: true,
      stdio: "ignore"
    })
  );
  const currentPath = registry?.value ?? "";
  const entries = currentPath.split(";").map((p) => path.normalize(p.trim()).toLowerCase()).filter((p) => p.length > 0);
  if (entries.includes(npmBinDir.toLowerCase())) {
    return;
  }
  const newPath = currentPath ? currentPath + ";" + npmBinDir : npmBinDir;
  execFileSync(
    "reg.exe",
    [
      "add",
      "HKCU\\Environment",
      "/v",
      "Path",
      "/t",
      registry?.type ?? "REG_EXPAND_SZ",
      "/d",
      newPath,
      "/f"
    ],
    { timeout: 1e4, stdio: "ignore", windowsHide: true }
  );
  try {
    const ps = [
      "Add-Type -Namespace Win32 -Name NM -MemberDefinition '",
      '[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)]',
      "public static extern IntPtr SendMessageTimeout(",
      "IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,",
      "uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);';",
      "$r=[UIntPtr]::Zero;",
      "[Win32.NM]::SendMessageTimeout(",
      '[IntPtr]0xFFFF,0x001A,[UIntPtr]::Zero,"Environment",',
      "2,5000,[ref]$r)|Out-Null"
    ].join(" ");
    execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: "utf-8",
      timeout: 15e3,
      stdio: "ignore"
    });
  } catch {
  }
  console.log(
    '\n  \u2713 Added npm global bin directory to PATH.\n    Please restart your terminal to use "qodercli".\n'
  );
}
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
