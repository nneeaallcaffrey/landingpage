import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The robot generated with Higgsfield (SAM 3D, first generation) from the
 * white / blue service-robot reference. It is a single textured, unrigged
 * mesh, so on load it is cut into rigid parts (torso, neck, head, thigh,
 * shin, foot) that hang off the articulated rig's pivots.
 */
export const SCAN_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_3JYrbVW8ZPjbhxDps9SqPjdTffR/hf_20260925_134640_31e27666-a76b-4db6-9e85-ac6d6296233d.glb'

// Landmarks measured on the source mesh (model units: 1.0 tall, soles at
// y = -0.5, facing +Z, symmetric in X). Legs have a reverse (digitigrade) knee.
const M = {
  hip: [0.225, -0.2, -0.115],
  knee: [0.205, -0.325, -0.13],
  ankle: [0.178, -0.435, 0.02],
  neckBase: [0, 0.19, 0.075],
  headPivot: [0, 0.315, 0],
  ear: [0.305, 0.455, -0.12],
  torsoBottomY: -0.235,
  legSideY: -0.18,
  legSideX: 0.13,
  neckHalfWidth: 0.1,
  headWidth: 0.62,
}

/** Model units -> robot units (metres; soles at y = 0). */
export const SCAN_SCALE = 0.75
const toRobot = (x, y, z) => new THREE.Vector3(x * SCAN_SCALE, (y + 0.5) * SCAN_SCALE, z * SCAN_SCALE)

function legFrames() {
  const H = toRobot(...M.hip)
  const K = toRobot(...M.knee)
  const A = toRobot(...M.ankle)
  const thighAngle = Math.atan2(K.z - H.z, H.y - K.y) // from straight down, towards +Z
  const shinAngle = Math.atan2(A.z - K.z, K.y - A.y)
  const thigh = Math.hypot(K.z - H.z, H.y - K.y)
  const shin = Math.hypot(A.z - K.z, K.y - A.y)
  return { H, K, A, thighAngle, shinAngle, thigh, shin }
}

const LEG = legFrames()
const NECK_BASE = toRobot(...M.neckBase)
const HEAD_PIVOT = toRobot(...M.headPivot)

/** Rig proportions for the controller (see DIM in robotController). */
export const SCAN_DIMS = {
  hipH: LEG.H.y,
  hipX: LEG.H.x,
  footX: LEG.H.x,
  footZ: LEG.A.z, // standing pose = the model's own rest pose
  ankleH: toRobot(0, M.ankle[1], 0).y,
  thigh: LEG.thigh,
  shin: LEG.shin,
  kneeDir: -1,
  crouch: 0,
  walkCrouch: 0.04,
  lowerDepth: 0.07,
  maxStep: 0.12,
  speed: 0.9,
  headWidth: M.headWidth * SCAN_SCALE,
  headTop: 0.89,
  neck: { base: 0, mid: 0, head: 0, foldBase: 0.35, foldMid: 0, foldHead: -0.2 },
}

/** Rig layout (all positions relative to the parent pivot). */
export const SCAN_LAYOUT = {
  hip: [LEG.H.x, 0, LEG.H.z], // x mirrored per side
  knee: [0, -LEG.thigh, 0],
  ankle: [0, -LEG.shin, 0],
  neckBase: [0, NECK_BASE.y - LEG.H.y, NECK_BASE.z],
  neckMid: [0, HEAD_PIVOT.y - NECK_BASE.y, HEAD_PIVOT.z - NECK_BASE.z],
  // joint caps hide the seams where the scan was cut (offsets inside each pivot)
  kneeCapX: (M.knee[0] - M.hip[0]) * SCAN_SCALE,
  ankleCapX: (M.ankle[0] - M.hip[0]) * SCAN_SCALE,
  ear: [M.ear[0] * SCAN_SCALE, toRobot(0, M.ear[1], 0).y - HEAD_PIVOT.y, M.ear[2] * SCAN_SCALE - HEAD_PIVOT.z],
}

