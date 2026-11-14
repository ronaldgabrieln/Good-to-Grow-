import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import { BrandLogo, HomeButton } from './Brand'

export interface PickedPoint {
  lat: number
  lon: number
}

// Esri World Imagery for picking fields (sharp, keyless) + a labels overlay so towns are findable.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
  ],
}

export function MapPicker(props: {
  initialCenter: PickedPoint
  initialZoom?: number
  picked: PickedPoint | null
  onPick: (p: PickedPoint) => void
  onSetLocation: () => void
  onHome?: () => void
  /** True while the crop question sits on top of the map. */
  dimmed?: boolean
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const marker = useRef<Marker | null>(null)
  const onPick = useRef(props.onPick)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  useEffect(() => {
    onPick.current = props.onPick
  }, [props.onPick])

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: [props.initialCenter.lon, props.initialCenter.lat],
      zoom: props.initialZoom ?? 13,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('click', (e) => onPick.current({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    m.getCanvas().style.cursor = 'crosshair'
    map.current = m
    return () => m.remove()
    // The map is created once; later prop changes are pushed through effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!props.picked) {
      marker.current?.remove()
      marker.current = null
      return
    }
    const ll: [number, number] = [props.picked.lon, props.picked.lat]
    if (!marker.current) {
      const dot = document.createElement('div')
      dot.className = 'field-pin'
      marker.current = new maplibregl.Marker({ element: dot }).setLngLat(ll).addTo(m)
    } else marker.current.setLngLat(ll)
  }, [props.picked])

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoError('Location is not available in this browser.')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        map.current?.flyTo({ center: [p.lon, p.lat], zoom: 15 })
        props.onPick(p)
      },
      () => {
        setLocating(false)
        setGeoError('Could not get your location. Tap your field on the map instead.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className={`picker ${props.dimmed ? 'is-dimmed' : ''}`}>
      <div ref={el} className="picker-map" />
      <div className="picker-top">
        <BrandLogo className="picker-logo" />
        <h1>Where is your field?</h1>
        <p>Zoom in and tap the middle of your field.</p>
        <button className="picker-locate" onClick={locate} disabled={locating}>
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
        {geoError && <p className="picker-error">{geoError}</p>}
      </div>
      <HomeButton onHome={props.onHome} className="picker-home" />
      {props.picked && !props.dimmed && (
        <div className="picker-sheet" role="dialog" aria-label="Confirm field">
          <div>
            <strong>Is this your field?</strong>
            <span>We will read 30 years of NASA weather and satellite images for this spot.</span>
          </div>
          <button className="picker-go" onClick={props.onSetLocation}>
            Set location
          </button>
        </div>
      )}
    </div>
  )
}
