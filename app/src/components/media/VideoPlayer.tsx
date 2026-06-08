'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
} from 'lucide-react'
import type { PlaybackData } from '@/lib/media-server/types'
import { useAudioChain } from '@/components/player/useAudioChain'
import { MediaToolsPanel } from '@/components/player/MediaToolsPanel'
import { MediaQualitySelector } from '@/components/player/MediaQualitySelector'
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

  // Player state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  // Next-episode autoplay state
  const [nextEpisode, setNextEpisode] = useState<NextEpisode | null>(null)
  const [countdownActive, setCountdownActive] = useState(false)
  const [countdown, setCountdown] = useState(10)

  // Tools panel state
  const [showToolsPanel, setShowToolsPanel] = useState(false)
  const [videoFilter, setVideoFilter] = useState('')
  const [videoTransform, setVideoTransform] = useState('')
  const [videoAlignment, setVideoAlignment] = useState('center center')
  const [aspectRatioMode, setAspectRatioMode] = useState<AspectRatioMode>('auto')
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

  // Audio track state. The active audio-relative index; the server default is whichever
  // audio stream matches defaultAudioIndex (an absolute ffprobe index).
  const serverDefaultAudioRel =
    audioStreams.find((a) => a.index === defaultAudioIndex)?.relIndex ?? 0
  const [activeAudioRel, setActiveAudioRel] = useState<number>(serverDefaultAudioRel)
  const [showAudioMenu, setShowAudioMenu] = useState(false)

  // User language preferences (localStorage). Read once on mount to set English defaults.
  const { prefs, ready: prefsReady } = usePlaybackPrefs()

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

  const party = usePartySync(partyId, {
    videoRef,
    selfUserId,
    enabled: !!partyId,
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
        setPartyId(joined.partyId)
        setPartyJoinCode(joined.joinCode)
        setPartyMediaId(joined.mediaId)
        // Resolve host + member list for the panel.
        const info = await getPartyInfo(joined.partyId)
        if (cancelled) return
        setPartyHostUserId(info.hostUserId)
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
  useEffect(() => {
    if (party.ended) teardownParty()
  }, [party.ended, teardownParty])

  // The keyboard effect is a single mount-once listener with stale closures over
  // party state, so route its play/seek intents through a live ref instead.
  const partyKbdRef = useRef<{
    active: boolean
    sendIntent: (action: 'play' | 'pause' | 'seek', positionTicks: number) => void
  }>({ active: false, sendIntent: () => {} })
  partyKbdRef.current = { active: partyActive, sendIntent: party.sendIntent }

  // ---------------------------------------------------------------------------
  // Aspect ratio auto-detection + screen-aware quality selection (mount once)
  // ---------------------------------------------------------------------------

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

  useEffect(() => {
    if (props.nativeWidth && props.nativeHeight) {
      setAspectRatioMode(detectAspectRatio(props.nativeWidth, props.nativeHeight))
    }

    if (props.availableQualities?.length && props.nativeHeight) {
      const screenH = (window.screen.height ?? 0) * (window.devicePixelRatio || 1)
      if (props.nativeHeight > 0 && screenH > 0 && screenH < props.nativeHeight * 0.75) {
        const best = props.availableQualities.find(
          (q) => !q.isDirect && q.maxHeight <= screenH
        )
        if (best) {
          setCurrentQuality(best)
          setActiveStreamUrl(best.streamUrl)
          setActiveIsHls(best.isHls)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the active subtitle track to the video element's textTracks
  useEffect(() => {
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === activeSubIndex ? 'showing' : 'hidden'
    }
  }, [activeSubIndex])

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
    fetch(progressApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: itemId, positionTicks: 0, played: false }),
    }).catch(() => {})
  }, [itemId, progressApiUrl])

  const reportProgress = useCallback(
    (isPaused: boolean) => {
      if (!progressApiUrl) return
      const positionTicks = Math.round((videoRef.current?.currentTime ?? 0) * 10_000_000)
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

    const preferredAudioRel = selectPreferredAudioRel(
      audioStreams,
      prefs.audioLang,
      serverDefaultAudioRel,
    )
    if (preferredAudioRel !== serverDefaultAudioRel) {
      handleAudioChange(preferredAudioRel)
    }

    setActiveSubIndex(selectPreferredSubtitleIndex(subtitleStreams, prefs.subtitleLang))
  }, [
    prefsReady,
    prefs,
    audioStreams,
    subtitleStreams,
    serverDefaultAudioRel,
    handleAudioChange,
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
                // reached this segment yet (v1 seek limitation). The user should seek
                // backwards to a position that has already been transcoded.
                const code = data.response?.code
                setError(
                  code === 503
                    ? 'Seek past the current transcode position. Seek backwards to a played section to resume.'
                    : `Network error loading segment: ${data.details}`,
                )
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
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

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
      switch (e.key) {
        case ' ':
          e.preventDefault()
          partyTogglePlay()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
        case 'M':
          e.preventDefault()
          toggleMute()
          break
        case 'k':
        case 'K':
          e.preventDefault()
          partyTogglePlay()
          break
        case 'j':
        case 'J':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime - 10)
          break
        case 'l':
        case 'L':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime + 10)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime - (e.shiftKey ? 30 : 10))
          break
        case 'ArrowRight':
          e.preventDefault()
          if (video) partySeekTo(video.currentTime + (e.shiftKey ? 30 : 10))
          break
        case 'ArrowUp':
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
        case ',':
          e.preventDefault()
          if (video && video.paused) video.currentTime = Math.max(0, video.currentTime - 1 / 24)
          break
        case '.':
          e.preventDefault()
          if (video) {
            video.pause()
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 1 / 24)
          }
          break
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
          e.preventDefault()
          if (video && video.duration) {
            partySeekTo((parseInt(e.key) / 10) * video.duration)
          }
          break
        case 'i':
        case 'I':
          e.preventDefault()
          setShowStats((s) => !s)
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
    // A pending seek (from an audio-track switch) takes precedence and resumes at the exact
    // position captured before the switch — the same currentTime path as everything else.
    if (pendingSeekRef.current != null) {
      video.currentTime = pendingSeekRef.current
      pendingSeekRef.current = null
      return
    }
    const resumeSeconds = resumePositionTicks / 10_000_000
    if (resumeSeconds > 30 && !resumeApplied.current) {
      resumeApplied.current = true
      video.currentTime = resumeSeconds
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
      progressInterval.current = setInterval(() => {
        const vid = videoRef.current
        if (vid) reportProgress(vid.paused)
      }, 10_000)
    }
  }

  const handlePause = () => setIsPlaying(false)

  const handleTimeUpdate = () => {
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
    reportStop()
    if (seriesId && nextEpisodeApiBase) {
      fetch(`${nextEpisodeApiBase}/${seriesId}/next-episode`)
        .then((r) => r.json())
        .then((ep: NextEpisode | null) => {
          if (!ep) return
          setNextEpisode(ep)
          setCountdown(10)
          setCountdownActive(true)
        })
        .catch(() => {})
    } else if (seriesId && !nextEpisodeApiBase) {
      console.warn('[VideoPlayer] nextEpisodeApiBase not set, next episode autoplay disabled')
    }
  }, [seriesId, nextEpisodeApiBase, reportStop])

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
    if (countdown === 0 && nextEpisode) {
      router.push(`/watch/${nextEpisode.id}`)
    }
  }, [countdown, nextEpisode, router])

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
  const subtitleTracks = subtitleApiBase
    ? subtitleStreams.map((s) => ({
        src: `${subtitleApiBase}/embedded/${itemId}/${s.index}`,
        label: s.title,
        srcLang: s.language,
        isDefault: s.isDefault,
        extractable: s.extractable,
      }))
    : []

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

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="h-12 w-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {/* Party reaction overlay */}
      {partyActive && (
        <ReactionOverlay reactions={party.reactions} onExpire={party.expireReaction} />
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
          <div>Resolution: {videoRef.current?.videoWidth ?? 0}×{videoRef.current?.videoHeight ?? 0}</div>
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
            onClick={togglePlay}
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
              <ReactionBar onReact={party.sendReaction} />
            </div>
          )}

          {/* Subtitle track picker */}
          {subtitleStreams.length > 0 && (
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
                  {subtitleTracks.map((track, i) => (
                    <button
                      key={track.src}
                      disabled={!track.extractable}
                      onClick={() => { setActiveSubIndex(i); setShowSubMenu(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${track.extractable ? 'hover:bg-zinc-800' : 'opacity-40 cursor-not-allowed'}`}
                    >
                      {activeSubIndex === i && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
                      <span className={`${activeSubIndex === i ? 'text-white font-medium' : 'text-zinc-300'} ${activeSubIndex !== i ? 'ml-5' : ''}`}>
                        {track.label || track.srcLang || `Track ${i + 1}`}
                        {!track.extractable && ' (image — unsupported)'}
                      </span>
                    </button>
                  ))}
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
          <PartyPanel
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
          />
          <ChatPanel
            messages={party.chatMessages}
            selfUserId={selfUserId}
            onSend={party.sendChat}
          />
        </div>
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
