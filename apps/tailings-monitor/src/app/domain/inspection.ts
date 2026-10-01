import type {
  Anomaly,
  AssignmentVersion,
  CoverageSummary,
  FloodTour,
  ImportResultSummary,
  PointAssignment,
  PointCompletion,
  PointConflict,
  RoadBlockage,
  RouteSegment,
  SegmentCoverage,
  TabletPackage,
  TailingsDataset
} from './models'

// ---------------------------------------------------------------------------
// 班次 / 路线段 / 测点归属
// ---------------------------------------------------------------------------

export const getTour = (dataset: TailingsDataset, tourId: string): FloodTour | undefined =>
  dataset.tours.find((tour) => tour.id === tourId)

export const getAssignment = (tour: FloodTour, pointId: string): PointAssignment | undefined =>
  tour.assignments.find((item) => item.pointId === pointId)

export const isCompleted = (tour: FloodTour, pointId: string): boolean =>
  tour.completions.some((item) => item.pointId === pointId)

export const getCompletion = (tour: FloodTour, pointId: string): PointCompletion | undefined =>
  tour.completions.find((item) => item.pointId === pointId)

export const getSegment = (tour: FloodTour, segmentId: string): RouteSegment | undefined =>
  tour.segments.find((item) => item.id === segmentId)

const versionOf = (assignment: PointAssignment): number => assignment.current.version

const nextVersion = (
  assignment: PointAssignment,
  edit: { segmentId: string; basis: RouteSegment['kind']; editedBy: string; editedAt: string; reason: string; tabletId?: string }
): { current: AssignmentVersion; history: AssignmentVersion[] } => ({
  current: {
    version: assignment.current.version + 1,
    segmentId: edit.segmentId,
    basis: edit.basis,
    editedBy: edit.editedBy,
    editedAt: edit.editedAt,
    reason: edit.reason,
    tabletId: edit.tabletId
  },
  history: [...assignment.history, assignment.current]
})

/** 直接改线（值班室或单端编辑）：只影响尚未完成的点；已完成的点保持原归属与完成事实 */
export const reassignPoint = (
  tour: FloodTour,
  pointId: string,
  segmentId: string,
  editedBy: string,
  reason: string,
  editedAt = new Date().toISOString()
): { tour: FloodTour; applied: boolean; reason?: string } => {
  const assignment = getAssignment(tour, pointId)
  if (!assignment) return { tour, applied: false, reason: '测点不在本班次计划内' }
  if (isCompleted(tour, pointId)) return { tour, applied: false, reason: '测点已完成，改线不影响已完成点' }
  if (!getSegment(tour, segmentId)) return { tour, applied: false, reason: '目标路线段不存在' }
  if (assignment.current.segmentId === segmentId) return { tour, applied: true }
  const basis = getSegment(tour, segmentId)?.kind ?? '计划段'
  const moved = nextVersion(assignment, { segmentId, basis, editedBy, editedAt, reason })
  return {
    tour: {
      ...tour,
      assignments: tour.assignments.map((item) => (item.pointId === pointId ? { ...item, status: '正常', ...moved } : item))
    },
    applied: true
  }
}

/** 批量改线：封路后把一批未完成点切到绕行段 */
export const rerouteForBlockage = (
  dataset: TailingsDataset,
  blockage: Omit<RoadBlockage, 'id'> & { id?: string },
  detourSegmentId: string,
  pointIds: string[],
  editedBy: string,
  editedAt = new Date().toISOString()
): TailingsDataset => {
  let tours = dataset.tours
  const tour = getTour(dataset, blockage.tourId)
  if (!tour) return dataset
  const record: RoadBlockage = { ...blockage, id: blockage.id ?? `BLK-${Date.now()}` }
  let working = tour.blockages.some((item) => item.id === record.id) ? tour : { ...tour, blockages: [...tour.blockages, record] }
  for (const pointId of pointIds) {
    const result = reassignPoint(working, pointId, detourSegmentId, editedBy, `封路绕行：${blockage.reason}`, editedAt)
    if (result.applied) working = result.tour
  }
  tours = tours.map((item) => (item.id === working.id ? working : item))
  return { ...dataset, tours }
}

