// FAO-56 Penman–Monteith reference evapotranspiration (Allen et al., 1998, FAO Irrigation
// and Drainage Paper 56, equations 6–40). All inputs are daily values.

export function satVaporPressure(tC: number): number {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3))
}

/** Extraterrestrial radiation Ra, MJ/m²/day (FAO-56 eq. 21). */
export function extraterrestrialRadiation(latDeg: number, doy: number): number {
  const phi = (latDeg * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365)
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  return (
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  )
}

export interface Et0Input {
  tmax: number
  tmin: number
  /** Incoming shortwave radiation, MJ/m²/day. */
  rs: number
  /** Actual vapour pressure, kPa. */
  ea: number
  /** Wind speed at 2 m, m/s. */
  u2: number
  latDeg: number
  doy: number
  elevationM: number
}

export function et0PenmanMonteith(i: Et0Input): number {
  const tmean = (i.tmax + i.tmin) / 2
  const pressure = 101.3 * Math.pow((293 - 0.0065 * i.elevationM) / 293, 5.26)
  const gamma = 0.000665 * pressure
  const delta = (4098 * satVaporPressure(tmean)) / Math.pow(tmean + 237.3, 2)
  const es = (satVaporPressure(i.tmax) + satVaporPressure(i.tmin)) / 2
  const ra = extraterrestrialRadiation(i.latDeg, i.doy)
  const rso = (0.75 + 2e-5 * i.elevationM) * ra
  const rns = 0.77 * i.rs
  const sigma = 4.903e-9
  const ratio = rso > 0 ? Math.min(1, i.rs / rso) : 0.5
  const rnl =
    sigma *
    ((Math.pow(i.tmax + 273.16, 4) + Math.pow(i.tmin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, i.ea))) *
    (1.35 * ratio - 0.35)
  const rn = rns - rnl
  const et0 =
    (0.408 * delta * rn + gamma * (900 / (tmean + 273)) * i.u2 * (es - i.ea)) /
    (delta + gamma * (1 + 0.34 * i.u2))
  return Math.max(0, et0)
}

/** Convenience: ET0 from POWER-style daily fields (mean RH). */
export function et0FromDaily(
  tmax: number,
  tmin: number,
  rs: number,
  rhMean: number,
  u2: number,
  latDeg: number,
  doy: number,
  elevationM: number,
): number {
  const es = (satVaporPressure(tmax) + satVaporPressure(tmin)) / 2
  const ea = (rhMean / 100) * es
  return et0PenmanMonteith({ tmax, tmin, rs, ea, u2, latDeg, doy, elevationM })
}
