/*
  Good to Grow - field node (Arduino Nano version)
  Arduino Nano (ATmega328P) + DHT11 + soil moisture sensor + DS3231 RTC (Keyestudio modules)

  What it does
  - Prints a live reading every LIVE_INTERVAL_S over USB:  T:23.0 RH:55 Soil:41
    (Tools > Serial Plotter draws it as a live chart; Serial Monitor shows the numbers.)
  - Logs one reading every LOG_INTERVAL_MIN into the Nano's built-in EEPROM.
    126 readings fit (about 10 h at 5 min). Data survives power loss; when full, the oldest
    reading is overwritten.
  - Commands: open Serial Monitor at 9600 baud, line ending "Newline", type:
      d                         dump the log as CSV (copy it into a .csv file)
      s                         status (time, rows logged, calibration, min/max)
      t 2026-11-14 18:30:00     set the clock (local time). Without the clock module, set it
                                BEFORE going outside: opening Serial Monitor resets the Nano,
                                so rows from an earlier power-on can't be re-timed afterwards.
      dry                       soil probe is in dry air / dry soil now -> save as 0 %
      wet                       soil probe is in water now -> save as 100 %
      q                         pause / resume the live lines (handy before 'd')
      clear                     erase the log
      h                         help

  Temperature: the DHT11 is used when it answers. If it doesn't (missing / broken), the DS3231's
  built-in sensor is used instead (about +-3 C, 0.25 C steps, updates every 64 s; no humidity).
  The CSV column temp_src says which one each row came from.

  Wiring (all modules on the Nano's 5V + GND)
    DHT11  S/DATA -> A4   (+ -> 5V, - -> GND; unplug it at once if it gets hot)
    Soil   A0/S   -> A0
    DS3231 SDA    -> A4,  SCL -> A5   only with USE_RTC 1 (then the DHT11 goes back on D2)
                                      OPTIONAL: without it, time counts from power-on.
    Battery: 2 x 3.7 V Li-ion in series (7.4 V) -> VIN, minus -> GND.  Never into the 5V pin.
             The Nano draws ~25 mA, so a 2000 mAh pack lasts days.

  Arduino IDE setup
    Board: "Arduino Nano". Processor: "ATmega328P"; if upload fails with "not in sync",
    use "ATmega328P (Old Bootloader)" (most CH340 clone Nanos).
    Libraries: "DHT sensor library" + "Adafruit Unified Sensor", "RTClib" (Adafruit)
*/

#include <Wire.h>
#include <EEPROM.h>
#include <RTClib.h>
#include <DHT.h>

// ---------------- settings ----------------
// DHT11 on A4. A4 is also the DS3231's SDA, so the clock module is switched off (USE_RTC 0);
// set USE_RTC 1 and move the DHT11 back to D2 to use a working DS3231 again.
#define USE_RTC 0
#define DHT_PIN A4
#define DHT_TYPE DHT11
#define SOIL_PIN A0
const uint16_t LIVE_INTERVAL_S = 5;
const uint8_t LOG_INTERVAL_MIN = 4;   // 126 rows x 4 min = 8.4 h before the oldest is overwritten

// ---------------- EEPROM layout ----------------
struct Header {      // 10 bytes at address 0
  uint16_t magic;
  uint16_t count;    // rows stored
  uint16_t head;     // next slot to write
  int16_t dry;       // soil raw reading = 0 %
  int16_t wet;       // soil raw reading = 100 %
};
struct Rec {         // 8 bytes per reading
  uint32_t t;        // seconds (RTClib unixtime, local time)
  int16_t temp10;    // temperature x10, NO_TEMP if missing
  uint8_t rh;        // %, NO_RH if missing
  uint8_t soil4;     // soil raw / 4 (0..255)
};
const uint16_t MAGIC = 0x6732;
const int HDR_ADDR = 0;
const int REC_ADDR = 16;
const uint16_t REC_N = (E2END + 1 - REC_ADDR) / sizeof(Rec);  // 126 on a Nano
const int16_t NO_TEMP = -32768;
const uint8_t NO_RH = 255;
// rh byte: 0..100 = humidity; +128 marks the first row after a power-on (boot); 254 = boot, no humidity.
const uint8_t BOOT_FLAG = 0x80;
const uint8_t BOOT_NO_RH = 254;

