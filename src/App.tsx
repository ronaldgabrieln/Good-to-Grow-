import { lazy, Suspense, useEffect, useState } from 'react'
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

  useEffect(() => {
    let timer: number | undefined
    const onHash = () => {
      setAnimating(true)
      setView(viewFromHash())
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setAnimating(false), 1500)
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.clearTimeout(timer)
    }
  }, [])

  const isStory = view === 'story'

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
    <main className={`scene${animating ? ' is-animating' : ''}`} data-view={view}>
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
        <a className="back-btn" href="#">
          <img src={homeImg} alt="home" />
        </a>
      </section>
    </main>
  )
}

export default App
