import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import LiquidLoader from './components/LiquidLoader'
import Scene from './scene/Scene'
import { INITIAL_PHASE, SCENE_PHASES, isAtLeast, nextPhase } from './scene/phases'

function detectQuality() {
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

function ScrollHint({ visible }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="scroll-hint"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 1.2, duration: 0.8 } }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          className="fixed bottom-7 inset-x-0 z-20 flex flex-col items-center gap-3 pointer-events-none select-none"
          aria-hidden="true"
        >
          <span className="text-[10px] tracking-[0.4em] pl-[0.4em] text-neutral-500 font-medium">SCROLL</span>
          <span className="relative block w-px h-10 bg-neutral-200 overflow-hidden">
            <span className="absolute inset-0 bg-neutral-700 animate-scroll-line" />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const [phase, setPhase] = useState(INITIAL_PHASE)
  const [quality] = useState(detectQuality)
  const [frameloop, setFrameloop] = useState('always')
  const [robotReady, setRobotReady] = useState(false)
  const introState = useRef({ collapse: 0, dark: 0 })
  const mouse = useRef({ x: 0, y: 0 })
  const phaseRef = useRef(phase)
  const transitionTriggered = useRef(false)

  const heroActive = phase === SCENE_PHASES.HERO_ACTIVE

  // Deterministic, one-way phase machine: a phase can only advance from itself.
  const handlePhaseDone = useCallback((from) => {
    setPhase((current) => (current === from ? nextPhase(from) : current))
  }, [])
  const handleLoaderComplete = useCallback(() => handlePhaseDone(SCENE_PHASES.LOADING), [handlePhaseDone])
  const handleRobotReady = useCallback(() => setRobotReady(true), [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Mouse position lives in a ref — no React updates on mousemove.
  useEffect(() => {
    const onPointerMove = (e) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  // First downward scroll while the robot watches the user starts the transition (once).
  useEffect(() => {
    const trigger = () => {
      if (phaseRef.current !== SCENE_PHASES.ROBOT_TRACKING || transitionTriggered.current) return
      transitionTriggered.current = true
      setPhase((current) =>
        current === SCENE_PHASES.ROBOT_TRACKING ? SCENE_PHASES.ROBOT_MOVING_ASIDE : current,
      )
    }
    const onWheel = (e) => {
      if (e.deltaY > 2) trigger()
    }
    let touchStartY = null
    const onTouchStart = (e) => {
      touchStartY = e.touches[0]?.clientY ?? null
    }
    const onTouchMove = (e) => {
      const y = e.touches[0]?.clientY
      if (touchStartY != null && y != null && touchStartY - y > 24) trigger()
    }
    const onKeyDown = (e) => {
      if (['ArrowDown', 'PageDown', ' ', 'Spacebar'].includes(e.key)) trigger()
    }
    const onScroll = () => {
      if (window.scrollY > 0) trigger()
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The page doesn't scroll until the robot has cleared the stage.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    if (heroActive) {
      html.style.overflow = ''
      body.style.overflow = ''
      window.scrollTo(0, 0)
    } else {
      html.style.overflow = 'hidden'
      body.style.overflow = 'hidden'
    }
    return () => {
      html.style.overflow = ''
      body.style.overflow = ''
    }
  }, [heroActive])

  // Once the robot has settled, stop the continuous render loop (renders on demand, e.g. resize).
  useEffect(() => {
    if (!heroActive) return
    const id = setTimeout(() => setFrameloop('demand'), 1800)
    return () => clearTimeout(id)
  }, [heroActive])

  const navVisibility = heroActive
    ? 'active'
    : isAtLeast(phase, SCENE_PHASES.ROBOT_TRACKING)
      ? 'subtle'
      : 'hidden'

  return (
    <div className="relative bg-white text-neutral-900 font-sans selection:bg-[#EAECE9] selection:text-[#1C2E1E] antialiased overflow-x-hidden flex flex-col lg:block lg:min-h-screen">
      {/* own stacking layer so the header (z-10) and mobile overlay (z-[9]) sit above the content (z-10) */}
      <div className="relative z-20">
        <Navbar visibility={navVisibility} />
      </div>

      {heroActive && (
        <div className="relative z-10 flex flex-col order-first lg:order-none w-full bg-white lg:bg-transparent pb-8 lg:pb-0 lg:min-h-screen">
          <main id="spade-hero" className="w-full max-w-7xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center">
            <div className="pt-12 lg:pt-16">
              <Hero />
            </div>
          </main>
        </div>
      )}

      {/* 3D robotics room — fixed full-screen during the intro */}
      <div
        className={heroActive ? 'relative w-full h-[72svh] lg:fixed lg:inset-0 lg:h-auto z-0' : 'fixed inset-0 z-0'}
        aria-hidden="true"
      >
        <Scene
          phase={phase}
          onPhaseDone={handlePhaseDone}
          onRobotReady={handleRobotReady}
          introState={introState.current}
          mouse={mouse}
          quality={quality}
          frameloop={frameloop}
        />
      </div>

      {phase === SCENE_PHASES.LOADING && (
        <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none" role="status" aria-label="Loading">
          <LiquidLoader onComplete={handleLoaderComplete} introState={introState.current} ready={robotReady} />
        </div>
      )}

      <ScrollHint visible={phase === SCENE_PHASES.ROBOT_TRACKING} />
    </div>
  )
}
