import type {
  AssignmentConflict,
  AssignmentConflictChoice,
  InspectionAssignment,
  InspectionCoverage,
  OfflineSyncPackage,
  RouteSegment,
  TailingsDataset
} from './models'

let auditSequence = 100

const timestamp = (): string => new Date().toISOString()

const makeAudit = (entityId: string, action: string, operator: string, detail: string, createdAt = timestamp()) => ({
  id: `AUD-${Date.now()}-${auditSequence++}`,
  entityId,
  action,
  operator,
  detail,
  createdAt
})

// The seed uses stable route IDs; keep the closure policy explicit and versioned here.
const closureRouteMap: Record<string, string> = {
  'RS-MAIN': 'RS-MAIN-BYPASS',
  'RS-LAKE': 'RS-LAKE-BYPASS'
}

export function findActiveShift(dataset: TailingsDataset) {
  return dataset.inspection.shifts.find((shift) => shift.status === '进行中') ?? dataset.inspection.shifts[0]
}

export function buildInspectionCoverage(dataset: TailingsDataset, shiftId = findActiveShift(dataset)?.id ?? ''): InspectionCoverage {
  const shift = dataset.inspection.shifts.find((item) => item.id === shiftId)
  const assignments = dataset.inspection.assignments.filter((item) => item.shiftId === shiftId)
  const usedSegments = new Set(assignments.map((item) => item.segmentId))
  const completedPoints = assignments.filter((item) => item.status === '已完成').length

  return {
    shiftId,
    shiftName: shift?.name ?? shiftId,
    totalPoints: dataset.points.length,
    completedPoints,
    pendingPoints: Math.max(dataset.points.length - completedPoints, 0),
    coverageRate: dataset.points.length ? Math.round((completedPoints / dataset.points.length) * 1000) / 10 : 0,
    uniqueAssignments: new Set(assignments.map((item) => `${item.shiftId}:${item.pointId}`)).size,
    originalSegments: dataset.inspection.segments.filter((segment) => segment.kind === '原计划' && usedSegments.has(segment.id)).length,
    detourSegments: dataset.inspection.segments.filter((segment) => segment.kind === '绕行' && usedSegments.has(segment.id)).length,
    pendingConflicts: dataset.inspection.conflicts.filter((item) => item.shiftId === shiftId && item.status === '待值班室确认').length
  }
}

export function validateInspectionInvariants(dataset: TailingsDataset, shiftId: string) {
  const assignments = dataset.inspection.assignments.filter((assignment) => assignment.shiftId === shiftId)
  const pointIds = new Set(dataset.points.map((point) => point.id))
  const assignmentKeys = new Set(assignments.map((assignment) => `${assignment.shiftId}:${assignment.pointId}`))
  const segmentIds = new Set(dataset.inspection.segments.map((segment) => segment.id))

  if (assignments.length !== pointIds.size || assignmentKeys.size !== pointIds.size) {
    throw new Error('每个测点在一次汛期巡检中只能归一个路线段')
  }
  if (assignments.some((assignment) => !pointIds.has(assignment.pointId) || !segmentIds.has(assignment.segmentId) || !segmentIds.has(assignment.originalSegmentId))) {
    throw new Error('巡检分配引用了不存在的测点或路线段')
  }
}

export function applyDamTopClosure(dataset: TailingsDataset, shiftId: string, operator: string, at = timestamp()) {
  const inspection = dataset.inspection
  const shift = inspection.shifts.find((item) => item.id === shiftId)
  if (!shift) throw new Error('巡检班次不存在')

  const audits = [makeAudit(shiftId, '暴雨封路改线', operator, '坝顶联络路封闭；仅调整尚未完成的主坝、库区测点。', at)]
  shift.damTopRoadClosed = true
  shift.routeRevision += 1

  inspection.assignments
    .filter((assignment) => assignment.shiftId === shiftId && assignment.status === '待巡检')
    .forEach((assignment) => {
      const targetSegmentId = closureRouteMap[assignment.originalSegmentId]
      const targetSegment = targetSegmentId ? inspection.segments.find((segment) => segment.id === targetSegmentId) : undefined
      if (!targetSegment || assignment.segmentId === targetSegment.id) return
      assignment.segmentId = targetSegment.id
      assignment.revision += 1
      assignment.changedBy = operator
      assignment.changedAt = at
      targetSegment.active = true
      audits.push(makeAudit(assignment.pointId, '改至绕行段', operator, `${assignment.id} 改至「${targetSegment.name}」；已完成点和现场记录不回改。`, at))
    })

  validateInspectionInvariants(dataset, shiftId)
  return audits
}

