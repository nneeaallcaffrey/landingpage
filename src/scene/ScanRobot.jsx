import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { useRobotRig } from './useRobotRig'
import { BONES, SCAN_DIMS, SCAN_LAYOUT } from './scanRobotModel'

function useAntennaParts() {
  const parts = useMemo(
    () => ({
      cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
      ball: new THREE.SphereGeometry(1, 12, 8),
      rod: new THREE.MeshStandardMaterial({ color: '#1f2225', roughness: 0.45, metalness: 0.5 }),
      collar: new THREE.MeshStandardMaterial({ color: '#d9dde0', roughness: 0.4, metalness: 0.2 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts])
  return parts
}

const LENS_R = 0.0178 // glass radius (m)
const DOME_R = 0.03 // curvature of the glass dome
const DOME_ANGLE = Math.asin(LENS_R / DOME_R)

function useCameraParts() {
  const parts = useMemo(() => {
    const std = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
    return {
      housing: new RoundedBoxGeometry(0.069, 0.069, 0.033, 3, 0.008),
      barrel: new THREE.CylinderGeometry(0.0215, 0.0225, 0.012, 40).rotateX(Math.PI / 2),
      sideBarrel: new THREE.CylinderGeometry(0.0225, 0.0225, 0.066, 40).rotateX(Math.PI / 2),
      knurl: new THREE.TorusGeometry(0.0212, 0.0024, 8, 48),
      disc: new THREE.CircleGeometry(LENS_R, 40),
      iris: new THREE.RingGeometry(0.0072, 0.0125, 48),
      pupil: new THREE.CircleGeometry(0.0068, 32),
      dome: new THREE.SphereGeometry(DOME_R, 32, 8, 0, Math.PI * 2, 0, DOME_ANGLE).rotateX(Math.PI / 2),
      glint: new THREE.CircleGeometry(0.0034, 16),
      housingMat: std('#16181b', 0.5, 0.1),
      barrelMat: std('#0b0c0e', 0.35, 0.5),
      knurlMat: std('#35383d', 0.3, 0.85),
      discMat: std('#0a1119', 0.25, 0.4),
      irisMat: std('#8a5a26', 0.22, 0.9), // golden lens coating, like the reference
      pupilMat: std('#020304', 0.2, 0),
      // reflections only: added on top of the lens so the glass shines without darkening it
      domeMat: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.04,
        metalness: 1,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      glintMat: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, toneMapped: false }),
    }
  }, [])
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts])
  return parts
}

/** Lens stack in front of the plane z (knurled ring, coated lens, glass dome). */
function Lens({ z, parts }) {
  return (
    <group position={[0, 0, z]}>
      <mesh geometry={parts.knurl} material={parts.knurlMat} />
      <mesh geometry={parts.disc} material={parts.discMat} position-z={0.0001} />
      <mesh geometry={parts.iris} material={parts.irisMat} position-z={0.0003} />
      <mesh geometry={parts.pupil} material={parts.pupilMat} position-z={0.0004} />
      <mesh geometry={parts.dome} material={parts.domeMat} position-z={-DOME_R * Math.cos(DOME_ANGLE)} renderOrder={2} />
      <mesh geometry={parts.glint} material={parts.glintMat} position={[-0.0062, 0.0068, DOME_R * (1 - Math.cos(DOME_ANGLE)) - 0.0012]} renderOrder={3} />
    </group>
  )
}

/** Camera eyes (black square housings) and the third camera on the head's corner. */
function CameraEyes({ parts }) {
  const [ex, ey, ez] = SCAN_LAYOUT.eye
  return (
    <group>
      {[1, -1].map((side) => (
        <group key={side} position={[side * ex, ey, ez]} rotation-x={SCAN_LAYOUT.faceTilt}>
          <mesh geometry={parts.housing} material={parts.housingMat} castShadow />
          <mesh geometry={parts.barrel} material={parts.barrelMat} position-z={0.0225} />
          <Lens z={0.0286} parts={parts} />
        </group>
      ))}
      <group position={SCAN_LAYOUT.sideCam} rotation-x={SCAN_LAYOUT.faceTilt}>
        <mesh geometry={parts.sideBarrel} material={parts.barrelMat} castShadow />
        <Lens z={0.0331} parts={parts} />
      </group>
    </group>
  )
}

