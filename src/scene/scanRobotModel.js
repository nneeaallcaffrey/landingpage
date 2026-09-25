import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The robot generated with Higgsfield (SAM 3D, first generation) from the
 * white / blue service-robot reference. It is a single textured, unrigged
 * mesh, so on load it is skinned to the articulated rig: every vertex gets
 * smooth weights for torso / neck / head / thigh / shin / foot bones, so the
 * shell bends continuously at the joints (no gaps, cables stay connected).
 * The scan's own texture is blotchy, so the robot is painted with the
 * reference robot's livery instead (see paintAt).
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
/* Paint job: the reference robot's livery, drawn on the 3D shape             */
/* -------------------------------------------------------------------------- */

// colour (sRGB), roughness, metalness
const PAINT = {
  shell: [[236, 235, 231], 0.55, 0], // off-white shell
  panel: [[202, 205, 209], 0.55, 0], // light grey face plate / vent frame
  neck: [[198, 201, 205], 0.5, 0],
  mount: [[126, 131, 137], 0.5, 0.1], // mid grey mounts and actuators
  display: [[84, 88, 94], 0.45, 0.1], // display panel frame
  recess: [[40, 43, 47], 0.4, 0], // dark window / lens mounts / vent
  lens: [[14, 15, 17], 0.12, 0], // glossy black lens
  cable: [[30, 31, 34], 0.45, 0],
  blue: [[38, 104, 222], 0.42, 0],
  orange: [[242, 138, 40], 0.5, 0],
  bronze: [[184, 142, 88], 0.32, 0.7], // leg joints
}

const EYES = [-0.094, 0.094] // lens centres (x) on the face, y = 0.416
const KNEE_YZ = [-0.325, -0.13]

/**
 * Livery at a point of the source mesh (model units: soles at y = -0.5,
 * facing +Z) with face normal n. Modelled on the reference render: white
 * shell, light grey face with black square lens mounts, blue stripes and
 * leg covers, a dark display window, bronze joints, blue feet with an
 * orange sole.
 */
function paintAt(x, y, z, nx, ny, nz) {
  const ax = Math.abs(x)
  const head = y > 0.345 || (y > 0.3 && ax > 0.1)
  if (head) {
    // side camera on the left front corner
    if (x > 0.235 && x < 0.325 && y > 0.42 && y < 0.49 && z > 0.18) return nz > 0.6 && z > 0.255 ? PAINT.lens : PAINT.recess
    if (nz > 0.2) {
      for (const ex of EYES) {
        const dx = Math.abs(x - ex)
        const dy = Math.abs(y - 0.416)
        if (dx * dx + dy * dy < 0.029 * 0.029) return PAINT.lens
        if (dx ** 4 + dy ** 4 < 0.046 ** 4) return PAINT.recess // square mount, rounded corners
      }
    }
    if (nz > 0.45 && z < 0.25 && y > 0.37 && y < 0.496 && ax < 0.27) return PAINT.panel
    if (ny > 0.6 && z > 0.212 && z < 0.232 && ax > 0.07 && ax < 0.26) return PAINT.blue // racing stripes on top
    if (Math.abs(nx) > 0.6) {
      if (Math.abs(z - 0.7 * (y - 0.36) - 0.05) < 0.016) return PAINT.blue // diagonal side stripe
      if (y > 0.36 && y < 0.378 && z < 0.05 && z > -0.2) return PAINT.blue
    }
    if (ny < -0.6 && ax < 0.1) return PAINT.mount
    return PAINT.shell
  }

  if (ax < 0.1 && y > 0.175) return y > 0.325 || y < 0.2 ? PAINT.mount : PAINT.neck

  if (ax < 0.172 && y > -0.222 && y <= 0.185) {
    // body box
    if (nz > 0.6 && z > 0.18) {
      // front: display window (orange coils, bronze pads) and a V vent
      if (ax < 0.078 && y > -0.014 && y < 0.066 && z < 0.214) {
        if (y > 0.034 && y < 0.054 && ((x + 0.078) / 0.026) % 1 < 0.45) return PAINT.orange
        if (y > 0.002 && y < 0.016 && ax < 0.05 && ((x + 0.05) / 0.034) % 1 < 0.6) return PAINT.bronze
        return PAINT.recess
      }
      if (ax < 0.095 && y > -0.03 && y < 0.083) return PAINT.display
      // V vent with slats
      if (y > -0.156 && y < -0.064 && ax < 0.03 + ((y + 0.156) / 0.092) * 0.05) return ((y + 0.156) / 0.012) % 1 < 0.35 ? PAINT.mount : PAINT.recess
      if (ax < 0.105 && y > -0.172 && y < -0.05) return PAINT.panel
    }
    if (Math.abs(ny) < 0.5 && ((y > 0.098 && y < 0.12) || y < -0.198)) return PAINT.blue // stripe + bottom band
    if (ax > 0.162 && y > -0.205 && y < 0) return PAINT.mount // hip axle between body and housing
    return PAINT.shell
  }

  if (ax > 0.262 && y < 0 && y > -0.37) return PAINT.cable // cables along the legs
  if (ax >= 0.172 && y > 0) return y < 0.095 ? PAINT.blue : PAINT.cable // cable loops + connectors
  if (y > -0.235) return ax < 0.18 && Math.abs(nx) > 0.6 && nx * x < 0 ? PAINT.mount : PAINT.shell // side housings (inner face in shadow grey)

  // legs
  if (Math.hypot(y - KNEE_YZ[0], z - KNEE_YZ[1]) < 0.045) return PAINT.bronze
  if (y > -0.325) return PAINT.blue // thigh cover
  if (y > -0.432) return PAINT.shell // shin
  if (y > -0.452) return PAINT.bronze // ankle
  if (y > -0.477) return PAINT.blue // foot
  if (y > -0.492) return PAINT.orange // sole
  return PAINT.panel // base plate
}

