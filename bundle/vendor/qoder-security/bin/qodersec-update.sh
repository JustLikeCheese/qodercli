#!/bin/sh
# qodersec-update.sh — Background dependency updater for the qodersec plugin.
#
# Spawned detached by qodersec-launch.sh so that no hook ever blocks on a
# download. The launcher owns the decision (which steps are needed, which
# version is the target) and passes it in via QODERSEC_UPDATE_*; this script
# only executes, in dependency order, and never lets a later step's failure
# undo an earlier one:
#
#   1. qodersec binary (bootstrap.sh)  — hard prerequisite: failure stops here
#   2. config.yaml + .config-version   — only once the binary is at target
#   3. qodercli (qodersec ensure-deps) — failure is logged, nothing else breaks
#
# Concurrency: one lock directory guards the whole run. A lock whose updater
# process is gone is reclaimed immediately — age alone is never the criterion,
# so an updater killed together with its session never blocks the next one.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${QODER_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# ONE root for config + credentials + logs + state (same order as the launcher).
if [ -n "${QODERSEC_HOME:-}" ]; then
    _CHOME="$QODERSEC_HOME"
elif [ -n "${CODESEC_HOME:-}" ]; then
    _CHOME="$CODESEC_HOME"
else
    _CHOME="$HOME/.qodersec"
fi
export QODERSEC_HOME="$_CHOME"
export CODESEC_HOME="$_CHOME"
export CODESEC_LOG_NAME="${CODESEC_LOG_NAME:-qodersec}"

BIN_DIR="$_CHOME/bin"
CLI="$BIN_DIR/qodersec"
STATE_DIR="$_CHOME/state"
LOCK_DIR="$STATE_DIR/qodersec-update.lock"
COOLDOWN_FILE="$STATE_DIR/qodersec-update.cooldown"
_QODERSEC_LOG="$_CHOME/logs/qodersec.log"
# Only used when process liveness cannot be determined at all: a lock nobody
# refreshed for this long is treated as orphaned.
HEARTBEAT_STALE_MINUTES=10

mkdir -p "$_CHOME/logs" "$STATE_DIR" 2>/dev/null

log() {
    printf '[%s] [updater] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$_QODERSEC_LOG" 2>/dev/null
}

NEED_BIN="${QODERSEC_UPDATE_NEED_BIN:-0}"
NEED_CONFIG="${QODERSEC_UPDATE_NEED_CONFIG:-0}"
NEED_QODERCLI="${QODERSEC_UPDATE_NEED_QODERCLI:-0}"
# The launcher is the single decision point: it resolved the target version
# (including any local-test exemption), so we never re-derive it here.
TARGET_CLI_VERSION="${QODERSEC_UPDATE_TARGET_VERSION:-}"

if [ "$NEED_BIN" = "1" ] && [ -z "$TARGET_CLI_VERSION" ]; then
    log "abort: launcher passed no target version (QODERSEC_UPDATE_TARGET_VERSION)"
    exit 0
fi

# Reads the installed qodersec version: the marker bootstrap writes first, the
# binary itself only as a fallback for hand-installed builds.
installed_version() {
    if [ -f "$BIN_DIR/qodersec-version.json" ]; then
        sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$BIN_DIR/qodersec-version.json" | head -1
        return 0
    fi
    if [ -x "$CLI" ]; then
        "$CLI" version 2>/dev/null | awk 'NR == 1 { print $2 }'
    fi
}

# Is an updater process actually doing something? That is the only question a
# held lock can be judged by; elapsed time proves nothing.
#   0 = running, 1 = not running, 2 = cannot tell
updater_is_running() {
    lock_pid=""
    [ -f "$LOCK_DIR/pid" ] && lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
    case "$lock_pid" in
        "") return 2 ;;
        *[!0-9]*) return 2 ;;
    esac
    kill -0 "$lock_pid" 2>/dev/null || return 1
    # PIDs get recycled: an alive PID only counts when it still looks like an
    # updater. If ps tells us nothing, keep the conservative answer (running).
    if command -v ps >/dev/null 2>&1; then
        lock_args="$(ps -p "$lock_pid" -o args= 2>/dev/null)"
        if [ -n "$lock_args" ]; then
            case "$lock_args" in
                *qodersec-update*) return 0 ;;
                *) return 1 ;;
            esac
        fi
    fi
    return 0
}

heartbeat_is_stale() {
    hb="$LOCK_DIR/heartbeat"
    [ -f "$hb" ] || hb="$LOCK_DIR"
    [ -n "$(find "$hb" -maxdepth 0 -mmin "+${HEARTBEAT_STALE_MINUTES}" 2>/dev/null)" ]
}

