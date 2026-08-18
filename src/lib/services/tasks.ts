import { createWorkspaceRecordService } from './core'
import type { TaskRecord } from './types'
export const taskService = createWorkspaceRecordService<TaskRecord>('tasks')
