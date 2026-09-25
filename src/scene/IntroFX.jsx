import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SCENE_PHASES as P, TIMING, TIME_SCALE } from './phases'

/**
 * Cinematic intro layer rendered inside the main (static) camera view:
 *  - a full-frame "veil" that hides the room during loading, darkens slightly
 *    while the liquid loader goes critical, then fades to reveal the room
 *  - a controlled white energy burst (star-like particles + a short flash)
 */

const VEIL_WHITE = new THREE.Color('#f7f7f5')
const VEIL_CRITICAL = new THREE.Color('#d8dcda')
const VEIL_BRIGHT = new THREE.Color('#fbfbfa')
const BURST_DIST = 2.0

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smootherstep = (x) => {
  x = clamp01(x)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2

const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uDuration;
  uniform float uSpread;
  uniform float uPixelRatio;
  uniform vec3 uOrigin;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uFwd;
  attribute float aAngle;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aLife;
  attribute float aDepth;
  attribute float aTint;
  attribute float aStar;
  varying float vAlpha;
  varying float vTint;
  varying float vStar;
  void main() {
    float life = clamp(uTime / (uDuration * aLife), 0.0, 1.0);
    float travel = aSpeed * uSpread * (1.0 - pow(1.0 - life, 3.0));
    vec3 dir = normalize(uRight * cos(aAngle) + uUp * sin(aAngle) + uFwd * aDepth);
    vec3 pos = uOrigin + dir * travel;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (1.0 - 0.55 * life) * (2.0 / -mv.z);
    vAlpha = smoothstep(0.0, 0.035, uTime) * (1.0 - smoothstep(0.42, 1.0, life));
    vTint = aTint;
    vStar = aStar;
  }
`

const particleFragment = /* glsl */ `
  varying float vAlpha;
  varying float vTint;
  varying float vStar;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float glow = exp(-r * r * 22.0);
    float core = smoothstep(0.16, 0.0, r);
    float flare = (max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.1)
                 + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.1)) * vStar;
    float a = clamp(glow * 0.75 + core + flare * 0.55, 0.0, 1.0) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(vTint), a);
  }
`

const flashVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const flashFragment = /* glsl */ `
  uniform float uT;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float rise = smoothstep(0.0, 0.05, uT);
    float fade = exp(-max(0.0, uT - 0.05) * 6.5);
    float core = exp(-r * r * 9.0) * rise * fade;
    float ringR = 0.12 + 0.8 * (1.0 - exp(-uT * 5.0));
    float ring = exp(-pow((r - ringR) * 26.0, 2.0)) * 0.3 * exp(-uT * 4.0) * rise;
    float a = clamp(core + ring, 0.0, 1.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`

function buildParticles(count) {
  const geometry = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3) // origin is resolved in the shader
  const angle = new Float32Array(count)
  const speed = new Float32Array(count)
  const size = new Float32Array(count)
  const life = new Float32Array(count)
  const depth = new Float32Array(count)
  const tint = new Float32Array(count)
  const star = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    angle[i] = Math.random() * Math.PI * 2
    speed[i] = 0.12 + Math.pow(Math.random(), 0.7) * 0.95
    const big = Math.random() < 0.1
    size[i] = big ? 11 + Math.random() * 9 : 3 + Math.random() * 6
    life[i] = 0.55 + Math.random() * 0.45
    depth[i] = (Math.random() - 0.5) * 0.5
    tint[i] = 0.93 + Math.random() * 0.07
    star[i] = big ? 1 : Math.random() < 0.25 ? 0.4 : 0
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1))
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1))
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 1))
  geometry.setAttribute('aStar', new THREE.BufferAttribute(star, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)

  const material = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uDuration: { value: TIMING.explosion + TIMING.roomReveal * 0.35 },
      uSpread: { value: 1 },
      uPixelRatio: { value: 1 },
      uOrigin: { value: new THREE.Vector3() },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
    },
  })
  return { geometry, material }
}

export default function IntroFX({ phase, introState, onPhaseDone, count }) {
  const camera = useThree((s) => s.camera)
  const veil = useRef()
  const points = useRef()
  const flash = useRef()
  const local = useRef({ phase: null, t: 0, reported: new Set() })

  const veilMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: VEIL_WHITE.clone(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  )
  const { geometry, material } = useMemo(() => buildParticles(count), [count])
  const flashMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: flashVertex,
        fragmentShader: flashFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uT: { value: 0 } },
      }),
    [],
  )

  useEffect(
    () => () => {
      veilMat.dispose()
      geometry.dispose()
      material.dispose()
      flashMat.dispose()
    },
    [veilMat, geometry, material, flashMat],
  )

  // The camera never moves, so the veil and burst origin are placed once.
  useLayoutEffect(() => {
    camera.updateMatrixWorld()
    const dir = camera.getWorldDirection(new THREE.Vector3())
    veil.current.position.copy(camera.position).addScaledVector(dir, 0.5)
    veil.current.quaternion.copy(camera.quaternion)
    const origin = camera.position.clone().addScaledVector(dir, BURST_DIST)
    material.uniforms.uOrigin.value.copy(origin)
    material.uniforms.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0)
    material.uniforms.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1)
    material.uniforms.uFwd.value.copy(dir)
    flash.current.position.copy(origin)
    flash.current.quaternion.copy(camera.quaternion)
  }, [camera, material])

  useFrame((state, delta) => {
    const L = local.current
    if (L.phase !== phase) {
      L.phase = phase
      L.t = 0
    }
    L.t += Math.min(delta, 1 / 20) * TIME_SCALE
    const t = L.t
    const report = (p) => {
      if (L.reported.has(p)) return
      L.reported.add(p)
      onPhaseDone(p)
    }

    const halfH = Math.tan(THREE.MathUtils.degToRad(state.camera.fov / 2)) * BURST_DIST
    material.uniforms.uSpread.value = halfH * Math.max(1, state.camera.aspect) * 1.05
    material.uniforms.uPixelRatio.value = state.viewport.dpr
    const flashSize = halfH * 2.2 * (0.25 + 0.75 * (1 - Math.exp(-t * 7)))
    flash.current.scale.setScalar(flashSize)

    if (phase === P.LOADING) {
      veilMat.color.copy(VEIL_WHITE).lerp(VEIL_CRITICAL, Math.pow(introState.collapse, 1.4))
      veilMat.opacity = 1
      points.current.visible = false
      flash.current.visible = false
    } else if (phase === P.EXPLOSION) {
      points.current.visible = true
      flash.current.visible = true
      material.uniforms.uTime.value = t
      flashMat.uniforms.uT.value = t
      // stay dim while the stars fly out, then bloom to near-white as they fade
      veilMat.color.copy(VEIL_CRITICAL).lerp(VEIL_BRIGHT, smootherstep((t - 0.28) / 0.55))
      veilMat.opacity = 1
      if (t >= TIMING.explosion) report(P.EXPLOSION)
    } else if (phase === P.ROOM_REVEAL) {
      const tt = TIMING.explosion + t
      material.uniforms.uTime.value = tt
      flashMat.uniforms.uT.value = tt
      veilMat.color.copy(VEIL_BRIGHT)
      veilMat.opacity = 1 - easeInOutSine(t / TIMING.roomReveal)
      if (t >= TIMING.roomReveal) report(P.ROOM_REVEAL)
    }
  })

  return (
    <group>
      <mesh ref={veil} material={veilMat} renderOrder={1000} scale={20} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={flash} material={flashMat} renderOrder={1001} visible={false} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <points ref={points} geometry={geometry} material={material} renderOrder={1002} visible={false} frustumCulled={false} />
    </group>
  )
}
