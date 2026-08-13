# Chromium-only Playwright image.
#
# The official mcr.microsoft.com/playwright image is 3.5GB because it ships Chromium, Firefox AND
# WebKit plus every system dep for all three. This skill launches Chromium and nothing else, so
# the other two are pure download and disk cost.
#
# Build:  docker build -t unified-drive:1.50.0 .
#
# The playwright version here MUST match the `playwright` package in ./node_modules, or Chromium
# will not launch — the package looks for a browser build number it was compiled against. Change
# both together, never one.
FROM node:24-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_VERSION=1.50.0

# --with-deps pulls the system libraries Chromium needs (fonts, nss, libdrm, …). Doing it in the
# same layer as the browser install and dropping the apt lists afterwards keeps the layer small.
RUN npm i -g "playwright@${PLAYWRIGHT_VERSION}" \
 && npx playwright install --with-deps chromium \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /w
