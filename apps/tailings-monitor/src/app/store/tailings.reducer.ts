import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, TailingsDataset } from '../domain'
import { importTabletPackage, liftBlockage, reassignPoint, resolveConflict } from '../domain/inspection'
import { seedDataset } from '../data/seed'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部'
}

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString()
})

const withAudit = (dataset: TailingsDataset, entries: AuditEntry[]): TailingsDataset =>
  entries.length ? { ...dataset, audit: [...entries, ...dataset.audit] } : dataset

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TailingsActions.submitFieldReview, (state, { anomalyId, review }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !review.observed || !review.evidence || !review.reassessment) return state
    anomaly.fieldReviews.unshift({ ...review, version: anomaly.fieldReviews.length + 1 })
    anomaly.status = '原因调查中'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交现场复核', review.inspector, review.reassessment))
    return { ...state, dataset }
  }),
  on(TailingsActions.addExpertOpinion, (state, { anomalyId, opinion }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !opinion.content) return state
    anomaly.opinions.unshift(opinion)
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '补充专业意见', opinion.specialist, `${opinion.conclusion}：${opinion.content}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.saveDispositionPlan, (state, { anomalyId, plan }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !plan.owner || !plan.deadline || !plan.conditions) return state
    anomaly.plan = { ...plan, approvedBy: '', approvedAt: '' }
    anomaly.status = '待负责人审批'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交处置方案', '当前用户', `${plan.action}，责任方${plan.owner}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.approvePlan, (state, { anomalyId, approver, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return state
    anomaly.plan.approvedBy = approver
    anomaly.plan.approvedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '审批处置方案', approver, note || '同意执行'))
    return { ...state, dataset }
  }),
  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !anomaly.plan.approvedBy || !anomaly.fieldReviews.length || !note.trim()) return state
    anomaly.status = '已关闭'
    anomaly.closedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '关闭异常', anomaly.plan.approvedBy, note))
    return { ...state, dataset }
  }),
  on(TailingsActions.createEmergencyLink, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    anomaly.plan.emergencyLinked = true
    anomaly.status = '应急联动'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '启动应急联动', '值班负责人', note))
    return { ...state, dataset }
  }),
  on(TailingsActions.reroutePoint, (state, { tourId, pointId, segmentId, editedBy, reason }) => {
    const tour = state.dataset.tours.find((item) => item.id === tourId)
    if (!tour) return state
    const result = reassignPoint(tour, pointId, segmentId, editedBy, reason)
    if (!result.applied) return state
    const entry = audit(pointId, '改线', editedBy, `${reason}；改入${segmentId}`)
    const dataset = withAudit(
      { ...state.dataset, tours: state.dataset.tours.map((item) => (item.id === tourId ? result.tour : item)) },
      [entry]
    )
    return { ...state, dataset }
  }),
  on(TailingsActions.importTabletPackage, (state, { pkg }) => {
    const { dataset: merged, summary } = importTabletPackage(state.dataset, pkg)
    const entries: AuditEntry[] = []
    if (summary.duplicated) {
      entries.push(audit(pkg.id, '离线包重复提交忽略', '值班室', `${pkg.tabletId} 重复导入同一平板包，未新增班次、改线或完成记录`))
    } else if (!summary.ok) {
      entries.push(audit(pkg.id, '离线包导入失败', '值班室', summary.note))
    } else {
      entries.push(audit(pkg.id, '导入离线平板包', pkg.tabletId, summary.note))
      summary.conflictIds.forEach((id) => entries.push(audit(id, '离线合并冲突', '值班室', `同一测点两边都改过，保留两版待值班室确认（包${pkg.id}）`)))
      summary.reviewIds.forEach((id) => entries.push(audit(id, '接收入库现场复核', pkg.operator, '离线复核作为独立版本追加，已上传复核未改动')))
      summary.ownerClaimsKept.forEach((anomalyId) => entries.push(audit(anomalyId, '异常责任人保持原样', pkg.operator, '离线包认领责任人被忽略，原责任人不变')))
    }
    return { ...state, dataset: withAudit(merged, entries) }
  }),
  on(TailingsActions.resolveConflict, (state, { tourId, conflictId, choice, resolvedBy }) => {
    const merged = resolveConflict(state.dataset, tourId, conflictId, choice, resolvedBy)
    if (merged === state.dataset) return state
    const entry = audit(conflictId, '裁决离线冲突', resolvedBy, `值班室确认采用${choice === 'server' ? '值班室版本' : '平板版本'}`)
    return { ...state, dataset: withAudit(merged, [entry]) }
  }),
  on(TailingsActions.liftBlockage, (state, { tourId, blockageId, operator }) => {
    const before = state.dataset.tours.find((item) => item.id === tourId)
    const merged = liftBlockage(state.dataset, tourId, blockageId, new Date().toISOString(), operator)
    if (merged === state.dataset) return state
    const after = merged.tours.find((item) => item.id === tourId)
    const reassigned = after?.assignments.filter((assignment) =>
      assignment.current.reason.startsWith('封路解除') &&
      !before?.assignments.some((old) => old.pointId === assignment.pointId && old.current.segmentId === assignment.current.segmentId)
    ) ?? []
    const entry = audit(blockageId, '封路解除', operator, `绕行点按原计划重新接管${reassigned.length}处；绕行段已完成点不重复派回`)
    return { ...state, dataset: withAudit(merged, [entry]) }
  }),
  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id }))
)
