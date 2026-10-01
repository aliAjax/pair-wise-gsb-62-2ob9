/* 场景级校验：巡检路线 / 测点归属 / 异常处置 / 离线合并的业务不变量 */
import assert from 'node:assert/strict'
import { seedDataset } from './app/data/seed'
import { demoTabletPackages } from './app/data/tablet-packages'
import type { TailingsDataset, TabletPackage } from './domain'
import { buildCoverage, completePoint, getAssignment, getCompletion, getTour, importTabletPackage, liftBlockage, reassignPoint, resolveConflict } from './app/domain/inspection'

let passed = 0
const check = (name: string, fn: () => void): void => { fn(); passed += 1; console.log(`✓ ${name}`) }

const clone = structuredClone
const findPkg = (id: string): TabletPackage => {
  const pkg = demoTabletPackages.find((item) => item.id === id)
  if (!pkg) throw new Error(`missing package ${id}`)
  return clone(pkg)
}
const dayTourId = 'FT-260929-D'

// 1. 每个测点在一次汛期巡检只归一个路线段
check('每个测点在一次汛期巡检只有一条归属记录', () => {
  const tour = getTour(seedDataset, dayTourId)!
  const ids = tour.assignments.map((item) => item.pointId)
  assert.equal(new Set(ids).size, ids.length)
  tour.assignments.forEach((item) => assert.equal(item.tourId, dayTourId))
  // 不同班次可以再次归属（夜班）
  assert.ok(getTour(seedDataset, dayTourId)!.assignments.every((item) => item.pointId !== 'P-D01' || item.tourId === dayTourId))
})

// 2. 改线只影响尚未完成的点；已完成点保持原归属
check('值班室改线对已完成点无效（含已上传现场复核的D01）', () => {
  const tour = getTour(seedDataset, dayTourId)!
  const before = getAssignment(tour, 'P-D01')!.current.segmentId
  const result = reassignPoint(tour, 'P-D01', 'SG-LAKE', '值班员', '尝试把已完成点调到库区')
  assert.equal(result.applied, false)
  assert.equal(getAssignment(result.tour, 'P-D01')!.current.segmentId, before)
  assert.ok(getCompletion(result.tour, 'P-D01'))
  // 未完成点可以改
  const ok = reassignPoint(tour, 'P-D02', 'SG-LAKE', '值班员', '主坝未完成点改库区段')
  assert.equal(ok.applied, true)
  assert.equal(getAssignment(ok.tour, 'P-D02')!.current.segmentId, 'SG-LAKE')
  assert.equal(getAssignment(ok.tour, 'P-D02')!.history.length, 1)
})

// 3. 导入 T1：改线 + 绕行段新点完成 + 现场复核追加；已完成点跳过；责任人保持原样
check('导入巡检班长包：未完成点改线、已完成点跳过、复核追加、责任人原样', () => {
  const { dataset, summary } = importTabletPackage(clone(seedDataset), findPkg('PKG-0929-T1'))
  const tour = getTour(dataset, dayTourId)!
  assert.equal(summary.appliedEdits, 3, 'D02、S01、W01 三处未完成点改线（编辑先于完成上报处理）')
  assert.equal(summary.skippedCompleted, 0, '编辑阶段 D01 不在包内、S01 尚未完成')
  assert.equal(getAssignment(tour, 'P-D02')!.current.segmentId, 'SG-DETOUR-A')
  assert.equal(getAssignment(tour, 'P-W01')!.current.segmentId, 'SG-DETOUR-A')
  assert.equal(getAssignment(tour, 'P-D01')!.current.segmentId, 'SG-MAIN', 'D01 不被改线')
  // S01 在绕行段完成
  const s01 = getCompletion(tour, 'P-S01')!
  assert.equal(s01.segmentId, 'SG-DETOUR-A')
  // W01 异常追加了离线现场复核（独立版本），已有复核/读数不动
  const w01Anomaly = dataset.anomalies.find((item) => item.id === 'AN-260929-02')!
  assert.ok(w01Anomaly.fieldReviews.some((review) => review.id === 'FR-OFF-1'))
  // 已有责任人“库区调度班”保持原样，离线认领被忽略
  assert.equal(w01Anomaly.owner, '库区调度班')
  assert.deepEqual(summary.ownerClaimsKept, ['AN-260929-02'])
  // D01 异常的已上传复核原样
  const d01Anomaly = dataset.anomalies.find((item) => item.id === 'AN-260929-01')!
  assert.equal(d01Anomaly.fieldReviews[0].id, 'FR-1')
  assert.equal(d01Anomaly.owner, '坝体安全组')
  // 包登记
  assert.deepEqual(tour.importedPackages, ['PKG-0929-T1'])
})