/** World (robot-space) rest frame of every part. Parts are stored relative to these. */
function restFrames() {
  const m = (pos, rotX = 0) =>
    new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX), new THREE.Vector3(1, 1, 1))
  const frames = {
    torso: m(new THREE.Vector3(0, LEG.H.y, 0)),
    neck: m(NECK_BASE.clone()),
    head: m(HEAD_PIVOT.clone()),
  }
  for (const [side, key] of [
    [1, 'L'],
    [-1, 'R'],
  ]) {
    const hip = new THREE.Vector3(side * LEG.H.x, LEG.H.y, LEG.H.z)
    const knee = hip.clone().add(new THREE.Vector3(0, -LEG.thigh * Math.cos(LEG.thighAngle), LEG.thigh * Math.sin(LEG.thighAngle)))
    const ankle = knee.clone().add(new THREE.Vector3(0, -LEG.shin * Math.cos(LEG.shinAngle), LEG.shin * Math.sin(LEG.shinAngle)))
    frames[`thigh${key}`] = m(hip, -LEG.thighAngle)
    frames[`shin${key}`] = m(knee, -LEG.shinAngle)
    frames[`foot${key}`] = m(ankle)
  }
  return frames
}

function classify(cx, cy) {
  if (cy > M.headPivot[1]) return 'head'
  if (cy > M.neckBase[1] && Math.abs(cx) < M.neckHalfWidth) return 'neck'
  const isLeg = cy < M.torsoBottomY || (cy < M.legSideY && Math.abs(cx) > M.legSideX)
  if (!isLeg) return 'torso'
  const key = cx >= 0 ? 'L' : 'R'
  if (cy >= M.knee[1]) return `thigh${key}`
  if (cy >= M.ankle[1]) return `shin${key}`
  return `foot${key}`
}

/** Splits the source mesh into rigid, pivot-relative BufferGeometries. */
function segment(sourceGeometry) {
  const pos = sourceGeometry.getAttribute('position')
  const uv = sourceGeometry.getAttribute('uv')
  const index = sourceGeometry.getIndex()
  const triCount = index ? index.count / 3 : pos.count / 3
  const vi = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k)

  const frames = restFrames()
  const inverse = Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, f.clone().invert()]))
  const buckets = {}
  const v = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0)
    const b = vi(t, 1)
    const c = vi(t, 2)
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3
    const part = classify(cx, cy)
    const bucket = (buckets[part] ??= { map: new Map(), pos: [], uv: [], idx: [] })
    for (const i of [a, b, c]) {
      let ni = bucket.map.get(i)
      if (ni === undefined) {
        ni = bucket.map.size
        bucket.map.set(i, ni)
        v.copy(toRobot(pos.getX(i), pos.getY(i), pos.getZ(i))).applyMatrix4(inverse[part])
        bucket.pos.push(v.x, v.y, v.z)
        if (uv) bucket.uv.push(uv.getX(i), uv.getY(i))
      }
      bucket.idx.push(ni)
    }
  }

  const parts = {}
  for (const [name, bucket] of Object.entries(buckets)) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3))
    if (bucket.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2))
    g.setIndex(bucket.idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    parts[name] = g
  }
  return parts
}

/**
 * Downloads the Higgsfield mesh and prepares it for the rig.
 * Resolves to { parts: Record<string, BufferGeometry>, material }.
 */
export async function loadScanRobot({ signal, timeoutMs = 15000 } = {}) {
  const loader = new GLTFLoader()
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('scan robot: timeout')), timeoutMs))
  const gltf = await Promise.race([loader.loadAsync(SCAN_URL), timeout])
  if (signal?.aborted) throw new Error('aborted')

  let source = null
  gltf.scene.traverse((o) => {
    if (!source && o.isMesh) source = o
  })
  if (!source) throw new Error('scan robot: no mesh')

  const map = source.material?.map ?? null
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
  }
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0 })
  const parts = segment(source.geometry)

  source.geometry.dispose()
  if (source.material && source.material !== material) source.material.dispose()
  return { parts, material }
}
