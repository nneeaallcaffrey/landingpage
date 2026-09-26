import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import LiquidLoader from './components/LiquidLoader'
import Scene from './scene/Scene'
import { INITIAL_PHASE, SCENE_PHASES, isAtLeast, nextPhase } from './scene/phases'

type Quality = {
  tier: 'mobile' | 'tablet' | 'desktop'
  particles: number
  shadowMap: number
  contactRes: number
  dpr: [number, number]
  smooth: number
  segs: number
  detail: boolean
}

function detectQuality(): Quality {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1440
  const tier = w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop'
  return {
    tier,
    particles: tier === 'mobile' ? 240 : tier === 'tablet' ? 420 : 640,
    shadowMap: tier === 'mobile' ? 512 : 1024,
    contactRes: tier === 'mobile' ? 128 : 256,
    dpr: [1, tier === 'mobile' ? 1.25 : 1.5],
    smooth: tier === 'mobile' ? 2 : 3,
    segs: tier === 'mobile' ? 14 : 28,
    detail: tier !== 'mobile',
  }
}

// Lens vignette over the red studio, like the hero video; on phones the text sits
// over the robot's body, so the bottom gets a deeper red scrim.
const VIGNETTE = 'radial-gradient(ellipse 85% 95% at 68% 42%, rgba(0,0,0,0) 45%, rgba(45,0,5,0.55) 100%)'
const MOBILE_SCRIM = 'linear-gradient(to top, rgba(92,0,10,0.92) 0%, rgba(110,0,12,0.65) 38%, rgba(110,0,12,0) 68%)'

export default function App() {
  const [phase, setPhase] = useState<string>(INITIAL_PHASE)
  const [quality] = useState(detectQuality)
  const [robotReady, setRobotReady] = useState(false)
  const introState = useRef({ collapse: 0, dark: 0 })
  const mouse = useRef({ x: 0, y: 0 })

  // Deterministic, one-way phase machine: a phase can only advance from itself.
  const handlePhaseDone = useCallback((from: string) => {
    setPhase((current) => (current === from ? nextPhase(from) : current))
  }, [])
  const handleLoaderComplete = useCallback(() => handlePhaseDone(SCENE_PHASES.LOADING), [handlePhaseDone])
  const handleRobotReady = useCallback(() => setRobotReady(true), [])

  // Mouse position lives in a ref — no React updates on mousemove.
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  const revealed = isAtLeast(phase, SCENE_PHASES.ROOM_REVEAL)
  // the hero appears as the robot walks in; the typewriter types while it arrives
  const heroShown = isAtLeast(phase, SCENE_PHASES.ROBOT_ENTERING)

  return (
    <div className="relative h-screen overflow-hidden bg-white text-white antialiased">
      {/* 3D robotics studio: the robot stands in for the hero video */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        <Scene
          phase={phase}
          onPhaseDone={handlePhaseDone}
          onRobotReady={handleRobotReady}
          introState={introState.current}
          mouse={mouse}
          quality={quality}
        />
      </div>

      <div
        className="fixed inset-0 z-[1] pointer-events-none transition-opacity duration-[1400ms]"
        style={{ background: VIGNETTE, opacity: revealed ? 1 : 0 }}
        aria-hidden="true"
      />
      <div
        className="md:hidden fixed inset-0 z-[1] pointer-events-none transition-opacity duration-700"
        style={{ background: MOBILE_SCRIM, opacity: heroShown ? 1 : 0 }}
        aria-hidden="true"
      />

      <Navbar visible={heroShown} />
      {heroShown && <Hero />}

      {phase === SCENE_PHASES.LOADING && (
        <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none" role="status" aria-label="Loading">
          <LiquidLoader onComplete={handleLoaderComplete} introState={introState.current} ready={robotReady} />
        </div>
      )}
    </div>
  )
}
