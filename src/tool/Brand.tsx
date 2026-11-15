import homeImg from '../assets/home.svg'

// Brand pieces shared with the landing page (same SVG assets, so they are already cached).
const asset = (folder: string, name: string) => `${import.meta.env.BASE_URL}${folder}/${encodeURIComponent(name)}`

const LOGO_SRC = asset('landing_assets', 'Hello.svg')

/** The GoodToGrow logo. With onHome it is also a link back to the landing page. */
export function BrandLogo({ className = '', onHome }: { className?: string; onHome?: () => void }) {
  const img = <img className={`brand-logo ${className}`} src={LOGO_SRC} alt="GoodToGrow — Smart farming" />
  if (!onHome) return img
  return (
    <a
      className="brand-home"
      href="#"
      title="Back to home"
      onClick={(e) => {
        e.preventDefault()
        onHome()
      }}
    >
      {img}
    </a>
  )
}

/** The crumpled-paper "home" button; returns to the landing. */
export function HomeButton({ onHome, className = '' }: { onHome?: () => void; className?: string }) {
  if (!onHome) return null
  return (
    <button type="button" className={`home-btn ${className}`} onClick={onHome}>
      <img src={homeImg} alt="Home" />
    </button>
  )
}
