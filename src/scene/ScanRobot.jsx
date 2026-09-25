import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useRobotRig } from './useRobotRig'
import { SCAN_DIMS, SCAN_LAYOUT } from './scanRobotModel'

const HALF_PI = Math.PI / 2

function useCapMaterials() {
  const mats = useMemo(
    () => ({
      joint: new THREE.MeshStandardMaterial({ color: '#25282b', roughness: 0.55, metalness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ color: '#b3b8ba', roughness: 0.32, metalness: 0.8 }),
      antenna: new THREE.MeshStandardMaterial({ color: '#1f2225', roughness: 0.45, metalness: 0.5 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  return mats
}

function useCapGeometry(segs) {
  const geo = useMemo(
    () => ({ cyl: new THREE.CylinderGeometry(1, 1, 1, segs), ball: new THREE.SphereGeometry(1, 12, 8) }),
    [segs],
  )
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])
  return geo
}

function Part({ geometry, material }) {
  if (!geometry) return null
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

/** Dark cylindrical joint cap along X (hides the cut between two rigid parts). */
function Cap({ geo, mat, r, len, x = 0 }) {
  return <mesh geometry={geo.cyl} material={mat} position={[x, 0, 0]} rotation={[0, 0, HALF_PI]} scale={[r, len, r]} castShadow />
}

/** ~15 cm antenna rising out of the "ear" housing on each side of the head. */
function EarAntenna({ side, geo, mats }) {
  const [x, y, z] = SCAN_LAYOUT.ear
  return (
    <group position={[side * x, y, z]}>
      <mesh geometry={geo.cyl} material={mats.antenna} rotation={[0, 0, HALF_PI]} scale={[0.016, 0.022, 0.016]} castShadow />
      <group rotation={[0, 0, -side * 0.05]}>
        <mesh geometry={geo.cyl} material={mats.steel} position={[0, 0.012, 0]} scale={[0.006, 0.014, 0.006]} castShadow />
        <mesh geometry={geo.cyl} material={mats.antenna} position={[0, 0.094, 0]} scale={[0.0028, 0.15, 0.0028]} castShadow />
        <mesh geometry={geo.ball} material={mats.antenna} position={[0, 0.171, 0]} scale={0.0055} castShadow />
      </group>
    </group>
  )
}

function ScanLeg({ side, parts, material, rig, index, geo, mats }) {
  const key = side > 0 ? 'L' : 'R'
  const [hx, hy, hz] = SCAN_LAYOUT.hip
  return (
    <group ref={rig.hips[index]} position={[side * hx, hy, hz]} rotation={[0, 0, 0, 'ZXY']}>
      <Part geometry={parts[`thigh${key}`]} material={material} />
      <group ref={rig.knees[index]} position={SCAN_LAYOUT.knee}>
        <Cap geo={geo} mat={mats.joint} r={0.026} len={0.085} x={side * SCAN_LAYOUT.kneeCapX} />
        <Part geometry={parts[`shin${key}`]} material={material} />
        <group ref={rig.ankles[index]} position={SCAN_LAYOUT.ankle}>
          <Cap geo={geo} mat={mats.joint} r={0.017} len={0.058} x={side * SCAN_LAYOUT.ankleCapX} />
          <Part geometry={parts[`foot${key}`]} material={material} />
        </group>
      </group>
    </group>
  )
}

/**
 * The Higgsfield-generated robot, cut into rigid parts and driven by the same
 * controller (walk, head tracking, step aside, turn, crouch) as the procedural one.
 */
export function ScanRobot({ phase, onPhaseDone, mouse, quality, model, children }) {
  const { parts, material } = model
  const mats = useCapMaterials()
  const geo = useCapGeometry(quality.segs)
  const rig = useRobotRig({ phase, onPhaseDone, mouse, dims: SCAN_DIMS })

  return (
    <group ref={rig.stage}>
      <group ref={rig.root}>
        <group ref={rig.body} position={[0, SCAN_DIMS.hipH, 0]} rotation={[0, 0, 0, 'YXZ']}>
          <Part geometry={parts.torso} material={material} />

          <group ref={rig.neckBase} position={SCAN_LAYOUT.neckBase}>
            <Part geometry={parts.neck} material={material} />
            <group ref={rig.neckMid} position={SCAN_LAYOUT.neckMid}>
              <group ref={rig.head}>
                <Part geometry={parts.head} material={material} />
                <EarAntenna side={1} geo={geo} mats={mats} />
                <EarAntenna side={-1} geo={geo} mats={mats} />
              </group>
            </group>
          </group>

          <ScanLeg side={1} index={0} parts={parts} material={material} rig={rig} geo={geo} mats={mats} />
          <ScanLeg side={-1} index={1} parts={parts} material={material} rig={rig} geo={geo} mats={mats} />
        </group>
      </group>
      {children}
    </group>
  )
}
