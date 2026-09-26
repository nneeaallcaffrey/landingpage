import { useEffect, useState, type CSSProperties } from 'react'
import { useTypewriter } from '../hooks/useTypewriter'

const TYPED_TEXT = 'Glad you stopped in. Good taste tends to find us. Now, what are we building?'
const ACTIONS = ['Pitch us an idea', 'Come work here', 'Send a brief hello', 'See how we operate']
const EMAIL = 'hello@mainframe.co'

const TEXT: CSSProperties = { fontSize: 'clamp(18px, 4vw, 26px)', fontWeight: 400, color: '#fff' }
const PILL =
  'inline-flex items-center justify-center rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap transition-colors duration-200'

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="0.75" y="0.75" width="7" height="7" rx="1.25" />
      <rect x="4.25" y="4.25" width="7" height="7" rx="1.25" />
    </svg>
  )
}

export default function Hero() {
  const { displayed, done } = useTypewriter(TYPED_TEXT, 38, 600)
  const [actionsVisible, setActionsVisible] = useState(false)

  // the buttons don't wait for the typewriter
  useEffect(() => {
    const id = setTimeout(() => setActionsVisible(true), 400)
    return () => clearTimeout(id)
  }, [])

  const copyEmail = () => {
    navigator.clipboard?.writeText(EMAIL).catch(() => {})
  }

  return (
    <section className="relative z-[1] h-screen flex flex-col justify-end pb-12 md:justify-center md:pb-0 px-5 sm:px-8 md:px-10 overflow-hidden">
      <div className="max-w-xl relative z-10">
        <p className="pointer-events-none select-none mb-5 sm:mb-6" style={{ ...TEXT, lineHeight: 1.3, filter: 'blur(4px)' }} aria-hidden="true">
          Hey there, meet A.R.I.A,
          <br />
          Mainframe&apos;s Adaptive Response Interface Agent
        </p>

        <p className="mb-5 sm:mb-6" style={{ ...TEXT, lineHeight: 1.35, minHeight: 54 }}>
          <span className="sr-only">{TYPED_TEXT}</span>
          <span aria-hidden="true">
            {displayed}
            {!done && <span className="inline-block w-[2px] h-[1.1em] bg-white align-middle ml-[2px] animate-blink" />}
          </span>
        </p>

        <div
          className="flex flex-wrap gap-y-1"
          style={{
            opacity: actionsVisible ? 1 : 0,
            transform: actionsVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
          }}
        >
          {ACTIONS.map((label) => (
            <button key={label} type="button" className={`${PILL} bg-white text-black border border-black/10 hover:bg-black hover:text-white`}>
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={copyEmail}
            className={`${PILL} gap-2 sm:gap-3 text-white bg-transparent border border-white hover:bg-white hover:text-black`}
            aria-label={`Copy ${EMAIL}`}
          >
            <span>
              Reach us: <span className="underline underline-offset-1">{EMAIL}</span>
            </span>
            <CopyIcon />
          </button>
        </div>
      </div>
    </section>
  )
}
