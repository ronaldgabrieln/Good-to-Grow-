import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import Planner from './tool/Planner'
import homeImg from './assets/home.svg'
import { ProfileProvider } from './profile/ProfileProvider'

// Hidden demo page: reachable only by typing #behind-the-scenes (no button links to it).
const Lab = lazy(() => import('./lab/Lab'))

// SVGs live in public/ (served as-is from the site root).
const landingAsset = (name: string) =>
  `/landing_assets/${encodeURIComponent(name)}`
const storyAsset = (name: string) =>
  `/our_story_assets/${encodeURIComponent(name)}`

type View = 'landing' | 'story' | 'planner' | 'lab'

// "The team" page of our story: one card per member, left to right as in the mockup.
const TEAM = [
  { file: 'elina.svg', alt: 'Elina Sarabia Tostado, 2nd year Software Engineering' },
  { file: 'alonso.svg', alt: 'Alonso Aguilar Higuera, 2nd year Mechatronics Engineering' },
  { file: 'emma.svg', alt: 'Emma Garcia Angel, 1st year Software Engineering' },
  { file: 'ronald.svg', alt: 'Ronald G. Naraín Rivera, 2nd year Software Engineering' },
  { file: 'elena.svg', alt: 'Elena De Basabe Vargas, 2nd year Software Engineering' },
  { file: 'plant.svg', alt: 'Barrios, the plant' },
]

// The art gallery: four screens after the team, laid out like the mockups. Each piece already
// carries its caption. x / y / w are % of a 16:9 screen (left, top, width), measured from the mockups.
// toRight: stick to the window's right edge (not the 16:9 screen's), so it reaches the very end
// on wide windows too; x is then ignored.
type Art = { file: string; alt: string; x: number; y: number; w: number; toRight?: boolean }
const GALLERY: Art[][] = [
  [
    { file: 'art_gallery.svg', alt: 'Art gallery', x: 11.4, y: 1.1, w: 29.4 },
    { file: 'art2.svg', alt: '"Farmers house", Elena De Basabe (2026), mixed media', x: 3.05, y: 33.1, w: 68.7 },
    { file: 'art1.svg', alt: '"Blue hour at the fields", Elena De Basabe (2026), mixed media', x: 51.6, y: 6.7, w: 44.5 },
  ],
  [
    { file: 'art3.svg', alt: '"Barn at the fields", Elena De Basabe (2026), mixed media', x: 1.2, y: 7.4, w: 46.4 },
    { file: 'art4.svg', alt: '"Vicky the scarecrow – Head", Elena De Basabe (2026), mixed media', x: 32.6, y: 46.3, w: 25.2 },
    { file: 'art5.svg', alt: '"Vicky the scarecrow", Elena De Basabe (2026), mixed media', x: 57.9, y: 3.3, w: 31.3 },
    { file: 'art6.svg', alt: 'Our crops', x: 89.5, y: 11.4, w: 11.9 },
  ],
  [{ file: 'art7.svg', alt: '"Crops and such", Elena De Basabe (2026), mixed media', x: 1.1, y: 2.9, w: 96.8 }],
  [
    { file: 'art8.svg', alt: '"Los Carbones remix", Elena De Basabe (2026), mixed media', x: 7.5, y: 10.9, w: 43.8 },
    { file: 'art9.svg', alt: 'To do list: the 36 crops, from the sketchbook', x: 50.3, y: -5.3, w: 49.5, toRight: true },
  ],
]
// Screens side by side: page 1, the team, then the gallery.
const STORY_SCREENS = 2 + GALLERY.length

// '#3d-visual' (the landing's first button) opens the rotation planner.
const viewFromHash = (): View => {
  const h = window.location.hash
  if (h === '#our-story') return 'story'
  if (h === '#3d-visual' || h === '#planner') return 'planner'
  if (h === '#behind-the-scenes') return 'lab'
  return 'landing'
}

