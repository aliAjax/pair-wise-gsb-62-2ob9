export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭'
export type Severity = '关注' | '较高' | '重大'
export type RouteSegmentKind = '原计划' | '绕行'
export type AssignmentStatus = '待巡检' | '已完成'
export type InspectionShiftStatus = '进行中' | '已结束'
export type AssignmentConflictStatus = '待值班室确认' | '已确认'
export type AssignmentConflictChoice = '现场版' | '导入版'

export interface MonitoringPoint {
  id: string
  name: string
  zone: string
  type: MonitoringType
  longitude: number
  latitude: number
  status: PointStatus
  currentValue: number
  unit: string
  thresholdId: string
  lastInspectionAt: string
}

export interface Threshold {
  id: string
  type: MonitoringType
  warning: number
  alarm: number
  changeRate: number
  unit: string
  enabled: boolean
  version: number
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  version: number
}

export interface DispositionPlan {
  id: string
  action: '加密监测' | '降低库水位' | '疏通排水' | '应急撤离准备' | '工程加固'
  owner: string
  deadline: string
  conditions: string
  emergencyLinked: boolean
  approvedBy: string
  approvedAt: string
}

export interface Anomaly {
  id: string
  pointId: string
  title: string
  severity: Severity
  status: AnomalyStatus
  openedAt: string
  owner: string
  triggerReadingId: string
  observedValue: string
  fieldReviews: FieldReview[]
  opinions: ExpertOpinion[]
  plan: DispositionPlan
  closedAt: string
  version: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface RouteSegment {
  id: string
  name: string
  zone: string
  kind: RouteSegmentKind
  active: boolean
  order: number
}

export interface InspectionAssignment {
  id: string
  shiftId: string
  pointId: string
  segmentId: string
  originalSegmentId: string
  status: AssignmentStatus
  completedAt: string
  revision: number
  changedBy: string
  changedAt: string
}

export interface OfflineAssignmentEdit {
  pointId: string
  segmentId: string
  baseSegmentId: string
  baseRevision: number
}

export interface AssignmentConflict {
  id: string
  shiftId: string
  pointId: string
  localSegmentId: string
  incomingSegmentId: string
  incomingPackageId: string
  incomingTabletId: string
  status: AssignmentConflictStatus
  resolvedSegmentId: string
  resolvedBy: string
  resolvedAt: string
  createdAt: string
}

export interface OfflineSyncPackage {
  id: string
  shiftId: string
  tabletId: string
  operator: string
  baseRevision: number
  baseRouteRevision: number
  exportedAt: string
  importedAt: string
  edits: OfflineAssignmentEdit[]
}

export interface InspectionShift {
  id: string
  name: string
  date: string
  status: InspectionShiftStatus
  damTopRoadClosed: boolean
  routeRevision: number
  lastPackageId: string
}

export interface InspectionCoverage {
  shiftId: string
  shiftName: string
  totalPoints: number
  completedPoints: number
  pendingPoints: number
  coverageRate: number
  uniqueAssignments: number
  originalSegments: number
  detourSegments: number
  pendingConflicts: number
}

export interface InspectionStateData {
  shifts: InspectionShift[]
  segments: RouteSegment[]
  assignments: InspectionAssignment[]
  conflicts: AssignmentConflict[]
  packages: OfflineSyncPackage[]
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  inspection: InspectionStateData
  audit: AuditEntry[]
}

export interface ReviewPackage extends TailingsDataset {
  packageName: string
  generatedAt: string
  coverage: InspectionCoverage
}
