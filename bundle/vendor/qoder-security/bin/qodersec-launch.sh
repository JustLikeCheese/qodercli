#!/bin/sh
# Unix launcher for the qodersec binary. qodersec-launch.cmd delegates here on
# macOS/Linux so its Windows batch section never needs shell heredoc tricks.
#
# The launcher never downloads anything: it is the single decision point that
# compares installed versions against this plugin's pins (pure file reads), and
# hands any needed work to qodersec-update.sh in the background. That keeps
# SessionStart — and every other hook — at milliseconds instead of the 70s+ a
# synchronous bootstrap + ensure-deps used to cost.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export QODER_PLUGIN_ROOT="$PLUGIN_ROOT"
export CODESEC_LOG_NAME="qodersec"

# Pinned dependency versions (updated when plugin is published).
export QODERSEC_CLI_VERSION_GLOBAL="0.9.0"
export QODERSEC_CLI_VERSION_CN="0.9.0"
export CODESEC_CLI_VERSION_GLOBAL="0.9.0"
export CODESEC_CLI_VERSION_CN="0.9.0"
export QODERCLI_VERSION_GLOBAL="1.1.41"
export QODERCLI_VERSION_CN="1.1.41"
export QODERCLI_MANIFEST_URL_GLOBAL="https://download.qoder.com/qodercli/channels/1.1.41/manifest.json"
export QODERCLI_MANIFEST_URL_CN="https://static.qoder.com.cn/qoder-cli-cn/channels/1.1.41/manifest.json"

# Hooks may run with a minimal PATH; add the usual install directories.
export PATH="$HOME/.qodersec/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# ONE root for config + credentials + logs + state.
if [ -n "${QODERSEC_HOME:-}" ]; then
    _CHOME="$QODERSEC_HOME"
elif [ -n "${CODESEC_HOME:-}" ]; then
    _CHOME="$CODESEC_HOME"
else
    _CHOME="$HOME/.qodersec"
fi
mkdir -p "$_CHOME" 2>/dev/null
mkdir -p "$_CHOME/logs" 2>/dev/null
_QODERSEC_LOG="$_CHOME/logs/qodersec.log"

export QODERSEC_HOME="$_CHOME"
export CODESEC_HOME="$_CHOME"

STATE_DIR="$_CHOME/state"
LOCK_DIR="$STATE_DIR/qodersec-update.lock"
COOLDOWN_FILE="$STATE_DIR/qodersec-update.cooldown"
# A failed update attempt must not make every edit re-download the world.
UPDATE_COOLDOWN_MINUTES=10

log_launcher() {
    printf '[%s] [launcher] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$_QODERSEC_LOG" 2>/dev/null
}

# Gated skips happen on every edit once an update is in flight; keep them out of
# the log unless someone is debugging.
debug_launcher() {
    if [ "${CODESEC_DEBUG:-}" = "1" ]; then
        log_launcher "$@"
    fi
    return 0
}

# Hook hosts pipe the event JSON in and expect it to be consumed, so paths that
# exit without running the binary drain it. Only when it is a pipe: a terminal
# never sends EOF, so draining a hand-run launcher would just hang.
drain_stdin() {
    if [ ! -t 0 ]; then
        cat >/dev/null 2>&1 || true
    fi
}

# Seed the persistent config when it is missing entirely. The version-driven
# refresh belongs to qodersec-update.sh, which only does it after the binary
# reached the pinned version — config must never run ahead of its dependency.
if [ ! -f "$_CHOME/config.yaml" ]; then
    if [ -f "$PLUGIN_ROOT/config.yaml" ]; then
        cp "$PLUGIN_ROOT/config.yaml" "$_CHOME/config.yaml" 2>/dev/null
    elif [ -f "$PLUGIN_ROOT/config.yaml.example" ]; then
        cp "$PLUGIN_ROOT/config.yaml.example" "$_CHOME/config.yaml" 2>/dev/null
    fi
fi

