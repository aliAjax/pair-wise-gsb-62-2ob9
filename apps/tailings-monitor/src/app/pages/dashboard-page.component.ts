import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { SpatialMapComponent } from '../components/spatial-map.component'
import { selectActiveCoverage, selectActiveTour, selectAnomalies, selectCoverageAll, selectDataset, selectPoints } from '../store/tailings.selectors'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule, SpatialMapComponent],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>监测点</span><strong>{{ pointCount$ | async }}</strong><small>位移、水位、渗流、降雨</small></article>
        <article><span>异常点</span><strong>{{ abnormalCount$ | async }}</strong><small>阈值引擎自动标记</small></article>
        <article><span>待审异常</span><strong>{{ openAnomalyCount$ | async }}</strong><small>未完成处置闭环</small></article>
        <article><span>阈值版本</span><strong>{{ thresholdVersion$ | async }}</strong><small>每次调整独立留痕</small></article>
      </div>
      <app-spatial-map [points]="(points$ | async) ?? []" [tour]="(activeTour$ | async) ?? null" />
      <div class="coverage-band">
        <div><h2>汛期巡检覆盖范围</h2><p>与异常详情、审阅包同一口径；改线只影响未完成点，已完成点不重复派回。</p></div>
        <div class="coverage-grid">
          <article *ngFor="let coverage of coverageAll$ | async">
            <header><b>{{ coverage.tourName }}</b><span [class.open]="coverage.status === '进行中'">{{ coverage.status }}</span></header>
            <div class="bar"><i [style.width.%]="coverage.totalPoints ? (coverage.completedPoints / coverage.totalPoints) * 100 : 0"></i></div>
            <p>{{ coverage.completedPoints }}/{{ coverage.totalPoints }} 点已完成 · 待巡检 {{ coverage.pendingPoints }} · 绕行待接管 {{ coverage.detourPendingPoints }} · 绕行已完成不派回 {{ coverage.detourCompletedPoints }} · 冲突 {{ coverage.conflictPointIds.length }}</p>
            <div class="segments"><span *ngFor="let segment of coverage.bySegment" [class.detour]="segment.kind === '绕行段'">{{ segment.segmentName }} {{ segment.completed }}/{{ segment.total }}</span></div>
          </article>
        </div>
      </div>
      <div class="threshold-band">
        <div><h2>阈值与运行方式</h2><p>报警阈值、变化速率和监测频率按坝体分区执行。</p></div>
        <table mat-table [dataSource]="(dataset$ | async)?.thresholds ?? []">
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
          <ng-container matColumnDef="warning"><th mat-header-cell *matHeaderCellDef>预警</th><td mat-cell *matCellDef="let row">{{ row.warning }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="alarm"><th mat-header-cell *matHeaderCellDef>报警</th><td mat-cell *matCellDef="let row">{{ row.alarm }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="rate"><th mat-header-cell *matHeaderCellDef>变化率</th><td mat-cell *matCellDef="let row">{{ row.changeRate }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="thresholdColumns"></tr><tr mat-row *matRowDef="let row; columns: thresholdColumns"></tr>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 15px; }
    .metrics article { padding: 17px 19px; border-right: 1px solid #e2e8e6; } .metrics article:last-child { border: 0; }
    .metrics span, .metrics strong, .metrics small { display: block; } .metrics span { color: #72807d; font-size: 12px; } .metrics strong { font-size: 27px; color: #245060; margin: 6px 0; } .metrics small { color: #98a4a0; font-size: 10px; }
    .coverage-band, .threshold-band { background: white; border: 1px solid #d9e1df; margin-top: 15px; padding: 16px; }
    .coverage-band h2, .threshold-band h2 { margin: 0 0 5px; font-size: 17px; } .coverage-band p, .threshold-band p { color: #72807d; font-size: 12px; margin: 0 0 12px; }
    .coverage-grid { display: grid; gap: 12px; } .coverage-grid article { border: 1px solid #e2e7e6; padding: 12px; }
    .coverage-grid header { display: flex; justify-content: space-between; align-items: center; } .coverage-grid header span { font-size: 10px; color: #98a4a0; } .coverage-grid header span.open { color: #2e765a; }
    .bar { height: 7px; background: #edf1f0; border-radius: 4px; margin: 8px 0 6px; overflow: hidden; } .bar i { display: block; height: 100%; background: #315d6e; }
    .segments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; } .segments span { font-size: 10px; color: #315d6e; background: #e7eef2; padding: 2px 8px; border-radius: 3px; } .segments span.detour { background: #f8efd9; color: #936d20; }
    table { width: 100%; }
  `]
})
export class DashboardPageComponent {
  private readonly store = inject(Store)
  readonly points$ = this.store.select(selectPoints)
  readonly anomalies$ = this.store.select(selectAnomalies)
  readonly dataset$ = this.store.select(selectDataset)
  readonly activeTour$ = this.store.select(selectActiveTour)
  readonly activeCoverage$ = this.store.select(selectActiveCoverage)
  readonly coverageAll$ = this.store.select(selectCoverageAll)
  readonly pointCount$ = this.points$.pipe(map((points) => points.length))
  readonly abnormalCount$ = this.points$.pipe(map((points) => points.filter((point) => point.status !== '正常').length))
  readonly openAnomalyCount$ = this.anomalies$.pipe(map((items) => items.filter((item) => item.status !== '已关闭').length))
  readonly thresholdVersion$ = this.dataset$.pipe(map((dataset) => dataset.thresholds.reduce((sum, item) => sum + item.version, 0)))
  readonly thresholdColumns = ['type', 'warning', 'alarm', 'rate', 'version']
}
