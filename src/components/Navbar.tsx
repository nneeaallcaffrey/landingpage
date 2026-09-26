import { useEffect, useState } from 'react'

const LINKS = ['Labs', 'Studio', 'Openings', 'Shop']

export default function Navbar({ visible = true }: { visible?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <nav
        className="fixed top-0 inset-x-0 z-10 flex flex-row justify-between items-center px-5 sm:px-8 py-4 sm:py-5 text-white transition-opacity duration-700"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
      >
        <a href="#" className="flex flex-row items-center gap-3" aria-label="Mainframe home">
          <span className="text-[21px] sm:text-[26px] tracking-tight text-white" style={{ fontFamily: 'var(--font-heading)' }}>
            Mainframe®
          </span>
          <span className="text-[25px] sm:text-[30px] text-white select-none" style={{ letterSpacing: '-0.02em' }} aria-hidden="true">
            ✳︎
          </span>
        </a>

        <div className="hidden md:flex flex-row text-[23px] text-white">
          {LINKS.map((label, i) => (
            <span key={label}>
              <a href="#" className="hover:opacity-60 transition-opacity">
                {label}
              </a>
              {i < LINKS.length - 1 && ', '}
            </span>
          ))}
        </div>

        <a href="#" className="hidden md:inline text-[23px] text-white underline underline-offset-2 hover:opacity-60 transition-opacity">
          Get in touch
        </a>

        <button
          type="button"
          className="md:hidden flex flex-col gap-[5px] p-1 -mr-1"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          <span className={`block w-6 h-[2px] bg-white transition-all duration-300 ${open ? 'translate-y-[7px] rotate-45' : ''}`} />
          <span className={`block w-6 h-[2px] bg-white transition-all duration-300 ${open ? 'opacity-0' : 'opacity-100'}`} />
          <span className={`block w-6 h-[2px] bg-white transition-all duration-300 ${open ? '-translate-y-[7px] -rotate-45' : ''}`} />
        </button>
      </nav>

      <div
        className="fixed inset-0 z-[9] md:hidden bg-black/90 backdrop-blur-md flex flex-col justify-center items-start px-8 gap-8 transition-opacity duration-300"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
      >
        {LINKS.map((label) => (
          <a key={label} href="#" className="text-[32px] font-medium text-white" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            {label}
          </a>
        ))}
        <a href="#" className="text-[32px] font-medium text-white underline underline-offset-2" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
          Get in touch
        </a>
      </div>
    </>
  )
}
