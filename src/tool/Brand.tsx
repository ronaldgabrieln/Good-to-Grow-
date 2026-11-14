// Brand pieces shared with the landing page (same SVG assets, so they are already cached).
const asset = (folder: string, name: string) => `${import.meta.env.BASE_URL}${folder}/${encodeURIComponent(name)}`

const LOGO_SRC = asset('landing assets', 'Hello.svg')
const BACK_SRC = asset('our story assets', 'back.svg')

export function BrandLogo({ className = '' }: { className?: string }) {
  return <img className={`brand-logo ${className}`} src={LOGO_SRC} alt="GoodToGrow — Smart farming" />
}

/** The crumpled-paper "back" button from the "our story" page; returns to the landing. */
export function HomeButton({ onHome, className = '' }: { onHome?: () => void; className?: string }) {
  if (!onHome) return null
  return (
    <button type="button" className={`home-btn ${className}`} onClick={onHome}>
      <img src={BACK_SRC} alt="Back to home" />
    </button>
  )
}
