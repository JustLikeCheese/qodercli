#!/usr/bin/env node
/**
 * npm postinstall hook — writes installation source marker for update routing.
 * Aligned with qodercli-old: core/utils/install/source.go reads this file
 * to determine how the CLI was installed (npm, homebrew-cask, curl-bash).
 */
const fs = require('node:fs');
const path = require('node:path');

try {
  const pkgRoot = path.resolve(__dirname, '..');
  const markerPath = path.join(pkgRoot, '.qodercli-install-resource');
  fs.writeFileSync(markerPath, 'npm', 'utf8');
} catch {
  // Silent failure — marker is best-effort, should never block installation
}
