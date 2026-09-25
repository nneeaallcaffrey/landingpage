import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { RobotController, DIM } from './robotController'
import { SCENE_PHASES as P, TIME_SCALE } from './phases'

/**
 * Procedural, fully articulated service robot modelled after the
 * white / blue NVIDIA-style bipedal service robot reference:
 * a wide flat sensor head on a two-joint dark neck, a boxy torso with
 * blue lower panels, short legs with large dark knee actuators and big
 * wedge feet. Every joint is a separate pivot group.
 */

const QualityCtx = createContext({ smooth: 3, segs: 28, detail: true })

const HALF_PI = Math.PI / 2

function useRobotMaterials() {
  const mats = useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: '#eceeed', roughness: 0.42, metalness: 0.04 }),
      light: new THREE.MeshStandardMaterial({ color: '#d3d8d6', roughness: 0.5, metalness: 0.06 }),
      gray: new THREE.MeshStandardMaterial({ color: '#8e9598', roughness: 0.45, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.58, metalness: 0.35 }),
      black: new THREE.MeshStandardMaterial({ color: '#17191b', roughness: 0.62, metalness: 0.2 }),
      blue: new THREE.MeshStandardMaterial({ color: '#34507f', roughness: 0.5, metalness: 0.08 }),
      gold: new THREE.MeshStandardMaterial({ color: '#c9a24d', roughness: 0.32, metalness: 0.75 }),
      steel: new THREE.MeshStandardMaterial({ color: '#b9bec0', roughness: 0.3, metalness: 0.85 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#0b0e11',
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      lens: new THREE.MeshStandardMaterial({
        color: '#d7e0de',
        roughness: 0.2,
        metalness: 0.1,
        emissive: '#eaf3f1',
        emissiveIntensity: 0.15,
      }),
      display: new THREE.MeshBasicMaterial({ color: '#b9c4c1', toneMapped: false }),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  return mats
}

function useJointGeometries(segs) {
  const geo = useMemo(
    () => ({
      cyl: new THREE.CylinderGeometry(1, 1, 1, segs),
      sphere: new THREE.SphereGeometry(1, Math.max(10, segs / 2), Math.max(8, segs / 3)),
      torus: new THREE.TorusGeometry(1, 0.2, 8, segs),
    }),
    [segs],
  )
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])
  return geo
}

const GeoCtx = createContext(null)

/** Rounded box with shadows. */
function Box({ size, r = 0.01, mat, ...props }) {
  const q = useContext(QualityCtx)
  return (
    <RoundedBox
      args={size}
      radius={Math.min(r, Math.min(...size) / 2 - 1e-4)}
      smoothness={q.smooth}
      material={mat}
      castShadow
      receiveShadow
      {...props}
    />
  )
}

/** Cylinder whose axis runs along local X (joint axles, discs). */
function Joint({ r, len, mat, axis = 'x', ...props }) {
  const geo = useContext(GeoCtx)
  const rotation = axis === 'x' ? [0, 0, HALF_PI] : axis === 'z' ? [HALF_PI, 0, 0] : [0, 0, 0]
  return (
    <group {...props}>
      <mesh geometry={geo.cyl} material={mat} rotation={rotation} scale={[r, len, r]} castShadow receiveShadow />
    </group>
  )
}

function Ball({ r, mat, ...props }) {
  const geo = useContext(GeoCtx)
  return <mesh geometry={geo.sphere} material={mat} scale={r} castShadow {...props} />
}

function Ring({ r, tube, mat, ...props }) {
  const geo = useContext(GeoCtx)
  // unit torus (tube 0.2): scale x/y sets the ring radius, z sets its thickness
  return <mesh geometry={geo.torus} material={mat} scale={[r, r, tube / 0.2]} {...props} />
}

function Cable({ side, mat }) {
  const q = useContext(QualityCtx)
  const geometry = useMemo(() => {
    const s = side
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(s * 0.012, -0.05, 0.016),
      new THREE.Vector3(s * 0.02, -0.12, 0.022),
      new THREE.Vector3(s * 0.018, -0.172, -0.008),
      new THREE.Vector3(s * 0.006, -0.162, -0.05),
      new THREE.Vector3(-s * 0.004, -0.1, -0.058),
    ])
    return new THREE.TubeGeometry(curve, q.detail ? 40 : 18, 0.0052, q.detail ? 8 : 5, false)
  }, [side, q.detail])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={mat} castShadow />
}

/* ---------------------------------------------------------------------- */

