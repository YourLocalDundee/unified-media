// Deluge stub — not yet implemented.
// Deluge uses a JSON-RPC 2.0 API with session cookie auth, similar in concept
// to qBittorrent but with a different handshake.
// All methods throw immediately so the registry can still be loaded without error.
import type {
  AddTorrentPayload,
  DownloadClient,
  MaindataResult,
  Torrent,
  TorrentFilter,
  TransferInfo,
} from './types'

export class DelugeClient implements DownloadClient {
  getTorrents(_filter?: TorrentFilter): Promise<Torrent[]> {
    throw new Error('Deluge support not yet implemented')
  }

  getTransferInfo(): Promise<TransferInfo> {
    throw new Error('Deluge support not yet implemented')
  }

  pollMaindata(_rid?: number): Promise<MaindataResult> {
    throw new Error('Deluge support not yet implemented')
  }

  addTorrent(_payload: AddTorrentPayload): Promise<void> {
    throw new Error('Deluge support not yet implemented')
  }

  deleteTorrents(_hashes: string[], _deleteFiles: boolean): Promise<void> {
    throw new Error('Deluge support not yet implemented')
  }

  pauseTorrents(_hashes: string[]): Promise<void> {
    throw new Error('Deluge support not yet implemented')
  }

  resumeTorrents(_hashes: string[]): Promise<void> {
    throw new Error('Deluge support not yet implemented')
  }
}
