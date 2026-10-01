import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { firstValueFrom, map } from 'rxjs'
import { buildInspectionCoverage } from '../domain'
import type { ReviewPackage } from '../domain'
import { TailingsApiService } from '../services/tailings-api.service'
import { selectDataset, selectInspectionCoverage } from '../store/tailings.selectors'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>异常创建、原始读数、现场复核、专业意见、处置方案、审批、路线改线和关闭全部留痕。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>
      <div class="coverage-band">
        <b>审阅包覆盖：{{ (coverage$ | async)?.shiftName }}</b>
        <span>{{ (coverage$ | async)?.uniqueAssignments }}/{{ (coverage$ | async)?.totalPoints }} 点唯一归属</span>
        <span>完成覆盖 {{ (coverage$ | async)?.coverageRate }}%</span>
        <span>绕行段 {{ (coverage$ | async)?.detourSegments }} 条</span>
        <span>待确认 {{ (coverage$ | async)?.pendingConflicts }} 条</span>
      </div>
      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row">{{ row.action }}</td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }.coverage-band { background: white; border: 1px solid #d9e1df; border-left: 4px solid #315d6e; padding: 12px 14px; margin-bottom: 12px; display: flex; gap: 18px; align-items: center; color: #52635f; font-size: 12px; }.coverage-band b { color: #245060; }.toolbar { display: flex; align-items: center; gap: 12px; }.toolbar span { color: #74827f; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'entity', 'action', 'operator', 'detail']
  readonly filtered$ = this.store.select(selectDataset).pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(this.keyword))))
  readonly coverage$ = this.store.select(selectInspectionCoverage)
  async exportPackage(): Promise<void> {
    const dataset = await firstValueFrom(this.store.select(selectDataset))
    const reviewPackage: ReviewPackage = {
      ...structuredClone(dataset),
      packageName: '尾矿库汛期巡检与异常处置审阅包',
      generatedAt: new Date().toISOString(),
      coverage: buildInspectionCoverage(dataset)
    }
    this.api.exportPackage(reviewPackage).subscribe((blob) => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = '尾矿库汛期巡检审阅包.json'; anchor.click(); URL.revokeObjectURL(url)
    })
  }
}