function Leg({ side, mats, hipRef, kneeRef, ankleRef }) {
  const q = useContext(QualityCtx)
  return (
    <group ref={hipRef} position={[side * DIM.hipX, 0, 0]} rotation={[0, 0, 0, 'ZXY']}>
      {/* thigh: blue structural cover with a white front plate */}
      <Joint r={0.034} len={0.084} mat={mats.dark} />
      <Box size={[0.074, 0.13, 0.086]} r={0.016} mat={mats.blue} position={[0, -0.062, 0.002]} />
      <Box size={[0.058, 0.086, 0.014]} r={0.006} mat={mats.white} position={[0, -0.064, 0.046]} />

      <group ref={kneeRef} position={[0, -DIM.thigh, 0]}>
        {/* large dark knee actuator */}
        <Joint r={0.039} len={0.09} mat={mats.dark} />
        <Joint r={0.018} len={0.094} mat={mats.steel} />
        <Ring r={0.026} tube={0.003} mat={mats.gray} position={[side * 0.047, 0, 0]} rotation={[0, HALF_PI, 0]} />

        {/* shin */}
        <Box size={[0.06, 0.118, 0.064]} r={0.014} mat={mats.white} position={[0, -0.063, -0.004]} />
        <Box size={[0.064, 0.034, 0.068]} r={0.01} mat={mats.blue} position={[0, -0.098, -0.004]} />
        {q.detail && <Joint r={0.007} len={0.09} axis="y" mat={mats.steel} position={[0, -0.058, -0.042]} />}

        <group ref={ankleRef} position={[0, -DIM.shin, 0]}>
          <Joint r={0.025} len={0.072} mat={mats.dark} />
          {/* large mechanical wedge foot, sole on the floor when flat */}
          <Box size={[0.102, 0.028, 0.205]} r={0.01} mat={mats.black} position={[0, -0.046, 0.03]} />
          <Box size={[0.09, 0.028, 0.13]} r={0.012} mat={mats.blue} position={[0, -0.022, 0.012]} rotation={[0.1, 0, 0]} />
          <Box size={[0.098, 0.03, 0.055]} r={0.012} mat={mats.dark} position={[0, -0.043, 0.112]} />
          <Box size={[0.09, 0.03, 0.05]} r={0.01} mat={mats.dark} position={[0, -0.043, -0.05]} />
          <Box size={[0.004, 0.007, 0.07]} r={0.0015} mat={mats.gold} position={[side * 0.052, -0.034, 0.03]} />
        </group>
      </group>
    </group>
  )
}

function Antenna({ side, mats }) {
  // ~15 cm antenna rising out of each "ear" housing on the side of the head
  return (
    <group position={[side * 0.19, 0.05, -0.02]} rotation={[0, 0, -side * 0.05]}>
      <Joint r={0.0065} len={0.014} axis="y" mat={mats.steel} position={[0, 0.007, 0]} />
      <Joint r={0.0027} len={0.15} axis="y" mat={mats.dark} position={[0, 0.089, 0]} />
      <Ball r={0.0055} mat={mats.dark} position={[0, 0.166, 0]} />
    </group>
  )
}

function Lens({ x, mats }) {
  return (
    <group position={[x, 0.031, 0.168]}>
      <Ring r={0.0175} tube={0.0035} mat={mats.gold} />
      <Joint r={0.016} len={0.01} axis="z" mat={mats.glass} />
      <Ball r={0.0065} mat={mats.lens} position={[0, 0, 0.004]} scale={[0.0065, 0.0065, 0.003]} />
    </group>
  )
}

function Head({ mats, headRef }) {
  const q = useContext(QualityCtx)
  return (
    <group ref={headRef}>
      {/* wide flat sensor head */}
      <Box size={[0.37, 0.056, 0.23]} r={0.014} mat={mats.white} position={[0, 0.032, 0.05]} />
      <Box size={[0.34, 0.01, 0.19]} r={0.004} mat={mats.light} position={[0, 0.061, 0.045]} />
      <Box size={[0.3, 0.004, 0.012]} r={0.0015} mat={mats.gray} position={[0, 0.0665, 0.135]} />
      {[1, -1].map((s) => (
        <group key={s}>
          <Box size={[0.006, 0.018, 0.18]} r={0.0025} mat={mats.blue} position={[s * 0.186, 0.03, 0.05]} />
          <Box size={[0.05, 0.018, 0.006]} r={0.0025} mat={mats.blue} position={[s * 0.155, 0.03, 0.166]} />
          {/* ear housings with the antennas coming out of them */}
          <Joint r={0.017} len={0.02} mat={mats.dark} position={[s * 0.188, 0.036, -0.02]} />
          <Joint r={0.008} len={0.024} mat={mats.steel} position={[s * 0.188, 0.036, -0.02]} />
          <Antenna side={s} mats={mats} />
        </group>
      ))}
      {/* face plate with two optical sensors and a small amber status light */}
      <Box size={[0.25, 0.038, 0.006]} r={0.003} mat={mats.light} position={[0, 0.031, 0.165]} />
      <Lens x={-0.07} mats={mats} />
      <Lens x={0.07} mats={mats} />
      <Box size={[0.014, 0.006, 0.004]} r={0.0015} mat={mats.gold} position={[0.125, 0.031, 0.169]} />
      <Box size={[0.17, 0.034, 0.045]} r={0.01} mat={mats.gray} position={[0, 0.03, -0.072]} />
      {q.detail && <Box size={[0.06, 0.012, 0.03]} r={0.004} mat={mats.gray} position={[0, 0.001, 0.12]} />}
    </group>
  )
}