/**
 * 封路解除：绕行点按原计划重新接管。
 * 只接管“尚未完成且当前在绕行段”的点；已经完成的点（无论在计划段还是绕行段完成）不重复派回。
 */
export const liftBlockage = (
  dataset: TailingsDataset,
  tourId: string,
  blockageId: string,
  liftedAt = new Date().toISOString(),
  operator = '值班室'
): TailingsDataset => {
  const tour = getTour(dataset, tourId)
  if (!tour) return dataset
  let working: FloodTour = {
    ...tour,
    blockages: tour.blockages.map((item) => (item.id === blockageId && !item.liftedAt ? { ...item, liftedAt } : item))
  }
  working.assignments.forEach((assignment) => {
    const completed = isCompleted(working, assignment.pointId)
    const onDetour = assignment.current.basis === '绕行段'
    if (!completed && onDetour && assignment.plannedSegmentId !== assignment.current.segmentId) {
      const result = reassignPoint(working, assignment.pointId, assignment.plannedSegmentId, operator, '封路解除，按原计划接管', liftedAt)
      if (result.applied) working = result.tour
    }
  })
  return { ...dataset, tours: dataset.tours.map((item) => (item.id === tourId ? working : item)) }
}

/** 现场完成测点：一次班次一个测点只能完成一次，重复上报幂等 */
export const completePoint = (
  tour: FloodTour,
  pointId: string,
  inspector: string,
  note: string,
  completedAt = new Date().toISOString()
): { tour: FloodTour; duplicated: boolean } => {
  const assignment = getAssignment(tour, pointId)
  if (!assignment) return { tour, duplicated: false }
  const existing = getCompletion(tour, pointId)
  if (existing) return { tour, duplicated: true }
  const completion: PointCompletion = { pointId, tourId: tour.id, segmentId: assignment.current.segmentId, completedAt, inspector, note }
  return { tour: { ...tour, completions: [...tour.completions, completion] }, duplicated: false }
}

// ---------------------------------------------------------------------------
// 离线平板包导入（三方合并 + 幂等）
// ---------------------------------------------------------------------------

let conflictSeq = 0
const conflictId = (): string => `CFL-${Date.now()}-${conflictSeq++}`

/**
 * 导入一个离线平板包，返回新数据集和导入结果。纯函数，不写副作用。
 *
 * 规则：
 * 1. packageId 幂等：已成功导入的包直接返回 duplicated，绝不新增班次、归属版本或完成记录。
 * 2. 归属编辑三方合并（baseVersion）：
 *    - baseVersion 等于值班室当前版本：fast-forward（若点已完成则跳过，已完成点不被改线）。
 *    - 值班室版本 > baseVersion（同一点两边都改过）：保留两版，登记冲突待值班室确认，不覆盖任何一版。
 * 3. 完成记录、现场复核按 packageId/记录 id 幂等；现场复核与异常责任人上传后保持原样。
 * 4. 已存在责任人的异常，包内的责任人认领不覆盖（ownerClaimsKept）。
 */
