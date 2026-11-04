# Motion on the web: how to choose and how to build it

The house motion rules, shared across the owner's sites. Locally's own design rules in `docs/design.md` win where they are more specific.

Read this before adding or changing animation in any frontend. A repo's own rules win
where they are more specific (emuLearning's `web/src/app/AGENTS.md` "What not to reach
for" is the fullest worked example).

## Pick the style by what the page is

| The page is | Motion style | Reference |
|---|---|---|
| A scroll-through marketing or story page | Scroll-led. Plays once on arrival, or is scrubbed by the scroll | emuLearning landing (GSAP), `Freelance/yourbrand-showcase` (CSS) |
| An app people tap (dashboards, tools, booking) | Reacts to input and state: press, open, appear, settle. Nothing on scroll | `locally` |
| A form or intake flow | Almost none: hover, focus, a progress bar | `Freelance/summit-quote` |

## Pick the tool by weight

The visitor's browser downloads every library. These are approximate gzipped sizes.

- **CSS only (`@keyframes`, scroll timelines `animation-timeline: view()`):** costs
  nothing to download. This is the default for demo sites and simple scroll effects.
- **GSAP core, about 25 KB, plus about 10 KB per plugin (ScrollTrigger, SplitText,
  DrawSVG, MorphSVG):** use it when you need a headline split into words, SVG drawing or
  morphing, staggered batches, or a timeline. It is free for commercial use.
- **Lenis, about 4 KB:** smooth scrolling. Only on scroll-led pages, never in an app.
- **Three.js or React Three Fiber, about 150 KB or more:** only when 3D is the point.
  Lazy-load it (`next/dynamic`, `ssr: false`), mount it near the viewport, pause it off
  screen, and render nothing when WebGL fails.

## Rules that hold everywhere

1. **One motion file per site.** Markup carries tags (`data-fx="rise|flip|split|zoom"`)
   and the one file wires them up. Don't scatter keyframes through components, and
   don't copy one site's keyframe set into the next.
2. **A written budget.** List the effects the site is allowed to use in its rules file.
   Nothing beyond the list pops in or drifts at its own speed.
3. **The page is complete without motion.** Never hide content in the markup and rely on
   JS to reveal it. Run all JS motion inside
   `gsap.matchMedia('(prefers-reduced-motion: no-preference)')`. Pair every CSS animation
   with a `prefers-reduced-motion` / `motion-reduce:` fallback.
4. **One easing signature per site**, used everywhere:
   - calm and premium (an app, a craft business): `cubic-bezier(0.16, 1, 0.3, 1)`
   - playful, with an overshoot (kids, food, fun brands): `cubic-bezier(0.3, 1.6, 0.5, 1)`
   - scrubbed scroll animations: `linear`
5. **Animate only `transform` and `opacity`.** Never animate width, height, top or
   left, except a progress bar's width.
6. **When Lenis runs with ScrollTrigger, drive both from GSAP's ticker**
   (`lenis.on('scroll', ScrollTrigger.update)`) so they agree.

## Cheap upgrades that work on any site

- Add the site's easing curve to every hover and every element that appears.
- Give buttons and cards a press state (`scale(0.97)` on active) and an open state.
- On a scroll page, split the hero headline into words with SplitText plus smooth scroll.
  That's about 40 KB and the biggest visible gain.
