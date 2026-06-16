# OpenLakeWatchParty (Ash-KODES) — Feature Mining

Source: `sources/OpenLakeWatchParty/`
Stack: Chrome extension (content scripts injected into streaming sites) + Node + Socket.IO server
(`server/index.js`). Syncs **third-party sites** (Netflix, YouTube, Hotstar) by scraping their players via
per-site content scripts (`extension/script/netflix.js`, `youtube.js`, `hotstar.js`,
`getDuration_*.js`).

This is the weakest watch-together reference in `sources/`. Its model — a browser extension that hijacks
*other people's* video players — is the opposite of ours (we own a native player on local content). Sync is
basic host-authoritative timestamp broadcast (`syncYoutube` / `syncNetflix` / `syncHotstar` each send
`[duration, isPaused]`), well below Party Play (v0.9.5). Nothing structural to grab.

---

## The one item of note

### WebRTC video chat reference — `extension/script/videoChat.js`
It implements peer-to-peer video chat (`connectClients` → `notifyClientsToConnect` signaling in
`server/index.js:193`, plus `videoChat.html` / `videoChatStyles.css`). This is a **third independent
reference** for the voice/video-chat feature (after watchparty `joinVideo`/`signal` and OpenLakeWatchParty
here). watchparty's implementation is more mature, so use that as primary — but this one is smaller and may
be easier to read end-to-end when we build the signaling relay.

---

## NOT applicable

- **Everything else.** Per-site scraping content scripts (Netflix/YouTube/Hotstar DOM hooks), the Chrome
  extension packaging, host-only timestamp sync, and the "open a shared link then join" flow are all tied
  to the extension-over-third-party-sites model. None of it maps to a native media server.

---

## Recommendation

Skip for features. If/when we build voice+video chat (watch-party grab #2), glance at `videoChat.js` as a
compact second reference for the WebRTC handshake. Otherwise nothing here.
