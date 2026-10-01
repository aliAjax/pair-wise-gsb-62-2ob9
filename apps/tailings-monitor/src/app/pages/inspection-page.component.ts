import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { AssignmentConflict, AssignmentConflictChoice, OfflineSyncPackage, RouteSegment } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import {
  selectActiveShift,
  selectAssignmentRows,
  selectDataset,
  selectImportedPackages,
  selectInspection,
  selectInspectionCoverage,
  selectInspectionError,
  selectPendingConflicts
} from '../store/tailings.selectors'

@Component({
  selector: 'app-inspection-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head panel">
        <div>
          <span>{{ (shift$ | async)?.id }} · 路线版本 R{{ (shift$ | async)?.routeRevision }}</span>
          <h2>{{ (shift$ | async)?.name }}</h2>
          <p>一个测点在一次汛期巡检内只有一个有效路线段；现场复核、异常责任人和已上传记录不随改线覆盖。</p>
        </div>
        <div class="actions">
          <button mat-flat-button color="primary" [disabled]="(shift$ | async)?.damTopRoadClosed" (click)="closeDamTopRoad()">暴雨封闭坝顶联络路</button>
          <button mat-stroked-button [disabled]="!(shift$ | async)?.damTopRoadClosed" (click)="reopenDamTopRoad()">封路解除，未完成点接管原计划</button>
          <button mat-stroked-button (click)="importFailedPackage()">模拟首次导入失败</button>
          <button mat-stroked-button color="primary" (click)="retryPackage()">重试同一平板包</button>
        </div>
      </div>

      <div class="warning panel" *ngIf="error$ | async as error">
        <b>导入未生效（事务已回滚）</b>
        <span>{{ error }}</span>
        <button mat-button (click)="clearError()">知道了</button>
      </div>

      <div class="metrics">
        <article><span>测点数/有效归属</span><strong>{{ (coverage$ | async)?.uniqueAssignments ?? 0 }}/{{ (coverage$ | async)?.totalPoints ?? 0 }}</strong><small>不得一条点同时派两段</small></article>
        <article><span>当班覆盖</span><strong>{{ (coverage$ | async)?.coverageRate }}%</strong><small>{{ (coverage$ | async)?.completedPoints }} 完成，{{ (coverage$ | async)?.pendingPoints }} 待巡检</small></article>
        <article><span>封路状态</span><strong>{{ (shift$ | async)?.damTopRoadClosed ? '封闭绕行' : '原线通行' }}</strong><small>改线只作用待巡检点</small></article>
        <article><span>待确认冲突</span><strong>{{ (coverage$ | async)?.pendingConflicts }}</strong><small>两版路线均保留</small></article>
      </div>

      <div class="split">
        <div class="panel">
          <h3>测点—路线段—异常处置衔接</h3>
          <table mat-table [dataSource]="rows$ | async">
            <ng-container matColumnDef="point"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let row"><b>{{ row.point?.name ?? row.assignment.pointId }}</b><small>{{ row.assignment.pointId }} · {{ row.point?.status }}</small></td></ng-container>
            <ng-container matColumnDef="segment"><th mat-header-cell *matHeaderCellDef>当前路线段</th><td mat-cell *matCellDef="let row"><span class="route" [class.detour]="row.segment?.kind === '绕行'">{{ row.segment?.name }}</span><small *ngIf="row.segment?.id !== row.originalSegment?.id">原计划：{{ row.originalSegment?.name }}</small></td></ng-container>
            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>巡检状态</th><td mat-cell *matCellDef="let row"><b [class.done]="row.assignment.status === '已完成'">{{ row.assignment.status }}</b><small>R{{ row.assignment.revision }} · {{ row.assignment.changedBy }}</small></td></ng-container>
            <ng-container matColumnDef="anomaly"><th mat-header-cell *matHeaderCellDef>异常衔接</th><td mat-cell *matCellDef="let row">{{ anomalyText(row.assignment.pointId) }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="assignmentColumns"></tr><tr mat-row *matRowDef="let row; columns: assignmentColumns" [class.completed]="row.assignment.status === '已完成'"></tr>
          </table>
        </div>

        <aside>
          <div class="panel conflicts" *ngIf="(conflicts$ | async)?.length; else noConflicts">
            <h3>离线双版本待值班室确认</h3>
            <article *ngFor="let conflict of conflicts$ | async">
              <b>{{ conflict.pointId }}</b>
              <p><span>值班室/现场版</span>{{ segmentName(conflict.localSegmentId) }}</p>
              <p><span>{{ conflict.incomingTabletId }}导入版</span>{{ segmentName(conflict.incomingSegmentId) }}</p>
              <div class="conflict-actions">
                <button mat-button color="primary" (click)="resolve(conflict, '现场版')">保留现场版</button>
                <button mat-button (click)="resolve(conflict, '导入版')">采用导入版</button>
              </div>
            </article>
          </div>
          <ng-template #noConflicts><div class="panel conflicts empty"><h3>离线合并</h3><p>暂无同一测点双方修改；一旦两边都改，将保留两版等待确认。</p></div></ng-template>

          <div class="panel packages">
            <h3>已导入平板包（幂等记录）</h3>
            <article *ngFor="let item of packages$ | async">
              <b>{{ item.id }}</b><span>{{ item.tabletId }} · {{ item.operator }}</span>
              <small>导入：{{ item.importedAt.replace('T', ' ').slice(0, 16) }} · {{ item.edits.length }}个改线点</small>
            </article>
            <p>同一包ID重试只返回成功，不新增班次、不重复改线。</p>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.panel { background: white; border: 1px solid #d9e1df; }.head { padding: 17px; display: flex; justify-content: space-between; gap: 18px; align-items: center; }.head span { color: #758380; font-size: 10px; }.head h2 { margin: 4px 0; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }.actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; max-width: 520px; }
    .warning { margin-top: 12px; padding: 12px 14px; border-color: #d79a2e; background: #fdf4df; display: flex; align-items: center; gap: 12px; }.warning span { color: #76541c; font-size: 12px; }.warning button { margin-left: auto; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); margin: 14px 0; }.metrics article { background: white; border: 1px solid #d9e1df; padding: 15px 17px; margin-right: 10px; }.metrics article:last-child { margin-right: 0; }.metrics span, .metrics strong, .metrics small { display: block; }.metrics span { color: #72807d; font-size: 11px; }.metrics strong { color: #245060; font-size: 22px; margin: 5px 0; }.metrics small { color: #98a4a0; font-size: 10px; }
    .split { display: grid; grid-template-columns: minmax(650px, 1fr) 360px; gap: 14px; align-items: start; }.panel h3 { margin: 0; padding: 14px 14px 10px; font-size: 15px; }table { width: 100%; }td { font-size: 12px; }td small, .packages small { display: block; color: #82908c; font-size: 10px; margin-top: 3px; }.route { color: #245060; font-weight: 600; }.route.detour { color: #b76425; }.done { color: #2e765a; }.completed { background: #f6faf8; }
    .conflicts { margin-bottom: 14px; }.conflicts article { border-top: 1px solid #e2e7e6; padding: 12px 14px; }.conflicts p { margin: 6px 0; font-size: 12px; display: flex; justify-content: space-between; gap: 10px; }.conflicts p span { color: #7a8784; }.conflict-actions { display: flex; justify-content: flex-end; gap: 6px; }.empty p { padding: 0 14px 14px; color: #7a8784; font-size: 12px; margin: 0; }
    .packages article { border-top: 1px solid #e2e7e6; padding: 10px 14px; }.packages b, .packages span { display: block; }.packages span { color: #72807d; font-size: 11px; }.packages > p { padding: 0 14px 14px; color: #8b9894; font-size: 10px; margin: 8px 0 0; }
  `]
})
export class InspectionPageComponent {
  private readonly store = inject(Store)
  readonly shift$ = this.store.select(selectActiveShift)
  readonly rows$ = this.store.select(selectAssignmentRows)
  readonly conflicts$ = this.store.select(selectPendingConflicts)
  readonly packages$ = this.store.select(selectImportedPackages)
  readonly coverage$ = this.store.select(selectInspectionCoverage)
  readonly error$ = this.store.select(selectInspectionError)
  private readonly dataset$ = this.store.select(selectDataset)
  private readonly inspection$ = this.store.select(selectInspection)
  readonly assignmentColumns = ['point', 'segment', 'status', 'anomaly']

  private readonly failedOfflinePackage: OfflineSyncPackage = {
    id: 'PKG-261001-B',
    shiftId: 'SH-261001',
    tabletId: 'TABLET-B',
    operator: '值班室联络员',
    baseRevision: 2,
    baseRouteRevision: 1,
    exportedAt: '2026-10-01T09:05:00',
    importedAt: '',
    edits: [{ pointId: 'P-W01', segmentId: 'RS-MISSING', baseSegmentId: 'RS-LAKE-BYPASS', baseRevision: 2 }]
  }

  private readonly retriedOfflinePackage: OfflineSyncPackage = {
    ...this.failedOfflinePackage,
    edits: [{ pointId: 'P-W01', segmentId: 'RS-EMERGENCY', baseSegmentId: 'RS-LAKE-BYPASS', baseRevision: 2 }]
  }

  closeDamTopRoad(): void {
    this.store.dispatch(TailingsActions.applyDamTopClosure({ shiftId: 'SH-261001', operator: '巡检班长（TABLET-A）' }))
  }

  reopenDamTopRoad(): void {
    this.store.dispatch(TailingsActions.restoreDamTopRoad({ shiftId: 'SH-261001', operator: '值班室负责人' }))
  }

  importFailedPackage(): void {
    this.store.dispatch(TailingsActions.importOfflinePackage({ syncPackage: structuredClone(this.failedOfflinePackage) }))
  }

  retryPackage(): void {
    this.store.dispatch(TailingsActions.importOfflinePackage({ syncPackage: structuredClone(this.retriedOfflinePackage) }))
  }

  resolve(conflict: AssignmentConflict, choice: AssignmentConflictChoice): void {
    this.store.dispatch(TailingsActions.resolveAssignmentConflict({ conflictId: conflict.id, choice, operator: '值班室负责人' }))
  }

  clearError(): void {
    this.store.dispatch(TailingsActions.clearInspectionError())
  }

  segmentName(segmentId: string): string {
    let name = segmentId
    this.inspection$.subscribe((inspection) => {
      name = inspection.segments.find((segment: RouteSegment) => segment.id === segmentId)?.name ?? segmentId
    }).unsubscribe()
    return name
  }

  anomalyText(pointId: string): string {
    let text = '无未关闭异常；路线调整不改变测点归属'
    this.dataset$.subscribe((dataset) => {
      const anomaly = dataset.anomalies.find((item) => item.pointId === pointId && item.status !== '已关闭')
      text = anomaly ? `${anomaly.id} · ${anomaly.status} · 责任人 ${anomaly.owner}` : '无未关闭异常；现场记录原样保留'
    }).unsubscribe()
    return text
  }
}