export const importTabletPackage = (
  dataset: TailingsDataset,
  pkg: TabletPackage,
  importedAt = new Date().toISOString()
): { dataset: TailingsDataset; summary: ImportResultSummary } => {
  if (dataset.tours.some((tour) => tour.importedPackages.includes(pkg.id)) ||
      dataset.importLog.some((log) => log.packageId === pkg.id && log.ok && !log.duplicated)) {
    const summary: ImportResultSummary = {
      ok: true, duplicated: true, packageId: pkg.id, tabletId: pkg.tabletId, tourId: pkg.tourId, importedAt,
      appliedEdits: 0, skippedCompleted: 0, fastForwardEdits: 0, conflictIds: [], completionIds: [], reviewIds: [],
      ownerClaimsApplied: [], ownerClaimsKept: [], note: '该平板包已导入过，重复提交已忽略，未新增班次或记录'
    }
    return { dataset: { ...dataset, importLog: [summary, ...dataset.importLog] }, summary }
  }

  let tours = dataset.tours
  let anomalies = dataset.anomalies

  // 现场直接开出的新班次：只在包首次导入时创建
  let tour = getTour(dataset, pkg.tourId)
  if (!tour && pkg.newTour) {
    const created: FloodTour = {
      id: pkg.newTour.id,
      name: pkg.newTour.name,
      season: pkg.newTour.season,
      status: '进行中',
      startedAt: pkg.newTour.startedAt,
      expectedPointIds: [...pkg.newTour.expectedPointIds],
      segments: pkg.newTour.segments.map((segment) => ({ ...segment, tourId: pkg.newTour.id })),
      assignments: pkg.newTour.expectedPointIds.map((pointId, index) => ({
        pointId,
        tourId: pkg.newTour.id,
        plannedSegmentId: pkg.newTour!.segments[Math.min(index, pkg.newTour!.segments.length - 1)].id,
        status: '正常',
        current: {
          version: 1,
          segmentId: pkg.newTour!.segments[Math.min(index, pkg.newTour!.segments.length - 1)].id,
          basis: '计划段',
          editedBy: pkg.operator,
          editedAt: pkg.newTour!.startedAt,
          reason: '新班次按计划建线'
        },
        history: []
      })),
      completions: [],
      conflicts: [],
      blockages: [],
      importedPackages: []
    }
    tours = [...tours, created]
    tour = created
  }
  if (!tour) {
    const summary: ImportResultSummary = failureSummary(pkg, importedAt, '平板包对应的汛期班次不存在，导入失败，未写入任何数据')
    return { dataset: { ...dataset, importLog: [summary, ...dataset.importLog] }, summary }
  }

  let working: FloodTour = { ...tour }
  if (pkg.newSegments?.length) {
    const known = new Set(working.segments.map((segment) => segment.id))
    working.segments = [...working.segments, ...pkg.newSegments.filter((segment) => !known.has(segment.id)).map((segment) => ({ ...segment, tourId: working.id }))]
  }

  let appliedEdits = 0
  let skippedCompleted = 0
  let fastForwardEdits = 0
  const conflictIds: string[] = []
  const newConflicts: PointConflict[] = []

  for (const edit of pkg.assignmentEdits) {
    const assignment = getAssignment(working, edit.pointId)
    if (!assignment) continue
    if (isCompleted(working, edit.pointId)) {
      // 已完成（含已上传复核）的点不接受改线
      skippedCompleted += 1
      continue
    }
    const targetSegment = getSegment(working, edit.segmentId)
    if (!targetSegment) continue
    if (assignment.current.segmentId === edit.segmentId) {
      fastForwardEdits += 1
      continue
    }
    if (edit.baseVersion < versionOf(assignment)) {
      // 两边都改过同一点：保留两版，待值班室确认
      const record: PointConflict = {
        id: conflictId(),
        tourId: working.id,
        pointId: edit.pointId,
        server: assignment.current,
        tablet: {
          version: edit.baseVersion + 1,
          segmentId: edit.segmentId,
          basis: edit.basis,
          editedBy: pkg.operator,
          editedAt: edit.editedAt,
          reason: edit.reason,
          tabletId: pkg.tabletId
        },
        packageId: pkg.id,
        tabletId: pkg.tabletId,
        detectedAt: importedAt,
        status: '待值班室确认'
      }
      newConflicts.push(record)
      conflictIds.push(record.id)
      continue
    }
    const moved = nextVersion(assignment, {
      segmentId: edit.segmentId,
      basis: edit.basis,
      editedBy: pkg.operator,
      editedAt: edit.editedAt,
      reason: edit.reason,
      tabletId: pkg.tabletId
    })
    working = {
      ...working,
      assignments: working.assignments.map((item) => (item.pointId === edit.pointId ? { ...item, ...moved } : item))
    }
    appliedEdits += 1
    fastForwardEdits += 1
  }

  if (newConflicts.length) {
    working = {
      ...working,
      conflicts: [...working.conflicts, ...newConflicts],
      assignments: working.assignments.map((item) =>
        newConflicts.some((conflict) => conflict.pointId === item.pointId) ? { ...item, status: '冲突待确认' } : item
      )
    }
  }

  // 完成上报：幂等
  const completionIds: string[] = []
  for (const completion of pkg.completions) {
    const result = completePoint(working, completion.pointId, completion.inspector, completion.note, completion.completedAt)
    working = result.tour
    if (!result.duplicated) completionIds.push(completion.pointId)
  }

  working = { ...working, importedPackages: [...working.importedPackages, pkg.id] }
  tours = tours.map((item) => (item.id === working.id ? working : item))

  // 现场复核：追加独立版本，绝不修改或覆盖已上传的复核
  const reviewIds: string[] = []
  for (const bundle of pkg.fieldReviews) {
    const anomaly = anomalies.find((item) => item.id === bundle.anomalyId && item.tourId === working.id)
    if (!anomaly) continue
    if (anomaly.fieldReviews.some((review) => review.id === bundle.review.id)) continue
    const version = anomaly.fieldReviews.length + 1
    anomalies = anomalies.map((item) =>
      item.id === bundle.anomalyId
        ? { ...item, fieldReviews: [{ ...bundle.review, version }, ...item.fieldReviews], version: item.version + 1 }
        : item
    )
    reviewIds.push(bundle.review.id)
  }

  // 异常责任人：只有尚无责任人时才采用包内认领；已有责任人保持原样
  const ownerClaimsApplied: string[] = []
  const ownerClaimsKept: string[] = []
  for (const claim of pkg.ownerClaims) {
    const anomaly = anomalies.find((item) => item.id === claim.anomalyId)
    if (!anomaly) continue
    if (anomaly.owner.trim()) {
      ownerClaimsKept.push(anomaly.id)
      continue
    }
    anomalies = anomalies.map((item) => (item.id === claim.anomalyId ? { ...item, owner: claim.owner } : item))
    ownerClaimsApplied.push(anomaly.id)
  }

  const noteParts: string[] = []
  if (appliedEdits) noteParts.push(`快进改线${appliedEdits}处`)
  if (skippedCompleted) noteParts.push(`已完成点跳过${skippedCompleted}处`)
  if (conflictIds.length) noteParts.push(`双方同改冲突${conflictIds.length}处，保留两版待值班室确认`)
  if (completionIds.length) noteParts.push(`完成上报${completionIds.length}点`)
  if (reviewIds.length) noteParts.push(`现场复核${reviewIds.length}份`)
  if (ownerClaimsKept.length) noteParts.push(`责任人保持原样${ownerClaimsKept.length}项`)
  if (pkg.newTour) noteParts.unshift(`新班次${working.name}已建班`)

  const summary: ImportResultSummary = {
    ok: true,
    duplicated: false,
    packageId: pkg.id,
    tabletId: pkg.tabletId,
    tourId: working.id,
    importedAt,
    appliedEdits,
    skippedCompleted,
    fastForwardEdits,
    conflictIds,
    completionIds,
    reviewIds,
    ownerClaimsApplied,
    ownerClaimsKept,
    note: noteParts.join('，') || '包内无新增变更'
  }

  return { dataset: { ...dataset, tours, anomalies, importLog: [summary, ...dataset.importLog] }, summary }
}