Header hdr;
RTC_DS3231 rtc;
bool rtcOk = false;
uint32_t fallbackBoot = 0;   // no clock module: time = fallbackBoot + seconds since power-on
uint16_t rowsSinceBoot = 0;  // rows the 't' command can re-time when there is no clock module
DHT dht(DHT_PIN, DHT_TYPE);

bool liveOn = true;
unsigned long lastLiveMs = 0, lastLogMs = 0;
float tMin = NAN, tMax = NAN;
char line[32];
uint8_t lineLen = 0;

// ---------------- helpers ----------------
uint32_t nowSecs() { return rtcOk ? rtc.now().unixtime() : fallbackBoot + millis() / 1000; }

void printTime(uint32_t t) {
  DateTime d(t);
  char b[20];
  snprintf(b, sizeof b, "%04d-%02d-%02d %02d:%02d:%02d", d.year(), d.month(), d.day(), d.hour(), d.minute(), d.second());
  Serial.print(b);
}

void saveHdr() { EEPROM.put(HDR_ADDR, hdr); }

void loadHdr() {
  EEPROM.get(HDR_ADDR, hdr);
  if (hdr.magic != MAGIC || hdr.head >= REC_N || hdr.count > REC_N) {
    hdr.magic = MAGIC; hdr.count = 0; hdr.head = 0; hdr.dry = 0; hdr.wet = 700;
    saveHdr();
  }
}

int readSoilRaw() {
  long sum = 0;
  for (uint8_t i = 0; i < 16; i++) { sum += analogRead(SOIL_PIN); delay(2); }
  return sum / 16;
}

// Keyestudio resistive probe reads higher when wet; a capacitive probe reads lower. Calibration handles both.
float soilPercent(int raw) {
  if (hdr.wet == hdr.dry) return NAN;
  float p = 100.0 * (raw - hdr.dry) / (float)(hdr.wet - hdr.dry);
  return constrain(p, 0.0, 100.0);
}

// DHT11 first; if it doesn't answer, the DS3231's own temperature sensor (no humidity then).
float readTemp(float& rh) {
  float t = dht.readTemperature();
  rh = dht.readHumidity();
  if (isnan(t) || isnan(rh)) {
    rh = NAN;
    t = rtcOk ? rtc.getTemperature() : NAN;
  }
  return t;
}

void printNum(float v, uint8_t dec) { if (isnan(v)) Serial.print(F("nan")); else Serial.print(v, dec); }

// ---------------- logging ----------------
void logReading(float temp, float rh, int soilRaw, bool boot = false) {
  Rec r;
  r.t = nowSecs();
  r.temp10 = isnan(temp) ? NO_TEMP : (int16_t)lround(temp * 10);
  r.rh = isnan(rh) ? NO_RH : (uint8_t)constrain(lround(rh), 0, 100);
  if (boot) r.rh = r.rh == NO_RH ? BOOT_NO_RH : r.rh | BOOT_FLAG;
  r.soil4 = soilRaw >> 2;
  EEPROM.put(REC_ADDR + hdr.head * sizeof(Rec), r);
  hdr.head = (hdr.head + 1) % REC_N;
  if (hdr.count < REC_N) hdr.count++;
  if (rowsSinceBoot < REC_N) rowsSinceBoot++;
  saveHdr();

  if (liveOn) {
    Serial.print(F("# logged "));
    Serial.print(hdr.count); Serial.print('/'); Serial.print(REC_N); Serial.print(F(" at "));
    printTime(r.t);
    Serial.println();
  }
}

