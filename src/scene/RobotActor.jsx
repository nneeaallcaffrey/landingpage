import { useEffect, useState } from 'react'
import { ProceduralRobot } from './Robot'
import { ScanRobot } from './ScanRobot'
import { loadScanRobot } from './scanRobotModel'

/** Loads the Higgsfield robot; on failure the procedural robot takes its place. */
function useScanRobotModel(textureSize) {
  const [state, setState] = useState({ status: 'loading', model: null })

  useEffect(() => {
    const controller = new AbortController()
    let model = null
    const dispose = (m) => {
      m.geometry.dispose()
      m.material.map?.dispose()
      m.material.dispose()
    }
    loadScanRobot({ signal: controller.signal, textureSize })
      .then((m) => {
        if (controller.signal.aborted) return dispose(m)
        model = m
        setState({ status: 'ready', model: m })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('[robot] scanned model unavailable, using the procedural robot:', err?.message ?? err)
        setState({ status: 'error', model: null })
      })
    return () => {
      controller.abort()
      if (model) dispose(model)
    }
  }, [textureSize])

  return state
}

export default function RobotActor({ onReady, ...props }) {
  const { status, model } = useScanRobotModel(props.quality?.tier === 'mobile' ? 512 : 1024)

  useEffect(() => {
    if (status !== 'loading') onReady?.(status)
  }, [status, onReady])

  if (status === 'ready') return <ScanRobot {...props} model={model} />
  if (status === 'error') return <ProceduralRobot {...props} />
  return null
}
