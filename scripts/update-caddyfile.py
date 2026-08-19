#!/usr/bin/env python3
"""
Rewrites one vhost block in the live Caddyfile from this repo's canonical source,
app/caddy.fragment.

The block used to be duplicated inline here, which meant this script quietly shipped a stale
copy of it. It now reads the fragment, so there is exactly one definition to keep correct.

Hostnames are not hardcoded: pass the one you want with APP_HOST (or --host). The deployment's
real names live on the box, not in this repo.

    APP_HOST=app.example.dev python3 scripts/update-caddyfile.py
    python3 scripts/update-caddyfile.py --host app.example.dev --dry-run

Two things about how this writes, both of which matter:
  * The Caddyfile is a single-FILE bind mount, and Docker binds single files by inode. Writing
    in place (open 'w' truncates and rewrites the same inode) keeps the mount attached. Never
    switch this to the write-temp-then-rename pattern -- that swaps the inode, silently detaches
    the mount, and the container serves the original file forever.
  * Because of the above, a `caddy reload` after this script is NOT sufficient to trust on its
    own. Verify the container actually sees the change, and recreate if it does not. The script
    prints the exact commands.
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CADDYFILE = os.environ.get('CADDYFILE', '/etc/caddy/Caddyfile')
FRAGMENT = os.environ.get('CADDY_FRAGMENT', os.path.join(REPO, 'app', 'caddy.fragment'))


def block_for(text, host):
    """Return the `host { ... }` block from `text`, or None. Assumes the closing brace of a
    site block is the only `}` at column 0, which is how both files are formatted."""
    lines = text.splitlines(keepends=True)
    start = next((i for i, l in enumerate(lines) if l.startswith(host + ' {')), None)
    if start is None:
        return None
    end = next((i for i in range(start, len(lines)) if lines[i].rstrip() == '}'), None)
    if end is None:
        return None
    return ''.join(lines[start:end + 1]), start, end


def main():
    args = sys.argv[1:]
    host = os.environ.get('APP_HOST')
    dry_run = '--dry-run' in args
    if '--host' in args:
        host = args[args.index('--host') + 1]

    if not host:
        print('ERROR: set APP_HOST or pass --host <hostname>.', file=sys.stderr)
        return 2

    try:
        fragment_text = open(FRAGMENT).read()
    except OSError as err:
        print(f'ERROR: cannot read {FRAGMENT}: {err}', file=sys.stderr)
        return 1

    found = block_for(fragment_text, host)
    if not found:
        print(f'ERROR: no `{host}` block in {FRAGMENT}', file=sys.stderr)
        return 1
    new_block, _, _ = found

    try:
        live_text = open(CADDYFILE).read()
    except OSError as err:
        print(f'ERROR: cannot read {CADDYFILE}: {err}', file=sys.stderr)
        return 1

    found = block_for(live_text, host)
    if not found:
        print(f'ERROR: no `{host}` block in {CADDYFILE} — refusing to guess where to put it.',
              file=sys.stderr)
        return 1
    old_block, start, end = found

    if old_block == new_block:
        print(f'{host}: already matches {FRAGMENT}, nothing to do.')
        return 0

    lines = live_text.splitlines(keepends=True)
    updated = ''.join(lines[:start]) + new_block + ''.join(lines[end + 1:])

    if dry_run:
        print(f'--dry-run: would rewrite the `{host}` block in {CADDYFILE}')
        return 0

    # In place on purpose: see the module docstring. Do NOT write-temp-then-rename.
    with open(CADDYFILE, 'w') as fh:
        fh.write(updated)

    print(f'{host}: block updated in {CADDYFILE}')
    print('Now verify the container actually sees it, and recreate if it does not:')
    print(f'  docker exec caddy grep -n "{host}" {CADDYFILE}')
    print('  docker compose up -d caddy   # recreate; a reload alone is not enough')
    return 0


if __name__ == '__main__':
    sys.exit(main())
