import { createFeatureSelector, createSelector } from '@ngrx/store'
import { buildAllCoverage, buildCoverage, getTour } from '../domain/inspection'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectTours = createSelector(selectDataset, (dataset) => dataset.tours)
export const selectImportLog = createSelector(selectDataset, (dataset) => dataset.importLog)
export const selectActiveTour = createSelector(selectTours, (tours) => tours.find((tour) => tour.status === '进行中') ?? tours[0])

/** 看板、巡检页、异常详情、审阅包共用的同一覆盖范围口径 */
export const selectCoverageAll = createSelector(selectDataset, (dataset) => buildAllCoverage(dataset))
export const selectActiveCoverage = createSelector(selectActiveTour, (tour) => (tour ? buildCoverage(tour) : undefined))

export const selectSelectedAnomaly = createSelector(selectTailings, (state) => {
  const selected = state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0]
  return selected
})

/** 异常详情中的覆盖范围与其所属班次一致 */
export const selectSelectedAnomalyCoverage = createSelector(selectDataset, selectSelectedAnomaly, (dataset, anomaly) => {
  if (!anomaly) return undefined
  const tour = getTour(dataset, anomaly.tourId) ?? dataset.tours[0]
  return tour ? buildCoverage(tour) : undefined
})

export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))
