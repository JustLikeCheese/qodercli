// Preserve the browser-facing Host so the loopback backend can reject foreign Origins.
export function localProxy(target: string) {
  return Object.fromEntries(['/functions/v1/app', '/storage/v1', '/__local/'].map(path => [path, { target, changeOrigin: false }]));
}
