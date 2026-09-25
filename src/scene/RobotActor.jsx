import { useEffect, useState } from 'react'
import { ProceduralRobot } from './Robot'
import { ScanRobot } from './ScanRobot'
import { loadScanRobot } from './scanRobotModel'

/** Loads the Higgsfield robot; on failure the procedural robot takes its place. */
function useScanRobotModel() {
  const [state, setState] = useState({ status: 'loading', model: null })

  useEffect(() => {
    const controller = new AbortController()
    let model = null
    loadScanRobot({ signal: controller.signal })
      .then((m) => {
        model = m
        if (!controller.signal.aborted) setState({ status: 'ready', model: m })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('[robot] scanned model unavailable, using the procedural robot:', err?.message ?? err)
        setState({ status: 'error', model: null })
      })
    return () => {
      controller.abort()
      if (model) {
        Object.values(model.parts).forEach((g) => g.dispose())
        model.material.map?.dispose()
        model.material.dispose()
      }
    }
  }, [])

  return state
}

export default function RobotActor({ onReady, ...props }) {
  const { status, model } = useScanRobotModel()

  useEffect(() => {
    if (status !== 'loading') onReady?.(status)
  }, [status, onReady])

  if (status === 'ready') return <ScanRobot {...props} model={model} />
  if (status === 'error') return <ProceduralRobot {...props} />
  return null
}
