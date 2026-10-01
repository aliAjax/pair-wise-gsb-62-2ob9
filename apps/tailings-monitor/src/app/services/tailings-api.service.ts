import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of } from 'rxjs'
import type { ReviewEnvelope, TailingsDataset } from '../domain'
import { buildReviewEnvelope } from '../domain/inspection'
import { seedDataset } from '../data/seed'

@Injectable({ providedIn: 'root' })
export class TailingsApiService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = (globalThis as { __TAILINGS_API__?: string }).__TAILINGS_API__ ?? '/api'

  loadDataset(): Observable<TailingsDataset> {
    return this.http.get<TailingsDataset>(`${this.baseUrl}/tailings/snapshot`).pipe(catchError(() => of(structuredClone(seedDataset))))
  }

  /** 审阅包：覆盖范围与看板、异常详情同源；原始读数、复核与责任人原样导出 */
  exportPackage(envelope: ReviewEnvelope): Observable<Blob> {
    return this.http.post(`${this.baseUrl}/tailings/export`, envelope, { responseType: 'blob' }).pipe(catchError(() => of(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }))))
  }

  buildEnvelope(dataset: TailingsDataset): ReviewEnvelope {
    return buildReviewEnvelope(dataset)
  }
}
