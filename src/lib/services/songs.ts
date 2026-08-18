import { createWorkspaceRecordService } from './core'
import type { SongRecord } from './types'
export const songService = createWorkspaceRecordService<SongRecord>('songs')