// 4. 同一测点两边都改 → 保留两版待值班室确认，不覆盖
check('另一台平板改过同一点：冲突保留两版，当前归属不被任何一版覆盖', () => {
  let state = clone(seedDataset)
  state = importTabletPackage(state, findPkg('PKG-0929-T1')).dataset
  const { dataset, summary } = importTabletPackage(state, findPkg('PKG-0929-T2'))
  assert.equal(summary.conflictIds.length, 1)
  const tour = getTour(dataset, dayTourId)!
  const conflict = tour.conflicts[0]
  assert.equal(conflict.pointId, 'P-W01')
  assert.equal(conflict.status, '待值班室确认')
  assert.equal(conflict.server.segmentId, 'SG-DETOUR-A')
  assert.equal(conflict.tablet.segmentId, 'SG-DETOUR-B')
  const assignment = getAssignment(tour, 'P-W01')!
  assert.equal(assignment.status, '冲突待确认')
  assert.equal(assignment.current.segmentId, 'SG-DETOUR-A', '值班室当前版本不被平板覆盖')
  // 值班室裁决采用平板版本
  const resolved = resolveConflict(dataset, dayTourId, conflict.id, 'tablet', '何清')
  const resolvedTour = getTour(resolved, dayTourId)!
  assert.equal(getAssignment(resolvedTour, 'P-W01')!.current.segmentId, 'SG-DETOUR-B')
  assert.equal(resolvedTour.conflicts[0].status, '已确认')
  assert.equal(getAssignment(resolvedTour, 'P-W01')!.status, '正常')
  // 两版都还在
  assert.equal(resolvedTour.conflicts[0].server.segmentId, 'SG-DETOUR-A')
})

// 5. 导入失败后重试同一平板包不能多出班次
check('失败包重试不新增班次；失败也不登记幂等键', () => {
  let state = clone(seedDataset)
  const toursBefore = state.tours.length
  const r1 = importTabletPackage(state, findPkg('PKG-0929-T3'))
  assert.equal(r1.summary.ok, false)
  assert.equal(r1.dataset.tours.length, toursBefore)
  state = r1.dataset
  const r2 = importTabletPackage(state, findPkg('PKG-0929-T3'))
  assert.equal(r2.summary.ok, false)
  assert.equal(r2.dataset.tours.length, toursBefore, '重试同一失败包不得多出班次')
  assert.equal(r2.dataset.importLog.filter((log) => log.packageId === 'PKG-0929-T3').length, 2, '两次失败均留痕')
})

// 6. 成功包重试完全幂等：不新增班次/归属版本/完成/复核
check('成功导入的包重试幂等：无新班次、新版本、新完成、新复核', () => {
  let state = importTabletPackage(clone(seedDataset), findPkg('PKG-0929-T1')).dataset
  const snapshot = clone(state)
  const { dataset: retried, summary } = importTabletPackage(state, findPkg('PKG-0929-T1'))
  assert.equal(summary.duplicated, true)
  const tour1 = getTour(snapshot, dayTourId)!
  const tour2 = getTour(retried, dayTourId)!
  assert.equal(tour2.assignments.length, tour1.assignments.length)
  tour2.assignments.forEach((item, i) => assert.equal(item.current.version, tour1.assignments[i].current.version))
  assert.equal(tour2.completions.length, tour1.completions.length)
  assert.equal(tour2.importedPackages.length, tour1.importedPackages.length, '包登记不重复')
  const anomaly = retried.anomalies.find((item) => item.id === 'AN-260929-02')!
  assert.equal(anomaly.fieldReviews.length, snapshot.anomalies.find((item) => item.id === 'AN-260929-02')!.fieldReviews.length)
})

