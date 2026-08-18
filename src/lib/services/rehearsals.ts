import { createWorkspaceRecordService } from './core'
import type { RehearsalRecord } from './types'
export const rehearsalService = createWorkspaceRecordService<RehearsalRecord>('rehearsals')
