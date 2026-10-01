import { createFeatureSelector, createSelector } from '@ngrx/store'
import { buildInspectionCoverage, joinAssignmentRows } from '../domain'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectInspection = createSelector(selectDataset, (dataset) => dataset.inspection)
export const selectActiveShift = createSelector(
  selectInspection,
  (inspection) => inspection.shifts.find((shift) => shift.status === '进行中') ?? inspection.shifts[0]
)
export const selectInspectionCoverage = createSelector(selectDataset, (dataset) => buildInspectionCoverage(dataset))
export const selectAssignmentRows = createSelector(selectDataset, (dataset) => joinAssignmentRows(dataset))
export const selectPendingConflicts = createSelector(
  selectInspection,
  (inspection) => inspection.conflicts.filter((conflict) => conflict.status === '待值班室确认')
)
export const selectImportedPackages = createSelector(selectInspection, (inspection) => inspection.packages)
export const selectInspectionError = createSelector(selectTailings, (state) => state.inspectionError)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])
export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))