# Prevent the SDK-spawned inner qodercli from recursively entering hooks.
if [ "${CODESEC_REVIEW_SUBPROCESS:-}" = "1" ]; then
    if [ "${CODESEC_DEBUG:-}" = "1" ]; then
        printf '[%s] [launcher] skip inner subprocess\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$_QODERSEC_LOG" 2>/dev/null
    fi
    drain_stdin
    exit 0
fi

if [ "${CODESEC_DEBUG:-}" = "1" ]; then
    printf '[%s] [launcher] exec cmd=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$_QODERSEC_LOG" 2>/dev/null
fi

CLI="$_CHOME/bin/qodersec"
TARGET_CLI_VERSION="$QODERSEC_CLI_VERSION_GLOBAL"
if [ "${QODER_SITE:-}" = "CN" ] || [ "${QODER_SITE:-}" = "cn" ]; then
    TARGET_CLI_VERSION="$QODERSEC_CLI_VERSION_CN"
fi

# Installed qodersec version: the marker bootstrap writes (no process spawn),
# with the binary itself as fallback for hand-installed builds.
INSTALLED_CLI_VERSION=""
if [ -f "$_CHOME/bin/qodersec-version.json" ]; then
    INSTALLED_CLI_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$_CHOME/bin/qodersec-version.json" | head -1)"
fi
if [ -z "$INSTALLED_CLI_VERSION" ] && [ -x "$CLI" ]; then
    INSTALLED_CLI_VERSION="$("$CLI" version 2>/dev/null | awk 'NR == 1 { print $2 }')"
fi

# Splits X.Y.Z into _V_MAJOR/_V_MINOR/_V_PATCH; non-zero when the input is not
# exactly three numeric components. Released versions always are (the publish
# pipeline rejects anything else), so anything else counts as un-orderable.
split_version() {
    case "$1" in
        *.*.*.* | *[!0-9.]* | *..*) return 1 ;;
        *.*.*) ;;
        *) return 1 ;;
    esac
    _V_MAJOR="${1%%.*}"
    _V_REST="${1#*.}"
    _V_MINOR="${_V_REST%%.*}"
    _V_PATCH="${_V_REST#*.}"
    [ -n "$_V_MAJOR" ] && [ -n "$_V_MINOR" ] && [ -n "$_V_PATCH" ]
}

# 0 when pin $1 is strictly older than installed $2. Un-orderable input answers
# "no", leaving such a case to the caller's mismatch rule so a corrupt marker
# still gets repaired instead of freezing the binary forever.
pin_is_downgrade() {
    split_version "$1" || return 1
    _PIN_MAJOR="$_V_MAJOR"
    _PIN_MINOR="$_V_MINOR"
    _PIN_PATCH="$_V_PATCH"
    split_version "$2" || return 1
    [ "$_PIN_MAJOR" -ne "$_V_MAJOR" ] && { [ "$_PIN_MAJOR" -lt "$_V_MAJOR" ]; return; }
    [ "$_PIN_MINOR" -ne "$_V_MINOR" ] && { [ "$_PIN_MINOR" -lt "$_V_MINOR" ]; return; }
    [ "$_PIN_PATCH" -lt "$_V_PATCH" ]
}

# Only ever forward, never back. One binary is shared by every launcher copy on
# the machine and each copy pins its own version, so a pin-vs-installed
# *mismatch* is not enough: replacing a newer binary with an older pin makes two
# copies overwrite each other's install on every session, forever. A rollback
# therefore ships as a higher version, not as a lower pin.
NEED_BIN=0
if [ "$INSTALLED_CLI_VERSION" != "$TARGET_CLI_VERSION" ]; then
    NEED_BIN=1
    if pin_is_downgrade "$TARGET_CLI_VERSION" "$INSTALLED_CLI_VERSION"; then
        NEED_BIN=0
        debug_launcher "keeping installed qodersec: pin is older (installed=$INSTALLED_CLI_VERSION pin=$TARGET_CLI_VERSION)"
    fi
fi

