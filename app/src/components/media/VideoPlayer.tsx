'use client'

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  ArrowLeft,
  Sliders,
  Captions,
  Languages,
  Check,
  Search,
} from 'lucide-react'
import type { PlaybackData } from '@/lib/media-server/types'
import { useAudioChain } from '@/components/player/useAudioChain'
import { MediaToolsPanel } from '@/components/player/MediaToolsPanel'
import { MediaQualitySelector } from '@/components/player/MediaQualitySelector'
import SubtitleSearchPanel from '@/components/player/SubtitleSearchPanel'
import type { AspectRatioMode, QualityOption } from '@/components/player/types'
import { usePlaybackPrefs } from '@/hooks/useSettings'
import { selectPreferredAudioRel, selectPreferredSubtitleIndex } from '@/lib/media-server/codecs'
import { usePartySync } from '@/hooks/usePartySync'
import { PartyPanel } from '@/components/party/PartyPanel'
import { ChatPanel } from '@/components/party/ChatPanel'
import { ReactionBar } from '@/components/party/ReactionBar'
import { ReactionOverlay } from '@/components/party/ReactionOverlay'
import { StartPartyButton } from '@/components/party/StartPartyButton'
import { joinParty, getPartyInfo, leaveParty, endParty } from '@/lib/party/client'

// Memoized party children (A4-H6). `currentTime` state updates ~4×/sec during
// playback and re-renders VideoPlayer; without memo these heavy panels reconcile on
// every tick. usePartySync returns useCallback-stable handlers and state arrays that
// only change on real party events, so their props are referentially stable between
// time ticks and memo short-circuits the re-render.
const PartyPanelMemo = memo(PartyPanel)
const ChatPanelMemo = memo(ChatPanel)
const ReactionOverlayMemo = memo(ReactionOverlay)
const ReactionBarMemo = memo(ReactionBar)

// ---------------------------------------------------------------------------
// Time formatting (HH:MM:SS / MM:SS for player display)
// ---------------------------------------------------------------------------

