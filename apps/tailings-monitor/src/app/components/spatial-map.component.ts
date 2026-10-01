import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core'
import * as turf from '@turf/turf'
import maplibregl, { LngLatLike, Map, Marker } from 'maplibre-gl'
import type { CoverageSummary, FloodTour, MonitoringPoint } from '../domain'
import { buildCoverage } from '../domain/inspection'

@Component({
  selector: 'app-spatial-map',
  standalone: true,
  template: `
    <div class="map-panel">
      <div class="map-head">
        <div><b>测点分布与巡检路线</b><span>路线长度 {{ routeLength.toFixed(1) }} km · 已完成 {{ completedCount }}/{{ coverage.totalPoints }} 点 · 绕行待接管 {{ coverage.detourPendingPoints }} 点</span></div>
        <span class="legend"><i class="normal"></i>正常 <i class="warning"></i>预警 <i class="danger"></i>异常 <i class="detour-line"></i>绕行段</span>
      </div>
      <div #mapContainer class="map"></div>
    </div>
  `,
  styles: [`
    .map-panel { background: white; border: 1px solid #d9e1df; }
    .map-head { display: flex; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e2e7e6; }
    .map-head b, .map-head span { display: block; } .map-head span { color: #74827f; font-size: 10px; margin-top: 3px; }
    .legend { display: flex !important; align-items: center; gap: 6px; margin: 0 !important; }
    .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; } .normal { background: #3e8a6b; } .warning { background: #c28d27; } .danger { background: #b84038; }
    .legend i.detour-line { width: 14px; height: 0; border-top: 3px dashed #c28d27; border-radius: 0; }
    .map { height: 420px; }
  `]
})
export class SpatialMapComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) points: MonitoringPoint[] = []
  @Input() tour: FloodTour | null = null
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>
  routeLength = 0
  completedCount = 0
  coverage: CoverageSummary = { tourId: '', tourName: '', status: '进行中', totalPoints: 0, completedPoints: 0, pendingPoints: 0, detourPendingPoints: 0, detourCompletedPoints: 0, conflictPointIds: [], coveredPointIds: [], bySegment: [] }
  private map?: Map

  ngAfterViewInit(): void {
    this.map = new maplibregl.Map({
      container: this.mapContainer.nativeElement,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe8e5' } }]
      },
      center: [112.843, 40.116] as LngLatLike,
      zoom: 11.5,
      attributionControl: false
    })
    this.map.on('load', () => this.renderPoints())
  }

  ngOnChanges(_changes: SimpleChanges): void { this.renderPoints() }

  private renderPoints(): void {
    if (!this.map) return
    document.querySelectorAll('.point-marker').forEach((element) => element.remove())
    if (this.tour) this.coverage = buildCoverage(this.tour)
    this.completedCount = this.coverage.completedPoints
    const completed = new Set(this.tour?.completions.map((item) => item.pointId) ?? [])

    this.points.forEach((point) => {
      const color = point.status === '异常' ? '#b84038' : point.status === '预警' ? '#c28d27' : '#3e8a6b'
      const done = completed.has(point.id)
      const element = document.createElement('div')
      element.className = 'point-marker'
      element.style.cssText = `width:${done ? 20 : 16}px;height:${done ? 20 : 16}px;border-radius:50%;background:${color};border:${done ? '4px solid #2e765a' : '3px solid white'};box-shadow:0 1px 5px rgba(0,0,0,.35);${done ? 'box-sizing:border-box;' : ''}`
      const suffix = done ? `<br><b style="color:#2e765a">✓ 本班次已完成</b>` : ''
      new Marker({ element }).setLngLat([point.longitude, point.latitude]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${point.name}</strong><br>${point.currentValue} ${point.unit} · ${point.status}${suffix}`)).addTo(this.map!)
    })

    this.renderRoutes()
  }

  private renderRoutes(): void {
    const sourceId = 'inspection-route'
    const layerId = 'inspection-route-line'
    ;[
      [layerId, sourceId],
      ['inspection-planned-line', 'inspection-planned'],
      ['inspection-detour-line', 'inspection-detour']
    ].forEach(([layer, source]) => {
      if (this.map!.getLayer(layer)) this.map!.removeLayer(layer)
      if (this.map!.getSource(source)) this.map!.removeSource(source)
    })

    let total = 0
    if (this.tour && this.tour.assignments.length) {
      // 按当前归属（计划段/绕行段）分组连线，颜色与看板一致
      const plannedCoords: [number, number][] = []
      const detourCoords: [number, number][] = []
      this.tour.assignments.forEach((assignment) => {
        const point = this.points.find((item) => item.id === assignment.pointId)
        if (!point) return
        ;(assignment.current.basis === '绕行段' ? detourCoords : plannedCoords).push([point.longitude, point.latitude])
      })
      const addLine = (id: string, coords: [number, number][], color: string, dash: boolean): void => {
        if (coords.length < 2) return
        const line = turf.lineString(coords)
        total += turf.length(line, { units: 'kilometers' })
        this.map!.addSource(id, { type: 'geojson', data: { type: 'Feature' as const, properties: {}, geometry: line.geometry } })
        const layout: Record<string, unknown> = dash ? { 'line-join': 'round', 'line-cap': 'round' } : { 'line-join': 'round' }
        this.map!.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 2, ...(dash ? { 'line-dasharray': [2, 2] } : {}) }, layout })
      }
      addLine('inspection-planned', plannedCoords, '#315d6e', false)
      addLine('inspection-detour', detourCoords, '#c28d27', true)
    } else if (this.points.length > 1) {
      const line = turf.lineString(this.points.map((point) => [point.longitude, point.latitude]))
      total = turf.length(line, { units: 'kilometers' })
      this.map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature' as const, properties: {}, geometry: line.geometry } })
      this.map.addLayer({ id: layerId, type: 'line', source: sourceId, paint: { 'line-color': '#315d6e', 'line-width': 2, 'line-dasharray': [2, 2] } })
    }
    this.routeLength = total
  }
}
