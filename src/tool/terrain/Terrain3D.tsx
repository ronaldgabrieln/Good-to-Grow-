import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EROSION_CLASSES, paintTexture, type Terrain } from './terrain'

const TEX = 2048
const EXAGGERATION = 2 // vertical exaggeration so a valley floor still reads as terrain
const UNIT = 1 / 10 // scene units per metre

export type TerrainLayer = 'erosion' | 'water' | 'satellite'

export function Terrain3D(props: {
  terrain: Terrain
  layer: TerrainLayer
  /** Modeled soil loss at the field (t/ha/yr) for the rotation being shown. */
  erosionAtField: number
  rotationLabel: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const textureCtx = useRef<CanvasRenderingContext2D | null>(null)
  const texture = useRef<THREE.CanvasTexture | null>(null)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const { terrain } = props

  // Satellite image for the texture.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(terrain.imageUrl, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => createImageBitmap(b))
      .then(setImage)
      .catch(() => {
        if (!ctrl.signal.aborted) setImageFailed(true)
      })
    return () => ctrl.abort()
  }, [terrain.imageUrl])

  // Scene setup (once per terrain).
  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 10000)
    const size = terrain.sizeM * UNIT
    camera.position.set(size * 0.05, size * 0.62, size * 0.86)

    const n = terrain.n
    const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, (terrain.elev[i] - terrain.minElev) * EXAGGERATION * UNIT)
    geo.computeVertexNormals()

    const canvas = document.createElement('canvas')
    canvas.width = TEX
    canvas.height = TEX
    textureCtx.current = canvas.getContext('2d')
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    texture.current = tex
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }))
    scene.add(mesh)

    // Skirt under the edges so the chunk looks like a solid block of land.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(size, 6, size),
      new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 1 }),
    )
    base.position.y = -3
    scene.add(base)

    // The farmer's field: a pin at the centre.
    const fieldY = (terrain.field.elevationM - terrain.minElev) * EXAGGERATION * UNIT
    const pin = new THREE.Group()
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 34, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }))
    stick.position.y = 17
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 16), new THREE.MeshStandardMaterial({ color: 0x2a6b2f }))
    head.position.y = 36
    const ring = new THREE.Mesh(new THREE.RingGeometry(14, 17, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.6
    pin.add(stick, head, ring)
    pin.position.y = fieldY
    scene.add(pin)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(-size, size * 0.9, size * 0.4)
    scene.add(sun)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, fieldY * 0.6, 0)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.46
    controls.minDistance = size * 0.15
    controls.maxDistance = size * 1.6
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    const stopSpin = () => (controls.autoRotate = false)
    renderer.domElement.addEventListener('pointerdown', stopSpin)
    renderer.domElement.addEventListener('wheel', stopSpin, { passive: true })

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let raf = 0
    const tick = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', stopSpin)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
      tex.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      texture.current = null
      textureCtx.current = null
    }
  }, [terrain])

  // Repaint the texture whenever the layer, the rotation or the image changes.
  useEffect(() => {
    const ctx = textureCtx.current
    if (!ctx || !texture.current) return
    paintTexture(ctx, TEX, terrain, image, {
      erosionAtField: props.layer === 'erosion' ? props.erosionAtField : null,
      fieldLs: terrain.field.ls,
      showWater: props.layer === 'water',
    })
    texture.current.needsUpdate = true
  }, [terrain, image, props.layer, props.erosionAtField])

  return (
    <div className="terrain3d">
      <div ref={host} className="terrain3d-canvas" />
      {props.layer === 'erosion' && (
        <div className="terrain3d-legend">
          <strong>Soil washed away by rain</strong>
          <span className="small">with {props.rotationLabel} · tonnes per hectare per year</span>
          <ul>
            {EROSION_CLASSES.map((c) => (
              <li key={c.label}>
                <i style={{ background: c.color ?? 'transparent' }} className={c.color ? '' : 'none'} />
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {props.layer === 'water' && (
        <div className="terrain3d-legend">
          <strong>Where rain water runs</strong>
          <span className="small">Thicker blue = more water collects here (from NASA SRTM elevation)</span>
        </div>
      )}
      {imageFailed && <div className="terrain3d-note small">Satellite photo unavailable; showing plain ground.</div>}
      <div className="terrain3d-hint small">Drag to turn · scroll or pinch to zoom · terrain height ×{EXAGGERATION}</div>
    </div>
  )
}
