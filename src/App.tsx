import { useEffect, useState } from 'react'
import './App.css'
import Planner from './tool/Planner'

// SVGs live in public/ (served as-is from the site root).
const landingAsset = (name: string) =>
  `/landing assets/${encodeURIComponent(name)}`
const storyAsset = (name: string) =>
  `/our story assets/${encodeURIComponent(name)}`

type View = 'landing' | 'story' | 'planner'

// '#3d-visual' (the landing's first button) opens the rotation planner.
const viewFromHash = (): View => {
  const h = window.location.hash
  if (h === '#our-story') return 'story'
  if (h === '#3d-visual' || h === '#planner') return 'planner'
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

  if (view === 'planner') return <Planner onHome={() => (window.location.hash = '')} />

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
            <img src={landingAsset('boton 1.svg')} alt="3d visual" />
          </a>
          <a className="paper-btn paper-btn--story" href="#our-story">
            <img src={landingAsset('boton 2.svg')} alt="our story" />
          </a>
        </nav>
      </div>

      <footer className="footer" inert={isStory}>
        <img
          src={landingAsset('pie.svg')}
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
          src={storyAsset('text.svg')}
          alt="We are a mexican team that cares about the workers that farm in our community. We want this site to be understandable for farmers, because farming is difficult and they support the economy of our city."
        />
        <img className="story-heart" src={storyAsset('heart.svg')} alt="" />
        <img className="story-doodle" src={storyAsset('doodle.svg')} alt="" />
        <a className="back-btn" href="#">
          <img src={storyAsset('back.svg')} alt="back" />
        </a>
      </section>
    </main>
  )
}

export default App