# qodercli: compare the pin with what ensure-deps recorded, per channel.
QODERCLI_CHANNEL="global"
QODERCLI_BINARY="qodercli"
TARGET_QODERCLI_VERSION="$QODERCLI_VERSION_GLOBAL"
if [ "${QODER_SITE:-}" = "CN" ] || [ "${QODER_SITE:-}" = "cn" ]; then
    QODERCLI_CHANNEL="cn"
    QODERCLI_BINARY="qoderclicn"
    TARGET_QODERCLI_VERSION="$QODERCLI_VERSION_CN"
fi
NEED_QODERCLI=0
if [ -n "$TARGET_QODERCLI_VERSION" ]; then
    QODERCLI_MARKER="$_CHOME/bin/${QODERCLI_BINARY}-version.json"
    if [ -f "$QODERCLI_MARKER" ]; then
        INSTALLED_QODERCLI_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$QODERCLI_MARKER" | head -1)"
        INSTALLED_QODERCLI_CHANNEL="$(sed -n 's/.*"channel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$QODERCLI_MARKER" | head -1)"
        # A channel switch is a different binary, so it always applies. The
        # version, on the other hand, moves forward only: this binary is shared
        # the same way qodersec is, and an older pin replacing a newer install
        # makes two copies fight over it on every session.
        if [ "$INSTALLED_QODERCLI_CHANNEL" != "$QODERCLI_CHANNEL" ]; then
            NEED_QODERCLI=1
        elif [ "$INSTALLED_QODERCLI_VERSION" != "$TARGET_QODERCLI_VERSION" ]; then
            NEED_QODERCLI=1
            if pin_is_downgrade "$TARGET_QODERCLI_VERSION" "$INSTALLED_QODERCLI_VERSION"; then
                NEED_QODERCLI=0
                debug_launcher "keeping installed $QODERCLI_BINARY: pin is older (installed=$INSTALLED_QODERCLI_VERSION pin=$TARGET_QODERCLI_VERSION)"
            fi
        fi
    else
        NEED_QODERCLI=1
    fi
fi

# config.yaml: refresh whenever the plugin version moved on — forward only, for
# the same reason the binaries do. config.yaml is a single shared file, so an
# older plugin version must not put its template back on top of a newer one.
PLUGIN_VERSION=""
if [ -f "$PLUGIN_ROOT/.qoder-plugin/plugin.json" ]; then
    PLUGIN_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_ROOT/.qoder-plugin/plugin.json" | head -1)"
fi
NEED_CONFIG=0
if [ -n "$PLUGIN_VERSION" ]; then
    INSTALLED_CONFIG_VERSION="$(cat "$_CHOME/.config-version" 2>/dev/null)"
    if [ "$INSTALLED_CONFIG_VERSION" != "$PLUGIN_VERSION" ]; then
        NEED_CONFIG=1
        if pin_is_downgrade "$PLUGIN_VERSION" "$INSTALLED_CONFIG_VERSION"; then
            NEED_CONFIG=0
            debug_launcher "keeping installed config: plugin version is older (installed=$INSTALLED_CONFIG_VERSION plugin=$PLUGIN_VERSION)"
        fi
    fi
fi

update_needed() {
    [ "$NEED_BIN" = "1" ] || [ "$NEED_CONFIG" = "1" ] || [ "$NEED_QODERCLI" = "1" ]
}

# Is a lock held by a process that is still alive? `kill -0` is a shell builtin,
# so the hot PostToolUse path pays no fork for this. Deliberately cheap and
# approximate: the authoritative check — command-line match plus orphan reclaim,
# never a plain age threshold — lives in qodersec-update.sh, and a lock we
# cannot attribute is left to it rather than blocking the spawn here.
update_in_flight() {
    [ -d "$LOCK_DIR" ] || return 1
    lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
    case "$lock_pid" in
        "" | *[!0-9]*) return 1 ;;
    esac
    kill -0 "$lock_pid" 2>/dev/null
}

