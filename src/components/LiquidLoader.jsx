import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useAnimationFrame, useMotionValue } from 'motion/react'
import { TIMING, TIME_SCALE } from '../scene/phases'

/**
 * Futuristic liquid loader.
 * A glass disc slowly fills with a silvery liquid while a hairline arc fills
 * around the circumference (1% -> 100%). At 100% the room goes dark and the
 * loader turns luminous; it drops its labels, swells, becomes unstable,
 * vibrates, brightens and contracts to a point — the moment the scene layer
 * takes over with a white energy burst on black.
 *
 * Only the integer percentage lives in React state; the liquid, arc, jitter
 * and filters are written straight to the SVG from the animation frame loop.
 */

const C = 100
const R_RING = 76
const R_LIQ = 58
const CIRC = 2 * Math.PI * R_RING
const TICKS = 72

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const hex = (h) => [16, 8, 0].map((s) => (parseInt(h.slice(1), 16) >> s) & 255)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const css = (c) => `rgb(${c.map(Math.round).join(',')})`

// light theme (while loading) -> dark theme (after 100%)
const COL = {
  ink: [hex('#1C2E1E'), hex('#ffffff')],
  tickOff: [hex('#c9cfcc'), hex('#3a3d3c')],
  track: [hex('#e2e5e3'), hex('#2b2e2d')],
  glassTop: [hex('#fdfdfc'), hex('#262a28')],
  glassBottom: [hex('#e9ecea'), hex('#0f1110')],
  glassStroke: [hex('#dde1df'), hex('#3b403e')],
  liquidTop: [hex('#c3cbc7'), hex('#eef2f0')],
  liquidBottom: [hex('#8f9a95'), hex('#b9c4bf')],
  label: [hex('#525252'), hex('#a3a3a3')],
  percent: [hex('#171717'), hex('#ffffff')],
}
const WHITE = hex('#ffffff')
const WHITE_SOFT = hex('#f6f8f7')
const themed = (key, d) => mix(COL[key][0], COL[key][1], d)

function wavePath(level, amp, k, phase) {
  const x0 = C - R_LIQ - 12
  const x1 = C + R_LIQ + 12
  let d = `M ${x0} ${C + R_LIQ + 12} L ${x0} ${(level + amp * Math.sin(x0 * k + phase)).toFixed(2)}`
  for (let x = x0 + 6; x <= x1; x += 6) {
    d += ` L ${x} ${(level + amp * Math.sin(x * k + phase)).toFixed(2)}`
  }
  return `${d} L ${x1} ${C + R_LIQ + 12} Z`
}

// Longest the loader waits for the robot model before carrying on (the robot
// component falls back to the procedural robot on its own).
const MAX_READY_WAIT_MS = 20000