/**
 * Paints the livery into the mesh's own UV layout: every texel gets the
 * colour of the surface point it maps to (plus a roughness / metalness
 * texture so the lenses shine and the joints read as metal).
 */
function paintTextures(geometry, size) {
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  const T = index.count / 3
  const W = size
  const colour = new Uint8ClampedArray(W * W * 4)
  const orm = new Uint8ClampedArray(W * W * 4)
  const painted = new Uint8Array(W * W)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const tri = new THREE.Triangle()

  const write = (i, px, py, pz) => {
    const [rgb, rough, metal] = paintAt(px, py, pz, n.x, n.y, n.z)
    colour.set(rgb, i * 4)
    colour[i * 4 + 3] = 255
    orm[i * 4] = 255
    orm[i * 4 + 1] = rough * 255
    orm[i * 4 + 2] = metal * 255
    orm[i * 4 + 3] = 255
    painted[i] = 1
  }

  // two passes: texels inside a triangle first, then the ones touching its edges
  for (const pass of [0, 1]) {
    for (let t = 0; t < T; t++) {
      const i0 = index.getX(t * 3)
      const i1 = index.getX(t * 3 + 1)
      const i2 = index.getX(t * 3 + 2)
      tri.set(a.fromBufferAttribute(pos, i0), b.fromBufferAttribute(pos, i1), c.fromBufferAttribute(pos, i2))
      tri.getNormal(n)
      const ax = uv.getX(i0) * W
      const ay = uv.getY(i0) * W
      const bx = uv.getX(i1) * W
      const by = uv.getY(i1) * W
      const cx = uv.getX(i2) * W
      const cy = uv.getY(i2) * W
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(den) < 1e-9) continue
      const eps = pass === 0 ? 1e-6 : 0.75 / Math.max(Math.sqrt(Math.abs(den)), 1)
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const y1 = Math.min(W - 1, Math.ceil(Math.max(ay, by, cy)))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x
          if (pass === 1 && painted[i]) continue
          const l0 = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den
          const l1 = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den
          const l2 = 1 - l0 - l1
          if (l0 < -eps || l1 < -eps || l2 < -eps) continue
          const w0 = Math.min(1, Math.max(0, l0))
          const w1 = Math.min(1, Math.max(0, l1))
          const w2 = Math.min(1, Math.max(0, l2))
          const s = w0 + w1 + w2
          write(i, (w0 * a.x + w1 * b.x + w2 * c.x) / s, (w0 * a.y + w1 * b.y + w2 * c.y) / s, (w0 * a.z + w1 * b.z + w2 * c.z) / s)
        }
      }
    }
  }

  // gutters take the nearest painted texel so mip-maps never bleed
  const queue = new Int32Array(W * W)
  let head = 0
  let tail = 0
  for (let i = 0; i < W * W; i++) if (painted[i]) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j >= 0 && j < W * W && !painted[j]) {
        painted[j] = 1
        colour.copyWithin(j * 4, i * 4, i * 4 + 4)
        orm.copyWithin(j * 4, i * 4, i * 4 + 4)
        queue[tail++] = j
      }
    }
  }

  const toTexture = (data, colorSpace) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = W
    canvas.getContext('2d').putImageData(new ImageData(data, W, W), 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.flipY = false // glTF UV convention
    texture.colorSpace = colorSpace
    texture.anisotropy = 4
    return texture
  }
  return { map: toTexture(colour, THREE.SRGBColorSpace), orm: toTexture(orm, THREE.NoColorSpace) }
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

  const { map, orm } = paintTextures(source.geometry, textureSize)
  const material = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: orm, // G channel
    metalnessMap: orm, // B channel
    roughness: 1,
    metalness: 1,
    // a little self-illumination keeps the white shell reading white
    emissiveMap: map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.22,
  })
  const geometry = buildSkinnedGeometry(source.geometry)
  const boneInverses = restFrames().map((f) => f.clone().invert())

  source.material?.map?.dispose()
  source.geometry.dispose()
  source.material?.dispose()
  return { geometry, material, boneInverses }
}
