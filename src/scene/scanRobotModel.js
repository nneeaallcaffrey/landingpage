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
  hip: [0.21, -0.06, -0.025], // axle hub: the whole side housing swings with the leg
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
  waistH: toRobot(0, -0.2, 0).y, // bottom of the body box (close-up framing)
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

// Plane between thigh and shin through the knee, bisecting the two segments,
// so the blend follows the joint's crease instead of cutting straight across.
const KNEE_PLANE = (() => {
  const t = new THREE.Vector2(M.knee[1] - M.hip[1], M.knee[2] - M.hip[2]).normalize()
  const s = new THREE.Vector2(M.ankle[1] - M.knee[1], M.ankle[2] - M.knee[2]).normalize()
  return t.add(s).normalize() // (y, z)
})()

/** Smooth bone weights for one vertex (model units). Returns [[bone, weight], ...]. */
function weightsFor(x, y, z) {
  const ax = Math.abs(x)
  // head is the only thing wider than the neck above the torso
  if (y > 0.2 && ax >= 0.1) return [[B.head, 1]]
  if (y > 0.165 && ax < 0.1) {
    // the neck bends smoothly along its length
    const toNeck = smooth(0.17, 0.235, y)
    const toHead = smooth(0.265, 0.33, y)
    return [
      [B.torso, 1 - toNeck],
      [B.neck, toNeck * (1 - toHead)],
      [B.head, toNeck * toHead],
    ]
  }
  // The side housings (outside the body box, below the brackets) and
  // everything under the body box (bottom at y = -0.216) belong to the legs.
  // The split runs through the gap between box and housing, so the housing
  // swings with the leg as one rigid piece around its axle hub.
  const leg = Math.max(smooth(0.158, 0.17, ax) * smooth(0.012, -0.012, y), smooth(-0.216, -0.232, y))
  const d = (y - M.knee[1]) * KNEE_PLANE.x + (z - M.knee[2]) * KNEE_PLANE.y
  const knee = smooth(-0.022, 0.032, d)
  const ankle = smooth(-0.4, -0.447, y) // the shin's foot end bends softly into the ankle
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
    const z = pos.getZ(i)
    v.copy(toRobot(x, y, z))
    positions.set([v.x, v.y, v.z], i * 3)
    const w = weightsFor(x, y, z)
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
/* Repaint: flat white / blue / graphite palette decided on the 3D surface     */
/* -------------------------------------------------------------------------- */

const PALETTE = [
  [233, 236, 239], // 0 white shell
  [34, 119, 198], // 1 blue panels
  [93, 98, 104], // 2 graphite (face plate)
  [36, 39, 43], // 3 dark joints / display / neck
  [224, 150, 46], // 4 amber accents
]

function classify(r, g, b) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b
  const sat = Math.max(r, g, b) - Math.min(r, g, b)
  if (b > r + 22 && b >= g - 4) return 1
  if (r > b + 45 && r >= g && sat > 50) return 4
  if (lum >= 105) return 0 // light grey is baked shading on the white shell
  if (lum >= 55) return 2
  return 3
}

/**
 * Repaints the scan's texture with the clean palette. The scan's UV atlas is
 * cut into hundreds of small islands, so filtering the image itself leaves
 * specks and dark seams. Instead every surface vertex votes on its colour
 * (from the texels around it, smoothed over its mesh neighbours), and each
 * triangle is repainted from its vertices' votes: flat colours, crisp edges,
 * no dirt, and both sides of every UV seam agree.
 */
