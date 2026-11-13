#!/bin/sh
# bootstrap.sh — Download qodersec binary for the current platform.
#
# Pure shell bootstrap. Version is read from QODERSEC_CLI_VERSION_* env vars
# (set by qodersec-launch.cmd, with CODESEC_CLI_VERSION_* fallback for compat).
# The qodersec version manifest is verified here; qodercli download is handled
# by `qodersec ensure-deps` after bootstrap completes.
#
# Download strategy: read latest/manifest.json to get version, then download
# the archive and its versioned manifest (e.g. /0.6.0/manifest.json). The
# manifest's SHA-256 must match before extraction; a missing/invalid checksum is
# a hard failure. The default Qoder distribution endpoints serve signed binaries
# so macOS/Windows hosts accept them.
# OSS package name stays codesec-cli-*.tar.gz (CI/CD compat); binary is renamed
# to qodersec after extraction.
set -e

# Resolve home: hardcoded to ~/.qodersec (env vars ignored, see qodersec-launch.sh).
_CHOME="$HOME/.qodersec"

BIN_DIR="${_CHOME}/bin"
BINARY_NAME="qodersec"
QODERSEC_BIN="${BIN_DIR}/${BINARY_NAME}"

# Download URL: QODERSEC_OSS_URL > CODESEC_OSS_URL > default Qoder signed endpoint.
BUCKET_URL="${QODERSEC_OSS_URL:-${CODESEC_OSS_URL:-https://static.qoder.com.cn/security/qodersec}}"

# Skip if already installed unless launcher detected a pinned-version change.
if [ -x "$QODERSEC_BIN" ] && [ "${QODERSEC_FORCE_UPDATE:-}" != "1" ]; then
    exit 0
fi

# Read version from env (set by qodersec-launch.cmd)
VERSION="${QODERSEC_CLI_VERSION_GLOBAL:-${CODESEC_CLI_VERSION_GLOBAL:-0.5.0}}"
if [ "${QODER_SITE}" = "CN" ] || [ "${QODER_SITE}" = "cn" ]; then
    VERSION="${QODERSEC_CLI_VERSION_CN:-${CODESEC_CLI_VERSION_CN:-${VERSION}}}"
else
    # Non-CN users default to the global Qoder signed endpoint (unless overridden).
    BUCKET_URL="${QODERSEC_OSS_URL:-${CODESEC_OSS_URL:-https://qoder-ide.oss-accelerate.aliyuncs.com/security/qodersec}}"
fi

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "${OS}" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      echo "[bootstrap] unsupported OS: ${OS}" >&2; exit 1 ;;
esac
case "${ARCH}" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             echo "[bootstrap] unsupported arch: ${ARCH}" >&2; exit 1 ;;
esac

# Resolve actual version: use pinned VERSION from env, or fall back to manifest
resolve_version() {
    # If pinned version is set via env, use it directly
    if [ -n "${VERSION}" ] && [ "${VERSION}" != "0.5.0" ]; then
        echo "${VERSION}"
        return
    fi
    # Otherwise read from manifest; this request also holds the update lock.
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --connect-timeout 10 --max-time 60 "${BUCKET_URL}/latest/manifest.json" 2>/dev/null | \
            grep '"latest"' | sed 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
    elif command -v wget >/dev/null 2>&1; then
        wget --timeout=30 --tries=1 -qO- "${BUCKET_URL}/latest/manifest.json" 2>/dev/null | \
            grep '"latest"' | sed 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
    else
        echo "${VERSION}"
    fi
}

RESOLVED_VERSION="$(resolve_version)"
[ -n "${RESOLVED_VERSION}" ] || { echo "[bootstrap] failed to resolve version" >&2; exit 1; }

# Construct download URLs from the versioned directory. The manifest is release
# metadata produced alongside the archive and carries the archive's SHA-256.
# OSS package name stays codesec-cli-* for CI/CD compatibility.
FILENAME="codesec-cli-${OS}-${ARCH}.tar.gz"
DOWNLOAD_URL="${BUCKET_URL}/${RESOLVED_VERSION}/${FILENAME}"
MANIFEST_URL="${BUCKET_URL}/${RESOLVED_VERSION}/manifest.json"

echo "[bootstrap] downloading qodersec ${RESOLVED_VERSION} (${OS}/${ARCH})..."
echo "[bootstrap] ${DOWNLOAD_URL}"

mkdir -p "${BIN_DIR}" 2>/dev/null

# Stage inside BIN_DIR so installing is an atomic same-filesystem rename. A
# review started before the update keeps running off its own inode; extracting
# straight into BIN_DIR would rewrite the executable underneath it (ETXTBSY on
# Linux, a truncated image on macOS) — and updates now also get triggered from
# the PostToolUse path, so that overlap is no longer hypothetical.
STAGE_DIR="${BIN_DIR}/.qodersec-download.$$"
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}" || { echo "[bootstrap] cannot create ${STAGE_DIR}" >&2; exit 1; }