function formatPlayerTime(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) {
    return `${h}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

// ---------------------------------------------------------------------------
// Next-episode data shape
// ---------------------------------------------------------------------------

interface NextEpisode {
  id: string
  title: string
  seasonEpisode?: string
}

// Maps native dimensions to the closest aspect-ratio mode. Pure (args only), so it
// lives at module scope — usable from the lazy useState initializer without tripping
// the "use before declaration" rule and without being recreated each render.
function detectAspectRatio(w: number, h: number): AspectRatioMode {
  if (!w || !h) return 'auto'
  const ar = w / h
  const RATIO_MAP: [number, AspectRatioMode][] = [
    [16 / 9,  '16:9'],
    [4 / 3,   '4:3'],
    [21 / 9,  '21:9'],
    [2.35,    '2.35:1'],
    [1,       '1:1'],
    [9 / 16,  '9:16'],
  ]
  let best: AspectRatioMode = 'auto'
  let minDiff = Infinity
  for (const [ratio, mode] of RATIO_MAP) {
    const diff = Math.abs(ar - ratio)
    if (diff < minDiff) { minDiff = diff; best = mode }
  }
  return minDiff <= 0.15 ? best : 'auto'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VideoPlayer(props: PlaybackData) {
  const {
    streamUrl,
    isHls,
    mediaSourceId,
    itemId,
    playSessionId,
    subtitleStreams,
    audioStreams,
    defaultAudioIndex,
    itemTitle,
    seriesTitle,
    seriesId,
    seasonEpisode,
    resumePositionTicks,
    progressApiUrl,
    nextEpisodeApiBase,
    subtitleApiBase,
    downloadedSubtitles,
  } = props

  const router = useRouter()

  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const hlsRef = useRef<{ destroy: () => void } | null>(null)
  const didReportStart = useRef(false)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeApplied = useRef(false)
  // Set before a stream switch (audio track change) to the position to resume at; consumed
  // once in handleLoadedMetadata. Uses the same currentTime path as everything else — no
  // parallel offset system — so watch-progress / position_ticks stay the single source of truth.
  const pendingSeekRef = useRef<number | null>(null)
  // Guards the one-time, preference-driven default audio/subtitle selection on mount.
  const defaultsApplied = useRef(false)
  // Last position (ticks) reported to the progress endpoint, to skip redundant writes (A4-H5).
  const lastReportedTicksRef = useRef(-1)
  // Makes handleEnded idempotent (browsers can fire 'ended' twice) and lets us abort the
  // in-flight next-episode fetch on unmount (A4-M8).
  const didEndRef = useRef(false)
  const endedAbortRef = useRef<AbortController | null>(null)
  // Keeps nextEpisode current inside the keydown effect (which has empty deps to avoid
  // re-registration). Functional state setters handle activeSubIndex without a ref.
  const nextEpisodeRef = useRef<NextEpisode | null>(null)
  // True while the user is dragging the seek bar; suppresses timeupdate-driven setCurrentTime
  // so the thumb doesn't jump back to the playhead between drag events (A4-M3).
  const isScrubbingRef = useRef(false)

  // Player state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Decoded resolution for the stats overlay. Captured into state on loadedmetadata
  // rather than read from videoRef.current during render (refs aren't readable in render).
  const [videoResolution, setVideoResolution] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  // Next-episode autoplay state
  const [nextEpisode, setNextEpisode] = useState<NextEpisode | null>(null)
  const [countdownActive, setCountdownActive] = useState(false)
  const [countdown, setCountdown] = useState<number>(10)

  // Resume-mode dialog: shown when resumeMode === 'ask' and resumeSeconds > 30
  const [showResumeDialog, setShowResumeDialog] = useState(false)
  // State (not a ref) because it is read during render to drive the resume dialog —
  // reading a ref's .current in render is disallowed. Written only from event handlers.
  const [pendingResumeSeconds, setPendingResumeSeconds] = useState<number | null>(null)

  // Tools panel state
  const [showToolsPanel, setShowToolsPanel] = useState(false)
  const [videoFilter, setVideoFilter] = useState('')
  const [videoTransform, setVideoTransform] = useState('')
  const [videoAlignment, setVideoAlignment] = useState('center center')
  // Lazily initialised from the native dimensions (deterministic, props-only, so it is
  // SSR-safe) instead of being set in a mount effect — avoids a setState-in-effect.
  const [aspectRatioMode, setAspectRatioMode] = useState<AspectRatioMode>(() =>
    props.nativeWidth && props.nativeHeight
      ? detectAspectRatio(props.nativeWidth, props.nativeHeight)
      : 'auto',
  )
  const { initChain } = useAudioChain(videoRef)

  // Quality / resolution state
  const [currentQuality, setCurrentQuality] = useState<QualityOption | null>(
    props.availableQualities?.[0] ?? null
  )
  const [activeStreamUrl, setActiveStreamUrl] = useState(props.streamUrl)
  const [activeIsHls, setActiveIsHls] = useState(props.isHls)

  // Subtitle track state (-1 = Off)
  const [activeSubIndex, setActiveSubIndex] = useState<number>(-1)
  const [showSubMenu, setShowSubMenu] = useState(false)
  // On-demand subtitle search overlay + tracks grabbed during this session. Session
  // tracks are appended after the server-provided embedded/downloaded tracks and are
  // served by stable subtitle_wants id, so a live grab injects a <track> with no reload.
  const [showSubSearch, setShowSubSearch] = useState(false)
  const [extraTracks, setExtraTracks] = useState<Array<{ wantId: number; label: string; srcLang: string }>>([])

  // Audio track state. The active audio-relative index; the server default is whichever
  // audio stream matches defaultAudioIndex (an absolute ffprobe index).
  const serverDefaultAudioRel =
    audioStreams.find((a) => a.index === defaultAudioIndex)?.relIndex ?? 0
  const [activeAudioRel, setActiveAudioRel] = useState<number>(serverDefaultAudioRel)
  const [showAudioMenu, setShowAudioMenu] = useState(false)

  // User language preferences (localStorage). Read once on mount to set English defaults.
  const { prefs, ready: prefsReady } = usePlaybackPrefs()
  // Ref kept current so async closures (HLS MANIFEST_PARSED) can read latest prefs (A4-M1).
  const prefsRef = useRef(prefs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  // Stats overlay state
  const [showStats, setShowStats] = useState(false)

  // ---------------------------------------------------------------------------
  // Party Play state (all behind partyId truthiness — non-party playback is
  // behaviorally unchanged).
  // ---------------------------------------------------------------------------
  const selfUserId = props.selfUserId ?? ''
  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyJoinCode, setPartyJoinCode] = useState<string>('')
  const [partyHostUserId, setPartyHostUserId] = useState<string | null>(null)
  const [partyMediaId, setPartyMediaId] = useState<string>(itemId)
  const [partyPanelOpen, setPartyPanelOpen] = useState(true)
  const partyJoinAttempted = useRef(false)

  // Auto-advance navigation: when the server advances the shared queue, every client
  // navigates to the next item (same party, re-joined via ?party=). router.push keeps the
  // same document so playback autoplay stays permitted.
  const handleQueueAdvance = useCallback(
    (nextMediaId: string, joinCode: string) => {
      if (!nextMediaId) return
      const suffix = joinCode ? `?party=${joinCode}` : ''
      router.push(`/play/${nextMediaId}${suffix}`)
    },
    [router],
  )

  const party = usePartySync(partyId, {
    videoRef,
    selfUserId,
    enabled: !!partyId,
    mediaId: itemId,
    onQueueAdvance: handleQueueAdvance,
  })

  // Auto-join from a ?party={code} link on mount.
  useEffect(() => {
    if (!props.initialJoinCode || partyJoinAttempted.current) return
    partyJoinAttempted.current = true
    let cancelled = false
    ;(async () => {
      try {
        const joined = await joinParty({ joinCode: props.initialJoinCode })
        if (cancelled) return
        // If the party is for a different media item than this player has open, navigate
        // to the party's media instead of syncing against the wrong file (A5-02). The
        // link path normally already encodes the right [id], but a code entered here for
        // a party watching item B while we show item A must not sync in place.
        if (joined.mediaId !== itemId) {
          router.replace(`/play/${joined.mediaId}?party=${joined.joinCode}`)
          return
        }
        setPartyId(joined.partyId)
        setPartyJoinCode(joined.joinCode)
        setPartyMediaId(joined.mediaId)
        // Resolve host for the panel. This is a SECOND request after the join already
        // succeeded; a transient failure must not strip the host's "End party" control,
        // so retry a few times instead of swallowing it once (A5-05).
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            const info = await getPartyInfo(joined.partyId)
            if (cancelled) return
            setPartyHostUserId(info.hostUserId)
            break
          } catch (e) {
            if (attempt === 2) console.warn('[VideoPlayer] getPartyInfo failed after retries', e)
            else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
          }
        }
      } catch (e) {
        console.warn('[VideoPlayer] party auto-join failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const partyActive = !!partyId

  const partyJoinUrl =
    typeof window !== 'undefined' && partyJoinCode
      ? `${window.location.origin}/play/${partyMediaId}?party=${partyJoinCode}`
      : ''

  const handlePartyStarted = useCallback(
    (info: { partyId: string; joinCode: string; hostUserId: string }) => {
      setPartyId(info.partyId)
      setPartyJoinCode(info.joinCode)
      setPartyHostUserId(info.hostUserId)
      setPartyMediaId(itemId)
      setPartyPanelOpen(true)
    },
    [itemId],
  )

  const teardownParty = useCallback(() => {
    setPartyId(null)
    setPartyJoinCode('')
    setPartyHostUserId(null)
  }, [])

  const handlePartyLeave = useCallback(async () => {
    const id = partyId
    teardownParty()
    if (id) {
      try {
        await leaveParty(id)
      } catch {
        /* best-effort */
      }
    }
  }, [partyId, teardownParty])

  const handlePartyEnd = useCallback(async () => {
    const id = partyId
    teardownParty()
    if (id) {
      try {
        await endParty(id)
      } catch {
        /* best-effort */
      }
    }
  }, [partyId, teardownParty])

  // If the host ends the party (server -> party_ended), tear the local party UI down.
  // Done during render via the adjust-on-change pattern (the partyId guard prevents
  // re-entry once teardown clears it) so there is no synchronous setState in an effect.
  if (party.ended && partyId !== null) {
    teardownParty()
  }

  // The keyboard effect is a single mount-once listener with stale closures over
  // party state, so route its play/seek intents through a live ref instead. The ref
  // is updated in an effect (not during render) and only read from the keydown
  // listener that fires after commit, so the update timing is irrelevant.
  const partyKbdRef = useRef<{
    active: boolean
    sendIntent: (action: 'play' | 'pause' | 'seek', positionTicks: number) => void
  }>({ active: false, sendIntent: () => {} })
  useEffect(() => {
    partyKbdRef.current = { active: partyActive, sendIntent: party.sendIntent }
  })

  // Same live-ref bridge for the keydown handler's other dependencies, which are
  // declared further down the component (toggleFullscreen/toggleMute/totalSubCount).
  // Reading them straight from the mount-once listener would be "use before
  // declaration"; the ref is populated by an effect after they exist (see below).
  const kbdActionsRef = useRef<{
    toggleFullscreen: () => void
    toggleMute: () => void
    totalSubCount: number
  }>({ toggleFullscreen: () => {}, toggleMute: () => {}, totalSubCount: 0 })

  // ---------------------------------------------------------------------------
  // Aspect ratio auto-detection + screen-aware quality selection (mount once)
  // ---------------------------------------------------------------------------


  // Screen-aware quality selection. Needs the client window so it stays in an effect,
  // but the setStates are deferred a tick so they run outside the effect's synchronous
  // commit path (react-hooks/set-state-in-effect). (Aspect ratio is lazily initialised
  // above instead.)
  useEffect(() => {
    const qualities = props.availableQualities
    if (!qualities?.length || !props.nativeHeight) return
    const tid = setTimeout(() => {
      // Screen-aware selection: downgrade when the screen is significantly smaller than native.
      const screenH = (window.screen.height ?? 0) * (window.devicePixelRatio || 1)
      let selected: typeof qualities[number] | undefined
      if (props.nativeHeight! > 0 && screenH > 0 && screenH < props.nativeHeight! * 0.75) {
        selected = qualities.find((q) => !q.isDirect && q.maxHeight <= screenH)
      }
      // Quality pref: if the user set a preferred max bitrate and screen-aware didn't trigger,
      // find the best quality option at or below that bitrate ceiling.
      if (!selected && prefs.quality !== 0) {
        selected = qualities
          .filter((q) => !q.isDirect && q.bitrate <= prefs.quality)
          .at(-1) // highest quality within the ceiling (options are sorted best-first)
          ?? qualities.find((q) => !q.isDirect) // fallback to any non-direct
      }
      if (selected) {
        setCurrentQuality(selected)
        setActiveStreamUrl(selected.streamUrl)
        setActiveIsHls(selected.isHls)
      }
    }, 0)
    return () => clearTimeout(tid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the active subtitle track to the video element's textTracks. Array.from
  // materialises a plain array of the live TextTrack objects so the per-element `.mode`
  // write isn't flagged as mutating a value the compiler treats as immutable.
  useEffect(() => {
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    Array.from(tracks).forEach((track, i) => {
      track.mode = i === activeSubIndex ? 'showing' : 'hidden'
    })
  }, [activeSubIndex])

  // Keep ref current so the keydown closure (empty deps) can read the latest value.
  useEffect(() => { nextEpisodeRef.current = nextEpisode }, [nextEpisode])

  // ---------------------------------------------------------------------------
  // Display title
  // ---------------------------------------------------------------------------

  const displayTitle = seriesTitle
    ? [seriesTitle, seasonEpisode, itemTitle].filter(Boolean).join(' · ')
    : itemTitle

  // ---------------------------------------------------------------------------
  // Reporting helpers
  // ---------------------------------------------------------------------------

  const reportStart = useCallback(() => {
    if (!progressApiUrl) {
      console.warn('[VideoPlayer] progressApiUrl not set, progress will not be reported')
      return
    }
    // Send the actual current position, not a hard-coded 0 (A4-L5). On a resume the
    // seek has already landed in handleLoadedMetadata before 'play' fires, so posting
    // 0 here would briefly overwrite the resume position with 0 (lost on a crash in
    // that window).
    const positionTicks = Math.round((videoRef.current?.currentTime ?? 0) * 10_000_000)
    lastReportedTicksRef.current = positionTicks
    fetch(progressApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: itemId, positionTicks, played: false }),
    }).catch(() => {})
  }, [itemId, progressApiUrl])

  const reportProgress = useCallback(
    (isPaused: boolean) => {
      if (!progressApiUrl) return
      const positionTicks = Math.round((videoRef.current?.currentTime ?? 0) * 10_000_000)
      // Skip redundant writes for an unchanged position (A4-H5) — a paused/stationary
      // player previously re-upserted the same row into the single SQLite writer every
      // 10s forever.
      if (positionTicks === lastReportedTicksRef.current) return
      lastReportedTicksRef.current = positionTicks
      fetch(progressApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: itemId, positionTicks, played: isPaused ? undefined : false }),
      }).catch(() => {})
    },
    [itemId, progressApiUrl]
  )

  const reportStop = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
      progressInterval.current = null
    }
    if (!progressApiUrl) return
    const video = videoRef.current
    const positionTicks = Math.round((video?.currentTime ?? 0) * 10_000_000)
    const remaining = video && video.duration > 0
      ? (video.duration - (video.currentTime ?? 0)) / video.duration
      : 1
    // Mark as played when within the last 5% — avoids requiring the credits to finish.
    fetch(progressApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: itemId, positionTicks, played: remaining < 0.05 }),
    }).catch(() => {})
  }, [itemId, progressApiUrl])

  const handleQualityChange = useCallback((quality: QualityOption) => {
    // Capture the current position so the re-init resumes here instead of restarting
    // from 0 (A4-M1). Mirrors the audio-switch path; consumed once in
    // handleLoadedMetadata via the same single currentTime path.
    pendingSeekRef.current = videoRef.current?.currentTime ?? 0
    setCurrentQuality(quality)
    setActiveStreamUrl(quality.streamUrl)
    setActiveIsHls(quality.isHls)
    // Incrementing retryCount triggers the HLS init effect to re-run with the new stream URL.
    setRetryCount((c) => c + 1)
  }, [])

  // Switch the active audio track. Browsers cannot switch embedded audio on Direct Play, so
  // any non-default track routes through the HLS transcode pipeline with `-map 0:a:<rel>`.
  // We capture the current position and resume there once the new stream loads (option B —
  // restart-and-seek; see transcode.ts for the deferred seamless option A).
  const handleAudioChange = useCallback(
    (rel: number) => {
      if (rel === activeAudioRel) {
        setShowAudioMenu(false)
        return
      }
      pendingSeekRef.current = videoRef.current?.currentTime ?? 0
      setActiveAudioRel(rel)
      if (rel === serverDefaultAudioRel) {
        // The default track keeps the server's original decision (Direct Play when the
        // audio is browser-compatible, HLS otherwise).
        setActiveStreamUrl(streamUrl)
        setActiveIsHls(isHls)
      } else {
        setActiveStreamUrl(`/api/media/hls/${itemId}/a${rel}/master.m3u8`)
        setActiveIsHls(true)
      }
      setShowAudioMenu(false)
      setRetryCount((c) => c + 1)
    },
    [activeAudioRel, serverDefaultAudioRel, streamUrl, isHls, itemId],
  )

  // ---------------------------------------------------------------------------
  // Preference-driven default audio + subtitle selection (English by default)
  // ---------------------------------------------------------------------------

  // Applied once, after prefs hydrate from localStorage. Audio defaults to the preferred
  // language (falling back to the server's default track); switching to a non-default track
  // routes through HLS via handleAudioChange. Subtitles stay OFF unless a subtitle language
  // is configured, in which case the full track is preferred over signs-and-songs / forced.
  useEffect(() => {
    if (!prefsReady || defaultsApplied.current) return
    defaultsApplied.current = true

    // Deferred a tick so the default-applying setStates run outside the effect's
    // synchronous commit path (react-hooks/set-state-in-effect). The once-only guard
    // above is set synchronously so a re-render during the defer window cannot double-run.
    const tid = setTimeout(() => {
      const preferredAudioRel = selectPreferredAudioRel(
        audioStreams,
        prefs.audioLang,
        serverDefaultAudioRel,
      )
      if (preferredAudioRel !== serverDefaultAudioRel) {
        handleAudioChange(preferredAudioRel)
      }

      // Build a combined SubTrackInfo list so language matching considers both embedded
      // and downloaded tracks. Downloaded tracks are appended after embedded ones so the
      // returned index matches the unified subtitleTracks array.
      const allSubTrackInfo = [
        ...subtitleStreams.map(s => ({ language: s.language, title: s.title, forced: s.forced, extractable: s.extractable })),
        ...(downloadedSubtitles ?? []).map(s => ({ language: s.language, title: s.label, forced: s.forced, extractable: true })),
      ]
      setActiveSubIndex(selectPreferredSubtitleIndex(allSubTrackInfo, prefs.subtitleLang))
    }, 0)
    return () => clearTimeout(tid)
  }, [
    prefsReady,
    prefs,
    audioStreams,
    subtitleStreams,
    serverDefaultAudioRel,
    handleAudioChange,
    downloadedSubtitles,
  ])

  // ---------------------------------------------------------------------------
  // Controls visibility
  // ---------------------------------------------------------------------------

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current)
    controlsHideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
  }, [])

  // ---------------------------------------------------------------------------
  // Load video
  // ---------------------------------------------------------------------------

  // activeStreamUrl and retryCount are the two triggers. retryCount bumps force a full
  // HLS reinitialisation when the quality changes without the URL changing (e.g. same HLS
  // manifest with different level). The `destroyed` flag guards against setState after
  // the async dynamic import resolves post-unmount.
  useEffect(() => {
    let destroyed = false

    async function initVideo() {
      setIsLoading(true)
      setError(null)
      // A fresh source load can legitimately reach 'ended' again (A4-M8 idempotency guard).
      didEndRef.current = false

      const video = videoRef.current
      if (!video) {
        setError('Video element unavailable.')
        setIsLoading(false)
        return
      }

      const resumeSeconds = resumePositionTicks / 10_000_000

      if (activeIsHls) {
        const HlsModule = await import('hls.js').catch(() => null)
        if (destroyed) return

        if (HlsModule && HlsModule.default.isSupported()) {
          const Hls = HlsModule.default
          const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              manifestLoadingMaxRetry: 2,
              manifestLoadingRetryDelay: 1000,
              levelLoadingMaxRetry: 3,
              fragLoadingMaxRetry: 3,
              startLevel: -1,
            })
          hlsRef.current = hls
          hls.loadSource(activeStreamUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            setIsLoading(false)
            // Apply resume seek before play so HLS starts at the right position
            // instead of jumping 0→resumePoint after loadedmetadata (A4-M1).
            // 'ask' and 'restart' cases are still handled by handleLoadedMetadata.
            const resumeSeconds = resumePositionTicks / 10_000_000
            if (resumeSeconds > 30 && !resumeApplied.current && prefsRef.current.resumeMode === 'resume') {
              resumeApplied.current = true
              video.currentTime = resumeSeconds
            }
            video.play().catch(() => setIsPlaying(false))
          })
          hls.on(Hls.Events.ERROR, (_event: unknown, data: {
            fatal?: boolean
            details?: string
            type?: string
            response?: { code?: number }
            url?: string
          }) => {
            if (!data.fatal || destroyed) return
            console.error('[HLS]', data.type, data.details, data.url, data.response)
            setIsLoading(false)
            if (data.details === 'manifestLoadError') {
              const code = data.response?.code
              if (code === 401 || code === 403) {
                setError('Authentication required. Please refresh the page and try again.')
              } else if (code === 404) {
                setError('Stream not found. The media server may still be preparing this file.')
              } else {
                setError('Failed to load stream. The media server may be transcoding — try again in a moment.')
              }
            } else if (data.type === 'networkError') {
              if (data.details === 'fragLoadError') {
                // 503 from the segment endpoint means the linear transcode has not
                // reached this requested segment yet (v1 seek limitation). Rather than
                // wedging on a terminal error overlay that asks the user to seek back
                // themselves (A4-H4), snap back to the last buffered (transcoded)
                // position, restart the loader, and resume.
                const code = data.response?.code
                if (code === 503) {
                  const v = videoRef.current
                  const buf = v?.buffered
                  const safe = buf && buf.length > 0 ? Math.max(0, buf.end(buf.length - 1) - 1) : 0
                  if (v) v.currentTime = safe
                  hls.startLoad()
                  v?.play().catch(() => {})
                  setIsLoading(false)
                  return
                }
                setError(`Network error loading segment: ${data.details}`)
              } else {
                setError(`Network error: ${data.details ?? 'connection failed'}`)
              }
            } else if (data.type === 'mediaError') {
              // Non-fatal media errors can be recovered
              hls.recoverMediaError()
              return
            } else {
              setError(`Playback error: ${data.details ?? 'unknown error'}`)
            }
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = activeStreamUrl
          setIsLoading(false)
          video.play().catch(() => setIsPlaying(false))
        } else {
          setIsLoading(false)
          setError('HLS playback not supported in this browser.')
        }
      } else {
        video.src = activeStreamUrl
        setIsLoading(false)
        video.play().catch(() => setIsPlaying(false))
      }
    }

    initVideo()

    return () => {
      destroyed = true
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current)
      if (countdownTimer.current) clearInterval(countdownTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStreamUrl, retryCount])

  // ---------------------------------------------------------------------------
  // Before unload — report stop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => reportStop()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [reportStop])

  // Final progress write on React unmount (A4-H1). `beforeunload` only covers a full
  // page unload/refresh — it does NOT fire on Next.js client navigation (autoplay
  // router.push, back gestures, deep links), so without this the last position is lost
  // up to 10s stale. reportStop clears the interval and is guarded against a no-start
  // player by didReportStart, so it is safe to call once here. Keep the latest closure
  // in a ref so the empty-dep effect fires only on true unmount.
  const reportStopRef = useRef(reportStop)
  useEffect(() => { reportStopRef.current = reportStop })
  useEffect(() => {
    return () => {
      endedAbortRef.current?.abort()
      if (didReportStart.current) reportStopRef.current()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Fullscreen sync
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => setIsFullscreen(
      !!(
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
      )
    )
    document.addEventListener('fullscreenchange', handler)
    document.addEventListener('webkitfullscreenchange', handler)
    return () => {
      document.removeEventListener('fullscreenchange', handler)
      document.removeEventListener('webkitfullscreenchange', handler)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const video = videoRef.current
      // Party-aware helpers. In party mode play/pause/seek become intents and the
      // video moves only when the server STATE arrives.
      const pty = partyKbdRef.current
      const partyTogglePlay = () => {
        if (!video) return
        if (pty.active) {
          pty.sendIntent(video.paused ? 'play' : 'pause', Math.round(video.currentTime * 10_000_000))
        } else {
          video.paused ? video.play().catch(() => {}) : video.pause()
        }
      }
      const partySeekTo = (newTime: number) => {
        if (!video) return
        const clamped = Math.max(0, Math.min(video.duration || 0, newTime))
        if (pty.active) {
          pty.sendIntent('seek', Math.round(clamped * 10_000_000))
        } else {
          video.currentTime = clamped
        }
      }
      // These bindings are documented in the PLAYER_SHORTCUTS registry (src/lib/shortcuts.ts),
      // which generates the /settings/shortcuts reference. The `shortcut:` id on each group ties
      // a case back to its registry entry so the docs and this hot path stay in sync.
      switch (e.key) {
        case ' ': // shortcut: playPause
          e.preventDefault()
          partyTogglePlay()
          break
        case 'f': // shortcut: fullscreen
        case 'F':
          e.preventDefault()
          kbdActionsRef.current.toggleFullscreen()
          break
        case 'm': // shortcut: mute
        case 'M':
          e.preventDefault()
          kbdActionsRef.current.toggleMute()
          break
        case 'k': // shortcut: playPause
        case 'K':
          e.preventDefault()
          partyTogglePlay()
          break
        case 'j': // shortcut: seek10
        case 'J':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime - 10)
          break
        case 'l': // shortcut: seek10
        case 'L':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime + 10)
          break
        case 'ArrowLeft': // shortcut: seek10 / seek30 (shift)
          e.preventDefault()
          if (video) partySeekTo(video.currentTime - (e.shiftKey ? 30 : 10))
          break
        case 'ArrowRight': // shortcut: seek10 / seek30 (shift)
          e.preventDefault()
          if (video) partySeekTo(video.currentTime + (e.shiftKey ? 30 : 10))
          break
        case 'ArrowUp': // shortcut: volume
          e.preventDefault()
          if (video) {
            const newVol = Math.min(1, video.volume + 0.1)
            video.volume = newVol
            video.muted = false
            setVolume(newVol)
            setIsMuted(false)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (video) {
            const newVol = Math.max(0, video.volume - 0.1)
            video.volume = newVol
            setVolume(newVol)
            if (newVol === 0) setIsMuted(true)
          }
          break
        case ',': // shortcut: frameStep
          e.preventDefault()
          if (video && pty.active) {
            partySeekTo(video.currentTime - 1 / 24)
          } else if (video && video.paused) {
            video.currentTime = Math.max(0, video.currentTime - 1 / 24)
          }
          break
        case '.': // shortcut: frameStep
          e.preventDefault()
          if (video && pty.active) {
            partySeekTo(video.currentTime + 1 / 24)
          } else if (video) {
            video.pause()
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 1 / 24)
          }
          break
        case '0': case '1': case '2': case '3': case '4': // shortcut: seekPercent
        case '5': case '6': case '7': case '8': case '9':
          e.preventDefault()
          if (video && video.duration) {
            partySeekTo((parseInt(e.key) / 10) * video.duration)
          }
          break
        case 'i': // shortcut: statsOverlay
        case 'I':
          e.preventDefault()
          setShowStats((s) => !s)
          break
        case 's': // shortcut: cycleSubtitles
        case 'S':
          // Cycle through all subtitle tracks (embedded + downloaded): off → 0 → … → off
          e.preventDefault()
          {
            const subCount = kbdActionsRef.current.totalSubCount
            if (subCount > 0) {
              setActiveSubIndex((cur) => cur >= subCount - 1 ? -1 : cur + 1)
            }
          }
          break
        case 'n': // shortcut: nextEpisode
        case 'N':
          e.preventDefault()
          if (nextEpisodeRef.current) {
            if (countdownTimer.current) clearInterval(countdownTimer.current)
            router.push(`/watch/${nextEpisodeRef.current.id}`)
          }
          break
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Video event handlers
  // ---------------------------------------------------------------------------

  // Apply the resume position once, after the browser knows the file is seekable.
  // Setting currentTime before loadedmetadata fires causes stalls on MKV and other
  // container formats that require the browser to fetch the seek index first.
  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    // Capture the decoded resolution for the stats overlay (updates on quality/audio switches).
    setVideoResolution({ w: video.videoWidth, h: video.videoHeight })
    // A pending seek (from an audio-track switch) takes precedence and resumes at the exact
    // position captured before the switch — the same currentTime path as everything else.
    if (pendingSeekRef.current != null) {
      video.currentTime = pendingSeekRef.current
      pendingSeekRef.current = null
      // The position is now set by the switch; mark resume applied so a later natural
      // load can't re-seek to the stale resume point and jump the user backward (A4-M7).
      resumeApplied.current = true
      return
    }
    const resumeSeconds = resumePositionTicks / 10_000_000
    if (resumeSeconds > 30 && !resumeApplied.current) {
      if (prefs.resumeMode === 'restart') {
        // Always start from beginning — ignore the saved position.
        resumeApplied.current = true
      } else if (prefs.resumeMode === 'ask') {
        // Show the resume dialog; actual seek is deferred until the user chooses.
        setPendingResumeSeconds(resumeSeconds)
        setShowResumeDialog(true)
      } else {
        // 'resume' (default): seek to the saved position automatically.
        resumeApplied.current = true
        video.currentTime = resumeSeconds
      }
    }
  }

  // Surface video element errors as player error state instead of leaving an infinite spinner.
  // The <video> element fires 'error' without bubbling through React events, so without this
  // handler handleWaiting sets isLoading=true and nothing ever clears it.
  const handleVideoError = () => {
    setIsLoading(false)
    const code = videoRef.current?.error?.code
    if (code === 4) {
      setError('This format cannot be played directly. Try selecting a lower quality.')
    } else if (code === 3) {
      setError('Video decoding failed. The file may use an unsupported codec.')
    } else if (code === 2) {
      setError('Network error loading video. Check your connection and try again.')
    } else {
      setError('Failed to load video. The file may be missing or inaccessible on the server.')
    }
  }

  const handlePlay = () => {
    setIsPlaying(true)
    if (!didReportStart.current) {
      didReportStart.current = true
      reportStart()
    }
    // (Re)start the progress interval on play; each tick skips while paused/unchanged (A4-H5).
    if (!progressInterval.current) {
      progressInterval.current = setInterval(() => {
        const vid = videoRef.current
        if (!vid || vid.paused) return
        // In party mode, the local element can still be playing during the
        // `effectiveAt` window of a remote-applied pause; skip the write so a
        // slightly-ahead position isn't checkpointed for continue-watching (A5-04).
        // partyKbdRef.current.active is live; applyingRemoteStateRef is a stable ref.
        if (partyKbdRef.current.active && party.applyingRemoteStateRef.current) return
        reportProgress(false)
      }, 10_000)
    }
  }

  const handlePause = () => {
    setIsPlaying(false)
    // Stop the periodic writes while paused; capture the paused position once (A4-H5).
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
      progressInterval.current = null
    }
    reportProgress(true)
  }

  const handleTimeUpdate = () => {
    // While scrubbing, the seek input owns currentTime; ignore the still-playing video's
    // timeupdate so the thumb doesn't snap back to the playhead mid-drag (A4-M3).
    if (isScrubbingRef.current) return
    const video = videoRef.current
    if (video) setCurrentTime(video.currentTime)
  }

  const handleDurationChange = () => {
    const video = videoRef.current
    if (video) setDuration(video.duration || 0)
  }

  const handleWaiting = () => setIsLoading(true)
  const handleCanPlay = () => setIsLoading(false)

  const handleEnded = useCallback(() => {
    // Some browsers fire 'ended' more than once (ended → seek-to-near-end → ended);
    // make this idempotent so the next-episode fetch / countdown isn't double-triggered (A4-M8).
    if (didEndRef.current) return
    didEndRef.current = true
    reportStop()
    if (!prefs.autoPlayNext) return
    if (seriesId && nextEpisodeApiBase) {
      const ctrl = new AbortController()
      endedAbortRef.current = ctrl
      fetch(`${nextEpisodeApiBase}/${seriesId}/next-episode`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((ep: NextEpisode | null) => {
          if (!ep) return
          setNextEpisode(ep)
          const delay = prefs.autoPlayDelay
          if (delay === 0) {
            // Navigate immediately — no countdown needed.
            router.push(`/watch/${ep.id}`)
          } else {
            setCountdown(delay)
            setCountdownActive(true)
          }
        })
        .catch(() => {}) // includes AbortError on unmount
    } else if (seriesId && !nextEpisodeApiBase) {
      console.warn('[VideoPlayer] nextEpisodeApiBase not set, next episode autoplay disabled')
    }
  }, [seriesId, nextEpisodeApiBase, reportStop, prefs.autoPlayNext, prefs.autoPlayDelay, router])

  // ---------------------------------------------------------------------------
  // Countdown timer for auto-play
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!countdownActive) return
    countdownTimer.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current)
    }
  }, [countdownActive])

  useEffect(() => {
    // Require countdownActive too (A4-M8): cancelAutoplay clears it, so a countdown
    // that already reached 0 can't navigate after the user backed out.
    if (countdown === 0 && nextEpisode && countdownActive) {
      router.push(`/watch/${nextEpisode.id}`)
    }
  }, [countdown, nextEpisode, countdownActive, router])

  // ---------------------------------------------------------------------------
  // Control actions
  // ---------------------------------------------------------------------------

  // USER-ACTION SURFACES. In party mode these become intents (the video moves only
  // when the resulting authoritative STATE arrives, applied under the hook's
  // applyingRemoteState path). Out of party mode they mutate the video directly,
  // exactly as before.
  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (partyActive) {
      party.sendIntent(video.paused ? 'play' : 'pause', Math.round(video.currentTime * 10_000_000))
      return
    }
    video.paused ? video.play().catch(() => {}) : video.pause()
  }

  const seek = (delta: number) => {
    const video = videoRef.current
    if (!video) return
    const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta))
    if (partyActive) {
      party.sendIntent('seek', Math.round(newTime * 10_000_000))
      return
    }
    video.currentTime = newTime
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const newTime = Number(e.target.value)
    if (partyActive) {
      // Optimistically update the scrubber UI only — do NOT move the video. The
      // server STATE drives the actual seek.
      setCurrentTime(newTime)
      party.sendIntent('seek', Math.round(newTime * 10_000_000))
      return
    }
    video.currentTime = newTime
    setCurrentTime(newTime)
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    if (isMuted) {
      video.muted = false
      video.volume = volume || 1
      setIsMuted(false)
    } else {
      video.muted = true
      setIsMuted(true)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const vol = Number(e.target.value)
    video.volume = vol
    video.muted = vol === 0
    setVolume(vol)
    setIsMuted(vol === 0)
  }

  const toggleFullscreen = async () => {
    const container = containerRef.current
    const video = videoRef.current
    if (!container) return

    // Check fullscreen using both the standard API and the webkit-prefixed variant (iOS Safari).
    const isFs = !!(
      document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
    )

    if (!isFs) {
      // Enter fullscreen. On Android Chrome requestFullscreen on the container works.
      // On iOS Safari requestFullscreen on a div is not supported; fall back to
      // webkitEnterFullscreen on the <video> element.
      try {
        await container.requestFullscreen()
      } catch {
        if (video && typeof (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === 'function') {
          ;(video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen()
        }
      }
      // Android Chrome: screen.orientation.lock only works while the element is already
      // in fullscreen. Awaiting requestFullscreen above guarantees that precondition.
      // Wrap in try/catch — iOS Safari and desktop throw NotSupportedError here, which
      // must not interrupt playback.
      try {
        await screen.orientation.lock('landscape')
      } catch {
        // Not supported on this device/browser — orientation follows the device naturally.
      }
    } else {
      // Unlock orientation before exiting so the device can return to natural orientation.
      try { screen.orientation.unlock() } catch { /* not supported */ }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      } else {
        const doc = document as Document & { webkitExitFullscreen?: () => void }
        doc.webkitExitFullscreen?.()
      }
    }
  }

  const handleBack = () => {
    reportStop()
    try { screen.orientation.unlock() } catch { /* not supported */ }
    router.back()
  }

  const playNext = () => {
    if (!nextEpisode) return
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    router.push(`/watch/${nextEpisode.id}`)
  }

  const cancelAutoplay = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    setCountdownActive(false)
    setNextEpisode(null)
  }

  // ---------------------------------------------------------------------------
  // Subtitle tracks — inject <track> elements
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (subtitleStreams.length > 0 && !subtitleApiBase) {
      console.warn('[VideoPlayer] subtitleApiBase not set, subtitle tracks will not load')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Embedded subtitle streams are extracted to WebVTT by the /embedded/ endpoint (a plain
  // <video> won't render embedded MKV subs on Direct Play). One <track> per stream keeps the
  // list index aligned with activeSubIndex and the video's textTracks. Image-based tracks
  // (extractable=false) still get an element for index alignment but are disabled in the menu.
  // Downloaded subtitles (from subtitle_wants) are appended after embedded tracks; each is
  // served as proper WebVTT via /api/media/subtitles/{id}/{positionalIndex}.
  const embeddedTracks = subtitleApiBase
    ? subtitleStreams.map((s) => ({
        src: `${subtitleApiBase}/embedded/${itemId}/${s.index}`,
        label: s.title || s.language || 'Track',
        srcLang: s.language,
        extractable: s.extractable,
        isDownloaded: false,
      }))
    : []
  const downloadedTracks = subtitleApiBase && downloadedSubtitles
    ? downloadedSubtitles.map((s) => ({
        src: `${subtitleApiBase}/${itemId}/${s.index}`,
        label: s.label,
        srcLang: s.language,
        extractable: true,
        isDownloaded: true,
      }))
    : []
  // Tracks grabbed live this session (via SubtitleSearchPanel). Served by stable
  // subtitle_wants id rather than positional index, so adding one never shifts the
  // URL of another. Treated as downloaded tracks in the menu.
  const extraTrackList = subtitleApiBase
    ? extraTracks.map((t) => ({
        src: `${subtitleApiBase}/want/${t.wantId}`,
        label: t.label,
        srcLang: t.srcLang,
        extractable: true,
        isDownloaded: true,
      }))
    : []
  // Combined list — order must match the rendered <track> elements
  // (embedded first, then downloaded, then session grabs).
  const subtitleTracks = [...embeddedTracks, ...downloadedTracks, ...extraTrackList]
  const totalSubCount = subtitleTracks.length

  // Keep the keydown handler's live ref current (declared up near partyKbdRef). These
  // values change per render but the mount-once listener reads the latest via the ref.
  useEffect(() => {
    kbdActionsRef.current = { toggleFullscreen, toggleMute, totalSubCount }
  })

  // Append a freshly grabbed subtitle as a live <track> and select it. extraTracks is
  // read from the current render closure (the handler is recreated each render), and
  // de-dupes by wantId so re-adding the same pick just re-selects it.
  const handleSubtitleAdded = (track: { wantId: number; label: string; language: string }) => {
    const existingExtra = extraTracks.findIndex((t) => t.wantId === track.wantId)
    if (existingExtra >= 0) {
      setActiveSubIndex(embeddedTracks.length + downloadedTracks.length + existingExtra)
    } else {
      const newIndex = embeddedTracks.length + downloadedTracks.length + extraTracks.length
      setExtraTracks((prev) =>
        prev.some((t) => t.wantId === track.wantId)
          ? prev
          : [...prev, { wantId: track.wantId, label: track.label, srcLang: track.language }]
      )
      setActiveSubIndex(newIndex)
    }
    setShowSubSearch(false)
    setShowSubMenu(false)
  }

  // ---------------------------------------------------------------------------
  // Derived subtitle cue styles from user prefs
  // ---------------------------------------------------------------------------

  const cueFontSize = prefs.subtitleSize === 'small' ? '0.85em' : prefs.subtitleSize === 'large' ? '1.35em' : '1.05em'
  const cueBg = prefs.subtitleBg === 'none' ? 'rgba(0,0,0,0)' : prefs.subtitleBg === 'opaque' ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)'
  const cueColor = prefs.subtitleColor === 'yellow' ? '#ffe566' : '#ffffff'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black"
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      {/* Top bar */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-20 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white hover:text-zinc-300 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm font-medium truncate max-w-xs sm:max-w-lg">{displayTitle}</span>
          </button>

          {/* Start a watch party (only when not already in one and we know the viewer). */}
          {!partyActive && selfUserId && (
            <StartPartyButton itemId={itemId} selfUserId={selfUserId} onStarted={handlePartyStarted} />
          )}

          {/* Collapse/expand the party side area. */}
          {partyActive && (
            <button
              type="button"
              onClick={() => setPartyPanelOpen((v) => !v)}
              className="rounded-md bg-zinc-800/80 px-3 py-1.5 text-sm text-white transition-colors hover:bg-zinc-700"
            >
              {partyPanelOpen ? 'Hide party' : 'Show party'}
            </button>
          )}
        </div>
      </div>

      {/* Video element */}
      <video
        ref={videoRef}
        className={aspectRatioMode === 'auto' ? 'w-full h-full object-contain' : 'object-cover'}
        style={
          aspectRatioMode === 'auto'
            ? {
                filter: videoFilter || undefined,
                transform: videoTransform || undefined,
                objectPosition: videoAlignment,
              }
            : {
                filter: videoFilter || undefined,
                transform: videoTransform || undefined,
                objectPosition: videoAlignment,
                aspectRatio: aspectRatioMode.replace(':', '/'),
                objectFit: 'cover' as const,
                width: '100%',
                height: '100%',
              }
        }
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleVideoError}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlay={handlePlay}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
        onClick={togglePlay}
      >
        {subtitleTracks.map((track) => (
          // No `default` attr — visibility is driven entirely by activeSubIndex via the
          // textTracks mode effect, so a file with multiple default-flagged tracks doesn't
          // auto-show the wrong one.
          <track
            key={track.src}
            kind="subtitles"
            src={track.src}
            label={track.label}
            srcLang={track.srcLang}
          />
        ))}
      </video>

      {/* Subtitle cue appearance — injected inline so it reacts to pref changes without a full CSS cascade */}
      <style>{`::cue { font-size: ${cueFontSize}; color: ${cueColor}; background-color: ${cueBg}; }`}</style>

      {/* Resume-mode dialog ("Always ask") */}
      {showResumeDialog && pendingResumeSeconds != null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="rounded-xl bg-zinc-900 border border-zinc-700 p-6 flex flex-col gap-4 max-w-xs w-full mx-4 text-white">
            <p className="text-base font-semibold">Resume playback?</p>
            <p className="text-sm text-zinc-400">
              You were at {new Date(pendingResumeSeconds * 1000).toISOString().slice(11, 19).replace(/^00:/, '')}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                onClick={() => {
                  const video = videoRef.current
                  const t = pendingResumeSeconds
                  if (video && t != null) {
                    resumeApplied.current = true
                    video.currentTime = t
                  }
                  setPendingResumeSeconds(null)
                  setShowResumeDialog(false)
                }}
              >
                Resume
              </button>
              <button
                className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm font-medium hover:bg-zinc-800 transition-colors"
                onClick={() => {
                  resumeApplied.current = true
                  setPendingResumeSeconds(null)
                  setShowResumeDialog(false)
                }}
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="h-12 w-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {/* Party reaction overlay */}
      {partyActive && (
        <ReactionOverlayMemo reactions={party.reactions} onExpire={party.expireReaction} />
      )}

      {/* Party readiness-gate "waiting for others to buffer" overlay */}
      {partyActive && party.waitingFor.length > 0 && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-center text-sm text-amber-200">
          Waiting for {party.waitingFor.map((w) => w.displayName).join(', ')} to buffer…
        </div>
      )}

      {/* Stats overlay */}
      {showStats && !isLoading && (
        <div className="absolute top-16 left-4 z-30 bg-black/80 text-white text-xs font-mono p-3 rounded-lg pointer-events-none space-y-1">
          <div>Resolution: {videoResolution.w}×{videoResolution.h}</div>
          <div>Quality: {currentQuality?.label ?? 'Unknown'}</div>
          <div>Duration: {formatPlayerTime(duration)}</div>
          <div className="text-zinc-400 text-[10px] mt-1">Press I to toggle</div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-4 pb-4 pt-12 bg-gradient-to-t from-black/80 to-transparent z-20 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Seek bar */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.5}
          value={currentTime}
          onChange={handleSeek}
          onPointerDown={() => { isScrubbingRef.current = true }}
          onPointerUp={() => { isScrubbingRef.current = false }}
          onPointerCancel={() => { isScrubbingRef.current = false }}
          className="w-full mb-3 h-1.5 accent-white cursor-pointer"
          aria-label="Seek"
        />

        {/* Controls row */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => seek(-10)}
            className="text-white p-1 hover:text-zinc-300 transition-colors"
            aria-label="Rewind 10 seconds"
          >
            <SkipBack className="h-5 w-5" />
          </button>

          <button
            onClick={(e) => { e.currentTarget.blur(); togglePlay() }}
            className="text-white p-1 hover:text-zinc-300 transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </button>

          <button
            onClick={() => seek(10)}
            className="text-white p-1 hover:text-zinc-300 transition-colors"
            aria-label="Skip 10 seconds"
          >
            <SkipForward className="h-5 w-5" />
          </button>

          {/* Volume */}
          <button
            onClick={toggleMute}
            className="text-white p-1 hover:text-zinc-300 transition-colors"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 accent-white cursor-pointer hidden sm:block"
            aria-label="Volume"
          />

          {/* Time display */}
          <span className="text-white text-sm tabular-nums ml-1 select-none">
            {formatPlayerTime(currentTime)} / {formatPlayerTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Party reaction bar */}
          {partyActive && (
            <div className="hidden sm:block">
              <ReactionBarMemo onReact={party.sendReaction} />
            </div>
          )}

          {/* Subtitle track picker — also shown with zero tracks so the viewer can
              search online for one (when the native subtitle proxy is available). */}
          {(totalSubCount > 0 || subtitleApiBase) && (
            <div className="relative">
              <button
                onClick={() => setShowSubMenu((v) => !v)}
                className={`p-1 transition-colors ${activeSubIndex >= 0 ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                aria-label="Subtitles"
              >
                <Captions className="h-5 w-5" />
              </button>
              {showSubMenu && (
                <div className="absolute bottom-9 right-0 bg-zinc-900 border border-zinc-700 rounded-lg py-1 min-w-[10rem] z-40 shadow-xl">
                  <button
                    onClick={() => { setActiveSubIndex(-1); setShowSubMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-zinc-800 transition-colors"
                  >
                    {activeSubIndex === -1 && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
                    <span className={`${activeSubIndex === -1 ? 'text-white font-medium' : 'text-zinc-300'} ${activeSubIndex !== -1 ? 'ml-5' : ''}`}>Off</span>
                  </button>
                  {/* Embedded tracks */}
                  {embeddedTracks.length > 0 && (downloadedTracks.length + extraTrackList.length) > 0 && (
                    <p className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Embedded</p>
                  )}
                  {embeddedTracks.map((track, i) => (
                    <button
                      key={track.src}
                      disabled={!track.extractable}
                      onClick={() => { setActiveSubIndex(i); setShowSubMenu(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${track.extractable ? 'hover:bg-zinc-800' : 'opacity-40 cursor-not-allowed'}`}
                    >
                      {activeSubIndex === i && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
                      <span className={`${activeSubIndex === i ? 'text-white font-medium' : 'text-zinc-300'} ${activeSubIndex !== i ? 'ml-5' : ''}`}>
                        {track.label || track.srcLang || `Track ${i + 1}`}
                        {!track.extractable && ' (image)'}
                      </span>
                    </button>
                  ))}
                  {/* Downloaded tracks (subtitle_wants + session grabs) */}
                  {(downloadedTracks.length + extraTrackList.length) > 0 && (
                    <p className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Downloaded</p>
                  )}
                  {[...downloadedTracks, ...extraTrackList].map((track, di) => {
                    const i = embeddedTracks.length + di
                    return (
                      <button
                        key={track.src}
                        onClick={() => { setActiveSubIndex(i); setShowSubMenu(false) }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-zinc-800 transition-colors"
                      >
                        {activeSubIndex === i && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
                        <span className={`${activeSubIndex === i ? 'text-white font-medium' : 'text-zinc-300'} ${activeSubIndex !== i ? 'ml-5' : ''}`}>
                          {track.label}
                        </span>
                      </button>
                    )
                  })}
                  {/* Search online (OpenSubtitles) */}
                  {subtitleApiBase && (
                    <>
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        onClick={() => { setShowSubSearch(true); setShowSubMenu(false) }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-zinc-300 hover:bg-zinc-800 transition-colors"
                      >
                        <Search className="h-3.5 w-3.5 shrink-0" />
                        Search online…
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Audio track picker — only when there is more than one track to choose from */}
          {audioStreams.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowAudioMenu((v) => !v)}
                className="p-1 text-zinc-400 hover:text-white transition-colors"
                aria-label="Audio track"
              >
                <Languages className="h-5 w-5" />
              </button>
              {showAudioMenu && (
                <div className="absolute bottom-9 right-0 bg-zinc-900 border border-zinc-700 rounded-lg py-1 min-w-[12rem] z-40 shadow-xl">
                  {audioStreams.map((a) => (
                    <button
                      key={a.relIndex}
                      onClick={() => handleAudioChange(a.relIndex)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-zinc-800 transition-colors"
                    >
                      {activeAudioRel === a.relIndex && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
                      <span className={`${activeAudioRel === a.relIndex ? 'text-white font-medium' : 'text-zinc-300'} ${activeAudioRel !== a.relIndex ? 'ml-5' : ''}`}>
                        {a.title || a.language || `Track ${a.relIndex + 1}`}
                        {a.channels >= 6 ? ' · 5.1' : a.channels === 2 ? ' · 2.0' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quality selector */}
          {props.availableQualities && props.availableQualities.length > 1 && (
            <MediaQualitySelector
              qualities={props.availableQualities}
              currentQuality={currentQuality}
              onQualityChange={handleQualityChange}
            />
          )}

          {/* Tools toggle */}
          <button
            onClick={() => setShowToolsPanel((v) => !v)}
            className={`p-1 transition-colors ${showToolsPanel ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
            aria-label="Player tools"
          >
            <Sliders className="h-5 w-5" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="text-white p-1 hover:text-zinc-300 transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Auto-play next episode overlay */}
      {nextEpisode && countdownActive && (
        <div className="absolute bottom-24 right-6 z-30 bg-black/80 rounded-lg p-4 w-72">
          <p className="text-xs text-zinc-400 mb-1">Up Next</p>
          <p className="text-sm font-medium text-white mb-3 line-clamp-2">
            {nextEpisode.seasonEpisode
              ? `${nextEpisode.seasonEpisode} · ${nextEpisode.title}`
              : nextEpisode.title}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={playNext}
              className="flex-1 bg-white text-black text-sm font-medium rounded py-1.5 hover:bg-zinc-200 transition-colors"
            >
              Play Now
            </button>
            <button
              onClick={cancelAutoplay}
              className="px-3 text-sm text-zinc-300 hover:text-white transition-colors"
              aria-label="Cancel autoplay"
            >
              {countdown}s
            </button>
          </div>
        </div>
      )}

      {/* Party side area: PartyPanel + ChatPanel as siblings. */}
      {partyActive && partyPanelOpen && (
        <div className="absolute right-0 top-0 z-30 flex h-full w-80 max-w-[85vw] flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <PartyPanelMemo
            joinCode={partyJoinCode}
            joinUrl={partyJoinUrl}
            mediaId={partyMediaId}
            members={party.members}
            selfUserId={selfUserId}
            hostUserId={partyHostUserId}
            lastActor={party.lastActor}
            waitingFor={party.waitingFor}
            connectionState={party.connectionState}
            onLeave={handlePartyLeave}
            onEnd={handlePartyEnd}
            queue={party.queue}
            onAddToQueue={party.addToQueue}
            onRemoveFromQueue={party.removeFromQueue}
            onReorderQueue={party.reorderQueue}
            onPlayNext={party.playNext}
            controlLocked={party.controlLocked}
            onKick={party.kickMember}
            onControlLockToggle={party.toggleControlLock}
          />
          <ChatPanelMemo
            messages={party.chatMessages}
            selfUserId={selfUserId}
            onSend={party.sendChat}
            error={party.lastError}
          />
        </div>
      )}

      {/* On-demand subtitle search */}
      {showSubSearch && subtitleApiBase && (
        <SubtitleSearchPanel
          itemId={itemId}
          subtitleApiBase={subtitleApiBase}
          defaultLanguage={prefs.subtitleLang || 'en'}
          onClose={() => setShowSubSearch(false)}
          onAdded={handleSubtitleAdded}
        />
      )}

      {/* Tools panel */}
      {showToolsPanel && (
        <MediaToolsPanel
          videoRef={videoRef}
          duration={duration}
          itemId={itemId}
          itemTitle={itemTitle}
          chapters={props.chapters ?? []}
          initAudioChain={initChain}
          currentAspectRatio={aspectRatioMode}
          onAspectRatioChange={setAspectRatioMode}
          onVideoFilterChange={setVideoFilter}
          onVideoTransformChange={setVideoTransform}
          onVideoAlignmentChange={setVideoAlignment}
          onClose={() => setShowToolsPanel(false)}
        />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/90 p-6">
          <div className="w-full max-w-md bg-zinc-900 rounded-xl border border-zinc-700 p-6 text-center">
            <div className="mb-4 flex justify-center">
              <svg className="h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Unable to play this title</h3>
            <p className="text-sm text-zinc-400 mb-6">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => { setError(null); setRetryCount(c => c + 1) }}
                className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleBack}
                className="px-4 py-2 rounded-lg bg-zinc-700 text-white text-sm font-medium hover:bg-zinc-600 transition-colors"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
