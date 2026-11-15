"""Independent check of the night drainage DE  dm/dt = k (m - m_inf)  (pure Python, no numpy).

Written separately from src/engine/ground.ts so the two implementations check each other.
Usage: python -I analysis/verify_de.py field-data/live-2026-11-15_0002.csv field-data/power-hourly-ensenada-2026-11-10_12.json [minutes, default 30]
"""
import csv, json, math, sys
from collections import defaultdict
from datetime import datetime

csv_path, power_path = sys.argv[1], sys.argv[2]
WIN = int(sys.argv[3]) if len(sys.argv) > 3 else 30  # minutes per mean for method B

# ---------- 1. data: 5 s readings -> 1-minute means ----------
rows = []
with open(csv_path, encoding='utf-8-sig') as f:
    for r in csv.DictReader(f):
        if r['soil_raw']:
            rows.append((datetime.strptime(r['pc_time'], '%Y-%m-%d %H:%M:%S'), int(r['soil_raw'])))
bins = defaultdict(list)
for t, v in rows:
    bins[t.replace(second=0)].append(v)
minutes = sorted((t, sum(v) / len(v)) for t, v in bins.items())
t0_all = minutes[0][0]
peak_i = max(range(len(minutes)), key=lambda i: (minutes[i][1], i))  # latest highest
peak_t, peak_v = minutes[peak_i]
print('1. DATA')
print(f'   readings {len(rows)}, 1-min means {len(minutes)}, from {minutes[0][0]:%H:%M} to {minutes[-1][0]:%H:%M}')
print(f'   peak {peak_v:.1f} at {peak_t:%H:%M}; last {minutes[-1][1]:.1f}')

seg = minutes[peak_i:]
xs = [(t - peak_t).total_seconds() / 3600 for t, _ in seg]   # hours since peak
ys = [v for _, v in seg]
n = len(xs)

def lin_ls(e):
    """fit y = m_inf + b*e  (e = exp(-x/tau)) by least squares; return m_inf, b, sse"""
    se = sum(e); see = sum(a * a for a in e); sy = sum(ys); sey = sum(a * y for a, y in zip(e, ys))
    det = n * see - se * se
    b = (n * sey - se * sy) / det
    m = (sy - b * se) / n
    sse = sum((y - (m + b * a)) ** 2 for a, y in zip(e, ys))
    return m, b, sse

def fit_tau(tau):
    return lin_ls([math.exp(-x / tau) for x in xs])

# ---------- 2. method A: nonlinear least squares, continuous tau (golden-section) ----------
lo, hi = math.log(0.2), math.log(100)
g = (math.sqrt(5) - 1) / 2
a, b_ = lo, hi
c, d = b_ - g * (b_ - a), a + g * (b_ - a)
for _ in range(100):
    if fit_tau(math.exp(c))[2] < fit_tau(math.exp(d))[2]:
        b_ = d
    else:
        a = c
    c, d = b_ - g * (b_ - a), a + g * (b_ - a)
tauA = math.exp((a + b_) / 2)
mA, bA, sseA = fit_tau(tauA)
rmseA = math.sqrt(sseA / n)
ybar = sum(ys) / n
r2A = 1 - sseA / sum((y - ybar) ** 2 for y in ys)
print('\n2. METHOD A - nonlinear least squares on m(t) = m_inf + b e^(-t/tau)')
print(f'   m_inf = {mA:.2f}   b = {bA:.2f}   tau = {tauA:.3f} h   k = -1/tau = {-1/tauA:.4f} 1/h')
print(f'   RMSE = {rmseA:.2f} raw   R^2 = {r2A:.4f}   (n = {n})')