const failureSummary = (pkg: TabletPackage, importedAt: string, note: string): ImportResultSummary => ({
  ok: false,
  duplicated: false,
  packageId: pkg.id,
  tabletId: pkg.tabletId,
  tourId: pkg.tourId,
  importedAt,
  appliedEdits: 0,
  skippedCompleted: 0,
  fastForwardEdits: 0,
  conflictIds: [],
  completionIds: [],
  reviewIds: [],
  ownerClaimsApplied: [],
  ownerClaimsKept: [],
  error: note,
  note
})

/** 值班室对“同一测点两边都改”的冲突二选一裁决；不影响已完成点 */
export const resolveConflict = (
  dataset: TailingsDataset,
  tourId: string,
  conflictIdValue: string,
  choice: 'server' | 'tablet',
  resolvedBy: string,
  resolvedAt = new Date().toISOString()
): TailingsDataset => {
  const tour = getTour(dataset, tourId)
  const conflict = tour?.conflicts.find((item) => item.id === conflictIdValue)
  if (!tour || !conflict || conflict.status === '已确认') return dataset
  const assignment = getAssignment(tour, conflict.pointId)
  if (!assignment) return dataset
  const winner = choice === 'server' ? conflict.server : conflict.tablet
  let working = tour
  if (!isCompleted(working, conflict.pointId) && assignment.current.segmentId !== winner.segmentId) {
    const moved = nextVersion(assignment, {
      segmentId: winner.segmentId,
      basis: winner.basis,
      editedBy: resolvedBy,
      editedAt: resolvedAt,
      reason: `值班室裁决采用${choice === 'server' ? '值班室版本' : `平板${conflict.tabletId}版本`}：${winner.reason}`
    })
    working = { ...working, assignments: working.assignments.map((item) => (item.pointId === conflict.pointId ? { ...item, ...moved, status: '正常' } : item)) }
  } else {
    working = {
      ...working,
      assignments: working.assignments.map((item) => (item.pointId === conflict.pointId ? { ...item, status: '正常' } : item))
    }
  }
  working = {
    ...working,
    conflicts: working.conflicts.map((item) =>
      item.id === conflictIdValue ? { ...item, status: '已确认' as const, resolved: { choice, resolvedBy, resolvedAt } } : item
    )
  }
  return { ...dataset, tours: dataset.tours.map((item) => (item.id === tourId ? working : item)) }
}