function App() {
  const [view, setView] = useState<View>(viewFromHash)
  // Transitions are only enabled while switching views, so opening
  // /#our-story directly or resizing the window never animates.
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<number | undefined>(undefined)

  const animate = useCallback(() => {
    setAnimating(true)
    window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => setAnimating(false), 1500)
  }, [])

  useEffect(() => {
    const onHash = () => {
      animate()
      setView(viewFromHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.clearTimeout(animTimer.current)
    }
  }, [animate])

  const isStory = view === 'story'

  // "Our story" really scrolls: an invisible scroller covers the page and the browser does the
  // scrolling (wheel, trackpad momentum, touch, keys, scrollbar). How far down it is, in screens
  // (0 → STORY_SCREENS - 1), goes to the CSS variable --x, which slides the screens sideways:
  // 1 px of scroll = 1 px sideways. Set straight on the element, so no re-render per frame.
  const sceneRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const storyX = useRef(0)
  const onStoryScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    storyX.current = max > 0 ? (el.scrollTop / max) * (STORY_SCREENS - 1) : 0
    sceneRef.current?.style.setProperty('--x', String(storyX.current))
  }, [])

  useEffect(() => {
    if (!isStory) {
      storyX.current = 0
      sceneRef.current?.style.setProperty('--x', '0') // leaving: everything glides back
      return
    }
    scrollerRef.current?.scrollTo(0, 0)
    scrollerRef.current?.focus({ preventScroll: true }) // so arrow keys / space scroll it
    // The track's length follows the window width, so on resize put the scroll back where it
    // was (same screen, same spot) instead of letting the strip drift between screens.
    const onResize = () => {
      const el = scrollerRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      el.scrollTop = (storyX.current / (STORY_SCREENS - 1)) * max
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isStory])

  if (view === 'planner')
    return (
      <ProfileProvider>
        <Planner onHome={() => (window.location.hash = '')} />
      </ProfileProvider>
    )
  if (view === 'lab')
    return (
      <Suspense fallback={null}>
        <Lab onHome={() => (window.location.hash = '')} />
      </Suspense>
    )

  return (
    <main
      className={`scene${animating ? ' is-animating' : ''}`}
      data-view={view}
      ref={sceneRef}
    >
      {/* Our story's patterned background: fades in behind the shrinking painting. */}
      <div
        className="story-bg"
        aria-hidden="true"
        style={{ backgroundImage: `url("${storyAsset('background.svg')}")` }}
      />

      {/* The painting: covers the screen on the landing, then shrinks into
          the picture frame of the "our story" page. */}
      <div
        className="frame"
        aria-hidden="true"
        style={{ backgroundImage: `url("${landingAsset('Hello (1).svg')}")` }}
      />

      {/* ---------- Landing ---------- */}
      <div className="stage landing-ui" inert={isStory}>
        <h1 className="logo">
          <img src={landingAsset('Hello.svg')} alt="GoodToGrow — Smart farming" />
        </h1>

        <nav className="menu" aria-label="Main">
          <a className="paper-btn paper-btn--visual" href="#3d-visual">
            <img src={landingAsset('Hello (7).svg')} alt="start growing" />
          </a>
          <a className="paper-btn paper-btn--story" href="#our-story">
            <img src={landingAsset('boton 2.svg')} alt="our story" />
          </a>
        </nav>
      </div>

      <footer className="footer" inert={isStory}>
        <img
          src={landingAsset('Hello (8).svg')}
          alt="Made with love by los carbones remix"
        />
      </footer>

      {/* Our story's scroller: transparent, over the pictures, only there to be scrolled. */}
      {isStory && (
        <div
          className="story-scroll"
          ref={scrollerRef}
          onScroll={onStoryScroll}
          tabIndex={-1}
          aria-hidden="true"
        >
          {/* one window height + one window width per extra screen */}
          <div
            className="story-scroll-track"
            style={{ height: `calc(100vh + ${STORY_SCREENS - 1} * 100vw)` }}
          />
        </div>
      )}

      {/* ---------- Our story ---------- */}
      <section
        className="story-stage"
        aria-label="Our story"
        aria-hidden={!isStory}
        inert={!isStory}
      >
        <img
          className="story-text"
          src={storyAsset('text (2).svg')}
          alt="We are a team of five students from Mexico united by passion for science, technology and innovation. For the 2026 NASA Space Apps Challenge, we chose to tackle the Field Shift challenge because we believe that farmers are the backbone of our communities. Our mission is to put NASA's open data directly into the hands of farmers, helping them adapt to shifting climate patterns simply and effectively."
        />
        <img className="story-heart" src={storyAsset('heart.svg')} alt="" />
        <img className="story-doodle" src={storyAsset('doodle.svg')} alt="" />

        {/* Screen 2: the team. Enters from the right while page 1 leaves to the left. */}
        <div className="strip-page team-page" style={{ '--i': 1 } as CSSProperties}>
          <div className="team-stage">
            <h2 className="team-title">
              <img src={storyAsset('the_team.svg')} alt="The team" />
            </h2>
            <img className="team-box" src={storyAsset('box.svg')} alt="" />
            <ul className="team-list">
              {TEAM.map((m, i) => (
                <li key={m.file} className={`team-card team-card--${i + 1}`}>
                  <img src={storyAsset(m.file)} alt={m.alt} />
                </li>
              ))}
            </ul>
            <img className="team-sign" src={storyAsset('los_carbones_remix.svg')} alt="Los carbones remix" />
          </div>
        </div>

        {/* Screens 3–6: the art gallery (the patterned background has faded out by now). */}
        {GALLERY.map((screen, s) => (
          <div
            key={s}
            className="strip-page gallery-page"
            style={{ '--i': s + 2 } as CSSProperties}
            role="group"
            aria-label={s === 0 ? 'Art gallery' : undefined}
          >
            <div className="gallery-stage">
              {screen.map((a) => (
                <img
                  key={a.file}
                  className={`gallery-art${a.toRight ? ' gallery-art--to-right' : ''}`}
                  src={storyAsset(a.file)}
                  alt={a.alt}
                  loading="lazy"
                  style={{ ...(a.toRight ? {} : { left: `${a.x}%` }), top: `${a.y}%`, width: `${a.w}%` }}
                />
              ))}
            </div>
          </div>
        ))}

        <a className="back-btn" href="#">
          <img src={homeImg} alt="home" />
        </a>
      </section>
    </main>
  )
}

export default App