# ---------- 3. method B: the DE itself, from measured rates ----------
# 10-minute means, rate by central difference, then OLS: rate = k*m + c  ->  m_inf = -c/k
ten = defaultdict(list)
for t, v in seg:
    ten[t.replace(minute=t.minute // WIN * WIN)].append(v)
tens = sorted((t, sum(v) / len(v)) for t, v in ten.items() if len(v) >= WIN - 5)
pts = []
for i in range(1, len(tens) - 1):
    dt = (tens[i + 1][0] - tens[i - 1][0]).total_seconds() / 3600
    pts.append((tens[i][1], (tens[i + 1][1] - tens[i - 1][1]) / dt))
mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
kB = sum((p[0] - mx) * (p[1] - my) for p in pts) / sum((p[0] - mx) ** 2 for p in pts)
cB = my - kB * mx
mB = -cB / kB
res = [p[1] - (kB * p[0] + cB) for p in pts]
r2B = 1 - sum(r * r for r in res) / sum((p[1] - my) ** 2 for p in pts)
print(f'\n3. METHOD B - DE from data: regress dm/dt on m ({WIN}-min means, central differences)')
print(f'   dm/dt = {kB:.4f} * m + {cB:.2f}   ->  k = {kB:.4f} 1/h (tau = {-1/kB:.2f} h), m_inf = {mB:.1f}')
print(f'   R^2 = {r2B:.3f}   (n = {len(pts)} rates)')

# ---------- 4. method C: linearised, ln(m - m_inf) vs t should be a straight line ----------
lx, ly = [], []
for x, y in zip(xs, ys):
    if y - mA > 3:
        lx.append(x); ly.append(math.log(y - mA))
mlx = sum(lx) / len(lx); mly = sum(ly) / len(ly)
sC = sum((p - mlx) * (q - mly) for p, q in zip(lx, ly)) / sum((p - mlx) ** 2 for p in lx)
r2C = 1 - sum((q - (mly + sC * (p - mlx))) ** 2 for p, q in zip(lx, ly)) / sum((q - mly) ** 2 for q in ly)
print('\n4. METHOD C - linearised check: ln(m - m_inf) vs t')
print(f'   slope = {sC:.4f} 1/h (tau = {-1/sC:.2f} h)   R^2 = {r2C:.4f}')

# ---------- 5. is the DE needed? compare simpler models ----------
def aic(sse, p):
    return n * math.log(sse / n) + 2 * p
mx_ = sum(xs) / n
sl = sum((x - mx_) * (y - ybar) for x, y in zip(xs, ys)) / sum((x - mx_) ** 2 for x in xs)
sse_lin = sum((y - (ybar + sl * (x - mx_))) ** 2 for x, y in zip(xs, ys))
# exponential to zero: m = m0 e^(-t/tau) -> fit ln m linearly (approx), then score in raw units
lm = [math.log(y) for y in ys]; mlm = sum(lm) / n
s0 = sum((x - mx_) * (q - mlm) for x, q in zip(xs, lm)) / sum((x - mx_) ** 2 for x in xs)
sse_e0 = sum((y - math.exp(mlm + s0 * (x - mx_))) ** 2 for x, y in zip(xs, ys))
print('\n5. MODEL COMPARISON (lower AIC = better; difference > 10 is decisive)')
for name, sse, p in [('straight line  m = a + b t', sse_lin, 2), ('decay to zero  m = m0 e^(-t/tau)', sse_e0, 2), ('our DE  m = m_inf + b e^(-t/tau)', sseA, 3)]:
    print(f'   {name:36s} RMSE {math.sqrt(sse / n):5.2f}   AIC {aic(sse, p):8.1f}')

# ---------- 6. residuals: any pattern left? ----------
resA = [y - (mA + bA * math.exp(-x / tauA)) for x, y in zip(xs, ys)]
lag1 = sum(resA[i] * resA[i - 1] for i in range(1, n)) / sum(r * r for r in resA)
by_hour = defaultdict(list)
for x, r in zip(xs, resA):
    by_hour[int(x)].append(r)
print('\n6. RESIDUALS (data - fit)')
print('   mean by hour since peak: ' + '  '.join(f'h{h}:{sum(v)/len(v):+.1f}' for h, v in sorted(by_hour.items())))
print(f'   lag-1 autocorrelation {lag1:.2f} (1-min means; values near 1 = slow wiggles, see note)')

# ---------- 7. sensitivity: does the answer depend on the window? ----------
print('\n7. SENSITIVITY TO THE FIT WINDOW')
full_xs, full_ys = xs, ys
for label, s_h, e_h in [('peak -> end (used)', 0, 99), ('start 30 min after peak', 0.5, 99), ('start 60 min after peak', 1, 99), ('drop last hour', 0, xs[-1] - 1), ('first 4 h only', 0, 4)]:
    sel = [(x, y) for x, y in zip(full_xs, full_ys) if s_h <= x <= e_h]
    xs = [p[0] for p in sel]; ys = [p[1] for p in sel]; n = len(xs)
    best = min((fit_tau(0.2 * 500 ** (k / 400)) + (0.2 * 500 ** (k / 400),) for k in range(401)), key=lambda r: r[2])
    print(f'   {label:26s} m_inf {best[0]:6.1f}   tau {best[3]:5.2f} h')
xs, ys, n = full_xs, full_ys, len(full_xs)

# ---------- 8. what the fitted DE predicts ----------
left = bA * math.exp(-xs[-1] / tauA)
print('\n8. PREDICTIONS FROM THE FITTED DE')
print(f'   half-life of the excess water: tau*ln2 = {tauA*math.log(2):.2f} h')
print(f'   still to drain at the last reading: {left:.1f} raw = {100*left/peak_v:.1f}% of the peak')
print(f'   field capacity = m_inf = {mA:.1f} raw = {100*mA/peak_v:.1f}% of the peak')
print(f'   rate at the peak: {-bA/tauA:.1f} raw/h ; at the last reading: {-left/tauA:.1f} raw/h')

# ---------- 9. NASA POWER: how much could the air evaporate on those night hours? ----------
P = json.load(open(power_path))['properties']['parameter']
z = json.load(open(power_path))['geometry']['coordinates'][2]  # NASA grid-cell elevation, m
pres = 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26
gam = 0.000665 * pres
def es(T): return 0.6108 * math.exp(17.27 * T / (T + 237.3))
def et0_hour_night(T, RH, u2, Rn=-0.10):
    """FAO-56 eq. 53 (hourly). Night: Rs = 0, Rn = net longwave (assumed -0.10 MJ/m2/h), G = 0.5 Rn."""
    D = 4098 * es(T) / (T + 237.3) ** 2
    G = 0.5 * Rn
    return max(0.0, (0.408 * D * (Rn - G) + gam * 37 / (T + 273) * u2 * (es(T) - es(T) * RH / 100)) / (D + gam * (1 + 0.34 * u2)))
print(f"\n9. NASA POWER hourly at {json.load(open(power_path))['geometry']['coordinates'][:2]} (cell elevation {z:.0f} m), hours 00:30-07:30, nearest published nights")
nights = []
for day in ['20261110', '20261111', '20261112']:
    tot = tot_aero = 0.0; temps = []
    for h in range(0, 8):
        key = f'{day}{h:02d}'
        T, RH, u2 = P['T2M'][key], P['RH2M'][key], P['WS2M'][key]
        frac = 0.5 if h in (0, 7) else 1.0   # 00:30-07:30 window
        tot += frac * et0_hour_night(T, RH, u2)
        tot_aero += frac * et0_hour_night(T, RH, u2, Rn=0.0)
        temps.append(T)
    nights.append(tot)
    print(f'   night of {day[6:]} Nov: T {min(temps):.1f}-{max(temps):.1f} C   ET0 over the 7 h = {tot:.2f} mm (no longwave loss: {tot_aero:.2f} mm)')
et0_night = max(nights)

# ---------- 10. observed loss: the probe is in a pot (25 cm x 22 cm terracotta, potting mix + garden soil, Ensenada) ----------
# raw -> water content needs a calibration we have not done yet. Assumption (labelled): linear, raw 0 = dry,
# the settled reading = container capacity of the mix. Typical container capacity of a potting mix + soil blend: 0.35-0.50.
POT_D_CM, POT_DEPTH_CM = 25.0, 22.0
area_m2 = math.pi * (POT_D_CM / 200) ** 2
vol_l = area_m2 * POT_DEPTH_CM / 100 * 1000
d_raw = peak_v - minutes[-1][1]
print('\n10. OBSERVED LOSS IN THE POT vs NASA DEMAND (raw -> water content is an ASSUMPTION until calibrated)')
print(f'   pot: {POT_D_CM:.0f} cm across, {POT_DEPTH_CM:.0f} cm of soil -> surface {area_m2:.4f} m2 ({area_m2*1000:.0f} mL = 1 mm), soil {vol_l:.1f} L (cylinder)')
print(f'   drop {d_raw:.0f} raw from the peak; NASA night ET0 at most {et0_night:.2f} mm = {et0_night*area_m2*1000:.0f} mL from this pot')
for theta_cc in (0.35, 0.40, 0.50):
    d_theta = theta_cc * d_raw / mA
    whole_ml = d_theta * vol_l * 1000          # if the whole pot lost water like the probe zone
    mm = whole_ml / (area_m2 * 1000)
    print(f'   container capacity {theta_cc:.2f}: peak {theta_cc*peak_v/mA:.3f} m3/m3, drop {d_theta:.3f} m3/m3 -> {whole_ml:.0f} mL = {mm:.1f} mm; evaporation explains at most {100*et0_night/mm:.0f}%')
