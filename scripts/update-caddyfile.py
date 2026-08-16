#!/usr/bin/env python3
"""
Rewrites the <app-host> block in the live Caddyfile to match this
repo's canonical block (see app/caddy.fragment). The app handles its own auth,
so the block is a plain reverse_proxy — no forward_auth.

The block must keep the /api/party/ws* route: the Next standalone server cannot
take the `upgrade` event, so that path is served by a separate ws server on 3002
in the same container. Dropping it makes party play fail silently in production.

Two things about how this writes, both load-bearing:
  * The Caddyfile is a single-FILE bind mount, and Docker binds single files by
    inode. Writing in place (open 'w' truncates and rewrites the same inode)
    keeps the mount attached. Never switch this to the write-temp-then-rename
    pattern -- that swaps the inode, silently detaches the mount, and the
    container serves the original file forever.
  * Because of the above, a `caddy reload` after this script is NOT sufficient
    to trust on its own. Verify the container actually sees the change, and
    recreate if it does not. The script prints the exact commands.
"""
import os
import sys

CADDYFILE = os.environ.get('CADDYFILE', '/home/joe/docker/caddy/Caddyfile')

# Tabs, to match the rest of the live Caddyfile.
NEW_BLOCK = '''<app-host> {
\timport lab_common
\tencode zstd gzip

\thandle /api/party/ws* {
\t\treverse_proxy unified-frontend:3002
\t}
\thandle {
\t\treverse_proxy unified-frontend:3001
\t}
}'''


def find_block_end(text, start):
    """Find the index just past the closing brace matching the one at start."""
    depth = 0
    i = start
    while i < len(text):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def main():
    try:
        with open(CADDYFILE, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f'ERROR: {CADDYFILE} does not exist.')
        print('Set CADDYFILE=/path/to/Caddyfile if the edge lives somewhere else.')
        sys.exit(1)

    marker = '<app-host> {'
    idx = content.find(marker)
    if idx == -1:
        print(f'ERROR: <app-host> block not found in {CADDYFILE}')
        sys.exit(1)

    end = find_block_end(content, idx)
    if end == -1:
        print('ERROR: Could not find end of <app-host> block')
        sys.exit(1)

    if content[idx:end] == NEW_BLOCK:
        print(f'{CADDYFILE} already matches the canonical block. Nothing to do.')
        return

    # In-place truncate-and-rewrite, same inode. See the module docstring.
    with open(CADDYFILE, 'w') as f:
        f.write(content[:idx] + NEW_BLOCK + content[end:])

    print(f'{CADDYFILE} updated.')
    print('Now confirm the CONTAINER sees it -- a reload alone can silently no-op:')
    print('  docker exec caddy grep party/ws /etc/caddy/Caddyfile')
    print('If that prints nothing, the bind mount is stale. Recreate:')
    print('  cd /home/joe/docker/caddy && docker compose up -d caddy')


if __name__ == '__main__':
    main()
