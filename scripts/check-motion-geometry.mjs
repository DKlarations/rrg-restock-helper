import assert from 'node:assert/strict'

// Real browser geometry, including the frame where shared presence hides a body.
export async function checkMotionGeometry({ evaluate, pageCall, fresh, record, save, capture, baseline = false }) {
  const targets = [
    { name: 'settings', trigger: '.settings-panel > summary', container: '.settings-panel' },
    { name: 'duplicates', trigger: '.duplicate-details > summary', container: '.duplicate-details' },
  ]
  for (const width of [1440, 390, 320]) {
    await pageCall('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false })
    for (const target of targets) {
      for (const rate of [1, 0.2]) {
        await fresh()
        if (target.catalogue) await evaluate(async () => {
          document.querySelector('.catalogue-eye').click()
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })
        const resultPromise = evaluate(async (target, rate) => {
          const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          let trigger = document.querySelector(target.trigger)
          const id = trigger.getAttribute('aria-controls')
          let body = document.getElementById(id)
          if (!body.hidden) { trigger.click(); await wait(250) }
          trigger.scrollIntoView({ block: 'center' })
          const beforeWidth = document.documentElement.scrollWidth
          const transitions = []
          for (const opening of [true, false]) {
            trigger = document.querySelector(opening ? target.trigger : target.close || target.trigger)
            trigger.click()
            await frame()
            body = document.getElementById(id)
            const content = body.querySelector(target.panel ? '.rrg-motion-panel__content' : '.rrg-motion-accordion__content')
            const animation = body.getAnimations()[0]
            animation?.updatePlaybackRate(rate)
            const keyframes = animation?.effect.getKeyframes() ?? []
            const samples = []
            const start = performance.now()
            let settledFrames = 0
            while (performance.now() - start < 4000 && settledFrames < 3) {
              const rect = body.getBoundingClientRect()
              const inner = content?.getBoundingClientRect()
              const container = document.querySelector(target.container)?.getBoundingClientRect()
              const controls = [...body.querySelectorAll('input,select,textarea')].map((control) => {
                const box = control.getBoundingClientRect()
                return [box.width, box.height]
              })
              samples.push({ phase: body.dataset.motionPhase, hidden: body.hidden, width: rect.width, height: rect.height, innerWidth: inner?.width ?? 0, innerHeight: inner?.height ?? 0, innerScroll: content?.scrollHeight ?? 0, containerHeight: container?.height ?? 0, controls, documentWidth: document.documentElement.scrollWidth })
              const settled = body.dataset.motionPhase === (opening ? 'open' : 'closed')
              settledFrames = settled ? settledFrames + 1 : 0
              await frame()
            }
            transitions.push({ opening, keyframes, samples })
          }
          return { beforeWidth, transitions }
        }, target, rate)
        const capturePromise = capture && rate === 0.2 && !baseline ? (async () => {
          await new Promise((resolve) => setTimeout(resolve, target.name === 'sheet' ? 600 : 350))
          const image = await pageCall('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          await capture(`${target.name}-${width}-opening.png`, image.data)
        })() : Promise.resolve()
        const [result] = await Promise.all([resultPromise, capturePromise])
        await save(`${target.name}-${width}-${rate}.json`, result)
        if (!baseline) {
          const open = result.transitions[0]
          const natural = open.samples.at(-1)
          assert.equal(natural.phase, 'open', `${target.name}: opening never settled`)
          assert.ok(natural.height > 0, `${target.name}: open body has no size`)
          for (const transition of result.transitions) {
            const visible = transition.samples.filter((sample) => !sample.hidden)
            assert.ok(visible.length > 2, `${target.name}: no intermediate frames`)
            for (const sample of visible) {
              assert.ok(Math.abs(sample.width - natural.width) <= 1, `${target.name}: width squeezed`)
              assert.ok(Math.abs(sample.innerHeight - natural.innerHeight) <= 1, `${target.name}: measured content compressed ${sample.innerHeight}/${natural.innerHeight}`)
              assert.deepEqual(sample.controls, natural.controls, `${target.name}: child controls resized`)
              assert.ok(sample.documentWidth <= Math.max(result.beforeWidth, natural.documentWidth) + 1, `${target.name}: disclosure introduced overflow`)
              if (target.panel) assert.ok(Math.abs(sample.height - natural.height) <= 1, `${target.name}: panel height animated`)
            }
            if (target.panel) assert.ok(transition.keyframes.every((keyframe) => !('height' in keyframe) && !('width' in keyframe)), 'Panel keyframes change geometry')
            else assert.ok(transition.keyframes.every((keyframe) => !('opacity' in keyframe) && !('transform' in keyframe)), 'Accordion uses a second body effect')
          }
          const close = result.transitions[1].samples
          assert.equal(close.at(-1).phase, 'closed')
          assert.equal(close.at(-1).hidden, true)
          if (!target.panel) {
            const lastVisible = close.findLast((sample) => !sample.hidden)
            const settled = close.at(-1)
            assert.ok(Math.abs(lastVisible.containerHeight - settled.containerHeight - lastVisible.height) <= 1, `${target.name}: end-of-close footprint jump`)
          }
        }
        record(`${target.name} ${width}px ${rate === 1 ? 'normal' : 'slowed'} intermediate geometry${baseline ? ' baseline' : ''}`, { frames: result.transitions.map((transition) => transition.samples.length), naturalHeight: result.transitions[0].samples.at(-1).height })
      }
      if (!baseline) {
        await fresh()
        if (target.catalogue) await evaluate(async () => {
          document.querySelector('.catalogue-eye').click()
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })
        const id = await evaluate(async (target) => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const trigger = document.querySelector(target.trigger)
          const id = trigger.getAttribute('aria-controls')
          const body = document.getElementById(id)
          if (!body.hidden) { trigger.click(); await wait(250) }
          for (let i = 0; i < 9; i++) {
            const selector = target.panel && i % 2 ? target.close : target.trigger
            document.querySelector(selector).click()
            await wait(15)
          }
          await wait(260)
          if (body.hidden || body.dataset.motionPhase !== 'open' || body.inert) throw new Error('Rapid reversal lost newest open state')
          document.querySelector(target.close || target.trigger).click()
          await new Promise((resolve) => requestAnimationFrame(resolve))
          if (!body.inert || body.getAttribute('aria-hidden') !== 'true') throw new Error('Closing disclosure remains interactive')
          return id
        }, target)
        await pageCall('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        const reduced = await evaluate(async (id, target) => {
          const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
          await frame(); await frame()
          const body = document.getElementById(id)
          if (!body.hidden || body.getAnimations().length) throw new Error('Live reduced close did not settle')
          if (body.closest('details')?.open) throw new Error('Native details retained blank space after close')
          document.querySelector(target.trigger).click(); await frame(); await frame()
          if (body.hidden || body.inert || body.getAnimations().length) throw new Error('Reduced reopen is stale')
          const focusTarget = body.querySelector('input,select,textarea,button') || document.querySelector(target.trigger)
          focusTarget.focus()
          document.querySelector(target.close || target.trigger).click(); await frame(); await frame()
          if (!body.hidden || body.getAnimations().length || document.activeElement !== document.querySelector(target.trigger)) throw new Error('Reduced close lost immediate presence or focus recovery')
          return { phase: body.dataset.motionPhase, count: document.querySelectorAll(`[id="${id}"]`).length }
        }, id, target)
        assert.equal(reduced.count, 1)
        await pageCall('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
        record(`${target.name} ${width}px rapid reversal and live reduced motion`, reduced)
      }
    }
  }
}