acquire_lock() {
    mkdir "$LOCK_DIR" 2>/dev/null && return 0

    updater_is_running
    case "$?" in
        0)
            if heartbeat_is_stale; then
                # Never kill somebody else's download; bounded by the download
                # timeouts in bootstrap.sh instead.
                log "lock held but heartbeat stale pid=$(cat "$LOCK_DIR/pid" 2>/dev/null); leaving it alone"
            else
                log "busy: updater already running pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)"
            fi
            return 1
            ;;
        1)
            log "lock orphaned: no updater process; reclaimed"
            ;;
        *)
            if heartbeat_is_stale; then
                log "lock orphaned: liveness unknown, heartbeat older than ${HEARTBEAT_STALE_MINUTES}m; reclaimed"
            else
                log "busy: lock held, liveness unknown and heartbeat fresh"
                return 1
            fi
            ;;
    esac

    rm -rf "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || {
        log "busy: lost the race to reclaim the lock"
        return 1
    }
    return 0
}

beat() { : > "$LOCK_DIR/heartbeat" 2>/dev/null; }
mark_cooldown() { date '+%Y-%m-%dT%H:%M:%S' > "$COOLDOWN_FILE" 2>/dev/null; }
clear_cooldown() { rm -f "$COOLDOWN_FILE" 2>/dev/null; }

acquire_lock || exit 0
trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT INT TERM
printf '%s' "$$" > "$LOCK_DIR/pid" 2>/dev/null
printf '%s' "$TARGET_CLI_VERSION" > "$LOCK_DIR/target" 2>/dev/null
beat

log "start target=${TARGET_CLI_VERSION:-none} needs bin=$NEED_BIN config=$NEED_CONFIG qodercli=$NEED_QODERCLI"

# ── Step 1: the qodersec binary. Everything below depends on it, so a failure
#            here stops the run instead of advancing dependents. ──
if [ "$NEED_BIN" = "1" ]; then
    beat
    log "step=qodersec status=start current=$(installed_version) target=$TARGET_CLI_VERSION"
    if [ ! -f "$SCRIPT_DIR/bootstrap.sh" ]; then
        log "step=qodersec status=failed reason=bootstrap.sh missing in $SCRIPT_DIR"
        mark_cooldown
        exit 0
    fi
    # The launcher's target wins over the raw pins, so an exempted local build
    # can never be replaced by a released one.
    case "${QODER_SITE:-}" in
        CN|cn) export QODERSEC_CLI_VERSION_CN="$TARGET_CLI_VERSION" ;;
        *) export QODERSEC_CLI_VERSION_GLOBAL="$TARGET_CLI_VERSION" ;;
    esac
    if QODERSEC_FORCE_UPDATE=1 sh "$SCRIPT_DIR/bootstrap.sh" >> "$_QODERSEC_LOG" 2>&1; then
        CURRENT_CLI_VERSION="$(installed_version)"
        if [ "$CURRENT_CLI_VERSION" != "$TARGET_CLI_VERSION" ]; then
            log "step=qodersec status=failed reason=bootstrap verification failed current=$CURRENT_CLI_VERSION target=$TARGET_CLI_VERSION"
            mark_cooldown
            exit 0
        fi
        log "step=qodersec status=ok version=$CURRENT_CLI_VERSION"
    else
        log "step=qodersec status=failed reason=bootstrap error target=$TARGET_CLI_VERSION"
        mark_cooldown
        exit 0
    fi
fi

# ── Step 2: persistent config, only now that the binary is at target. A copy
#            failure is local and must not hold back the qodercli step. ──
if [ "$NEED_CONFIG" = "1" ]; then
    beat
    PLUGIN_VERSION=""
    if [ -f "$PLUGIN_ROOT/.qoder-plugin/plugin.json" ]; then
        PLUGIN_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$PLUGIN_ROOT/.qoder-plugin/plugin.json" | head -1)"
    fi
    TEMPLATE=""
    if [ -f "$PLUGIN_ROOT/config.yaml" ]; then
        TEMPLATE="$PLUGIN_ROOT/config.yaml"
    elif [ -f "$PLUGIN_ROOT/config.yaml.example" ]; then
        TEMPLATE="$PLUGIN_ROOT/config.yaml.example"
    fi
    if [ -n "$TEMPLATE" ] && cp "$TEMPLATE" "$_CHOME/config.yaml" 2>/dev/null; then
        [ -n "$PLUGIN_VERSION" ] && printf '%s' "$PLUGIN_VERSION" > "$_CHOME/.config-version" 2>/dev/null
        log "step=config status=ok plugin_version=${PLUGIN_VERSION:-unknown}"
    else
        log "step=config status=failed reason=no readable template under $PLUGIN_ROOT"
    fi
fi

# ── Step 3: qodercli. Always run once the binary is available: ensure-deps
#            skips the network when qodercli already matches the pin, and it is
#            what initialises the manual-review coverage baseline. ──
if [ -x "$CLI" ]; then
    beat
    log "step=qodercli status=start need=$NEED_QODERCLI"
    if "$CLI" ensure-deps --hook-event SessionStart >> "$_QODERSEC_LOG" 2>&1; then
        log "step=qodercli status=ok"
    else
        log "step=qodercli status=failed"
        mark_cooldown
        exit 0
    fi
else
    log "step=qodercli status=skipped reason=qodersec binary missing"
    mark_cooldown
    exit 0
fi

clear_cooldown
log "done target=${TARGET_CLI_VERSION:-none}"
