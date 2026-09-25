import { useEffect, useState } from 'react'

const LINKS = ['Labs', 'Studio', 'Openings', 'Shop']

const VISIBILITY_OPACITY = { hidden: 0, subtle: 0.12, active: 1 }

/**
 * @param {{ visibility: 'hidden' | 'subtle' | 'active' }} props
 * Kept hidden / extremely subtle during the cinematic intro.
 */
export default function Navbar({ visibility = 'active' }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const interactive = visibility === 'active'

  useEffect(() => {
    if (!interactive) setIsMobileMenuOpen(false)
  }, [interactive])

  useEffect(() => {
    if (!isMobileMenuOpen) return
    const onKey = (e) => e.key === 'Escape' && setIsMobileMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobileMenuOpen])

  const close = () => setIsMobileMenuOpen(false)

  return (
    <>
      <header
        className="fixed top-0 inset-x-0 z-10 px-5 sm:px-8 py-4 sm:py-5 flex flex-row justify-between items-center bg-transparent"
        style={{
          opacity: VISIBILITY_OPACITY[visibility] ?? 1,
          pointerEvents: interactive ? 'auto' : 'none',
          transition: 'opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        aria-hidden={!interactive}
      >
        <a href="#spade-hero" className="flex flex-row items-center gap-3" aria-label="Mainframe home" tabIndex={interactive ? 0 : -1}>
          <span className="text-[21px] sm:text-[26px] tracking-tight text-black font-medium select-none">Mainframe®</span>
          <span className="text-[25px] sm:text-[30px] text-black select-none tracking-[-0.02em] font-medium leading-none mb-1" aria-hidden="true">
            ✳
          </span>
        </a>

        <nav className="hidden md:flex items-center text-[23px] text-black" aria-label="Primary">
          {LINKS.map((link, i) => (
            <span key={link} className="flex items-center">
              <a href="#" className="hover:opacity-60 transition-opacity" tabIndex={interactive ? 0 : -1}>
                {link}
              </a>
              {i < LINKS.length - 1 && <span className="opacity-40">,&nbsp;</span>}
            </span>
          ))}
        </nav>

        <a
          href="#spade-hero"
          className="hidden md:block text-[23px] text-black underline underline-offset-2 hover:opacity-60 transition-opacity"
          tabIndex={interactive ? 0 : -1}
        >
          Get in touch
        </a>

        <button
          type="button"
          className="md:hidden flex flex-col justify-center items-center gap-[5px] w-10 h-10 -mr-2"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-navigation"
          tabIndex={interactive ? 0 : -1}
        >
          <span className={`w-6 h-[2px] bg-black transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-[7px]' : ''}`} />
          <span className={`w-6 h-[2px] bg-black transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`} />
          <span className={`w-6 h-[2px] bg-black transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-[7px]' : ''}`} />
        </button>
      </header>

      {/* Mobile navigation overlay */}
      <div
        id="mobile-navigation"
        className={`fixed inset-0 z-[9] bg-white/95 backdrop-blur-sm md:hidden transition-opacity duration-300 ${
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!isMobileMenuOpen}
      >
        <nav className="h-full flex flex-col justify-center px-8 gap-2" aria-label="Mobile">
          {LINKS.map((link) => (
            <a
              key={link}
              href="#"
              onClick={close}
              className="text-5xl tracking-tight text-black hover:opacity-60 transition-opacity"
              tabIndex={isMobileMenuOpen ? 0 : -1}
            >
              {link}
            </a>
          ))}
          <a
            href="#spade-hero"
            onClick={close}
            className="mt-10 text-2xl text-black underline underline-offset-2 hover:opacity-60 transition-opacity"
            tabIndex={isMobileMenuOpen ? 0 : -1}
          >
            Get in touch
          </a>
        </nav>
      </div>
    </>
  )
}