function Torso({ mats, armRefs }) {
  const q = useContext(QualityCtx)
  return (
    <group>
      <Box size={[0.27, 0.215, 0.245]} r={0.022} mat={mats.white} position={[0, 0.14, 0]} />
      <Box size={[0.278, 0.052, 0.252]} r={0.016} mat={mats.blue} position={[0, 0.058, 0]} />
      <Box size={[0.262, 0.016, 0.236]} r={0.006} mat={mats.gray} position={[0, 0.252, 0]} />

      {/* front: status display, vent grille, service panel */}
      <Box size={[0.105, 0.056, 0.01]} r={0.006} mat={mats.glass} position={[0.045, 0.19, 0.123]} />
      <mesh material={mats.display} position={[0.045, 0.2, 0.1285]}>
        <planeGeometry args={[0.07, 0.0035]} />
      </mesh>
      <mesh material={mats.display} position={[0.03, 0.188, 0.1285]}>
        <planeGeometry args={[0.04, 0.0025]} />
      </mesh>
      {q.detail &&
        [0, 1, 2, 3, 4].map((k) => (
          <Box key={k} size={[0.09, 0.0055, 0.008]} r={0.002} mat={mats.dark} position={[0.045, 0.14 - k * 0.0115, 0.1235]} />
        ))}
      <Box size={[0.09, 0.125, 0.01]} r={0.008} mat={mats.light} position={[-0.068, 0.165, 0.1225]} />
      <Box size={[0.07, 0.012, 0.006]} r={0.003} mat={mats.blue} position={[-0.068, 0.118, 0.1275]} />
      <Box size={[0.028, 0.007, 0.006]} r={0.002} mat={mats.gold} position={[-0.093, 0.212, 0.1275]} />

      {/* sides: shoulder emblems, blue panels, cable brackets ("arms") */}
      {[1, -1].map((s, i) => (
        <group key={s}>
          <group position={[s * 0.136, 0.17, 0.02]}>
            <Joint r={0.046} len={0.01} mat={mats.light} />
            <Joint r={0.033} len={0.013} mat={mats.dark} />
            <Joint r={0.013} len={0.016} mat={mats.steel} />
            <Ring r={0.04} tube={0.0022} mat={mats.steel} position={[s * 0.006, 0, 0]} rotation={[0, HALF_PI, 0]} />
          </group>
          <Box size={[0.01, 0.06, 0.15]} r={0.004} mat={mats.blue} position={[s * 0.137, 0.1, -0.03]} />
          <group ref={armRefs[i]} position={[s * 0.145, 0.215, -0.07]}>
            <Box size={[0.02, 0.03, 0.035]} r={0.005} mat={mats.dark} />
            <Cable side={s} mat={mats.black} />
          </group>
        </group>
      ))}

      <Box size={[0.16, 0.11, 0.02]} r={0.008} mat={mats.light} position={[0, 0.15, -0.124]} />
      <Box size={[0.1, 0.012, 0.008]} r={0.003} mat={mats.blue} position={[0, 0.115, -0.1345]} />
      {q.detail && <Box size={[0.05, 0.03, 0.01]} r={0.004} mat={mats.dark} position={[0.035, 0.17, -0.134]} />}
      <Joint r={0.024} len={0.075} mat={mats.dark} position={[0, 0.258, -0.065]} />
    </group>
  )
}

/* ---------------------------------------------------------------------- */

const _proj = new THREE.Vector3()

function robotScaleFor(size) {
  if (size.width < 640) return 0.8
  if (size.width < 1024) return 0.9
  return 1
}

