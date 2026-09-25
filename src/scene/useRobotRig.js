import { createRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RobotController } from './robotController'
import { SCENE_PHASES as P, TIME_SCALE } from './phases'

const _proj = new THREE.Vector3()

export function robotScaleFor(size) {
  if (size.width < 640) return 0.8
  if (size.width < 1024) return 0.9
  return 1
}

/**
 * Connects an articulated robot rig (any geometry) to the RobotController.
 * Returns the refs the rig must attach to its pivot groups.
 *
 * @param {{ phase: string, onPhaseDone: Function, mouse: {current:{x:number,y:number}},
 *           dims?: object, lensMaterial?: THREE.Material }} opts
 */
export function useRobotRig({ phase, onPhaseDone, mouse, dims, lensMaterial }) {
  const refs = useMemo(
    () => ({
      stage: createRef(),
      root: createRef(),
      body: createRef(),
      neckBase: createRef(),
      neckMid: createRef(),
      head: createRef(),
      hips: [createRef(), createRef()],
      knees: [createRef(), createRef()],
      ankles: [createRef(), createRef()],
      arms: [createRef(), createRef()],
    }),
    [],
  )
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
        const s = refs.stage.current ? refs.stage.current.scale.x : 1
        camera.updateMatrixWorld()
        _proj.set(1, 0.4 * s, z * s).project(camera)
        return 1 / Math.max(1e-3, _proj.x) / s
      },
    }),
    [get, refs],
  )

  useLayoutEffect(() => {
    refs.stage.current.scale.setScalar(robotScaleFor(get().size))
    ctrl.current = new RobotController(
      {
        stage: refs.stage.current,
        root: refs.root.current,
        body: refs.body.current,
        neckBase: refs.neckBase.current,
        neckMid: refs.neckMid.current,
        head: refs.head.current,
        hips: refs.hips.map((r) => r.current),
        knees: refs.knees.map((r) => r.current),
        ankles: refs.ankles.map((r) => r.current),
        arms: refs.arms.map((r) => r.current),
        lensMaterial,
      },
      { onPhaseDone: (p) => onDoneRef.current?.(p), dims },
    )
    return () => {
      ctrl.current = null
    }
  }, [get, refs, dims, lensMaterial])

  useLayoutEffect(() => {
    ctrl.current?.setPhase(phase, layout)
  }, [phase, layout, dims, lensMaterial])

  useFrame((state, delta) => {
    const c = ctrl.current
    if (!c) return
    const stage = refs.stage.current
    const s = robotScaleFor(state.size)
    if (stage.scale.x !== s) stage.scale.setScalar(s)
    if (c.phase === P.HERO_ACTIVE) {
      // Keep ~70% of the robot in frame if the viewport changes. The whole stage
      // (robot + its baked contact shadow) shifts together, so nothing re-bakes.
      const desired = c.asideX(layout, c.pos.z) * s
      const current = stage.position.x + c.pos.x * s
      if (Math.abs(desired - current) > 1e-3) stage.position.x += desired - current
    }
    const dt = Math.min(delta, 1 / 20) * TIME_SCALE
    c.update(dt, { camera: state.camera, mouse: mouse.current, layout })
  })

  return refs
}