export default function LiquidLoader({ onComplete, introState, ready = true }) {
  const [percent, setPercent] = useState(1)
  const [critical, setCritical] = useState(false)
  const progress = useMotionValue(1)
  const collapse = useMotionValue(0)
  const dark = useMotionValue(0)
  const shown = useRef(1)
  const level = useRef(0.01)
  const onCompleteRef = useRef(onComplete)
  const readyRef = useRef(ready)

  const groupRef = useRef()
  const arcRef = useRef()
  const dotRef = useRef()
  const wave1Ref = useRef()
  const wave2Ref = useRef()
  const stopTopRef = useRef()
  const stopBottomRef = useRef()
  const offsetRef = useRef()
  const dispRef = useRef()
  const coreRef = useRef()
  const bloomRef = useRef()
  const ticksRef = useRef()
  const haloRef = useRef()
  const trackRef = useRef()
  const glassRef = useRef()
  const glassTopRef = useRef()
  const glassBottomRef = useRef()
  const labelRef = useRef()
  const percentRef = useRef()

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    readyRef.current = ready
  }, [ready])

  useEffect(() => {
    let cancelled = false
    const running = []
    const run = (anim) => {
      running.push(anim)
      return anim
    }
    const ts = TIME_SCALE

    const unsubProgress = progress.on('change', (v) => {
      const r = Math.min(100, Math.max(1, Math.round(v)))
      shown.current = r
      setPercent((p) => (p === r ? p : r))
    })
    const unsubCollapse = collapse.on('change', (v) => {
      introState.collapse = v
    })
    const unsubDark = dark.on('change', (v) => {
      introState.dark = v
    })

    ;(async () => {
      // 1 -> 20 -> 45 -> 70 -> 90 -> 100, eased rather than linear
      await run(
        animate(progress, [1, 20, 45, 70, 90], {
          duration: (TIMING.loaderProgress * 0.87) / ts,
          delay: TIMING.loaderDelay / ts,
          times: [0, 0.23, 0.51, 0.78, 1],
          ease: ['easeOut', 'easeInOut', 'easeInOut', 'easeInOut'],
        }),
      )
      // the last 10% waits for the robot model to be ready
      const waitStart = performance.now()
      while (!cancelled && !readyRef.current && performance.now() - waitStart < MAX_READY_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      if (cancelled) return
      await run(animate(progress, 100, { duration: (TIMING.loaderProgress * 0.13) / ts, ease: 'easeOut' }))
      if (cancelled) return
      // 100%: the room goes dark
      await run(animate(dark, 1, { duration: TIMING.loaderHold / ts, ease: 'easeInOut' }))
      if (cancelled) return
      setCritical(true)
      await run(animate(collapse, 1, { duration: TIMING.loaderCritical / ts, delay: 0.2 / ts, ease: 'linear' }))
      if (cancelled) return
      onCompleteRef.current?.()
    })()

    return () => {
      cancelled = true
      running.forEach((a) => a.stop())
      unsubProgress()
      unsubCollapse()
      unsubDark()
    }
  }, [progress, collapse, dark, introState])

  useAnimationFrame((time, delta) => {
    const t = time / 1000
    const p = shown.current / 100
    // liquid level eases towards the displayed percentage (frame-rate independent)
    level.current += (p - level.current) * (1 - Math.exp(-Math.min(delta, 100) / 110))
    const lv = level.current
    const c = collapse.get()
    const d = dark.get()

    // progress arc around the circumference + head dot
    if (arcRef.current) arcRef.current.style.strokeDashoffset = `${CIRC * (1 - p)}`
    if (dotRef.current) {
      const a = -Math.PI / 2 + p * Math.PI * 2
      dotRef.current.setAttribute('cx', (C + R_RING * Math.cos(a)).toFixed(2))
      dotRef.current.setAttribute('cy', (C + R_RING * Math.sin(a)).toFixed(2))
    }

    // liquid surface
    const y = C + R_LIQ - lv * (2 * R_LIQ + 6)
    const agitation = 1 + 2.2 * smoothstep(0.05, 0.5, c)
    const amp = (1.6 + 3.2 * Math.sin(Math.PI * Math.min(1, lv))) * agitation
    wave1Ref.current?.setAttribute('d', wavePath(y, amp, 0.075, t * 2.1))
    wave2Ref.current?.setAttribute('d', wavePath(y + 1.5, amp * 0.7, 0.062, -t * 1.6 + 1.3))

    // organic edge: drift the noise field, destabilise it when critical
    offsetRef.current?.setAttribute('dx', (Math.sin(t * 0.9) * 5).toFixed(2))
    offsetRef.current?.setAttribute('dy', (Math.cos(t * 0.7) * 5).toFixed(2))
    const unstable = smoothstep(0.1, 0.55, c) * (1 - smoothstep(0.82, 1, c))
    dispRef.current?.setAttribute('scale', (4 + 12 * unstable).toFixed(2))

    // critical state: larger -> unstable/vibrating -> smaller -> brighter -> tiny
    let scale = 1
    if (c > 0) {
      if (c < 0.22) scale = 1 + 0.12 * (1 - Math.pow(1 - c / 0.22, 3))
      else if (c < 0.55) scale = 1.12 - 0.05 * ((c - 0.22) / 0.33)
      else scale = 0.03 + (1.07 - 0.03) * Math.pow(1 - (c - 0.55) / 0.45, 2.2)
    }
    const vib = (0.4 + 3.2 * smoothstep(0.12, 0.6, c)) * (1 - smoothstep(0.88, 1, c)) * (c > 0 ? 1 : 0)
    const jx = (Math.random() - 0.5) * 2 * vib
    const jy = (Math.random() - 0.5) * 2 * vib
    groupRef.current?.setAttribute(
      'transform',
      `translate(${(C + jx).toFixed(2)} ${(C + jy).toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-C} ${-C})`,
    )

    const bright = smoothstep(0.42, 0.92, c)
    stopTopRef.current?.setAttribute('stop-color', css(mix(themed('liquidTop', d), WHITE, bright)))
    stopBottomRef.current?.setAttribute('stop-color', css(mix(themed('liquidBottom', d), WHITE_SOFT, bright)))
    coreRef.current?.setAttribute('opacity', bright.toFixed(3))
    bloomRef.current?.setAttribute('opacity', (bright * 0.95).toFixed(3))

    // light -> dark theme
    const ink = css(themed('ink', d))
    arcRef.current?.setAttribute('stroke', ink)
    dotRef.current?.setAttribute('fill', ink)
    trackRef.current?.setAttribute('stroke', css(themed('track', d)))
    glassRef.current?.setAttribute('stroke', css(themed('glassStroke', d)))
    glassTopRef.current?.setAttribute('stop-color', css(themed('glassTop', d)))
    glassBottomRef.current?.setAttribute('stop-color', css(themed('glassBottom', d)))
    haloRef.current?.setAttribute('opacity', (1 - 0.8 * d).toFixed(3))
    if (labelRef.current) labelRef.current.style.color = css(themed('label', d))
    if (percentRef.current) percentRef.current.style.color = css(themed('percent', d))
    if (ticksRef.current) {
      ticksRef.current.style.opacity = `${1 - smoothstep(0, 0.3, c)}`
      ticksRef.current.style.setProperty('--tick-on', ink)
      ticksRef.current.style.setProperty('--tick-off', css(themed('tickOff', d)))
    }
  })

  return (
    <div className="relative w-[220px] h-[220px] sm:w-[260px] sm:h-[260px] animate-intro-fade-in select-none">
      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
        <defs>
          <radialGradient id="ll-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e7eae8" stopOpacity="0.9" />
            <stop offset="70%" stopColor="#eef0ef" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f7f7f5" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ll-glass" cx="42%" cy="38%" r="65%">
            <stop ref={glassTopRef} offset="0%" stopColor="#fdfdfc" />
            <stop ref={glassBottomRef} offset="100%" stopColor="#e9ecea" />
          </radialGradient>
          <linearGradient id="ll-liquid" x1="0" y1="0" x2="0" y2="1">
            <stop ref={stopTopRef} offset="0%" stopColor="#c3cbc7" />
            <stop ref={stopBottomRef} offset="100%" stopColor="#8f9a95" />
          </linearGradient>
          <radialGradient id="ll-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="ll-clip">
            <circle cx={C} cy={C} r={R_LIQ} />
          </clipPath>
          <filter id="ll-organic" x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="1" seed="7" result="noise" />
            <feOffset ref={offsetRef} in="noise" dx="0" dy="0" result="drift" />
            <feDisplacementMap ref={dispRef} in="SourceGraphic" in2="drift" scale="4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        <g ref={groupRef}>
          <circle ref={haloRef} cx={C} cy={C} r={98} fill="url(#ll-halo)" />
          <circle ref={bloomRef} cx={C} cy={C} r={96} fill="url(#ll-core)" opacity="0" />

          {/* engineering ticks */}
          <g ref={ticksRef} style={{ '--tick-on': '#1C2E1E', '--tick-off': '#c9cfcc' }}>
            {Array.from({ length: TICKS }, (_, i) => {
              const a = -Math.PI / 2 + (i / TICKS) * Math.PI * 2
              const long = i % 6 === 0
              const r0 = 85
              const r1 = long ? 91 : 88.5
              const active = i / TICKS < percent / 100
              return (
                <line
                  key={i}
                  x1={C + r0 * Math.cos(a)}
                  y1={C + r0 * Math.sin(a)}
                  x2={C + r1 * Math.cos(a)}
                  y2={C + r1 * Math.sin(a)}
                  style={{ stroke: active ? 'var(--tick-on)' : 'var(--tick-off)' }}
                  strokeOpacity={active ? 0.55 : 0.6}
                  strokeWidth={0.6}
                />
              )
            })}
          </g>

          {/* liquid body with an organic, slightly unstable contour */}
          <g filter="url(#ll-organic)">
            <circle ref={glassRef} cx={C} cy={C} r={R_LIQ + 1.5} fill="url(#ll-glass)" stroke="#dde1df" strokeWidth="0.8" />
            <g clipPath="url(#ll-clip)">
              <path ref={wave1Ref} fill="url(#ll-liquid)" opacity="0.92" />
              <path ref={wave2Ref} fill="#dfe5e2" opacity="0.55" />
              <ellipse cx={C - 20} cy={C - 30} rx={15} ry={6.5} fill="#ffffff" opacity="0.5" transform={`rotate(-32 ${C - 20} ${C - 30})`} />
            </g>
            <circle ref={coreRef} cx={C} cy={C} r={R_LIQ + 2} fill="url(#ll-core)" opacity="0" />
          </g>

          {/* circular progress: fills around the circumference */}
          <circle ref={trackRef} cx={C} cy={C} r={R_RING} fill="none" stroke="#e2e5e3" strokeWidth="1" />
          <circle
            ref={arcRef}
            cx={C}
            cy={C}
            r={R_RING}
            fill="none"
            stroke="#1C2E1E"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * 0.99}
            transform={`rotate(-90 ${C} ${C})`}
          />
          <circle ref={dotRef} cx={C} cy={C - R_RING} r="2.2" fill="#1C2E1E" />
        </g>
      </svg>

      <AnimatePresence>
        {!critical && (
          <motion.div
            key="labels"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.35, duration: 0.6 } }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.3 } }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            <span ref={labelRef} className="text-[9px] tracking-[0.42em] pl-[0.42em] text-neutral-600 font-medium">
              LOADING
            </span>
            <span ref={percentRef} className="mt-1 text-[22px] font-light tabular-nums tracking-tight text-neutral-900" aria-live="polite">
              {percent}%
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
