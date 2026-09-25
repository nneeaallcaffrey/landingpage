import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
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