void dumpCsv() {
  // boot = 1 on the first row after each power-on; since_boot_s is exact even without a clock module,
  // so a run on the power bank can be re-timed afterwards from the time it was plugged in.
  Serial.println(F("time,temp_c,temp_src,rh_pct,soil_raw,soil_pct,boot,since_boot_s"));
  uint16_t start = (hdr.head + REC_N - hdr.count) % REC_N;
  uint32_t bootT = 0;
  for (uint16_t i = 0; i < hdr.count; i++) {
    Rec r;
    EEPROM.get(REC_ADDR + ((start + i) % REC_N) * sizeof(Rec), r);
    bool boot = r.rh != NO_RH && (r.rh & BOOT_FLAG);
    uint8_t rh = !boot ? r.rh : (r.rh == BOOT_NO_RH ? NO_RH : (r.rh & ~BOOT_FLAG));
    if (boot || i == 0) bootT = r.t;
    printTime(r.t); Serial.print(',');
    if (r.temp10 != NO_TEMP) Serial.print(r.temp10 / 10.0, 1);
    Serial.print(',');
    if (r.temp10 != NO_TEMP) Serial.print(rh != NO_RH ? F("dht11") : F("ds3231"));
    Serial.print(',');
    if (rh != NO_RH) Serial.print(rh);
    Serial.print(',');
    int raw = r.soil4 * 4;
    Serial.print(raw); Serial.print(',');
    float p = soilPercent(raw);
    if (!isnan(p)) Serial.print(p, 1);
    Serial.print(','); Serial.print(boot ? 1 : 0);
    Serial.print(','); Serial.print(r.t - bootT);
    Serial.println();
  }
  Serial.println(F("# end"));
}

void printStatus() {
  Serial.print(F("# time ")); printTime(nowSecs());
  Serial.print(rtcOk ? F(" (DS3231)") : F(" (no clock module: counting from power-on, set it with t)"));
  Serial.print(F("\n# rows ")); Serial.print(hdr.count); Serial.print('/'); Serial.print(REC_N);
  Serial.print(F(", every ")); Serial.print(LOG_INTERVAL_MIN); Serial.print(F(" min"));
  Serial.print(F("\n# soil raw now ")); Serial.print(readSoilRaw());
  Serial.print(F(" (dry ")); Serial.print(hdr.dry); Serial.print(F(" / wet ")); Serial.print(hdr.wet); Serial.print(')');
  float rh, t = readTemp(rh);
  Serial.print(F("\n# temp now ")); printNum(t, 1);
  Serial.print(isnan(rh) ? (rtcOk ? F(" C from DS3231 (DHT11 not answering)") : F(" - no DHT11 and no DS3231!")) : F(" C from DHT11"));
  Serial.print(F("\n# temp min ")); printNum(tMin, 1); Serial.print(F(" / max ")); printNum(tMax, 1);
  Serial.println(F(" C since power-on"));
}

void printHelp() {
  Serial.println(F("# commands: d=dump CSV  s=status  t YYYY-MM-DD HH:MM:SS=set clock"));
  Serial.println(F("#           dry / wet = soil calibration  q=pause live  clear=erase log  h=help"));
}

// ---------------- commands ----------------
void runCommand(char* c) {
  if (!strcmp(c, "d")) dumpCsv();
  else if (!strcmp(c, "s")) printStatus();
  else if (!strcmp(c, "h")) printHelp();
  else if (!strcmp(c, "q")) { liveOn = !liveOn; Serial.println(liveOn ? F("# live on") : F("# live paused")); }
  else if (!strcmp(c, "dry")) { hdr.dry = readSoilRaw(); saveHdr(); Serial.print(F("# dry = ")); Serial.println(hdr.dry); }
  else if (!strcmp(c, "wet")) { hdr.wet = readSoilRaw(); saveHdr(); Serial.print(F("# wet = ")); Serial.println(hdr.wet); }
  else if (!strcmp(c, "clear")) { hdr.count = 0; hdr.head = 0; rowsSinceBoot = 0; saveHdr(); tMin = tMax = NAN; Serial.println(F("# log cleared")); }
  else if (c[0] == 't' && c[1] == ' ') {
    int Y, M, D, h, m, s;
    if (sscanf(c + 2, "%d-%d-%d %d:%d:%d", &Y, &M, &D, &h, &m, &s) == 6 && Y >= 2024) {
      DateTime d(Y, M, D, h, m, s);
      if (rtcOk) rtc.adjust(d);
      else {
        // Shift this power-on's rows by the same correction, so they get real times too.
        int32_t delta = (int32_t)(d.unixtime() - nowSecs());
        fallbackBoot += delta;
        retimeRows(delta);
      }
      Serial.print(F("# clock set to ")); printTime(nowSecs()); Serial.println();
    } else Serial.println(F("# use: t 2026-11-14 18:30:00"));
  } else if (c[0]) { Serial.print(F("# unknown: ")); Serial.println(c); printHelp(); }
}

