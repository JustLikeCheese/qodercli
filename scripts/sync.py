"""Sync upstream @qoder-ai/qodercli npm releases into this archive repo.

Idempotent. Safe to re-run. Detects what's missing and only does that.

Per run, will:
  1. Archive up to MAX_ARCHIVES missing versions (commit + tag + push + GH release with binaries + bilingual body).
  2. Backfill empty release bodies on existing tags where upstream changelog exists.

Sources:
  - npm registry:   https://registry.npmjs.org/@qoder-ai/qodercli
  - changelog EN:   https://github.com/QoderAI/changelog-CLI       (release body per tag)
  - changelog zh:   https://github.com/QoderAI/changelog-CLI-zh_CN (release body per tag)
  - binaries:       OSS URLs embedded in each version's package.json (binaries.files[].url)

Environment:
  MAX_ARCHIVES   how many new versions to archive per run        (default 5)
  MAX_BACKFILLS  how many empty bodies to backfill per run        (default 20)
  REPO_PATH      path to this repo                                (default: cwd)
  GH_TOKEN       passed to `gh` CLI; required in CI

Exit code is non-zero if any individual version failed.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

NPM_PACKAGE = "@qoder-ai/qodercli"
CHANGELOG_EN = "QoderAI/changelog-CLI"
CHANGELOG_ZH = "QoderAI/changelog-CLI-zh_CN"
NPM_REG = "https://registry.npmjs.org"

REPO = Path(os.environ.get("REPO_PATH", os.getcwd())).resolve()
WORK = Path(os.environ.get("WORK_DIR", os.environ.get("RUNNER_TEMP", os.environ.get("TEMP", "/tmp")))) / "qodercli-sync"
WORK.mkdir(parents=True, exist_ok=True)

MAX_ARCHIVES = int(os.environ.get("MAX_ARCHIVES", "5"))
MAX_BACKFILLS = int(os.environ.get("MAX_BACKFILLS", "20"))

# Platforms in (os, arch, asset_name) form. arch is the package.json key, not the URL suffix.
# Existing convention: 5 mainstream platforms only — skip musl + baseline.
PLATFORMS = [
    ("darwin", "arm64", "qodercli-darwin-arm64"),
    ("darwin", "amd64", "qodercli-darwin-amd64"),
    ("linux", "arm64", "qodercli-linux-arm64"),
    ("linux", "amd64", "qodercli-linux-amd64"),
    ("windows", "amd64", "qodercli-windows-amd64.exe"),
]

PRERELEASE_RE = re.compile(r"(beta|alpha|preview|rc|next)", re.I)


# ---------- io helpers ----------

def sh(cmd, *, cwd=None, check=True, capture=False):
    print(f"$ {cmd}", flush=True)
    r = subprocess.run(
        cmd, shell=True, cwd=cwd, check=check,
        capture_output=capture, text=True, encoding="utf-8",
    )
    if capture:
        return (r.stdout or "").strip()
    return r


def http_get(url, dest):
    print(f"  GET {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "qodercli-sync/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def gh_release_view(tag, repo):
    """Return dict or None if release missing."""
    r = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo, "--json", "name,body"],
        capture_output=True, text=True, encoding="utf-8",
    )
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


# ---------- data discovery ----------

def fetch_npm_versions():
    dest = WORK / "npm.json"
    http_get(f"{NPM_REG}/{NPM_PACKAGE}", dest)
    d = json.loads(dest.read_text(encoding="utf-8"))
    return list(d.get("versions", {}).keys())


def fetch_local_tags():
    out = sh("git tag -l", cwd=REPO, capture=True)
    return {line.strip() for line in out.splitlines() if line.strip()}


def fetch_gh_releases():
    """Return dict[tag] = {body, name}. Single API call via `gh api releases`."""
    repo_slug = sh("gh repo view --json nameWithOwner -q .nameWithOwner", cwd=REPO, capture=True)
    page = 1
    result = {}
    while True:
        out = sh(
            f'gh api "repos/{repo_slug}/releases?per_page=100&page={page}"',
            cwd=REPO, capture=True,
        )
        items = json.loads(out)
        if not items:
            break
        for it in items:
            result[it["tag_name"]] = {
                "name": it.get("name", "") or "",
                "body": it.get("body", "") or "",
            }
        if len(items) < 100:
            break
        page += 1
    return result


# ---------- changelog ----------

def build_body(version):
    """Return bilingual body (EN + zh + footer) or '' if no upstream entry."""
    en = gh_release_view(version, CHANGELOG_EN)
    zh = gh_release_view(version, CHANGELOG_ZH)
    en_has = en and (en.get("body") or en.get("name"))
    zh_has = zh and (zh.get("body") or zh.get("name"))
    if not en_has and not zh_has:
        return ""
    parts = []
    if en_has:
        t = (en.get("name") or "").strip()
        b = (en.get("body") or "").strip()
        if t:
            parts.append(f"## {t}")
            parts.append("")
        if b:
            parts.append(b)
    if en_has and zh_has:
        parts.append("")
        parts.append("---")
        parts.append("")
    if zh_has:
        t = (zh.get("name") or "").strip()
        b = (zh.get("body") or "").strip()
        if t:
            parts.append(f"## {t}")
            parts.append("")
        if b:
            parts.append(b)
    parts.append("")
    parts.append("---")
    parts.append("")
    parts.append(
        f"> Unofficial archive of "
        f"[`{NPM_PACKAGE}@{version}`](https://www.npmjs.com/package/{NPM_PACKAGE}/v/{version}). "
        f"Changelog sourced from "
        f"[{CHANGELOG_EN}](https://github.com/{CHANGELOG_EN}/releases/tag/{version}) "
        f"and [{CHANGELOG_ZH}](https://github.com/{CHANGELOG_ZH}/releases/tag/{version})."
    )
    return "\n".join(parts).strip() + "\n"


# ---------- archive flow ----------

def replace_repo_files(version):
    """Download tarball, blow away top-level files in REPO (except .git/.github/scripts), replace with tarball contents."""
    tgz = WORK / f"pkg-{version}.tgz"
    extract = WORK / f"extract-{version}"
    if extract.exists():
        shutil.rmtree(extract)
    extract.mkdir()
    http_get(f"{NPM_REG}/{NPM_PACKAGE}/-/qodercli-{version}.tgz", tgz)
    with tarfile.open(tgz, "r:gz") as t:
        t.extractall(extract)
    src = extract / "package"
    if not src.exists():
        raise RuntimeError(f"tarball missing 'package/' root: {tgz}")

    keep = {".git", ".github", "scripts"}  # scripts/sync.py lives here — never overwrite our own automation
    for entry in REPO.iterdir():
        if entry.name in keep:
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    for entry in src.iterdir():
        # Tarballs include their own scripts/install.js which would overwrite our scripts/sync.py.
        # Merge: keep our scripts/sync.py, take everything else from tarball.
        if entry.name == "scripts" and entry.is_dir():
            dest_scripts = REPO / "scripts"
            dest_scripts.mkdir(exist_ok=True)
            for sub in entry.iterdir():
                if sub.name == "sync.py":
                    continue
                dest = dest_scripts / sub.name
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(dest)
                    else:
                        dest.unlink()
                if sub.is_dir():
                    shutil.copytree(sub, dest)
                else:
                    shutil.copy2(sub, dest)
            continue
        dest = REPO / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest)
        else:
            shutil.copy2(entry, dest)
    return src  # path to extracted package/ dir


def download_binaries(version, src_pkg):
    """Download 5 platform binaries from OSS URLs in package.json. Returns list of local paths."""
    pkg = json.loads((src_pkg / "package.json").read_text(encoding="utf-8"))
    bins = pkg.get("binaries", {}).get("files", [])
    if not bins:
        print(f"  [warn] no binaries.files in package.json for {version} — skipping binary assets", flush=True)
        return []
    url_by_key = {(f["os"], f["arch"]): f["url"] for f in bins}

    out_dir = WORK / f"assets-{version}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir()

    assets = []
    for os_name, arch, asset_name in PLATFORMS:
        url = url_by_key.get((os_name, arch))
        if not url:
            print(f"  [skip] no URL for {os_name}/{arch}", flush=True)
            continue
        archive_path = out_dir / Path(url).name
        try:
            http_get(url, archive_path)
        except Exception as e:
            print(f"  [skip] download failed for {os_name}/{arch}: {e}", flush=True)
            continue

        binary_inside = "qodercli.exe" if os_name == "windows" else "qodercli"
        target = out_dir / asset_name
        try:
            if url.endswith(".zip"):
                with zipfile.ZipFile(archive_path) as z:
                    cand = next((n for n in z.namelist() if Path(n).name == binary_inside), None)
                    if not cand:
                        print(f"  [skip] no {binary_inside} in {archive_path.name}", flush=True)
                        continue
                    with z.open(cand) as f, open(target, "wb") as g:
                        shutil.copyfileobj(f, g)
            else:
                with tarfile.open(archive_path, "r:gz") as t:
                    cand = next(
                        (m for m in t.getmembers() if m.isfile() and Path(m.name).name == binary_inside),
                        None,
                    )
                    if not cand:
                        print(f"  [skip] no {binary_inside} in {archive_path.name}", flush=True)
                        continue
                    with t.extractfile(cand) as f, open(target, "wb") as g:
                        shutil.copyfileobj(f, g)
        except Exception as e:
            print(f"  [skip] extract failed for {os_name}/{arch}: {e}", flush=True)
            continue
        # Discard the wrapping archive to save disk before next platform.
        archive_path.unlink(missing_ok=True)
        assets.append(target)
        print(f"  [ok] {asset_name}  ({target.stat().st_size:,} bytes)", flush=True)
    return assets


def archive_one(version):
    tag = f"v{version}"
    print(f"\n========== archive {version} ==========", flush=True)

    # 1. body (may be empty for betas)
    body = build_body(version)
    print(f"  body: {'bilingual' if body else 'empty (no upstream entry)'}", flush=True)

    # 2. swap in tarball contents
    src_pkg = replace_repo_files(version)

    # Tarball-extracted files often have no actual change vs current repo state — but for archival
    # we want a commit per version regardless. Use --allow-empty to handle no-op.
    sh("git add -A", cwd=REPO)
    sh(f'git commit -m "chore: release {tag}" --allow-empty', cwd=REPO)
    sh(f"git tag {tag}", cwd=REPO)

    # 3. binaries
    assets = download_binaries(version, src_pkg)

    # 4. push
    sh("git push origin HEAD", cwd=REPO)
    sh(f"git push origin {tag}", cwd=REPO)

    # 5. release
    body_file = WORK / f"body-{version}.md"
    body_file.write_text(body if body else f"_Unofficial archive of `{NPM_PACKAGE}@{version}`._\n",
                         encoding="utf-8")
    is_prerelease = bool(PRERELEASE_RE.search(version))
    cmd = ["gh release create", tag, f'--title "{tag}"', f'--notes-file "{body_file}"']
    if is_prerelease:
        cmd.append("--prerelease")
    for a in assets:
        cmd.append(f'"{a}"')
    sh(" ".join(cmd), cwd=REPO)

    # Free disk before next iteration.
    shutil.rmtree(WORK / f"assets-{version}", ignore_errors=True)
    shutil.rmtree(WORK / f"extract-{version}", ignore_errors=True)
    (WORK / f"pkg-{version}.tgz").unlink(missing_ok=True)
    print(f"========== {version} done ==========", flush=True)


def backfill_body(version):
    """For existing release with empty body, write upstream changelog to it."""
    body = build_body(version)
    if not body:
        return False
    body_file = WORK / f"backfill-{version}.md"
    body_file.write_text(body, encoding="utf-8")
    tag = f"v{version}"
    sh(f'gh release edit {tag} --notes-file "{body_file}"', cwd=REPO)
    print(f"  [backfilled] {tag}", flush=True)
    return True


# ---------- main ----------

def main():
    print(f"REPO     = {REPO}", flush=True)
    print(f"WORK     = {WORK}", flush=True)
    print(f"caps     = archives:{MAX_ARCHIVES}  backfills:{MAX_BACKFILLS}", flush=True)

    # Sync tags from remote first.
    sh("git fetch --tags origin", cwd=REPO)

    npm_versions = fetch_npm_versions()
    local_tags = fetch_local_tags()
    gh_releases = fetch_gh_releases()

    missing = [v for v in npm_versions if f"v{v}" not in local_tags]
    print(f"npm versions: {len(npm_versions)}", flush=True)
    print(f"local tags:   {len(local_tags)}", flush=True)
    print(f"missing:      {len(missing)}", flush=True)

    failures = []

    # 1. Archive new versions, oldest first (so commit history is chronological).
    to_archive = missing[:MAX_ARCHIVES]
    for v in to_archive:
        try:
            archive_one(v)
        except Exception as e:
            print(f"!! archive {v} FAILED: {e}", flush=True)
            failures.append(("archive", v, str(e)))
            # Reset any partial state for this version so the next run can retry.
            sh("git reset --hard origin/main", cwd=REPO, check=False)
            sh(f"git tag -d v{v}", cwd=REPO, check=False)

    # 2. Backfill empty bodies on existing releases (where upstream changelog exists).
    backfilled = 0
    for v in npm_versions:
        if backfilled >= MAX_BACKFILLS:
            break
        tag = f"v{v}"
        rel = gh_releases.get(tag)
        if not rel:
            continue  # not yet released — archive step will handle later
        if (rel.get("body") or "").strip():
            continue  # already has body
        try:
            if backfill_body(v):
                backfilled += 1
        except Exception as e:
            print(f"!! backfill {v} FAILED: {e}", flush=True)
            failures.append(("backfill", v, str(e)))

    print(f"\nsummary: archived={len(to_archive)-sum(1 for f in failures if f[0]=='archive')} "
          f"backfilled={backfilled} failures={len(failures)}", flush=True)
    if failures:
        for kind, v, err in failures:
            print(f"  FAIL {kind} {v}: {err}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