# Download. Keep the random Xs at the END of the template: BSD mktemp (macOS)
# only substitutes a trailing run of Xs, so a ".tar.gz" suffix would create a
# literal fixed file and fail with "File exists" on the next run. tar does not
# need the extension.
TMPFILE=""
MANIFEST_FILE=""
trap 'rm -f "${TMPFILE}" "${MANIFEST_FILE}"; rm -rf "${STAGE_DIR}"' EXIT
trap 'exit 1' HUP INT TERM
TMPFILE="$(mktemp "${TMPDIR:-/tmp}/qodersec-XXXXXX")"
MANIFEST_FILE="$(mktemp "${TMPDIR:-/tmp}/qodersec-manifest-XXXXXX")"
echo "[bootstrap] TMPFILE: ${TMPFILE}"

# Every download is bounded: the background updater holds the update lock for
# the whole run, so a stalled connection would otherwise park it there.
if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 10 --max-time 60 -o "${MANIFEST_FILE}" "${MANIFEST_URL}" || { echo "[bootstrap] manifest download failed" >&2; exit 1; }
    curl -fsSL --connect-timeout 10 --max-time 900 -o "${TMPFILE}" "${DOWNLOAD_URL}" || { echo "[bootstrap] download failed" >&2; exit 1; }
elif command -v wget >/dev/null 2>&1; then
    wget --timeout=30 --tries=1 -qO "${MANIFEST_FILE}" "${MANIFEST_URL}" || { echo "[bootstrap] manifest download failed" >&2; exit 1; }
    wget --timeout=30 --tries=1 -qO "${TMPFILE}" "${DOWNLOAD_URL}" || { echo "[bootstrap] download failed" >&2; exit 1; }
else
    echo "[bootstrap] curl or wget required" >&2; exit 1
fi

# Locate this exact archive in the version manifest. Fail closed when the entry
# or digest is absent: silently accepting an unverified archive reintroduces the
# poisoning path this check is intended to close.
# Parse JSON structurally using POSIX awk (no jq/Python runtime dependency).
# Never search across object boundaries or fall back to versions/history entries.
EXPECTED_SHA256="$(
    LC_ALL=C awk -v filename="${FILENAME}" -v version="${RESOLVED_VERSION}" -v os="${OS}" -v arch="${ARCH}" '
        function fail() { invalid = 1; exit 1 }
        function hex4(    h, i, n) {
            h = substr(json, pos, 4)
            if (length(h) != 4 || h ~ /[^0-9A-Fa-f]/) fail()
            pos += 4
            for (i = 1; i <= 4; i++) n = n * 16 + index("0123456789abcdef", tolower(substr(h, i, 1))) - 1
            return n
        }
        function utf8(n) {
            if (n < 128) return sprintf("%c", n)
            if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64)
            if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64)
            return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64)
        }
        function next_token(    c, e, n, low) {
            while (substr(json, pos, 1) ~ /^[ \t\r\n]$/ && pos <= length(json)) pos++
            c = substr(json, pos++, 1)
            token = c; text = ""
            if (c != "\"") {
                if (c == "" || index("{}[]:,", c)) return
                pos--
                while (pos <= length(json) && substr(json, pos, 1) !~ /[ \t\r\n{}\[\]:,]/)
                    text = text substr(json, pos++, 1)
                if (text !~ /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)$/) fail()
                token = "literal"; return
            }
            token = "string"
            while (pos <= length(json)) {
                c = substr(json, pos++, 1)
                if (c == "\"") return
                if (c ~ /[[:cntrl:]]/) fail()
                if (c == "\\") {
                    e = substr(json, pos++, 1)
                    if (e == "u") {
                        n = hex4()
                        if (n >= 55296 && n <= 56319) {
                            if (substr(json, pos, 2) != "\\u") fail()
                            pos += 2; low = hex4()
                            if (low < 56320 || low > 57343) fail()
                            n = 65536 + (n - 55296) * 1024 + low - 56320
                        } else if (n >= 56320 && n <= 57343) fail()
                        # Decode before checking keys: latest and \\u006catest
                        # are the same key, including for duplicate detection.
                        text = text utf8(n); continue
                    }
                    if (e == "" || !index("\"\\/bfnrt", e)) fail()
                    if (e == "b") c = sprintf("%c", 8)
                    else if (e == "f") c = sprintf("%c", 12)
                    else if (e == "n") c = "\n"
                    else if (e == "r") c = "\r"
                    else if (e == "t") c = "\t"
                    else c = e
                }
                text = text c
            }
            fail()
        }
        function value(ctx, depth,    id, key, child, url, entryos, entryarch, sha) {
            if (depth > 64) fail()
            result = ""; result_type = token
            if (token == "{") {
                id = ++object_id; next_token()
                if (token != "}") while (1) {
                    if (token != "string") fail()
                    key = text
                    if (seen[id SUBSEP key]++) fail()
                    next_token(); if (token != ":") fail()
                    next_token(); child = "ignore"
                    if (ctx == "root" && key == "files") {
                        if (token != "[") fail()
                        child = "files"
                    }
                    value(child, depth + 1)
                    if (ctx == "root" && key == "latest") {
                        if (result_type != "string") fail()
                        latest = result
                    }
                    if (ctx == "file" && (key == "url" || key == "os" || key == "arch" || key == "sha256")) {
                        if (result_type != "string") fail()
                        if (key == "url") url = result
                        if (key == "os") entryos = result
                        if (key == "arch") entryarch = result
                        if (key == "sha256") sha = result
                    }
                    if (token != ",") break
                    next_token()
                }
                if (token != "}") fail()
                if (ctx == "file" && entryos == os && entryarch == arch &&
                    substr(url, length(url) - length(filename)) == "/" filename) {
                    matches++; digest = sha
                }
                next_token(); result = ""; result_type = "object"; return
            }
            if (token == "[") {
                next_token()
                if (token != "]") while (1) {
                    if (ctx == "files" && token != "{") fail()
                    value(ctx == "files" ? "file" : "ignore", depth + 1)
                    if (token != ",") break
                    next_token()
                }
                if (token != "]") fail()
                next_token(); result = ""; result_type = "array"; return
            }
            if (token != "string" && token != "literal") fail()
            result = text; result_type = token; next_token()
        }
        { json = json $0 "\n" }
        END {
            if (invalid) exit 1
            pos = 1; next_token()
            if (token != "{") fail()
            value("root", 0)
            if (token != "" || latest != version || matches != 1 ||
                length(digest) != 64 || digest ~ /[^0-9A-Fa-f]/) fail()
            print digest
        }
    ' "${MANIFEST_FILE}"
)" || { echo "[bootstrap] missing or invalid SHA-256 manifest for ${FILENAME}" >&2; exit 1; }
case "${EXPECTED_SHA256}" in
    ""|*[!0-9A-Fa-f]*) echo "[bootstrap] missing or invalid SHA-256 for ${FILENAME}" >&2; exit 1 ;;
