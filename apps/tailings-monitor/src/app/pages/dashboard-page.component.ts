import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { SpatialMapComponent } from '../components/spatial-map.component'
import { selectAnomalies, selectDataset, selectInspection, selectInspectionCoverage, selectPoints } from '../store/tailings.selectors'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule, SpatialMapComponent],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>监测点</span><strong>{{ pointCount$ | async }}</strong><small>位移、水位、渗流、降雨</small></article>
        <article><span>异常点</span><strong>{{ abnormalCount$ | async }}</strong><small>阈值引擎自动标记</small></article>
        <article><span>当班覆盖</span><strong>{{ (coverage$ | async)?.coverageRate ?? 0 }}%</strong><small>{{ (coverage$ | async)?.completedPoints ?? 0 }}/{{ (coverage$ | async)?.totalPoints ?? 0 }} 已完成 · 每点一段</small></article>
        <article><span>待确认双版本</span><strong>{{ (coverage$ | async)?.pendingConflicts ?? 0 }}</strong><small>路线冲突需值班室确认</small></article>
      </div>
      <app-spatial-map
        [points]="(points$ | async) ?? []"
        [assignments]="(inspection$ | async)?.assignments ?? []"
        [segments]="(inspection$ | async)?.segments ?? []" />
      <div class="threshold-band">
        <div class="band-head"><div><h2>同一覆盖范围</h2><p>看板、异常详情和审阅包均读取本次汛期巡检的唯一路线归属；封路只改未完成点。</p></div><b>{{ (coverage$ | async)?.shiftName }}</b></div>
        <div class="coverage-grid">
          <article><span>有效归属</span><strong>{{ (coverage$ | async)?.uniqueAssignments ?? 0 }}</strong><small>与测点数一致</small></article>
          <article><span>待巡检</span><strong>{{ (coverage$ | async)?.pendingPoints ?? 0 }}</strong><small>改线作用范围</small></article>
          <article><span>原计划段</span><strong>{{ (coverage$ | async)?.originalSegments ?? 0 }}</strong><small>当前使用</small></article>
          <article><span>绕行段</span><strong>{{ (coverage$ | async)?.detourSegments ?? 0 }}</strong><small>封路临时使用</small></article>
        </div>
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
    .threshold-band { background: white; border: 1px solid #d9e1df; margin-top: 15px; padding: 16px; } .threshold-band h2 { margin: 0 0 5px; font-size: 17px; } .threshold-band p { color: #72807d; font-size: 12px; margin: 0 0 12px; } table { width: 100%; }
    .band-head { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }.band-head b { color: #245060; font-size: 12px; }.coverage-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #e2e7e6; margin-bottom: 14px; }.coverage-grid article { padding: 12px; border-right: 1px solid #e2e7e6; }.coverage-grid article:last-child { border: 0; }.coverage-grid span, .coverage-grid strong, .coverage-grid small { display: block; }.coverage-grid span { color: #72807d; font-size: 11px; }.coverage-grid strong { color: #315d6e; font-size: 22px; margin: 4px 0; }.coverage-grid small { color: #98a4a0; font-size: 10px; }
  `]
})
export class DashboardPageComponent {
  private readonly store = inject(Store)
  readonly points$ = this.store.select(selectPoints)
  readonly anomalies$ = this.store.select(selectAnomalies)
  readonly dataset$ = this.store.select(selectDataset)
  readonly inspection$ = this.store.select(selectInspection)
  readonly coverage$ = this.store.select(selectInspectionCoverage)
  readonly pointCount$ = this.points$.pipe(map((points) => points.length))
  readonly abnormalCount$ = this.points$.pipe(map((points) => points.filter((point) => point.status !== '正常').length))
  readonly openAnomalyCount$ = this.anomalies$.pipe(map((items) => items.filter((item) => item.status !== '已关闭').length))
  readonly thresholdVersion$ = this.dataset$.pipe(map((dataset) => dataset.thresholds.reduce((sum, item) => sum + item.version, 0)))
  readonly thresholdColumns = ['type', 'warning', 'alarm', 'rate', 'version']
}