# `find -mmin +N` prints the file only once it is older than N minutes.
in_update_cooldown() {
    [ -f "$COOLDOWN_FILE" ] || return 1
    [ -z "$(find "$COOLDOWN_FILE" -maxdepth 0 -mmin "+${UPDATE_COOLDOWN_MINUTES}" 2>/dev/null)" ]
}

spawn_update() {
    if [ ! -f "$SCRIPT_DIR/qodersec-update.sh" ]; then
        log_launcher "update skipped: qodersec-update.sh missing in $SCRIPT_DIR"
        return 1
    fi
    export QODERSEC_UPDATE_NEED_BIN="$NEED_BIN"
    export QODERSEC_UPDATE_NEED_CONFIG="$NEED_CONFIG"
    export QODERSEC_UPDATE_NEED_QODERCLI="$NEED_QODERCLI"
    # The updater must not re-derive the target: passing it down is what keeps a
    # local-test exemption (which rewrites TARGET_CLI_VERSION above) effective.
    export QODERSEC_UPDATE_TARGET_VERSION="$TARGET_CLI_VERSION"

    if [ "${QODERSEC_UPDATE_SYNC:-}" = "1" ]; then
        log_launcher "sync update requested bin=$NEED_BIN config=$NEED_CONFIG qodercli=$NEED_QODERCLI current=$INSTALLED_CLI_VERSION target=$TARGET_CLI_VERSION"
        sh "$SCRIPT_DIR/qodersec-update.sh" >> "$_QODERSEC_LOG" 2>&1
        return 0
    fi

    # Double fork with every fd redirected: the hook host must not wait for the
    # child's stdout to close, and the child must outlive this hook.
    ( nohup sh "$SCRIPT_DIR/qodersec-update.sh" >> "$_QODERSEC_LOG" 2>&1 </dev/null & ) &
    log_launcher "async update spawned bin=$NEED_BIN config=$NEED_CONFIG qodercli=$NEED_QODERCLI current=$INSTALLED_CLI_VERSION target=$TARGET_CLI_VERSION"
    return 0
}

trigger_update() {
    update_needed || return 0
    if [ "${QODERSEC_SKIP_ASYNC_UPDATE:-}" = "1" ]; then
        debug_launcher "update skipped: QODERSEC_SKIP_ASYNC_UPDATE=1"
        return 0
    fi
    if update_in_flight; then
        debug_launcher "update skipped: already in flight"
        return 0
    fi
    if in_update_cooldown; then
        debug_launcher "update skipped: cooldown active after a failed attempt"
        return 0
    fi
    spawn_update
}

case "${1:-}" in
    ensure-deps)
        # SessionStart. Up to date means ensure-deps makes no network call at
        # all, so run it inline (it also initialises the review baseline);
        # otherwise hand everything to the updater and return immediately.
        if update_needed; then
            trigger_update
            drain_stdin
            exit 0
        fi
        debug_launcher "deps up to date; running ensure-deps"
        ;;
    *)
        # review / scan / settings fire far more often than SessionStart, which
        # makes them the safety net: if the SessionStart attempt was killed with
        # its hook or failed, a pending update still gets picked up before the
        # session ends. Gated and non-blocking, so the command is not delayed.
        trigger_update
        ;;
esac

# Nothing is installed yet (the async update is still downloading). Stay silent
# on stdout: the L1 PostToolUse hook fires on every edit, and any byte we print
# there would land in the model's context over and over.
#
# The settings resolver is the single exception. It is the entry point the
# security-scan skill calls before an L2/L3 review, and it MUST be able to tell
# "still downloading" apart from "the layer is switched off" — an empty answer
# would be read as "disabled" and send the user to the settings page instead of
# asking them to retry. So it gets the settings contract's initializing status.
if [ ! -x "$CLI" ]; then
    log_launcher "skip: qodersec not installed (async update pending) cmd=${1:-}"
    drain_stdin
    if [ "${1:-}" = "review" ] && [ "${2:-}" = "settings" ]; then
        printf '{"status":"initializing","host":"","l2_enabled":false,"l3_enabled":false}\n'
    fi
    exit 0
fi

exec "$CLI" "$@"
