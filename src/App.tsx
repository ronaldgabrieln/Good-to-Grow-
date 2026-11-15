import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
  // scrolling (wheel, trackpad momentum, touch, keys, scrollbar). How far down it is (0 → 1)
  // goes to the CSS variable --p, which slides page 1 out to the left and the team in from the
  // right, 1 px of scroll = 1 px sideways. Set straight on the element, so no re-render per frame.
  const sceneRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const onStoryScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    sceneRef.current?.style.setProperty('--p', String(max > 0 ? el.scrollTop / max : 0))
  }, [])

  useEffect(() => {
    if (!isStory) {
      sceneRef.current?.style.setProperty('--p', '0') // leaving: everything glides back
      return
    }
    scrollerRef.current?.scrollTo(0, 0)
    scrollerRef.current?.focus({ preventScroll: true }) // so arrow keys / space scroll it
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
          <div className="story-scroll-track" />
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

        {/* Page 2: the team. Enters from the right while page 1 leaves to the left. */}
        <div className="team-page">
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

        <a className="back-btn" href="#">
          <img src={homeImg} alt="home" />
        </a>
      </section>
    </main>
  )
}

export default App
