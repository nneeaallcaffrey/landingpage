import { createRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RobotController } from './robotController'
import { SCENE_PHASES as P, TIME_SCALE } from './phases'

const _proj = new THREE.Vector3()
const _ndc = new THREE.Vector3()

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

  const layout = useMemo(
    () => ({
      /**
       * Where the robot stands in the frame (like the character of the hero video):
       * on wide screens its head sits right of centre, clear of the text column;
       * on tall screens it is centred and the text sits over its lower body.
       * x: NDC x of the head, headHalf: head half-width (NDC), headTop: max NDC y of
       * the antenna tips (they may brush the top edge, like hair in a portrait).
       */
      anchor() {
        const { size } = get()
        const aspect = size.width / Math.max(1, size.height)
        if (aspect >= 1.2) {
          return { x: 0.44 + Math.max(0, 1.78 - aspect) * 0.1, headHalf: 0.4 * Math.min(1, aspect / 1.6), headTop: 0.95 }
        }
        return { x: 0, headHalf: 0.8, headTop: 0.9 }
      },
      /** NDC of a stage-space point (ignores the stage's resize shift). */
      project(x, y, z) {
        const { camera } = get()
        const s = refs.stage.current ? refs.stage.current.scale.x : 1
        camera.updateMatrixWorld()
        return _ndc.set(x * s, y * s, z * s).project(camera)
      },
      /** Stage-space X of the right viewport edge at a given depth (the camera is static). */
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
    if (c.phase === P.ROBOT_CENTER || c.phase === P.ROBOT_CONFUSED || c.phase === P.ROBOT_TRACKING) {
      // Once it has arrived, keep the robot at its spot if the viewport changes. The
      // whole stage (robot + its baked contact shadow) shifts together.
      const desired = c.anchorX(layout, c.pos.z) * s
      const current = stage.position.x + c.pos.x * s
      if (Math.abs(desired - current) > 1e-3) stage.position.x += desired - current
    }
    const dt = Math.min(delta, 1 / 20) * TIME_SCALE
    c.update(dt, { camera: state.camera, mouse: mouse.current, layout })
  })

  return refs
}