function paintTexture(image, geometry, size) {
  const K = PALETTE.length
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  const T = index.count / 3

  // source texels
  const S = image.width
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = srcCanvas.height = S
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  sctx.drawImage(image, 0, 0, S, S)
  const src = sctx.getImageData(0, 0, S, S).data
  const classAt = (u, v) => {
    const x = Math.min(S - 1, Math.max(0, Math.floor(u * S)))
    const y = Math.min(S - 1, Math.max(0, Math.floor(v * S)))
    const i = (y * S + x) * 4
    return classify(src[i], src[i + 1], src[i + 2])
  }

  // vertices merged by position (UV seams split them in the source mesh)
  const ids = new Map()
  const vid = new Int32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`
    let id = ids.get(key)
    if (id === undefined) ids.set(key, (id = ids.size))
    vid[i] = id
  }
  const NV = ids.size

  // each triangle votes with 7 texels, weighted by its surface area
  const votes = new Float32Array(NV * K)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const tri = new THREE.Triangle()
  const hist = new Float32Array(K)
  const SAMPLES = [
    [1 / 3, 1 / 3],
    [5 / 9, 2 / 9],
    [2 / 9, 5 / 9],
    [2 / 9, 2 / 9],
    [4 / 9, 4 / 9],
    [1 / 9, 4 / 9],
    [4 / 9, 1 / 9],
  ]
  for (let t = 0; t < T; t++) {
    const i0 = index.getX(t * 3)
    const i1 = index.getX(t * 3 + 1)
    const i2 = index.getX(t * 3 + 2)
    tri.set(a.fromBufferAttribute(pos, i0), b.fromBufferAttribute(pos, i1), c.fromBufferAttribute(pos, i2))
    const w = tri.getArea() / SAMPLES.length
    hist.fill(0)
    for (const [s1, s2] of SAMPLES) {
      const s0 = 1 - s1 - s2
      const u = s0 * uv.getX(i0) + s1 * uv.getX(i1) + s2 * uv.getX(i2)
      const v = s0 * uv.getY(i0) + s1 * uv.getY(i1) + s2 * uv.getY(i2)
      hist[classAt(u, v)] += w
    }
    for (const i of [i0, i1, i2]) for (let k = 0; k < K; k++) votes[vid[i] * K + k] += hist[k]
  }

  // one smoothing pass over mesh neighbours removes isolated specks
  const edges = new Set()
  for (let t = 0; t < T; t++) {
    for (let e = 0; e < 3; e++) {
      const p = vid[index.getX(t * 3 + e)]
      const q = vid[index.getX(t * 3 + ((e + 1) % 3))]
      if (p !== q) edges.add(p < q ? p * NV + q : q * NV + p)
    }
  }
  const smoothed = votes.slice()
  for (const e of edges) {
    const p = Math.floor(e / NV)
    const q = e - p * NV
    for (let k = 0; k < K; k++) {
      smoothed[p * K + k] += 0.5 * votes[q * K + k]
      smoothed[q * K + k] += 0.5 * votes[p * K + k]
    }
  }
  for (let v = 0; v < NV; v++) {
    let sum = 0
    for (let k = 0; k < K; k++) sum += smoothed[v * K + k]
    if (sum > 0) for (let k = 0; k < K; k++) smoothed[v * K + k] /= sum
  }

  // repaint every triangle in UV space from its vertices' votes
  const W = size
  const label = new Uint8Array(W * W).fill(255)
  for (let t = 0; t < T; t++) {
    const i0 = index.getX(t * 3)
    const i1 = index.getX(t * 3 + 1)
    const i2 = index.getX(t * 3 + 2)
    const ax = uv.getX(i0) * W
    const ay = uv.getY(i0) * W
    const bx = uv.getX(i1) * W
    const by = uv.getY(i1) * W
    const cx = uv.getX(i2) * W
    const cy = uv.getY(i2) * W
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(den) < 1e-9) continue
    const eps = 0.75 / Math.max(Math.sqrt(Math.abs(den)), 1) // include texels touching the edges
    const v0 = vid[i0] * K
    const v1 = vid[i1] * K
    const v2 = vid[i2] * K
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(W - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
        const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
        const l2 = 1 - l0 - l1
        if (l0 < -eps || l1 < -eps || l2 < -eps) continue
        const w0 = Math.min(1, Math.max(0, l0))
        const w1 = Math.min(1, Math.max(0, l1))
        const w2 = Math.min(1, Math.max(0, l2))
        let best = 0
        let bestP = -1
        for (let k = 0; k < K; k++) {
          const p = w0 * smoothed[v0 + k] + w1 * smoothed[v1 + k] + w2 * smoothed[v2 + k]
          if (p > bestP) {
            bestP = p
            best = k
          }
        }
        label[y * W + x] = best
      }
    }
  }

  // gutters take the nearest painted colour so mip-maps never bleed
  const queue = new Int32Array(W * W)
  let head = 0
  let tail = 0
  for (let i = 0; i < W * W; i++) if (label[i] !== 255) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j >= 0 && j < W * W && label[j] === 255) {
        label[j] = label[i]
        queue[tail++] = j
      }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = W
  const ctx = canvas.getContext('2d')
  const dst = ctx.createImageData(W, W)
  for (let i = 0; i < W * W; i++) {
    const col = PALETTE[label[i] === 255 ? 0 : label[i]]
    dst.data[i * 4] = col[0]
    dst.data[i * 4 + 1] = col[1]
    dst.data[i * 4 + 2] = col[2]
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
  const map = srcMap?.image ? paintTexture(srcMap.image, source.geometry, textureSize) : null
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
