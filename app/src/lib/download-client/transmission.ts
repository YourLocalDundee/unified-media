// Transmission stub — not yet implemented.
// Transmission uses RPC over HTTP with X-Transmission-Session-Id token rotation,
// which is more involved than qBittorrent's simple cookie flow.
// All methods throw immediately so the registry can still be loaded without error.
import type {
  AddTorrentPayload,
  DownloadClient,
  MaindataResult,
  Torrent,
  TorrentFilter,
  TransferInfo,
} from './types'

export class TransmissionClient implements DownloadClient {
  getTorrents(_filter?: TorrentFilter): Promise<Torrent[]> {
    throw new Error('Transmission support not yet implemented')
  }

  getTransferInfo(): Promise<TransferInfo> {
    throw new Error('Transmission support not yet implemented')
  }

  pollMaindata(_rid?: number): Promise<MaindataResult> {
    throw new Error('Transmission support not yet implemented')
  }

  addTorrent(_payload: AddTorrentPayload): Promise<void> {
    throw new Error('Transmission support not yet implemented')
  }

  deleteTorrents(_hashes: string[], _deleteFiles: boolean): Promise<void> {
    throw new Error('Transmission support not yet implemented')
  }

  pauseTorrents(_hashes: string[]): Promise<void> {
    throw new Error('Transmission support not yet implemented')
  }

  resumeTorrents(_hashes: string[]): Promise<void> {
    throw new Error('Transmission support not yet implemented')
  }
}
