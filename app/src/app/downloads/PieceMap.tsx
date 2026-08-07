'use client'

// Canvas piece map for the torrent detail panel's Files tab. Renders per-piece
// download state (0=missing, 1=downloading, 2=downloaded) as a horizontal strip,
// with thin dividers at file boundaries.
//
// Binning: torrents can have anywhere from a few dozen to tens of thousands of
// pieces, but the strip only has a few hundred/thousand physical pixels to draw
// into. Each pixel *column* (not each piece) is one draw call: the piece range
// covering that column is aggregated into have/downloading counts, then colored
// by priority — any downloading piece in the bin wins (keeps active regions
// visible even when heavily zoomed out), else a solid downloaded/missing color
// if the bin is uniform, else a linear blend of the two proportional to the
// downloaded fraction. This keeps the draw cost O(pieces) per frame regardless
// of how many thousands of pieces exist, instead of O(pieces) canvas draw calls.
//
// Colors are read from the app's `--theme-*` CSS custom properties (the same
// vars ThemeToggle.tsx writes per `data-theme`), not hardcoded light/dark
// classes — this covers all five built-in themes plus user-created custom
// themes, not just a binary light/dark split, and canvas fillStyle can't
// resolve `var(--x)` itself so we resolve it once per draw via getComputedStyle.
//
// No animation: pieces are colored statically and redrawn only when the data
// (poll tick) or the container size changes. There is nothing to gate behind
// `prefers-reduced-motion` as a result, which is the point — avoids a shimmer/
// pulse effect that would need its own reduced-motion branch.

import { useEffect, useRef } from 'react'
import type { QbtFileInfo } from '@/types/torrent'

interface PieceMapProps {
  /** 0=not downloaded, 1=downloading/requested, 2=downloaded. Empty while loading. */
  pieceStates: number[]
  /** Authoritative piece count from QbtTorrentProperties; falls back to pieceStates.length. */
  piecesNum: number
  /** Used only for `piece_range` to draw file-boundary dividers. */
  files: QbtFileInfo[]
}

const STRIP_HEIGHT = 20
// Never bin finer than this many CSS pixels per column — keeps individual
// columns visible/legible instead of sub-pixel slivers on ultra-wide panels.
const MIN_COLUMN_PX = 2

function readThemeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Linear-blend two `#rrggbb` colors; t=0 -> a, t=1 -> b. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16)
  const pb = parseInt(b.replace('#', ''), 16)
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

function draw(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  pieceStates: number[],
  piecesNum: number,
  files: QbtFileInfo[],
) {
  const cssWidth = container.clientWidth
  const ctx = canvas.getContext('2d')
  if (!ctx || cssWidth <= 0) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.round(STRIP_HEIGHT * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${STRIP_HEIGHT}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const missingColor = readThemeColor('--theme-muted', '#484f58')
  const downloadedColor = readThemeColor('--theme-success', '#3fb950')
  const activeColor = readThemeColor('--theme-accent', '#2f81f7')
  const borderColor = readThemeColor('--theme-border', '#30363d')

  const total = piecesNum > 0 ? piecesNum : pieceStates.length
  ctx.clearRect(0, 0, cssWidth, STRIP_HEIGHT)
  if (total <= 0) return

  const numColumns = Math.max(1, Math.min(total, Math.floor(cssWidth / MIN_COLUMN_PX) || 1))
  const haveStates = pieceStates.length > 0

  for (let col = 0; col < numColumns; col++) {
    const start = Math.floor((col * total) / numColumns)
    const end = Math.max(start + 1, Math.floor(((col + 1) * total) / numColumns))
    const count = end - start

    let have = 0
    let downloading = 0
    if (haveStates) {
      const s = Math.min(start, pieceStates.length)
      const e = Math.min(end, pieceStates.length)
      for (let i = s; i < e; i++) {
        const st = pieceStates[i]
        if (st === 2) have++
        else if (st === 1) downloading++
      }
    }

    let color: string
    if (downloading > 0) color = activeColor
    else if (count > 0 && have === count) color = downloadedColor
    else if (have === 0) color = missingColor
    else color = mixHex(missingColor, downloadedColor, have / count)

    const x = (col / numColumns) * cssWidth
    const nextX = ((col + 1) / numColumns) * cssWidth
    ctx.fillStyle = color
    ctx.fillRect(x, 0, Math.max(nextX - x, 1), STRIP_HEIGHT)
  }

  // File-boundary dividers (skip the boundary at piece 0 — that's the left edge).
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  let lastX = -Infinity
  for (const f of files) {
    const start = f.piece_range?.[0] ?? 0
    if (start <= 0) continue
    const x = Math.round((start / total) * cssWidth) + 0.5
    if (x - lastX < 1) continue
    lastX = x
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, STRIP_HEIGHT)
    ctx.stroke()
  }
}

export function PieceMap({ pieceStates, piecesNum, files }: PieceMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // "Latest draw" ref, updated post-render only (react-hooks/refs: never read/write
  // ref.current during render). The ResizeObserver effect below fires later, on a
  // browser callback, and needs the most recent data — not what was in scope when
  // it was created — hence the indirection instead of closing over props directly.
  const drawRef = useRef<() => void>(() => {})

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) draw(canvas, container, pieceStates, piecesNum, files)
    }
    drawRef.current()
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const total = piecesNum > 0 ? piecesNum : pieceStates.length
  const haveCount = pieceStates.length > 0 ? pieceStates.reduce((n, s) => n + (s === 2 ? 1 : 0), 0) : null

  if (total <= 0) return null

  return (
    <div className="mb-3">
      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            haveCount !== null
              ? `Piece map: ${haveCount} of ${total} pieces downloaded`
              : `Piece map: ${total} pieces, loading state`
          }
          className="block w-full rounded border border-gray-200 dark:border-gray-700"
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--theme-success, #3fb950)' }} />
          Downloaded
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--theme-accent, #2f81f7)' }} />
          Downloading
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--theme-muted, #484f58)' }} />
          Missing
        </span>
        {files.length > 1 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-px bg-gray-400 dark:bg-gray-500" />
            File boundary
          </span>
        )}
      </div>
    </div>
  )
}
