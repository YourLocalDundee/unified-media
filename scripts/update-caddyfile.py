#!/usr/bin/env python3
"""
Replaces the unified.minijoe.dev block in the live Caddyfile with the
simple version (plain reverse_proxy, no forward_auth).
"""
import re
import sys

CADDYFILE = '/opt/docker/configs/caddy/Caddyfile'
NEW_BLOCK = '''unified.minijoe.dev {
    import compressed
    reverse_proxy unified-frontend:3001
}'''

def find_block_end(text, start):
    """Find the index of the closing brace that matches the opening brace at start."""
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
    with open(CADDYFILE, 'r') as f:
        content = f.read()

    marker = 'unified.minijoe.dev {'
    idx = content.find(marker)
    if idx == -1:
        print('ERROR: unified.minijoe.dev block not found in Caddyfile')
        sys.exit(1)

    end = find_block_end(content, idx)
    if end == -1:
        print('ERROR: Could not find end of unified.minijoe.dev block')
        sys.exit(1)

    # Preserve leading newline if present
    prefix = '\n' if idx > 0 and content[idx-1] == '\n' else ''
    new_content = content[:idx] + NEW_BLOCK + content[end:]

    with open(CADDYFILE, 'w') as f:
        f.write(new_content)

    print('Caddyfile updated successfully.')
    print('Run: docker exec caddy caddy reload --config /etc/caddy/Caddyfile')

if __name__ == '__main__':
    main()