export function restoreDamTopRoad(dataset: TailingsDataset, shiftId: string, operator: string, at = timestamp()) {
  const inspection = dataset.inspection
  const shift = inspection.shifts.find((item) => item.id === shiftId)
  if (!shift) throw new Error('巡检班次不存在')

  shift.damTopRoadClosed = false
  shift.routeRevision += 1
  const audits = [makeAudit(shiftId, '封路解除恢复原线', operator, '未完成绕行点恢复至原计划路线；已完成点保留在实际完成路段。', at)]

  inspection.assignments
    .filter((assignment) => assignment.shiftId === shiftId)
    .forEach((assignment) => {
      const currentSegment = inspection.segments.find((segment) => segment.id === assignment.segmentId)
      if (currentSegment?.kind !== '绕行') return

      if (assignment.status === '已完成') {
        audits.push(makeAudit(assignment.pointId, '保留绕行完成记录', operator, '该点已在绕行段完成，不重复派回原路线，也不改变异常责任人和现场复核。', at))
        return
      }

      const originalSegment = inspection.segments.find((segment) => segment.id === assignment.originalSegmentId)
      if (!originalSegment || assignment.segmentId === originalSegment.id) return
      assignment.segmentId = originalSegment.id
      assignment.revision += 1
      assignment.changedBy = operator
      assignment.changedAt = at
      originalSegment.active = true
      audits.push(makeAudit(assignment.pointId, '恢复原计划段', operator, `${assignment.id} 恢复至「${originalSegment.name}」。`, at))
    })

  inspection.conflicts
    .filter((conflict) => conflict.shiftId === shiftId && conflict.status === '待值班室确认')
    .forEach((conflict) => {
      const assignment = inspection.assignments.find((item) => item.shiftId === conflict.shiftId && item.pointId === conflict.pointId)
      if (assignment) conflict.localSegmentId = assignment.originalSegmentId
    })

  inspection.segments.forEach((segment) => {
    if (segment.kind === '绕行') segment.active = false
  })

  validateInspectionInvariants(dataset, shiftId)
  return audits
}

export function importOfflinePackage(dataset: TailingsDataset, incoming: OfflineSyncPackage, at = timestamp()) {
  const inspection = dataset.inspection
  if (!incoming.id || !incoming.shiftId || !incoming.tabletId || !incoming.edits.length) throw new Error('离线包缺少班次、平板或改线内容')
  const shift = inspection.shifts.find((item) => item.id === incoming.shiftId && item.status === '进行中')
  if (!shift) throw new Error('离线包对应班次不存在；不会新建班次')
  if (inspection.packages.some((item) => item.id === incoming.id)) return []

  const editedPointIds = incoming.edits.map((edit) => edit.pointId)
  if (new Set(editedPointIds).size !== editedPointIds.length) throw new Error('同一离线包内存在重复测点改线')

  const work = structuredClone(inspection)
  const workShift = work.shifts.find((item) => item.id === incoming.shiftId)!
  const audits = [makeAudit(incoming.id, '导入离线平板包', `${incoming.tabletId}/${incoming.operator}`, `基线版本 R${incoming.baseRevision}，按包ID幂等处理。`, at)]
  let acceptedChange = false

  incoming.edits.forEach((edit) => {
    const assignment = work.assignments.find((item) => item.shiftId === incoming.shiftId && item.pointId === edit.pointId)
    const targetSegment = work.segments.find((segment) => segment.id === edit.segmentId)
    if (!assignment) throw new Error(`测点 ${edit.pointId} 不在当前汛期巡检班次`)
    if (!targetSegment) throw new Error(`路线段 ${edit.segmentId} 不存在`)
    if (edit.baseRevision > assignment.revision) throw new Error(`测点 ${edit.pointId} 的离线基线版本无法识别`)
    if (incoming.baseRouteRevision > workShift.routeRevision) throw new Error(`离线包 ${incoming.id} 的路线版本无法识别`)
    if (edit.baseSegmentId && edit.baseSegmentId !== assignment.segmentId && edit.baseSegmentId !== assignment.originalSegmentId) {
      throw new Error(`测点 ${edit.pointId} 的离线基线路线无法识别`)
    }
    if (work.conflicts.some((conflict) => conflict.pointId === edit.pointId && conflict.status === '待值班室确认')) {
      throw new Error(`测点 ${edit.pointId} 已有待值班室确认的两版路线`)
    }

    if (assignment.status === '已完成') {
      audits.push(makeAudit(edit.pointId, '跳过已完成点改线', incoming.operator, '该点已完成；现场复核、异常责任人和原始记录保持原样。', at))
      return
    }

    if (assignment.segmentId === targetSegment.id) {
      audits.push(makeAudit(edit.pointId, '离线改线结果一致', incoming.operator, '值班室与平板改到同一路线段，不产生重复版本。', at))
      return
    }

    const basedOnCurrentAssignment = incoming.baseRouteRevision === workShift.routeRevision && edit.baseRevision === assignment.revision && (!edit.baseSegmentId || edit.baseSegmentId === assignment.segmentId)
    if (basedOnCurrentAssignment) {
      assignment.segmentId = targetSegment.id
      assignment.revision += 1
      assignment.changedBy = `${incoming.tabletId}/${incoming.operator}`
      assignment.changedAt = at
      targetSegment.active = true
      acceptedChange = true
      audits.push(makeAudit(edit.pointId, '接受离线改线', incoming.operator, `改至「${targetSegment.name}」，测点仍只属于一个路线段。`, at))
      return
    }

    const conflict: AssignmentConflict = {
      id: `CF-${incoming.id}-${edit.pointId}`,
      shiftId: incoming.shiftId,
      pointId: edit.pointId,
      localSegmentId: assignment.segmentId,
      incomingSegmentId: targetSegment.id,
      incomingPackageId: incoming.id,
      incomingTabletId: incoming.tabletId,
      status: '待值班室确认',
      resolvedSegmentId: '',
      resolvedBy: '',
      resolvedAt: '',
      createdAt: at
    }
    work.conflicts.unshift(conflict)
    audits.push(makeAudit(edit.pointId, '离线改线冲突待确认', '系统', `值班室版本「${segmentName(work.segments, assignment.segmentId)}」与${incoming.tabletId}版本「${targetSegment.name}」同时保留。`, at))
  })

  if (acceptedChange) workShift.routeRevision += 1
  validateInspectionInvariants({ ...dataset, inspection: work }, incoming.shiftId)
  work.packages.push({ ...incoming, importedAt: at })
  workShift.lastPackageId = incoming.id
  dataset.inspection = work
  return audits
}