// ---------------------------------------------------------------------------
// 覆盖范围：看板、异常详情、审阅包共用同一口径
// ---------------------------------------------------------------------------

export const buildCoverage = (tour: FloodTour): CoverageSummary => {
  const completedIds = new Set(tour.completions.map((item) => item.pointId))
  const assignments = tour.assignments
  const segmentMap = new Map(tour.segments.map((segment) => [segment.id, segment]))

  const bySegment: SegmentCoverage[] = tour.segments.map((segment) => {
    const members = assignments.filter((item) => item.current.segmentId === segment.id)
    const pointIds = members.map((item) => item.pointId)
    return {
      segmentId: segment.id,
      segmentName: segment.name,
      kind: segment.kind,
      total: pointIds.length,
      completed: pointIds.filter((id) => completedIds.has(id)).length,
      pointIds
    }
  })

  const coveredPointIds = assignments.map((item) => item.pointId)
  const detourPending = assignments.filter((item) => !completedIds.has(item.pointId) && item.current.basis === '绕行段').map((item) => item.pointId)
  const detourCompleted = tour.completions.filter((item) => {
    const segment = segmentMap.get(item.segmentId)
    return segment?.kind === '绕行段'
  }).map((item) => item.pointId)

  return {
    tourId: tour.id,
    tourName: tour.name,
    status: tour.status,
    totalPoints: coveredPointIds.length,
    completedPoints: coveredPointIds.filter((id) => completedIds.has(id)).length,
    pendingPoints: coveredPointIds.filter((id) => !completedIds.has(id)).length,
    detourPendingPoints: detourPending.length,
    detourCompletedPoints: detourCompleted.length,
    conflictPointIds: tour.conflicts.filter((item) => item.status === '待值班室确认').map((item) => item.pointId),
    coveredPointIds,
    bySegment: bySegment.filter((segment) => segment.total > 0)
  }
}

/** 看板与审阅包都使用这个选择器，保证同一覆盖范围 */
export const buildAllCoverage = (dataset: TailingsDataset): CoverageSummary[] =>
  dataset.tours.map(buildCoverage)

export const anomalyCoveragePointIds = (dataset: TailingsDataset, anomaly: Anomaly): string[] => {
  const tour = getTour(dataset, anomaly.tourId)
  if (!tour) return []
  // 异常详情展示其所属班次的同一覆盖范围，避免与看板/审阅包口径漂移
  return buildCoverage(tour).coveredPointIds
}

/**
 * 组装审阅包：覆盖范围与看板完全同源；现场复核、责任人等已上传内容原样导出。
 */
export const buildReviewEnvelope = (dataset: TailingsDataset, generatedAt = new Date().toISOString()) => ({
  generatedAt,
  coverage: buildAllCoverage(dataset),
  dataset
})
