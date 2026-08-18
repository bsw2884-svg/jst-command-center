import { createWorkspaceRecordService } from './core'
import type { ShowRecord } from './types'
export const showService = createWorkspaceRecordService<ShowRecord>('shows')
