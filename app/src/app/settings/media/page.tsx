import { requireAdmin } from '@/lib/dal'
import { prowlarrFetch } from '@/lib/prowlarr/client'
import { sonarrFetch } from '@/lib/sonarr/client'
import { radarrFetch } from '@/lib/radarr/client'
import { bazarrFetch } from '@/lib/bazarr/client'
import type { ProwlarrIndexer } from '@/lib/prowlarr/types'
import type { SonarrQualityProfile, SonarrRootFolder, SonarrQueueResponse } from '@/lib/sonarr/types'
import type { RadarrQualityProfile, RadarrRootFolder, RadarrQueueResponse } from '@/lib/radarr/types'
import type { BazarrProvider, BazarrSystemStatus } from '@/lib/bazarr/types'
import MediaSettingsClient from './MediaSettingsClient'

export default async function MediaSettingsPage() {
  await requireAdmin()

  const [
    indexersResult,
    sonarrProfilesResult,
    sonarrFoldersResult,
    sonarrQueueResult,
    radarrProfilesResult,
    radarrFoldersResult,
    radarrQueueResult,
    providersResult,
    statusResult,
  ] = await Promise.allSettled([
    prowlarrFetch<ProwlarrIndexer[]>('/indexer'),
    sonarrFetch<SonarrQualityProfile[]>('/qualityprofile'),
    sonarrFetch<SonarrRootFolder[]>('/rootfolder'),
    sonarrFetch<SonarrQueueResponse>('/queue?pageSize=5'),
    radarrFetch<RadarrQualityProfile[]>('/qualityprofile'),
    radarrFetch<RadarrRootFolder[]>('/rootfolder'),
    radarrFetch<RadarrQueueResponse>('/queue?pageSize=5'),
    bazarrFetch<{ data: BazarrProvider[] }>('/providers'),
    bazarrFetch<{ data: BazarrSystemStatus }>('/system/status'),
  ])

  return (
    <MediaSettingsClient
      indexers={indexersResult.status === 'fulfilled' ? indexersResult.value : null}
      sonarrProfiles={sonarrProfilesResult.status === 'fulfilled' ? sonarrProfilesResult.value : null}
      sonarrFolders={sonarrFoldersResult.status === 'fulfilled' ? sonarrFoldersResult.value : null}
      sonarrQueueTotal={sonarrQueueResult.status === 'fulfilled' ? sonarrQueueResult.value.totalRecords : null}
      radarrProfiles={radarrProfilesResult.status === 'fulfilled' ? radarrProfilesResult.value : null}
      radarrFolders={radarrFoldersResult.status === 'fulfilled' ? radarrFoldersResult.value : null}
      radarrQueueTotal={radarrQueueResult.status === 'fulfilled' ? radarrQueueResult.value.totalRecords : null}
      providers={providersResult.status === 'fulfilled' ? providersResult.value.data : null}
      bazarrStatus={statusResult.status === 'fulfilled' ? statusResult.value.data : null}
    />
  )
}
