import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The robot generated with Higgsfield (SAM 3D, first generation) from the
 * white / blue service-robot reference. It is a single textured, unrigged
 * mesh, so on load it is skinned to the articulated rig: every vertex gets
 * smooth weights for torso / neck / head / thigh / shin / foot bones, so the
 * shell bends continuously at the joints (no gaps, cables stay connected).
 * The scanned texture is repainted with a clean white / blue palette.
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
  antenna: [0.285, 0.49, -0.15], // on top of the head, near the back corners
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
  antenna: [M.antenna[0] * SCAN_SCALE, toRobot(0, M.antenna[1], 0).y - HEAD_PIVOT.y, M.antenna[2] * SCAN_SCALE - HEAD_PIVOT.z],
}

export const BONES = ['torso', 'neck', 'head', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
const B = Object.fromEntries(BONES.map((n, i) => [n, i]))

/** Rest pose of every bone in robot space; the skeleton binds to these. */
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
  return BONES.map((name) => frames[name])
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Smooth bone weights for one vertex (model units). Returns [[bone, weight], ...]. */
function weightsFor(x, y) {
  const ax = Math.abs(x)
  // head is the only thing wider than the neck above the torso
  if (y > 0.2 && ax >= 0.1) return [[B.head, 1]]
  if (y > 0.175 && ax < 0.1) {
    const toNeck = smooth(0.175, 0.205, y)
    const toHead = smooth(0.29, 0.325, y)
    return [
      [B.torso, 1 - toNeck],
      [B.neck, toNeck * (1 - toHead)],
      [B.head, toNeck * toHead],
    ]
  }
  // torso -> leg (hip housings on the sides, everything below the torso)
  const leg = Math.max(smooth(0.105, 0.14, ax) * smooth(-0.165, -0.205, y), smooth(-0.225, -0.255, y))
  const knee = smooth(-0.305, -0.345, y)
  const ankle = smooth(-0.42, -0.45, y)
  const s = x >= 0 ? 'L' : 'R'
  return [
    [B.torso, 1 - leg],
    [B[`thigh${s}`], leg * (1 - knee)],
    [B[`shin${s}`], leg * knee * (1 - ankle)],
    [B[`foot${s}`], leg * knee * ankle],
  ]
}

/** Builds the skinned geometry in robot space (rest pose). */
function buildSkinnedGeometry(source) {
  const pos = source.getAttribute('position')
  const n = pos.count
  const positions = new Float32Array(n * 3)
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    v.copy(toRobot(x, y, pos.getZ(i)))
    positions.set([v.x, v.y, v.z], i * 3)
    const w = weightsFor(x, y)
      .filter(([, wt]) => wt > 1e-4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
    const sum = w.reduce((acc, [, wt]) => acc + wt, 0) || 1
    w.forEach(([bone, wt], k) => {
      skinIndex[i * 4 + k] = bone
      skinWeight[i * 4 + k] = wt / sum
    })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('uv', source.getAttribute('uv').clone())
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  g.setIndex(source.getIndex().clone())
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/* -------------------------------------------------------------------------- */
/* Texture clean-up: flat white / blue / graphite palette, no dirt specks      */
/* -------------------------------------------------------------------------- */

const PALETTE = [
  [233, 236, 239], // 0 white shell
  [34, 119, 198], // 1 blue panels
  [93, 98, 104], // 2 graphite (head panels, neck)
  [36, 39, 43], // 3 dark joints / sensors
  [224, 150, 46], // 4 amber accents
]

function classify(r, g, b) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b
  const sat = Math.max(r, g, b) - Math.min(r, g, b)
  if (b > r + 22 && b >= g - 4) return 1
  if (r > b + 45 && r >= g && sat > 50) return 4
  if (lum >= 140) return 0
  if (lum >= 62) return 2
  return 3
}

/**
 * Repaints the scan's texture with the clean palette. A majority filter
 * removes small specks (the "dirt"), and colours are grown past the UV
 * islands so mip-mapping never bleeds dark borders.
 */
function cleanTexture(image, geometry, size) {
  const W = size
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = W
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, W, W)
  const src = ctx.getImageData(0, 0, W, W)

  // UV coverage mask
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = maskCanvas.height = W
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })
  mctx.fillStyle = '#fff'
  mctx.strokeStyle = '#fff'
  mctx.lineWidth = 1.5
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t)
    const b = index.getX(t + 1)
    const c = index.getX(t + 2)
    // one path per triangle so overlapping (mirrored) UV islands never cancel out
    mctx.beginPath()
    mctx.moveTo(uv.getX(a) * W, uv.getY(a) * W)
    mctx.lineTo(uv.getX(b) * W, uv.getY(b) * W)
    mctx.lineTo(uv.getX(c) * W, uv.getY(c) * W)
    mctx.closePath()
    mctx.fill()
    mctx.stroke()
  }
  const mask = mctx.getImageData(0, 0, W, W).data

  const N = W * W
  const K = PALETTE.length
  const label = new Uint8Array(N).fill(255)
  for (let i = 0; i < N; i++) {
    if (mask[i * 4 + 3] > 0) label[i] = classify(src.data[i * 4], src.data[i * 4 + 1], src.data[i * 4 + 2])
  }

  // majority vote in a (2r+1)^2 window via one integral image per palette entry
  const r = W >= 1024 ? 3 : 2
  const S = W + 1
  const integrals = []
  for (let k = 0; k < K; k++) {
    const I = new Int32Array(S * S)
    for (let y = 0; y < W; y++) {
      let row = 0
      for (let x = 0; x < W; x++) {
        if (label[y * W + x] === k) row++
        I[(y + 1) * S + x + 1] = I[y * S + x + 1] + row
      }
    }
    integrals.push(I)
  }
  const out = new Uint8Array(N).fill(255)
  for (let y = 0; y < W; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(W, y + r + 1)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (label[i] === 255) continue
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(W, x + r + 1)
      let best = label[i]
      let bestCount = -1
      for (let k = 0; k < K; k++) {
        const I = integrals[k]
        const count = I[y1 * S + x1] - I[y0 * S + x1] - I[y1 * S + x0] + I[y0 * S + x0]
        if (count > bestCount) {
          bestCount = count
          best = k
        }
      }
      out[i] = best
    }
  }

  // grow colours outwards past the islands (prevents dark seams)
  for (let pass = 0; pass < 4; pass++) {
    const prev = out.slice()
    for (let y = 1; y < W - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        if (prev[i] !== 255) continue
        const n = prev[i - 1] !== 255 ? prev[i - 1] : prev[i + 1] !== 255 ? prev[i + 1] : prev[i - W] !== 255 ? prev[i - W] : prev[i + W]
        if (n !== 255) out[i] = n
      }
    }
  }

  const dst = ctx.createImageData(W, W)
  for (let i = 0; i < N; i++) {
    const c = PALETTE[out[i] === 255 ? 0 : out[i]]
    dst.data[i * 4] = c[0]
    dst.data[i * 4 + 1] = c[1]
    dst.data[i * 4 + 2] = c[2]
    dst.data[i * 4 + 3] = 255
  }
  ctx.putImageData(dst, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.flipY = false // glTF UV convention
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/**
 * Downloads the Higgsfield mesh and prepares it for the rig.
 * Resolves to { geometry, material, boneInverses }.
 */
export async function loadScanRobot({ signal, timeoutMs = 30000, textureSize = 1024 } = {}) {
  const loader = new GLTFLoader()
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('scan robot: timeout')), timeoutMs))
  const gltf = await Promise.race([loader.loadAsync(SCAN_URL), timeout])
  if (signal?.aborted) throw new Error('aborted')

  let source = null
  gltf.scene.traverse((o) => {
    if (!source && o.isMesh) source = o
  })
  if (!source) throw new Error('scan robot: no mesh')

  const srcMap = source.material?.map
  const map = srcMap?.image ? cleanTexture(srcMap.image, source.geometry, textureSize) : null
  const material = new THREE.MeshStandardMaterial({
    map,
    // a little self-illumination keeps the white shell reading white
    emissiveMap: map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.3,
    roughness: 0.62,
    metalness: 0,
  })
  const geometry = buildSkinnedGeometry(source.geometry)
  const boneInverses = restFrames().map((f) => f.clone().invert())

  srcMap?.dispose()
  source.geometry.dispose()
  source.material?.dispose()
  return { geometry, material, boneInverses }
}