/** ~15 cm antenna rising from the top of the head on each side. */
function Antenna({ side, parts }) {
  const [x, y, z] = SCAN_LAYOUT.antenna
  return (
    <group position={[side * x, y, z]} rotation={[0, 0, -side * 0.04]}>
      <mesh geometry={parts.cyl} material={parts.collar} position={[0, 0.006, 0]} scale={[0.009, 0.014, 0.009]} castShadow />
      <mesh geometry={parts.cyl} material={parts.rod} position={[0, 0.088, 0]} scale={[0.0028, 0.15, 0.0028]} castShadow />
      <mesh geometry={parts.ball} material={parts.rod} position={[0, 0.165, 0]} scale={0.0055} castShadow />
    </group>
  )
}

/**
 * The Higgsfield-generated robot as one skinned mesh: its bones hang off the
 * articulated rig's pivots, so the same controller (walk, head tracking, turn,
 * sit) drives it and the shell bends smoothly at every joint.
 */
export function ScanRobot({ phase, onPhaseDone, mouse, model, children }) {
  const { geometry, material, boneInverses } = model
  const antenna = useAntennaParts()
  const cameras = useCameraParts()
  const rig = useRobotRig({ phase, onPhaseDone, mouse, dims: SCAN_DIMS })

  const bones = useMemo(() => Object.fromEntries(BONES.map((name) => [name, new THREE.Bone()])), [])
  const mesh = useMemo(() => {
    const skinned = new THREE.SkinnedMesh(geometry, material)
    skinned.castShadow = true
    skinned.receiveShadow = true
    skinned.frustumCulled = false
    const skeleton = new THREE.Skeleton(
      BONES.map((name) => bones[name]),
      boneInverses.map((m) => m.clone()),
    )
    // geometry is in robot space and the mesh sits at the stage origin
    skinned.bind(skeleton, new THREE.Matrix4())
    return skinned
  }, [geometry, material, boneInverses, bones])
  useEffect(() => () => mesh.skeleton.dispose(), [mesh])

  const [hx, hy, hz] = SCAN_LAYOUT.hip

  return (
    <group ref={rig.stage}>
      <primitive object={mesh} />
      <group ref={rig.root}>
        <group ref={rig.body} position={[0, SCAN_DIMS.hipH, 0]} rotation={[0, 0, 0, 'YXZ']}>
          <primitive object={bones.torso} />
          <group ref={rig.neckBase} position={SCAN_LAYOUT.neckBase}>
            <primitive object={bones.neck} />
            <group ref={rig.neckMid} position={SCAN_LAYOUT.neckMid}>
              <group ref={rig.head}>
                <primitive object={bones.head} />
                <Antenna side={1} parts={antenna} />
                <Antenna side={-1} parts={antenna} />
                <CameraEyes parts={cameras} />
              </group>
            </group>
          </group>

          {[
            [1, 0, 'L'],
            [-1, 1, 'R'],
          ].map(([side, index, key]) => (
            <group key={key} ref={rig.hips[index]} position={[side * hx, hy, hz]} rotation={[0, 0, 0, 'ZXY']}>
              <primitive object={bones[`thigh${key}`]} />
              <group ref={rig.knees[index]} position={SCAN_LAYOUT.knee}>
                <primitive object={bones[`shin${key}`]} />
                <group ref={rig.ankles[index]} position={SCAN_LAYOUT.ankle}>
                  <primitive object={bones[`foot${key}`]} />
                </group>
              </group>
            </group>
          ))}
        </group>
      </group>
      {children}
    </group>
  )
}
