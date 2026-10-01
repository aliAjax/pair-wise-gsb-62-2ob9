import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core'
import * as turf from '@turf/turf'
import maplibregl, { LngLatLike, Map as MaplibreMap, Marker } from 'maplibre-gl'
import type { InspectionAssignment, MonitoringPoint, RouteSegment } from '../domain'

@Component({
  selector: 'app-spatial-map',
  standalone: true,
  template: `
    <div class="map-panel">
      <div class="map-head"><div><b>测点分布与当班巡检路线</b><span>当前路线 {{ routeLength.toFixed(1) }} km · 每点一个有效路线段</span></div><span class="legend"><i class="normal"></i>正常 <i class="warning"></i>预警 <i class="danger"></i>异常 <i class="detour"></i>绕行线</span></div>
      <div #mapContainer class="map"></div>
    </div>
  `,
  styles: [`
    .map-panel { background: white; border: 1px solid #d9e1df; }
    .map-head { display: flex; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e2e7e6; }
    .map-head b, .map-head span { display: block; } .map-head span { color: #74827f; font-size: 10px; margin-top: 3px; }
    .legend { display: flex !important; align-items: center; gap: 6px; margin: 0 !important; }
    .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; } .normal { background: #3e8a6b; } .warning { background: #c28d27; } .danger { background: #b84038; } .detour { border-radius: 0; background: #c2742d; }
    .map { height: 420px; }
  `]
})
export class SpatialMapComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) points: MonitoringPoint[] = []
  @Input() assignments: InspectionAssignment[] = []
  @Input() segments: RouteSegment[] = []
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>
  routeLength = 0
  private map?: MaplibreMap

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
    if (!this.map?.getStyle()) return
    document.querySelectorAll('.point-marker').forEach((element) => element.remove())
    const assignmentByPoint = new Map(this.assignments.map((assignment) => [assignment.pointId, assignment]))
    const segmentById = new Map(this.segments.map((segment) => [segment.id, segment]))

    this.points.forEach((point) => {
      const color = point.status === '异常' ? '#b84038' : point.status === '预警' ? '#c28d27' : '#3e8a6b'
      const element = document.createElement('div')
      element.className = 'point-marker'
      element.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 1px 5px rgba(0,0,0,.35)`
      const assignment = assignmentByPoint.get(point.id)
      const segment = assignment ? segmentById.get(assignment.segmentId) : undefined
      const routeText = segment ? `<br>${segment.name} · ${assignment?.status ?? ''}` : ''
      new Marker({ element }).setLngLat([point.longitude, point.latitude]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${point.name}</strong><br>${point.currentValue} ${point.unit} · ${point.status}${routeText}`)).addTo(this.map!)
    })

    this.map.getStyle().layers
      .filter((layer) => layer.id.startsWith('inspection-route-'))
      .forEach((layer) => this.map!.removeLayer(layer.id))
    Object.keys(this.map.getStyle().sources)
      .filter((sourceId) => sourceId.startsWith('inspection-route-'))
      .forEach((sourceId) => this.map!.removeSource(sourceId))

    const grouped = this.groupCoordinates(assignmentByPoint, segmentById)
    this.routeLength = 0
    grouped.forEach((coordinates, segmentId) => {
      if (coordinates.length < 2) return
      const line = turf.lineString(coordinates)
      this.routeLength += turf.length(line, { units: 'kilometers' })
      const segment = segmentById.get(segmentId)
      const sourceId = `inspection-route-${segmentId}`
      this.map!.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: line.geometry } })
      this.map!.addLayer({
        id: `inspection-route-line-${segmentId}`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': segment?.kind === '绕行' ? '#c2742d' : '#315d6e',
          'line-width': segment?.kind === '绕行' ? 3 : 2,
          'line-dasharray': segment?.kind === '绕行' ? [0.6, 1.4] : [2, 2]
        }
      })
    })

    if (!grouped.size && this.points.length > 1) {
      const line = turf.lineString(this.points.map((point) => [point.longitude, point.latitude]))
      this.routeLength = turf.length(line, { units: 'kilometers' })
      this.map.addSource('inspection-route-fallback', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: line.geometry } })
      this.map.addLayer({ id: 'inspection-route-line-fallback', type: 'line', source: 'inspection-route-fallback', paint: { 'line-color': '#315d6e', 'line-width': 2, 'line-dasharray': [2, 2] } })
    }
  }

  private groupCoordinates(assignmentByPoint: Map<string, InspectionAssignment>, segmentById: Map<string, RouteSegment>) {
    const grouped = new Map<string, [number, number][]>()
    this.assignments
      .filter((assignment) => assignmentByPoint.get(assignment.pointId)?.segmentId === assignment.segmentId)
      .sort((a, b) => {
        const aSegment = segmentById.get(a.segmentId)
        const bSegment = segmentById.get(b.segmentId)
        return (aSegment?.order ?? 0) - (bSegment?.order ?? 0) || a.pointId.localeCompare(b.pointId)
      })
      .forEach((assignment) => {
        const point = this.points.find((item) => item.id === assignment.pointId)
        if (!point) return
        const coordinates = grouped.get(assignment.segmentId) ?? []
        coordinates.push([point.longitude, point.latitude])
        grouped.set(assignment.segmentId, coordinates)
      })
    return grouped
  }
}