export function resolveAssignmentConflict(dataset: TailingsDataset, conflictId: string, choice: AssignmentConflictChoice, operator: string, at = timestamp()) {
  const inspection = dataset.inspection
  const conflict = inspection.conflicts.find((item) => item.id === conflictId && item.status === '待值班室确认')
  if (!conflict) throw new Error('待确认冲突不存在或已处理')

  const assignment = inspection.assignments.find((item) => item.shiftId === conflict.shiftId && item.pointId === conflict.pointId)
  if (!assignment) throw new Error('冲突测点的当班分配不存在')

  const selectedSegmentId = choice === '现场版' ? conflict.localSegmentId : conflict.incomingSegmentId
  const selectedSegment = inspection.segments.find((segment) => segment.id === selectedSegmentId)
  if (!selectedSegment) throw new Error('确认的路线段不存在')

  conflict.status = '已确认'
  conflict.resolvedSegmentId = selectedSegment.id
  conflict.resolvedBy = operator
  conflict.resolvedAt = at

  if (assignment.status === '已完成') {
    return [makeAudit(conflict.pointId, '确认冲突但不改完成记录', operator, `选择「${selectedSegment.name}」；该点已完成，不重复派工也不回改现场复核。`, at)]
  }

  assignment.segmentId = selectedSegment.id
  assignment.revision += 1
  assignment.changedBy = operator
  assignment.changedAt = at
  selectedSegment.active = true
  const shift = inspection.shifts.find((item) => item.id === conflict.shiftId)
  if (shift) shift.routeRevision += 1
  validateInspectionInvariants(dataset, conflict.shiftId)

  return [makeAudit(conflict.pointId, '值班室确认路线版本', operator, `采用${choice}：${selectedSegment.name}。同一汛期巡检中该测点仅保留这一条有效归属。`, at)]
}

function segmentName(segments: RouteSegment[], segmentId: string) {
  return segments.find((segment) => segment.id === segmentId)?.name ?? segmentId
}

export function joinAssignmentRows(dataset: TailingsDataset) {
  const shift = findActiveShift(dataset)
  const segmentById = new Map(dataset.inspection.segments.map((segment) => [segment.id, segment]))
  const pointById = new Map(dataset.points.map((point) => [point.id, point]))
  const conflictByPoint = new Map(
    dataset.inspection.conflicts
      .filter((conflict) => conflict.status === '待值班室确认')
      .map((conflict) => [conflict.pointId, conflict])
  )

  return dataset.inspection.assignments
    .filter((assignment) => assignment.shiftId === shift?.id)
    .map((assignment: InspectionAssignment) => ({
      assignment,
      point: pointById.get(assignment.pointId),
      segment: segmentById.get(assignment.segmentId),
      originalSegment: segmentById.get(assignment.originalSegmentId),
      conflict: conflictByPoint.get(assignment.pointId)
    }))
    .sort((a, b) => (a.segment?.order ?? 0) - (b.segment?.order ?? 0) || a.assignment.pointId.localeCompare(b.assignment.pointId))
}
