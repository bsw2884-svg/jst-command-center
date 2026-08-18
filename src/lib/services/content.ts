import { createWorkspaceRecordService } from './core'
import type { ContentItemRecord } from './types'
export const contentService = createWorkspaceRecordService<ContentItemRecord>('content_items')
