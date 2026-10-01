export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭'
export type Severity = '关注' | '较高' | '重大'

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
  /** 异常归属的汛期巡检班次，覆盖范围与看板、审阅包按同一班次计算 */
  tourId: string
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

// ---------------------------------------------------------------------------
// 汛期巡检：班次、路线段、测点归属、封路、离线平板合并
// ---------------------------------------------------------------------------

export type SegmentKind = '计划段' | '绕行段'
export type AssignmentStatus = '正常' | '冲突待确认'
export type TourStatus = '进行中' | '已结束'

export interface RouteSegment {
  id: string
  tourId: string
  name: string
  kind: SegmentKind
}

/** 测点归属的一次留痕版本；归属改变只追加新版本，不覆盖历史 */
export interface AssignmentVersion {
  version: number
  segmentId: string
  basis: SegmentKind
  editedBy: string
  editedAt: string
  reason: string
  tabletId?: string
}

/**
 * 测点在一次汛期巡检班次内的归属。
 * 不变量：同一 (tourId, pointId) 只允许一条记录，即一个测点在一次汛期巡检只归一个路线段；
 * 改线、绕行、接管都在同一条记录上追加版本，不新增第二条归属。
 */
export interface PointAssignment {
  pointId: string
  tourId: string
  /** 原计划段，封路解除后绕行点按此接管 */
  plannedSegmentId: string
  status: AssignmentStatus
  current: AssignmentVersion
  history: AssignmentVersion[]
}

export interface PointCompletion {
  pointId: string
  tourId: string
  /** 完成时所在段；在绕行段完成的点保留绕行完成事实，封路解除不重复派回 */
  segmentId: string
  completedAt: string
  inspector: string
  note: string
}

export interface PointConflict {
  id: string
  tourId: string
  pointId: string
  /** 值班室（服务端）版本 */
  server: AssignmentVersion
  /** 离线平板版本 */
  tablet: AssignmentVersion
  packageId: string
  tabletId: string
  detectedAt: string
  status: '待值班室确认' | '已确认'
  resolved?: { choice: 'server' | 'tablet'; resolvedBy: string; resolvedAt: string }
}

export interface RoadBlockage {
  id: string
  tourId: string
  /** 被封闭的路段；坝顶联络路同时切断主坝段与库区段 */
  segmentIds: string[]
  reason: string
  startedAt: string
  liftedAt: string
}

export interface FloodTour {
  id: string
  name: string
  season: string
  status: TourStatus
  startedAt: string
  expectedPointIds: string[]
  segments: RouteSegment[]
  assignments: PointAssignment[]
  completions: PointCompletion[]
  conflicts: PointConflict[]
  blockages: RoadBlockage[]
  /** 已成功导入的平板包，重试同一包幂等去重 */
  importedPackages: string[]
}

export interface TabletAssignmentEdit {
  pointId: string
  segmentId: string
  basis: SegmentKind
  /** 离线包所依据的归属版本；三方合并据此判断值班室是否同期改过同一点 */
  baseVersion: number
  editedAt: string
  reason: string
}

export interface TabletCompletion {
  pointId: string
  completedAt: string
  inspector: string
  note: string
}

export interface TabletFieldReview {
  anomalyId: string
  review: FieldReview
}

export interface TabletOwnerClaim {
  anomalyId: string
  owner: string
  reason: string
}

/** 离线平板同步包；newTour 表示现场直接开出的新班次（如夜巡） */
export interface TabletPackage {
  id: string
  tabletId: string
  tourId: string
  operator: string
  packedAt: string
  newTour?: {
    id: string
    name: string
    season: string
    startedAt: string
    expectedPointIds: string[]
    segments: Pick<RouteSegment, 'id' | 'name' | 'kind'>[]
  }
  newSegments?: Pick<RouteSegment, 'id' | 'name' | 'kind'>[]
  assignmentEdits: TabletAssignmentEdit[]
  completions: TabletCompletion[]
  fieldReviews: TabletFieldReview[]
  ownerClaims: TabletOwnerClaim[]
}

export interface ImportResultSummary {
  ok: boolean
  duplicated: boolean
  packageId: string
  tabletId: string
  tourId: string
  importedAt: string
  appliedEdits: number
  skippedCompleted: number
  fastForwardEdits: number
  conflictIds: string[]
  completionIds: string[]
  reviewIds: string[]
  ownerClaimsApplied: string[]
  /** 已有责任人而保持原样的异常 */
  ownerClaimsKept: string[]
  error?: string
  note: string
}

export interface SegmentCoverage {
  segmentId: string
  segmentName: string
  kind: SegmentKind
  total: number
  completed: number
  pointIds: string[]
}

/** 看板、异常详情、审阅包共用的同一覆盖范围口径 */
export interface CoverageSummary {
  tourId: string
  tourName: string
  status: TourStatus
  totalPoints: number
  completedPoints: number
  pendingPoints: number
  /** 尚未完成、当前走绕行段，等待封路解除接管 */
  detourPendingPoints: number
  /** 在绕行段完成的点，不重复派回原路线 */
  detourCompletedPoints: number
  conflictPointIds: string[]
  coveredPointIds: string[]
  bySegment: SegmentCoverage[]
}

export interface ReviewEnvelope {
  generatedAt: string
  coverage: CoverageSummary[]
  dataset: TailingsDataset
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  tours: FloodTour[]
  importLog: ImportResultSummary[]
  audit: AuditEntry[]
}
