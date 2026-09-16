import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Accordion } from '@rrg/ui-motion'

export type MotionDetailsProps = {
  summary: ReactNode
  children: ReactNode
  className?: string
  defaultOpen?: boolean
  id?: string
}

// Keep native summary activation; the shared body owns height and presence.
// Native details stays open until the closing body has finished disappearing.
export default function MotionDetails({
  summary,
  children,
  className = '',
  defaultOpen = false,
  id,
}: MotionDetailsProps) {
  const generatedId = useId()
  const bodyId = id ?? `motion-details-${generatedId}`
  const [expanded, setExpanded] = useState(defaultOpen)
  const expandedRef = useRef(defaultOpen)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    // Read current shared presence rather than a queued native toggle's old state.
    const syncPresence = () => {
      if (detailsRef.current) detailsRef.current.open = expandedRef.current || !body.hidden
    }
    const observer = new MutationObserver(syncPresence)
    observer.observe(body, { attributes: true, attributeFilter: ['hidden'] })
    syncPresence()
    return () => observer.disconnect()
  }, [expanded])

  return (
    <details ref={detailsRef} className={`motion-details ${className}`.trim()} open={defaultOpen}
      onToggle={(event) => {
        // Honor external native changes without treating exit retention as a new open.
        const nativeOpen = event.currentTarget.open
        if (nativeOpen !== (expandedRef.current || !bodyRef.current?.hidden)) {
          expandedRef.current = nativeOpen
          // A native close must not remove layout before shared exit measurement.
          event.currentTarget.open = nativeOpen || !bodyRef.current?.hidden
          setExpanded(nativeOpen)
        }
      }}>
      <summary ref={summaryRef} aria-expanded={expanded} aria-controls={bodyId}
        onClick={(event) => {
          event.preventDefault()
          const next = !expandedRef.current
          expandedRef.current = next
          // Make the natural body measurable before the shared opening effect.
          if (detailsRef.current) detailsRef.current.open = true
          setExpanded(next)
        }}>
        {summary}
      </summary>
      <Accordion ref={bodyRef} id={bodyId} open={expanded} triggerRef={summaryRef}>
        {children}
      </Accordion>
    </details>
  )
}