// 7. 新班次包：首次建班，重试不重复
check('现场新班次包首次导入建班、再次导入不重复建班', () => {
  let state = clone(seedDataset)
  state = importTabletPackage(state, findPkg('PKG-0929-T4')).dataset
  assert.ok(getTour(state, 'FT-260929-N'), '夜班已建立')
  const toursAfterFirst = state.tours.length
  state = importTabletPackage(state, findPkg('PKG-0929-T4')).dataset
  assert.equal(state.tours.length, toursAfterFirst)
  const night = getTour(state, 'FT-260929-N')!
  assert.deepEqual(night.importedPackages, ['PKG-0929-T4'])
  // 同一测点在不同班次各有一条归属
  assert.ok(getAssignment(night, 'P-D01'))
  assert.ok(getAssignment(getTour(state, dayTourId)!, 'P-D01'))
})

// 8. 封路解除：绕行未完成点按原计划接管；绕行段已完成点不派回
check('封路解除接管：未完成绕行点回原计划段，绕行段已完成点不派回', () => {
  let state = clone(seedDataset)
  state = importTabletPackage(state, findPkg('PKG-0929-T1')).dataset
  const tour = getTour(state, dayTourId)!
  // 接管前：D02 绕行未完成、S01 绕行已完成、D01 计划段已完成
  assert.equal(getAssignment(tour, 'P-D02')!.current.basis, '绕行段')
  assert.equal(getAssignment(tour, 'P-S01')!.current.basis, '绕行段')
  assert.ok(getCompletion(tour, 'P-S01'))
  const lifted = liftBlockage(state, dayTourId, 'BLK-1')
  const after = getTour(lifted, dayTourId)!
  assert.equal(getAssignment(after, 'P-D02')!.current.segmentId, 'SG-MAIN', '未完成绕行点接管回主坝段')
  assert.equal(getAssignment(after, 'P-W01')!.current.segmentId, 'SG-LAKE', 'W01 接管回原计划库区段')
  assert.equal(getAssignment(after, 'P-S01')!.current.segmentId, 'SG-DETOUR-A', '绕行段已完成点不派回原路线')
  assert.ok(getCompletion(after, 'P-S01'))
  assert.equal(getAssignment(after, 'P-D01')!.current.segmentId, 'SG-MAIN')
  assert.ok(after.blockages[0].liftedAt.length > 0)
})

// 9. 完成记录幂等，且一次班次每点仅一条完成
check('同一测点重复完成上报幂等', () => {
  const tour = getTour(seedDataset, dayTourId)!
  const r1 = completePoint(tour, 'P-D02', '高鹏', '第一次')
  assert.equal(r1.duplicated, false)
  const r2 = completePoint(r1.tour, 'P-D02', '高鹏', '第二次')
  assert.equal(r2.duplicated, true)
  assert.equal(r2.tour.completions.filter((item) => item.pointId === 'P-D02').length, 1)
})

// 10. 看板、异常详情、审阅包同一覆盖范围
check('覆盖范围三处同源，绕行接管后口径一致且完成点不重复', () => {
  let state = clone(seedDataset)
  state = importTabletPackage(state, findPkg('PKG-0929-T1')).dataset
  state = liftBlockage(state, dayTourId, 'BLK-1')
  const tour = getTour(state, dayTourId)!
  const coverage = buildCoverage(tour)
  assert.deepEqual(coverage.coveredPointIds.sort(), ['P-D01', 'P-D02', 'P-R01', 'P-S01', 'P-W01'])
  assert.equal(coverage.totalPoints, 5)
  assert.equal(coverage.completedPoints, 2, 'D01 + S01')
  assert.equal(coverage.pendingPoints, 3)
  assert.equal(coverage.detourCompletedPoints, 1, 'S01 在绕行段完成')
  assert.equal(coverage.detourPendingPoints, 0, '接管后无绕行待巡检点')
  // 分段计数之和等于总数
  assert.equal(coverage.bySegment.reduce((sum, item) => sum + item.total, 0), 5)
  // S01 完成在绕行段，归属保留在绕行段（不派回）；主坝段为 D01、D02
  const main = coverage.bySegment.find((item) => item.segmentId === 'SG-MAIN')!
  const detour = coverage.bySegment.find((item) => item.segmentId === 'SG-DETOUR-A')!
  assert.deepEqual(main.pointIds, ['P-D01', 'P-D02'])
  assert.deepEqual(detour.pointIds, ['P-S01'])
})

console.log(`\n${passed} 项校验全部通过`)
