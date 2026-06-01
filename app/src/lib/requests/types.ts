export type RequestStatus = 'pending' | 'approved' | 'declined' | 'available'
export type RequestMediaType = 'movie' | 'tv'

export interface NativeRequest {
  id: number
  user_id: string
  tmdb_id: number
  media_type: RequestMediaType
  title: string
  year: number | null
  poster_path: string | null
  overview: string | null
  seasons: string | null       // JSON: number[] or null
  status: RequestStatus
  created_at: number           // Unix ms
  updated_at: number
}

export interface NativeRequestWithUser extends NativeRequest {
  username: string             // joined from users table
}
