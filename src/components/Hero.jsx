import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { useTypewriter } from '../hooks/useTypewriter'

const HEADLINE = "we'd love to\nhear from you!"
const SERVICE_OPTIONS = ['Brand', 'Digital', 'Campaign', 'Other']

export default function Hero() {
  const { displayed, done } = useTypewriter(HEADLINE)
  const [services, setServices] = useState([])

  const toggleService = (service) =>
    setServices((prev) => (prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service]))

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <h1
          className="text-5xl md:text-6xl lg:text-[76px] font-normal tracking-tight text-black leading-[1.08] mb-8 select-none w-full whitespace-pre-wrap"
          aria-label={HEADLINE.replace('\n', ' ')}
        >
          <span aria-hidden="true">{displayed}</span>
          {!done && <span className="inline-block w-[2px] h-[1.1em] bg-black align-middle ml-[2px] animate-blink" aria-hidden="true" />}
        </h1>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
        <p className="text-lg md:text-xl text-[#5A635A] leading-relaxed font-normal mb-14 max-w-2xl">
          Whether you have questions, feedback,
          <br className="hidden md:block" /> drop us a message and we&apos;ll get back to you as soon as possible.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
        <h2 className="text-2xl font-medium tracking-tight mb-2">What sort of service?</h2>
        <p className="opacity-85 text-[#738273] mb-8">Select all that apply</p>

        <div className="flex flex-wrap gap-3 mb-6" role="group" aria-label="Services">
          {SERVICE_OPTIONS.map((option) => {
            const active = services.includes(option)
            return (
              <motion.button
                key={option}
                type="button"
                layout
                onClick={() => toggleService(option)}
                whileTap={{ scale: 0.96 }}
                aria-pressed={active}
                className={`flex items-center gap-2 px-6 py-3 rounded-full text-base font-medium transition-colors duration-300 ${
                  active
                    ? 'bg-[#1C2E1E] text-white shadow-md shadow-emerald-950/5 transform'
                    : 'bg-white text-[#1C2E1E] border border-[#F1F3F1] hover:bg-[#F1F3F1]/55'
                }`}
              >
                <AnimatePresence initial={false}>
                  {active && (
                    <motion.span
                      key="check"
                      initial={{ scale: 0, opacity: 0, width: 0 }}
                      animate={{ scale: 1, opacity: 1, width: 'auto' }}
                      exit={{ scale: 0, opacity: 0, width: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="inline-flex"
                    >
                      <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                    </motion.span>
                  )}
                </AnimatePresence>
                {option}
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence mode="wait">
          {services.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="italic text-xs"
            >
              Please click to select services above.
            </motion.p>
          ) : (
            <motion.div
              key="ready"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="overflow-hidden max-w-2xl"
            >
              <div className="bg-[#FAFBF9] border border-[#F1F3F1] rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-[#5A635A]">
                  Ready to inquire about: <span className="text-[#1C2E1E] font-medium">{services.join(', ')}</span>
                </p>
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Inquiry: ${services.join(', ')}`)}`}
                  className="text-[#4D6D47] uppercase text-xs tracking-[0.18em] font-semibold whitespace-nowrap hover:opacity-70 transition-opacity"
                >
                  Let&apos;s Go
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  )
}
