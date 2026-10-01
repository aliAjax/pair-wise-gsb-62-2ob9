import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { demoTabletPackages } from '../data/tablet-packages'
import type { FloodTour, PointConflict } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectActiveCoverage, selectActiveTour, selectCoverageAll, selectDataset, selectImportLog } from '../store/tailings.selectors'

@Component({
  selector: 'app-inspection-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head">
        <div>
          <h2>汛期巡检路线与离线合并</h2>
          <p>一个测点在一次汛期巡检只归一个路线段；改线只影响未完成点，已上传复核与责任人保持原样。</p>
        </div>
        <button mat-flat-button color="primary" (click)="liftBlockage()">封路解除并按原计划接管</button>
      </div>

      <div class="metrics">
        <article><span>计划测点</span><strong>{{ (coverage$ | async)?.totalPoints ?? 0 }}</strong><small>一次班次归属唯一</small></article>
        <article><span>已完成</span><strong>{{ (coverage$ | async)?.completedPoints ?? 0 }}</strong><small>绕行段完成不派回</small></article>
        <article><span>待巡检</span><strong>{{ (coverage$ | async)?.pendingPoints ?? 0 }}</strong><small>含绕行待接管 {{ (coverage$ | async)?.detourPendingPoints ?? 0 }} 点</small></article>
        <article><span>合并冲突</span><strong>{{ (coverage$ | async)?.conflictPointIds.length ?? 0 }}</strong><small>保留两版待值班室确认</small></article>
      </div>

      <div class="layout">
        <div class="stack">
          <div class="panel">
            <div class="panel-head"><h3>坝顶联络路封路状态</h3><span class="muted">{{ tourName$ | async }}</span></div>
            <table mat-table [dataSource]="(tour$ | async)?.blockages ?? []">
              <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>封闭路段</th><td mat-cell *matCellDef="let row">{{ row.reason }}</td></ng-container>
              <ng-container matColumnDef="startedAt"><th mat-header-cell *matHeaderCellDef>封闭时间</th><td mat-cell *matCellDef="let row">{{ row.startedAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
              <ng-container matColumnDef="liftedAt"><th mat-header-cell *matHeaderCellDef>解除时间</th><td mat-cell *matCellDef="let row"><span [class.done]="row.liftedAt">{{ row.liftedAt ? row.liftedAt.replace('T', ' ').slice(0, 16) : '未解除' }}</span></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="blockageColumns"></tr><tr mat-row *matRowDef="let row; columns: blockageColumns"></tr>
            </table>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>测点归属（每点本班次仅一段）</h3><span class="muted">改线只作用于未完成点</span></div>
            <table mat-table [dataSource]="(tour$ | async)?.assignments ?? []">
              <ng-container matColumnDef="pointId"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let row"><b>{{ row.pointId }}</b><small class="sub">{{ pointName(row.pointId) }}</small></td></ng-container>
              <ng-container matColumnDef="current"><th mat-header-cell *matHeaderCellDef>当前路线段</th><td mat-cell *matCellDef="let row"><span class="seg" [class.detour]="row.current.basis === '绕行段'">{{ segmentName(row.current.segmentId) }}</span><small class="sub">V{{ row.current.version }} · {{ row.current.editedBy }}</small></td></ng-container>
              <ng-container matColumnDef="planned"><th mat-header-cell *matHeaderCellDef>原计划段</th><td mat-cell *matCellDef="let row">{{ segmentName(row.plannedSegmentId) }}</td></ng-container>
              <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><span class="tag" [class.done]="isDone(row.pointId)" [class.conflict]="row.status === '冲突待确认'">{{ isDone(row.pointId) ? '已完成 · ' + completionSegment(row.pointId) : row.status }}</span></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="assignmentColumns"></tr><tr mat-row *matRowDef="let row; columns: assignmentColumns" [class.done-row]="isDone(row.pointId)"></tr>
            </table>
          </div>

          <div class="panel" *ngIf="(tour$ | async) as tour">
            <div class="panel-head"><h3>同点两边都改：保留两版待确认</h3><span class="muted">{{ tour.conflicts.length }} 条冲突记录</span></div>
            <p class="empty" *ngIf="!tour.conflicts.length">暂无离线合并冲突。先导入巡检班长包，再导入值班室另一平板包即可复现。</p>
            <article class="conflict" *ngFor="let conflict of tour.conflicts">
              <header><b>{{ conflict.pointId }} {{ pointName(conflict.pointId) }}</b><span class="tag" [class.conflict]="conflict.status === '待值班室确认'" [class.done]="conflict.status === '已确认'">{{ conflict.status }}</span></header>
              <div class="versions">
                <div class="version-card server">
                  <span>值班室版本 · V{{ conflict.server.version }}</span>
                  <b>{{ segmentName(conflict.server.segmentId) }}</b>
                  <small>{{ conflict.server.reason }} · {{ conflict.server.editedBy }}</small>
                  <button mat-flat-button color="primary" [disabled]="conflict.status === '已确认'" (click)="resolve(conflict, 'server')">采用值班室版本</button>
                </div>
                <div class="version-card tablet">
                  <span>平板 {{ conflict.tabletId }} · V{{ conflict.tablet.version }}</span>
                  <b>{{ segmentName(conflict.tablet.segmentId) }}</b>
                  <small>{{ conflict.tablet.reason }} · {{ conflict.tablet.editedBy }}</small>
                  <button mat-flat-button color="accent" [disabled]="conflict.status === '已确认'" (click)="resolve(conflict, 'tablet')">采用平板版本</button>
                </div>
              </div>
              <p class="resolved" *ngIf="conflict.resolved">已由 {{ conflict.resolved.resolvedBy }} 于 {{ conflict.resolved.resolvedAt.replace('T', ' ').slice(0, 16) }} 裁决</p>
            </article>
          </div>
        </div>

        <div class="side">
          <div class="panel import">
            <div class="panel-head"><h3>离线平板包合并</h3><span class="muted">按包号幂等去重</span></div>
            <button mat-flat-button color="primary" (click)="importPackage('PKG-0929-T1')">导入巡检班长包 T1（改线+完成+复核）</button>
            <button mat-flat-button color="accent" (click)="importPackage('PKG-0929-T2')">导入值班室另一平板 T2（同点改库区线）</button>
            <button mat-button (click)="importPackage('PKG-0929-T1')">再次导入 T1（应全部忽略）</button>
            <button mat-button (click)="importPackage('PKG-0929-T3')">导入失败包 T3（班次不存在）</button>
            <button mat-button (click)="importPackage('PKG-0929-T3')">重试失败包 T3（不得多出班次）</button>
            <button mat-button (click)="importPackage('PKG-0929-T4')">导入 T4（新建夜班）</button>
            <button mat-button (click)="importPackage('PKG-0929-T4')">再次导入 T4（夜班不重复）</button>
            <p class="hint">已完成点与已上传现场复核、异常责任人在任何导入下保持原样；同一点两边都改时不覆盖任何一版。</p>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>本段覆盖范围</h3><span class="muted">与看板、审阅包同一口径</span></div>
            <div class="coverage" *ngFor="let segment of (coverage$ | async)?.bySegment ?? []">
              <span class="seg" [class.detour]="segment.kind === '绕行段'">{{ segment.segmentName }}</span>
              <b>{{ segment.completed }}/{{ segment.total }}</b>
              <small>{{ segment.kind }}</small>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>全部班次覆盖</h3><span class="muted">共 {{ (allCoverage$ | async)?.length ?? 0 }} 个班次</span></div>
            <div class="coverage" *ngFor="let coverage of allCoverage$ | async">
              <span>{{ coverage.tourName }} <small>[{{ coverage.status }}]</small></span>
              <b>{{ coverage.completedPoints }}/{{ coverage.totalPoints }}</b>
            </div>
          </div>

          <div class="panel log">
            <div class="panel-head"><h3>导入日志</h3><span class="muted">失败与重试均留痕</span></div>
            <article *ngFor="let item of importLog$ | async">
              <header><b>{{ item.packageId }}</b><span class="tag" [class.done]="item.ok && !item.duplicated" [class.warn]="item.duplicated" [class.conflict]="!item.ok">{{ item.duplicated ? '重复忽略' : item.ok ? '已导入' : '失败' }}</span></header>
              <p>{{ item.note }}</p>
              <small>{{ item.tabletId }} · {{ item.importedAt.replace('T', ' ').slice(0, 16) }}</small>
            </article>
            <p class="empty" *ngIf="!(importLog$ | async)?.length">尚无导入记录。</p>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .head h2 { margin: 0 0 5px; font-size: 20px; } .head p { margin: 0; color: #72807d; font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }
    .metrics article { padding: 16px 18px; border-right: 1px solid #e2e7e6; } .metrics article:last-child { border: 0; }
    .metrics span, .metrics strong, .metrics small { display: block; } .metrics span { color: #72807d; font-size: 12px; } .metrics strong { font-size: 26px; color: #245060; margin: 6px 0; } .metrics small { color: #98a4a0; font-size: 10px; }
    .layout { display: grid; grid-template-columns: minmax(620px, 1fr) 360px; gap: 14px; align-items: start; }
    .stack { display: grid; gap: 14px; } .side { display: grid; gap: 14px; }
    .panel { background: white; border: 1px solid #d9e1df; padding: 14px; }
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; } .panel-head h3 { margin: 0; font-size: 14px; } .muted { color: #8b9895; font-size: 10px; }
    table { width: 100%; } .sub { display: block; color: #7c8986; font-size: 10px; margin-top: 2px; }
    .seg { display: inline-block; padding: 2px 8px; border-radius: 3px; background: #e7eef2; color: #315d6e; font-size: 11px; } .seg.detour { background: #f8efd9; color: #936d20; }
    .tag { padding: 2px 7px; border-radius: 3px; background: #e7f3ee; color: #2e765a; font-size: 11px; white-space: nowrap; } .tag.done { background: #e7f3ee; color: #2e765a; } .tag.conflict { background: #fae8e6; color: #a43c35; } .tag.warn { background: #f8efd9; color: #936d20; }
    .done-row { opacity: 0.72; } .done-row td { background: #f6f9f8; }
    .conflict { border: 1px solid #ecd2cf; border-left: 3px solid #b84038; padding: 11px; margin-top: 10px; }
    .conflict > header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
    .versions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .version-card { display: grid; gap: 5px; padding: 10px; border: 1px solid #e2e7e6; align-content: start; }
    .version-card span { font-size: 10px; color: #74827f; } .version-card b { font-size: 13px; color: #245060; } .version-card small { color: #8b9895; font-size: 10px; min-height: 28px; }
    .version-card.server { background: #f3f7f9; } .version-card.tablet { background: #fdf8ee; }
    .resolved { margin: 8px 0 0; color: #2e765a; font-size: 11px; }
    .import { display: grid; gap: 8px; } .hint { color: #8b9895; font-size: 10px; margin: 4px 0 0; line-height: 1.6; }
    .coverage { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid #eef2f1; } .coverage:last-child { border: 0; } .coverage b { color: #245060; } .coverage small { color: #93a09d; font-size: 10px; }
    .log article { border-bottom: 1px solid #eef2f1; padding: 8px 0; display: grid; gap: 3px; } .log article header { display: flex; justify-content: space-between; align-items: center; } .log p { margin: 0; font-size: 11px; color: #5f6d6a; } .log small { color: #98a4a0; font-size: 10px; }
    .empty { color: #93a09d; font-size: 11px; margin: 4px 0; }
  `]
})
export class InspectionPageComponent {
  private readonly store = inject(Store)
  readonly tour$ = this.store.select(selectActiveTour)
  readonly coverage$ = this.store.select(selectActiveCoverage)
  readonly allCoverage$ = this.store.select(selectCoverageAll)
  readonly importLog$ = this.store.select(selectImportLog)
  readonly dataset$ = this.store.select(selectDataset)
  readonly tourName$ = this.tour$
  readonly blockageColumns = ['reason', 'startedAt', 'liftedAt']
  readonly assignmentColumns = ['pointId', 'current', 'planned', 'status']

  pointName(id: string): string {
    let name = id
    this.dataset$.subscribe((dataset) => { name = dataset.points.find((point) => point.id === id)?.name ?? id }).unsubscribe()
    return name
  }

  segmentName(id: string): string {
    let name = id
    this.dataset$.subscribe((dataset) => {
      for (const tour of dataset.tours) {
        const segment = tour.segments.find((item) => item.id === id)
        if (segment) { name = segment.name; break }
      }
    }).unsubscribe()
    return name
  }

  isDone(pointId: string): boolean {
    let done = false
    this.tour$.subscribe((tour: FloodTour | undefined) => { done = !!tour?.completions.some((item) => item.pointId === pointId) }).unsubscribe()
    return done
  }

  completionSegment(pointId: string): string {
    let segmentId = ''
    this.tour$.subscribe((tour) => { segmentId = tour?.completions.find((item) => item.pointId === pointId)?.segmentId ?? '' }).unsubscribe()
    return segmentId ? this.segmentName(segmentId) : ''
  }

  importPackage(packageId: string): void {
    const pkg = demoTabletPackages.find((item) => item.id === packageId)
    if (pkg) this.store.dispatch(TailingsActions.importTabletPackage({ pkg: structuredClone(pkg) }))
  }

  resolve(conflict: PointConflict, choice: 'server' | 'tablet'): void {
    this.store.dispatch(TailingsActions.resolveConflict({ tourId: conflict.tourId, conflictId: conflict.id, choice, resolvedBy: '值班负责人 何清' }))
  }

  liftBlockage(): void {
    this.tour$.subscribe((tour) => {
      const blockage = tour?.blockages.find((item) => !item.liftedAt)
      if (tour && blockage) this.store.dispatch(TailingsActions.liftBlockage({ tourId: tour.id, blockageId: blockage.id, operator: '值班负责人 何清' }))
    }).unsubscribe()
  }
}