export default function Robot({ phase, onPhaseDone, mouse, quality, children }) {
  const stage = useRef()
  const root = useRef()
  const body = useRef()
  const neckBase = useRef()
  const neckMid = useRef()
  const head = useRef()
  const hipL = useRef()
  const hipR = useRef()
  const kneeL = useRef()
  const kneeR = useRef()
  const ankleL = useRef()
  const ankleR = useRef()
  const armL = useRef()
  const armR = useRef()

  const mats = useRobotMaterials()
  const geo = useJointGeometries(quality.segs)
  const get = useThree((s) => s.get)
  const ctrl = useRef(null)
  const onDoneRef = useRef(onPhaseDone)

  useEffect(() => {
    onDoneRef.current = onPhaseDone
  }, [onPhaseDone])

  // Stage-space X of the right viewport edge at a given depth (the camera is static).
  const layout = useMemo(
    () => ({
      edgeX(z) {
        const { camera } = get()
        const s = stage.current ? stage.current.scale.x : 1
        camera.updateMatrixWorld()
        _proj.set(1, 0.4 * s, z * s).project(camera)
        return 1 / Math.max(1e-3, _proj.x) / s
      },
    }),
    [get],
  )

  useLayoutEffect(() => {
    stage.current.scale.setScalar(robotScaleFor(get().size))
    ctrl.current = new RobotController(
      {
        stage: stage.current,
        root: root.current,
        body: body.current,
        neckBase: neckBase.current,
        neckMid: neckMid.current,
        head: head.current,
        hips: [hipL.current, hipR.current],
        knees: [kneeL.current, kneeR.current],
        ankles: [ankleL.current, ankleR.current],
        arms: [armL.current, armR.current],
        lensMaterial: mats.lens,
      },
      { onPhaseDone: (p) => onDoneRef.current?.(p) },
    )
    return () => {
      ctrl.current = null
    }
  }, [get, mats])

  useLayoutEffect(() => {
    ctrl.current?.setPhase(phase, layout)
  }, [phase, layout])

  useFrame((state, delta) => {
    const c = ctrl.current
    if (!c) return
    const s = robotScaleFor(state.size)
    if (stage.current.scale.x !== s) stage.current.scale.setScalar(s)
    if (c.phase === P.HERO_ACTIVE) {
      // Keep ~70% of the robot in frame if the viewport changes. The whole stage
      // (robot + its baked contact shadow) shifts together, so nothing re-bakes.
      const desired = c.asideX(layout, c.pos.z) * s
      const current = stage.current.position.x + c.pos.x * s
      if (Math.abs(desired - current) > 1e-3) stage.current.position.x += desired - current
    }
    const dt = Math.min(delta, 1 / 20) * TIME_SCALE
    c.update(dt, { camera: state.camera, mouse: mouse.current, layout })
  })

  return (
    <QualityCtx.Provider value={quality}>
      <GeoCtx.Provider value={geo}>
        <group ref={stage}>
          <group ref={root}>
            <group ref={body} position={[0, DIM.hipH, 0]} rotation={[0, 0, 0, 'YXZ']}>
              {/* pelvis and hip actuator housings */}
              <Box size={[0.16, 0.06, 0.13]} r={0.014} mat={mats.dark} position={[0, 0.012, -0.004]} />
              {[1, -1].map((s) => (
                <group key={s} position={[s * 0.128, 0, 0]}>
                  <Joint r={0.044} len={0.03} mat={mats.dark} />
                  <Joint r={0.02} len={0.034} mat={mats.steel} />
                </group>
              ))}

              <Torso mats={mats} armRefs={[armL, armR]} />

              <group ref={neckBase} position={[0, 0.262, -0.065]}>
                <Box size={[0.044, 0.09, 0.04]} r={0.01} mat={mats.dark} position={[0, 0.045, 0]} />
                <group ref={neckMid} position={[0, 0.09, 0]}>
                  <Joint r={0.022} len={0.056} mat={mats.steel} />
                  <Box size={[0.04, 0.08, 0.036]} r={0.01} mat={mats.dark} position={[0, 0.04, 0]} />
                  <group position={[0, 0.08, 0]}>
                    <Joint r={0.02} len={0.05} mat={mats.dark} />
                    <Head mats={mats} headRef={head} />
                  </group>
                </group>
              </group>

              <Leg side={1} mats={mats} hipRef={hipL} kneeRef={kneeL} ankleRef={ankleL} />
              <Leg side={-1} mats={mats} hipRef={hipR} kneeRef={kneeR} ankleRef={ankleR} />
            </group>
          </group>
          {children}
        </group>
      </GeoCtx.Provider>
    </QualityCtx.Provider>
  )
}