void retimeRows(int32_t delta) {
  uint16_t n = min(rowsSinceBoot, hdr.count);
  for (uint16_t i = 1; i <= n; i++) {
    int addr = REC_ADDR + ((hdr.head + REC_N - i) % REC_N) * sizeof(Rec);
    Rec r;
    EEPROM.get(addr, r);
    r.t += delta;
    EEPROM.put(addr, r);
  }
  if (n) { Serial.print(F("# re-timed ")); Serial.print(n); Serial.println(F(" rows from this power-on")); }
}

// Without a clock module, continue after the last logged row so times never go backwards.
void startFallbackClock() {
  uint32_t t0 = DateTime(F(__DATE__), F(__TIME__)).unixtime();
  if (hdr.count) {
    Rec last;
    EEPROM.get(REC_ADDR + ((hdr.head + REC_N - 1) % REC_N) * sizeof(Rec), last);
    if (last.t + 60 > t0) t0 = last.t + 60;
  }
  fallbackBoot = t0 - millis() / 1000;
}

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      line[lineLen] = 0;
      if (lineLen) runCommand(line);
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) line[lineLen++] = ch;
  }
}

// ---------------- main ----------------
void setup() {
  Serial.begin(9600);
  Serial.println(F("# booting..."));
#if USE_RTC
  Wire.begin();
  // A loose/swapped SDA-SCL wire can freeze the I2C bus forever; give up after 25 ms instead.
  Wire.setWireTimeout(25000, true);
  Serial.println(F("# looking for DS3231 on A4/A5..."));
  rtcOk = rtc.begin();
  Serial.println(rtcOk ? F("# DS3231 found") : F("# DS3231 NOT found - check SDA->A4, SCL->A5, VCC->5V, GND"));
  if (rtcOk && rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
#else
  Serial.println(F("# clock module off (DHT11 uses A4): time counts from power-on"));
#endif

  dht.begin();
  loadHdr();
  if (!rtcOk) startFallbackClock();
  delay(1500);  // DHT11 settles after power-up

  Serial.println(F("# Good to Grow field node (Nano)"));
  printStatus();
  printHelp();

  float h, t = readTemp(h);
  logReading(t, h, readSoilRaw(), true);
  lastLiveMs = lastLogMs = millis();
}

void loop() {
  readSerial();
  unsigned long ms = millis();

  if (ms - lastLiveMs >= LIVE_INTERVAL_S * 1000UL) {
    lastLiveMs = ms;
    float h, t = readTemp(h);
    int raw = readSoilRaw();
    if (!isnan(t)) { tMin = isnan(tMin) ? t : min(tMin, t); tMax = isnan(tMax) ? t : max(tMax, t); }

    if (liveOn) {  // label:value pairs -> Serial Plotter draws three lines
      Serial.print(F("T:")); printNum(t, 1);
      Serial.print(F(" RH:")); printNum(h, 0);
      Serial.print(F(" Soil:")); printNum(soilPercent(raw), 0);
      Serial.print(F(" Raw:")); Serial.print(raw);  // keeps the signal even when % is pinned at 0 or 100
      Serial.println();
    }
    if (ms - lastLogMs >= LOG_INTERVAL_MIN * 60000UL) {
      lastLogMs = ms;
      logReading(t, h, raw);
    }
  }
}
