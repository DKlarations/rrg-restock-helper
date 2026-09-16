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
  const [bodyPresent, setBodyPresent] = useState(defaultOpen)
  const bodyRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const syncPresence = () => setBodyPresent(!body.hidden)
    const observer = new MutationObserver(syncPresence)
    observer.observe(body, { attributes: true, attributeFilter: ['hidden'] })
    syncPresence()
    return () => observer.disconnect()
  }, [expanded])

  return (
    <details className={`motion-details ${className}`.trim()} open={expanded || bodyPresent}
      onToggle={(event) => {
        // Honor external native changes without treating exit retention as a new open.
        const nativeOpen = event.currentTarget.open
        if (nativeOpen !== (expanded || bodyPresent)) {
          setBodyPresent(nativeOpen)
          setExpanded(nativeOpen)
        }
      }}>
      <summary ref={summaryRef} aria-expanded={expanded} aria-controls={bodyId}
        onClick={(event) => {
          event.preventDefault()
          setBodyPresent(true)
          setExpanded((current) => !current)
        }}>
        {summary}
      </summary>
      <Accordion ref={bodyRef} id={bodyId} open={expanded} triggerRef={summaryRef}>
        {children}
      </Accordion>
    </details>
  )
}
