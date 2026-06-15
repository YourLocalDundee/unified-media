import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import fs from 'fs'
import { Readable } from 'stream'
import { stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

const MIME_TYPES: Record<string, string> = {
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ts':  'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
}

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'video/mp4'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAuth()

  const { id } = await params
  const item = getItemById(id)
  if (!item || !item.file_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const filePath = item.file_path
  let fileStats: Awaited<ReturnType<typeof stat>>
  try {
    fileStats = await stat(filePath)
  } catch {
    return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
  }

  const fileSize = fileStats.size
  const mimeType = getMimeType(filePath)
  const rangeHeader = req.headers.get('range')

  // Readable.toWeb bridges the Node stream and honors backpressure (it pauses the
  // fs read when the consumer is slow), unlike a manual enqueue-everything loop
  // that buffers the whole chunk backlog in memory for a stalled client (A4-L6).
  const toWeb = (stream: fs.ReadStream) => Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
  const unsatisfiable = () =>
    new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' } })

  if (rangeHeader) {
    // Only a single byte-range is supported. Validate strictly and answer 416 per
    // RFC 7233 for malformed, multi-range, or unsatisfiable requests instead of
    // emitting a broken 206 with a negative Content-Length or a mid-flight stream
    // error (A4-H3). The old parser fed raw parseInt() straight into createReadStream.
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match || (match[1] === '' && match[2] === '')) return unsatisfiable()

    let start: number
    let end: number
    if (match[1] === '') {
      // Suffix range: bytes=-N → the final N bytes.
      const suffixLen = parseInt(match[2], 10)
      if (!Number.isFinite(suffixLen) || suffixLen <= 0) return unsatisfiable()
      start = Math.max(0, fileSize - suffixLen)
      end = fileSize - 1
    } else {
      start = parseInt(match[1], 10)
      end = match[2] === '' ? fileSize - 1 : parseInt(match[2], 10)
    }
    end = Math.min(end, fileSize - 1)

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
      return unsatisfiable()
    }

    const chunkSize = end - start + 1
    return new NextResponse(toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Cache-Control': 'no-cache',
      },
    })
  }

  return new NextResponse(toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(fileSize),
      'Cache-Control': 'no-cache',
    },
  })
}
