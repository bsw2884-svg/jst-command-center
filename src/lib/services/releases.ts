import { createWorkspaceRecordService } from './core'
import type { ReleaseRecord } from './types'
export const releaseService = createWorkspaceRecordService<ReleaseRecord>('releases')