esac
if [ "${#EXPECTED_SHA256}" -ne 64 ]; then
    echo "[bootstrap] missing or invalid SHA-256 for ${FILENAME}" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(sha256sum "${TMPFILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(shasum -a 256 "${TMPFILE}" | awk '{print $1}')"
elif command -v openssl >/dev/null 2>&1; then
    ACTUAL_SHA256="$(openssl dgst -sha256 "${TMPFILE}" | sed 's/^.*=[[:space:]]*//')"
else
    echo "[bootstrap] no SHA-256 tool available (sha256sum, shasum, or openssl required)" >&2
    exit 1
fi
EXPECTED_SHA256="$(printf '%s' "${EXPECTED_SHA256}" | tr '[:upper:]' '[:lower:]')"
ACTUAL_SHA256="$(printf '%s' "${ACTUAL_SHA256}" | tr '[:upper:]' '[:lower:]')"
if [ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]; then
    echo "[bootstrap] SHA-256 mismatch for ${FILENAME}" >&2
    exit 1
fi
echo "[bootstrap] SHA-256 verified"

# Extract only after integrity verification. OSS package contains codesec-cli,
# which is renamed to qodersec during installation.
tar xzf "${TMPFILE}" -C "${STAGE_DIR}" 2>/dev/null || tar xzf "${TMPFILE}" --strip-components=1 -C "${STAGE_DIR}" 2>/dev/null || { echo "[bootstrap] extraction failed" >&2; exit 1; }

# Install: OSS package ships codesec-cli, the on-disk name is qodersec.
STAGED_BIN="${STAGE_DIR}/codesec-cli"
[ -f "${STAGED_BIN}" ] || STAGED_BIN="${STAGE_DIR}/${BINARY_NAME}"
[ -f "${STAGED_BIN}" ] || { echo "[bootstrap] extraction produced no binary" >&2; exit 1; }
chmod +x "${STAGED_BIN}" 2>/dev/null
mv -f "${STAGED_BIN}" "${QODERSEC_BIN}" || { echo "[bootstrap] cannot install ${QODERSEC_BIN}" >&2; exit 1; }

# Write version.json (format matches ensure-deps)
CHANNEL="global"
[ "${QODER_SITE}" = "CN" ] || [ "${QODER_SITE}" = "cn" ] && CHANNEL="cn"
UPDATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo 'unknown')"
printf '{\n  "version": "%s",\n  "channel": "%s",\n  "updated_at": "%s"\n}\n' \
    "${RESOLVED_VERSION}" "${CHANNEL}" "${UPDATED_AT}" > "${BIN_DIR}/qodersec-version.json"

echo "[bootstrap] installed qodersec ${RESOLVED_VERSION}"
