"""Sun run of 15 Nov 2026: re-time the Nano's EEPROM dump and test whether drying is measurable.

The Nano has no working clock, so each power-on starts a new run in the log (boot = 1) with an exact
seconds-since-power-on column. The team plugged the power bank in at 10:10, so the outdoor rows are
10:10 + since_boot_s.

Usage: python -I analysis/sun_run.py field-data/eeprom-2026-11-15-sun-raw.csv field-data/sun-2026-11-15.csv
"""
import csv, math, sys
from datetime import datetime, timedelta

src, out = sys.argv[1], sys.argv[2]
START = datetime(2026, 11, 15, 10, 10, 0)      # power bank plugged in (reported by the team)
NIGHT_PEAK = 699.1                             # highest peak so far (night run, 00:32), raw
NIGHT_CC = 573.8                               # night drainage level (container capacity), raw
POT_ML_PER_MM = math.pi * 0.125 ** 2 * 1000    # = 49.1 mL of water per mm over the pot

rows = list(csv.DictReader(open(src, encoding='utf-8-sig')))
# Runs = blocks that start at a boot row. The outdoor run is the boot whose first reading is in soil (raw > 0).
runs, cur = [], None
for r in rows:
    if r['boot'] == '1' or cur is None:
        cur = []; runs.append(cur)
    cur.append(r)
outdoor = next(run for run in runs if int(run[0]['soil_raw']) > 0)
print(f'runs in the log: {len(runs)} -> sizes {[len(x) for x in runs]}; outdoor run has {len(outdoor)} rows')

pts = [(START + timedelta(seconds=int(r['since_boot_s'])), int(r['soil_raw'])) for r in outdoor]
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['time', 'minutes_since_start', 'soil_raw', 'pct_of_highest_peak', 'temp_c', 'rh_pct'])
    peak = max(NIGHT_PEAK, max(v for _, v in pts))
    for t, v in pts:
        w.writerow([t.strftime('%Y-%m-%d %H:%M:%S'), round((t - START).total_seconds() / 60), v, round(100 * v / peak, 1), '', ''])
print(f'saved {len(pts)} re-timed rows to {out}: {pts[0][0]:%H:%M} -> {pts[-1][0]:%H:%M}')

vals = [v for _, v in pts]
print('\n1. WHAT THE PROBE SAW (raw, every 4 min)')
print('   ' + ' '.join(str(v) for v in vals))
print(f'   first reading {vals[0]} (probe just pushed in / watered), then min {min(vals[1:])}, max {max(vals[1:])}')

# Use the rows after the first 4 minutes (the first reading is the probe settling, like the night run's first 30 min).
body = pts[1:]
xs = [(t - body[0][0]).total_seconds() / 3600 for t, _ in body]
ys = [v for _, v in body]
n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
sxx = sum((x - mx) ** 2 for x in xs)
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
res = [y - (my + slope * (x - mx)) for x, y in zip(xs, ys)]
sd = math.sqrt(sum(r * r for r in res) / (n - 2))
se = sd / math.sqrt(sxx)
print('\n2. TREND (straight line through 10:14-11:50)')
print(f'   mean {my:.1f} raw   scatter (sd) {sd:.1f} raw   slope {slope:+.1f} +/- {se:.1f} raw/h (1 s.e.); 95% range {slope-2*se:+.1f} to {slope+2*se:+.1f}')
print(f'   drying is {"NOT " if slope + 2 * se > 0 else ""}distinguishable from zero over {xs[-1]*60:.0f} min')

half = n // 2
a, b = ys[:half], ys[half:]
print(f'   first half mean {sum(a)/len(a):.1f}  second half mean {sum(b)/len(b):.1f}  (difference {sum(b)/len(b)-sum(a)/len(a):+.1f})')

# 3. How big a drying signal should the sun produce in 100 min? NASA POWER November mean ET0 ~2.6 mm/day (30 years),
# spread over daylight with a sine shape (sunrise ~06:30, sunset ~17:00 in mid-November at 31.9 N).
sunrise, sunset = 6.5, 17.0
day = sunset - sunrise
frac = lambda h: (1 - math.cos(math.pi * (h - sunrise) / day)) / 2   # share of the day's ET done by hour h
share = frac(11 + 50 / 60) - frac(10 + 10 / 60)
et0_day = 2.6
for kc, label in ((1.0, 'basil Kc 1.0 (engine value, estimated)'), (1.5, 'x1.5 for terracotta walls + sun-heated pot')):
    mm = et0_day * share * kc
    ml = mm * POT_ML_PER_MM
    # spread over the whole 10.8 L of soil, then into raw units with container capacity 0.40 at the night level
    d_theta = ml / 10_800
    d_raw = d_theta / 0.40 * NIGHT_CC
    print(f'\n3. EXPECTED SUN SIGNAL, {label}')
    print(f'   {share*100:.0f}% of the day\'s ET0 falls in 10:10-11:50 -> {mm:.2f} mm = {ml:.0f} mL from the pot')
    print(f'   spread through the pot: {d_theta:.4f} m3/m3 = about {d_raw:.0f} raw  (vs scatter {sd:.0f} raw)')

# 4. Temperature effect: resistive probes read ~2 %/C higher as the soil warms.
rise = max(ys[:8]) - ys[0]
print('\n4. WHY THE READING ROSE IN THE MORNING')
print(f'   10:14 -> 10:38 the reading rose {rise:+d} raw ({100*rise/ys[0]:+.1f}%). At ~2 %/C that is ~{100*rise/ys[0]/2:.1f} C of soil warming:')
print('   the sun heating the probe and soil, not water being added. A soil thermometer would let us correct it.')
