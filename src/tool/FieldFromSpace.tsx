import { Badge } from './ClimatePanel'
import { MONTHS } from './format'
import { greennessLabel, type Frame } from './landsatFrames'

/** Year-by-year Landsat images of the field, the same frames shown while analyzing. */
export function FieldFromSpace({ frames }: { frames: Frame[] }) {
  if (frames.length === 0) return null
  const sorted = [...frames].sort((a, b) => a.year - b.year)
  const bare = sorted.filter((f) => f.greenness < 0.025).length
  return (
    <section className="card">
      <div className="card-head">
        <h2>Your field from space</h2>
        <span className="muted small">
          One clear image per year from NASA/USGS Landsat (30 m), over the same years as the weather analysis, preferring autumn when
          the field heads into the rainy season. The ring marks your field.
        </span>
      </div>
      <div className="filmstrip">
        {sorted.map((f) => {
          const d = new Date(`${f.date}T00:00:00Z`)
          return (
            <figure key={f.year}>
              <div className="film-img">
                <img src={f.url} alt={`Field on ${f.date}`} loading="lazy" />
                <i aria-hidden />
              </div>
              <figcaption>
                <strong>{f.year}</strong>
                <span>
                  {MONTHS[d.getUTCMonth()]} {d.getUTCDate()} · {f.sensor}
                </span>
                <span className={`green-tag g-${greennessLabel(f.greenness).replace(/ /g, '-')}`}>{greennessLabel(f.greenness)}</span>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <p className="small muted film-note">
        <Badge p="observed" /> images · <Badge p="modeled" /> “bare / green” from the visible-band excess-green index of a ~600 m window, so
        neighbouring plots can affect it. In {bare} of {sorted.length} images the spot looked mostly bare, which is when a
        winter cover crop protects the soil.
      </p>
    </section>
  )
}
