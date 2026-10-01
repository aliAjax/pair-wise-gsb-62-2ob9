import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  AssignmentConflictChoice,
  AuditEntry,
  DispositionPlan,
  ExpertOpinion,
  FieldReview,
  OfflineSyncPackage,
  TailingsDataset
} from '../domain'

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Apply Dam Top Closure': props<{ shiftId: string; operator: string }>(),
    'Restore Dam Top Road': props<{ shiftId: string; operator: string }>(),
    'Import Offline Package': props<{ syncPackage: OfflineSyncPackage }>(),
    'Resolve Assignment Conflict': props<{ conflictId: string; choice: AssignmentConflictChoice; operator: string }>(),
    'Submit Field Review': props<{ anomalyId: string; review: FieldReview }>(),
    'Add Expert Opinion': props<{ anomalyId: string; opinion: ExpertOpinion }>(),
    'Save Disposition Plan': props<{ anomalyId: string; plan: DispositionPlan }>(),
    'Approve Plan': props<{ anomalyId: string; approver: string; note: string }>(),
    'Close Anomaly': props<{ anomalyId: string; note: string }>(),
    'Create Emergency Link': props<{ anomalyId: string; note: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    'Clear Inspection Error': emptyProps(),
    'Reset Demo': emptyProps()
  }
})
