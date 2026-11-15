/*
  Good to Grow - field node
  ESP32-S3 + DHT11 + soil moisture sensor + DS3231 RTC (Keyestudio modules)

  What it does
  - Reads the sensors every LIVE_INTERVAL_S and logs a row every LOG_INTERVAL_S
    to /log.csv in flash (survives resets / battery brownouts).
  - Creates its own Wi-Fi network "GoodToGrow-Node" (password "goodtogrow").
    Join it with your phone and open http://192.168.4.1 for a live page + chart.
      /latest.json  current reading       /data.json  readings since power-on
      /log.csv      full log (download)   /settime, /cal, /clear  (buttons on the page)
  - Advertises Bluetooth LE as "GoodToGrow-Node". A notify characteristic sends
    "T23.4 H55 S41" (air temp C, humidity %, soil %) every LIVE_INTERVAL_S.
    Open it with the free "nRF Connect" app (or Web Bluetooth from Chrome).

  Wiring - everything on one header side of the ESP32-S3 board
    Soil   A0/S   -> GPIO 4   (must be ADC1 = GPIO 1-10 on the S3: ADC2 stops working with Wi-Fi on)
    DHT11  S/DATA -> GPIO 5
    DS3231 SDA    -> GPIO 6
    DS3231 SCL    -> GPIO 7
    All module VCC -> 3V3 (never 5V), all GND -> GND. Avoid GPIO 3, 45, 46 (boot strapping pins).
    Power: USB power bank is safest. Don't put 7.4 V on the "5V" pin unless you've checked
           that board's regulator accepts it.

  Arduino IDE setup
    Board: "ESP32S3 Dev Module" (Espressif ESP32 core, Boards Manager)
    Tools > Flash Size: match your board (4MB / 8MB / 16MB), Partition Scheme: "Huge APP" if it doesn't fit
    Tools > USB CDC On Boot: "Enabled" if you plug into the port marked USB (needed for Serial Monitor),
                             "Disabled" if you use the port marked COM/UART
    Tools > Upload Speed > 921600
    Libraries (Library Manager): "DHT sensor library" + "Adafruit Unified Sensor", "RTClib" (Adafruit),
                                 "NimBLE-Arduino" (h2zero)

  Soil calibration: open the page, hold the probe in dry air (or dry soil) and press
  "Soil = dry now", then put it in a glass of water and press "Soil = wet now".
  The % shown is relative to those two points, not true volumetric water content.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <Wire.h>
#include <RTClib.h>
#include <DHT.h>
#include <NimBLEDevice.h>  // library "NimBLE-Arduino" (much smaller than the built-in BLE stack)

// ---------------- settings ----------------
#define SOIL_PIN 4
#define DHT_PIN 5
#define DHT_TYPE DHT11
#define I2C_SDA 6
#define I2C_SCL 7
const uint32_t LIVE_INTERVAL_S = 5;   // live display / Bluetooth update
const uint32_t LOG_INTERVAL_S = 60;   // one row in the log
const char* AP_SSID = "GoodToGrow-Node";
const char* AP_PASS = "goodtogrow";   // at least 8 characters
const char* LOG_PATH = "/log.csv";

#define BLE_SERVICE_UUID "6e1a0001-7a3b-4c2d-9f10-67726f770001"
#define BLE_LIVE_UUID    "6e1a0002-7a3b-4c2d-9f10-67726f770001"

// ---------------- state ----------------
struct Reading {
  uint32_t t;      // unix-style seconds, local time as kept by the RTC
  float temp;      // C
  float hum;       // %
  int soilRaw;     // 0..4095
  float soilPct;   // 0..100 between dry and wet calibration points
  float rtcTemp;   // DS3231 chip temperature (inside the box, rough)
};

const int BUF_N = 720;  // 12 h at one row per minute, kept in RAM for the chart
Reading buf[BUF_N];
int bufHead = 0, bufCount = 0;

Reading live;
float tMin = NAN, tMax = NAN;
uint32_t lastLiveMs = 0, lastLogMs = 0;

RTC_DS3231 rtc;
bool rtcOk = false;
uint32_t fallbackBoot = 0;  // used only if the RTC is missing

DHT dht(DHT_PIN, DHT_TYPE);
WebServer server(80);
Preferences prefs;
int soilDryRaw = 0;     // Keyestudio resistive probe: dry reads low, wet reads high
int soilWetRaw = 2800;  // (a capacitive probe is the other way round; calibration handles both)

NimBLECharacteristic* liveChar = nullptr;
bool bleConnected = false;

// ---------------- helpers ----------------
uint32_t nowSecs() {
  if (rtcOk) return rtc.now().unixtime();
  return fallbackBoot + millis() / 1000;
}

String timeStr(uint32_t t) {
  DateTime d(t);
  char b[20];
  snprintf(b, sizeof b, "%04d-%02d-%02d %02d:%02d:%02d", d.year(), d.month(), d.day(), d.hour(), d.minute(), d.second());
  return String(b);
}

String jnum(float v, int dec) { return isnan(v) ? String("null") : String(v, dec); }
String cnum(float v, int dec) { return isnan(v) ? String("") : String(v, dec); }

int readSoilRaw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogRead(SOIL_PIN); delay(2); }
  return sum / 16;
}

float soilPercent(int raw) {
  if (soilWetRaw == soilDryRaw) return NAN;
  float p = 100.0f * (raw - soilDryRaw) / (float)(soilWetRaw - soilDryRaw);
  return constrain(p, 0.0f, 100.0f);
}

Reading readSensors() {
  Reading r;
  r.t = nowSecs();
  r.temp = dht.readTemperature();
  r.hum = dht.readHumidity();
  if (isnan(r.temp) || isnan(r.hum)) {  // DHT11 misses a read now and then
    delay(1100);
    r.temp = dht.readTemperature();
    r.hum = dht.readHumidity();
  }
  r.soilRaw = readSoilRaw();
  r.soilPct = soilPercent(r.soilRaw);
  r.rtcTemp = rtcOk ? rtc.getTemperature() : NAN;
  return r;
}

void writeHeader() {
  File f = LittleFS.open(LOG_PATH, "w");
  if (f) { f.println("time,temp_c,rh_pct,soil_raw,soil_pct,rtc_temp_c"); f.close(); }
}

void logReading(const Reading& r) {
  buf[bufHead] = r;
  bufHead = (bufHead + 1) % BUF_N;
  if (bufCount < BUF_N) bufCount++;

  if (!isnan(r.temp)) {
    tMin = isnan(tMin) ? r.temp : fminf(tMin, r.temp);
    tMax = isnan(tMax) ? r.temp : fmaxf(tMax, r.temp);
  }

  File f = LittleFS.open(LOG_PATH, "a");
  if (f) {
    f.printf("%s,%s,%s,%d,%s,%s\n", timeStr(r.t).c_str(), cnum(r.temp, 1).c_str(), cnum(r.hum, 0).c_str(),
             r.soilRaw, cnum(r.soilPct, 1).c_str(), cnum(r.rtcTemp, 2).c_str());
    f.close();
  }
  Serial.printf("[log] %s  T=%s C  RH=%s %%  soil=%s %% (raw %d)\n", timeStr(r.t).c_str(), cnum(r.temp, 1).c_str(),
                cnum(r.hum, 0).c_str(), cnum(r.soilPct, 0).c_str(), r.soilRaw);
}

void updateBle(const Reading& r) {
  if (!liveChar) return;
  char msg[24];  // keep under 20 bytes so it fits the default BLE packet
  snprintf(msg, sizeof msg, "T%.1f H%.0f S%.0f", r.temp, r.hum, r.soilPct);
  liveChar->setValue((uint8_t*)msg, strlen(msg));
  if (bleConnected) liveChar->notify();
}

// ---------------- web page ----------------
const char PAGE[] = R"rawliteral(<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Good to Grow node</title>
<style>body{font-family:sans-serif;margin:16px;background:#dfe9e3;color:#24425a}
.c{display:flex;gap:8px;flex-wrap:wrap}.b{background:#fff;border-radius:10px;padding:10px 14px;min-width:95px}
.v{font-size:28px;font-weight:700;color:#2a6b2f}small{color:#556}
button,a.btn{display:inline-block;margin:4px 4px 0 0;padding:9px 11px;border:0;border-radius:8px;background:#24425a;color:#fff;text-decoration:none;font-size:14px}
canvas{width:100%;height:220px;background:#fff;border-radius:10px;margin-top:10px}</style></head><body>
<h2>Good to Grow &middot; field node</h2>
<div class=c>
<div class=b>Air temp<div class=v id=t>-</div><small id=mm></small></div>
<div class=b>Humidity<div class=v id=h>-</div></div>
<div class=b>Soil moisture<div class=v id=s>-</div><small id=raw></small></div>
</div>
<p><small id=info>connecting...</small></p>
<canvas id=ch width=800 height=320></canvas>
<p><a class=btn href=/log.csv>Download CSV</a><button onclick=setClock()>Set clock from phone</button>
<button onclick="cal('dry')">Soil = dry now</button><button onclick="cal('wet')">Soil = wet now</button>
<button onclick=clr()>Clear log</button></p>
<script>
const $=id=>document.getElementById(id);
async function live(){try{const d=await(await fetch('/latest.json')).json();
$('t').textContent=d.temp==null?'err':d.temp.toFixed(1)+'°C';
$('h').textContent=d.rh==null?'err':Math.round(d.rh)+'%';
$('s').textContent=d.soil==null?'calibrate':Math.round(d.soil)+'%';
$('raw').textContent='raw '+d.soilRaw+' (dry '+d.dry+' / wet '+d.wet+')';
$('mm').textContent=d.tmin==null?'':'min '+d.tmin.toFixed(1)+' / max '+d.tmax.toFixed(1);
$('info').textContent=d.time+' · '+d.logged+' rows since power-on · Bluetooth '+(d.ble?'connected':'waiting')+(d.rtc?'':' · RTC missing!');
}catch(e){$('info').textContent='offline - are you on the GoodToGrow-Node Wi-Fi?'}}
async function chart(){try{const r=(await(await fetch('/data.json')).json()).rows;
const c=$('ch'),x=c.getContext('2d'),W=c.width,H=c.height,p=30;x.clearRect(0,0,W,H);
const ts=r.map(v=>v[1]).filter(v=>v!=null);if(r.length<2||!ts.length)return;
const lo=Math.floor(Math.min(...ts))-1,hi=Math.ceil(Math.max(...ts))+1;
const line=(i,a,b,col)=>{x.strokeStyle=col;x.lineWidth=2;x.beginPath();let f=true;
r.forEach((v,k)=>{if(v[i]==null)return;const X=p+(W-2*p)*k/(r.length-1),Y=H-p-(H-2*p)*(v[i]-a)/(b-a);f?x.moveTo(X,Y):x.lineTo(X,Y);f=false});x.stroke()};
line(2,0,100,'#9aa5ad');line(3,0,100,'#2a6bb0');line(1,lo,hi,'#c0392b');
x.fillStyle='#24425a';x.font='15px sans-serif';
x.fillText('red: temp '+lo+'–'+hi+'°C   blue: soil %   grey: humidity %',p,20);
x.fillText(r[0][0].slice(11,16),p,H-8);x.fillText(r[r.length-1][0].slice(11,16),W-p-42,H-8);}catch(e){}}
async function setClock(){const n=new Date(),z=v=>String(v).padStart(2,'0');
await fetch('/settime?t='+n.getFullYear()+'-'+z(n.getMonth()+1)+'-'+z(n.getDate())+'T'+z(n.getHours())+':'+z(n.getMinutes())+':'+z(n.getSeconds()));live()}
async function cal(w){await fetch('/cal?which='+w);live()}
async function clr(){if(confirm('Delete all logged data?')){await fetch('/clear');chart();live()}}
live();chart();setInterval(live,5000);setInterval(chart,60000);
</script></body></html>)rawliteral";

void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); }

void handleLatest() {
  String j = "{\"time\":\"" + timeStr(live.t) + "\",\"temp\":" + jnum(live.temp, 1) + ",\"rh\":" + jnum(live.hum, 0) +
             ",\"soil\":" + jnum(live.soilPct, 1) + ",\"soilRaw\":" + String(live.soilRaw) +
             ",\"rtcTemp\":" + jnum(live.rtcTemp, 2) + ",\"tmin\":" + jnum(tMin, 1) + ",\"tmax\":" + jnum(tMax, 1) +
             ",\"dry\":" + String(soilDryRaw) + ",\"wet\":" + String(soilWetRaw) + ",\"logged\":" + String(bufCount) +
             ",\"ble\":" + (bleConnected ? "true" : "false") + ",\"rtc\":" + (rtcOk ? "true" : "false") + "}";
  cors();
  server.send(200, "application/json", j);
}

void handleData() {
  cors();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  String chunk = "{\"cols\":[\"time\",\"temp_c\",\"rh_pct\",\"soil_pct\",\"soil_raw\"],\"rows\":[";
  int start = (bufHead - bufCount + BUF_N) % BUF_N;
  for (int k = 0; k < bufCount; k++) {
    const Reading& r = buf[(start + k) % BUF_N];
    if (k) chunk += ',';
    chunk += "[\"" + timeStr(r.t) + "\"," + jnum(r.temp, 1) + "," + jnum(r.hum, 0) + "," + jnum(r.soilPct, 1) + "," +
             String(r.soilRaw) + "]";
    if (chunk.length() > 1200) { server.sendContent(chunk); chunk = ""; }
  }
  chunk += "]}";
  server.sendContent(chunk);
  server.sendContent("");  // end of chunked response
}

void handleCsv() {
  File f = LittleFS.open(LOG_PATH, "r");
  if (!f) { server.send(404, "text/plain", "no log"); return; }
  cors();
  server.sendHeader("Content-Disposition", "attachment; filename=goodtogrow-log.csv");
  server.streamFile(f, "text/csv");
  f.close();
}

void handleSetTime() {
  String t = server.arg("t");  // YYYY-MM-DDTHH:MM:SS, phone's local time
  DateTime d(t.c_str());
  if (t.length() < 19 || d.year() < 2024) { server.send(400, "text/plain", "bad time"); return; }
  if (rtcOk) rtc.adjust(d);
  else fallbackBoot = d.unixtime() - millis() / 1000;
  server.send(200, "text/plain", "ok");
}

void handleCal() {
  int raw = readSoilRaw();
  String which = server.arg("which");
  if (which == "dry") { soilDryRaw = raw; prefs.putInt("dry", raw); }
  else if (which == "wet") { soilWetRaw = raw; prefs.putInt("wet", raw); }
  else { server.send(400, "text/plain", "which=dry|wet"); return; }
  live.soilRaw = raw;
  live.soilPct = soilPercent(raw);
  server.send(200, "text/plain", "ok");
}

void handleClear() {
  writeHeader();
  bufHead = bufCount = 0;
  tMin = tMax = NAN;
  server.send(200, "text/plain", "cleared");
}

// ---------------- Bluetooth ----------------
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override { bleConnected = true; }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    bleConnected = false;
    NimBLEDevice::startAdvertising();  // let the next phone connect
  }
};

void setupBle() {
  NimBLEDevice::init("GoodToGrow-Node");
  NimBLEServer* s = NimBLEDevice::createServer();
  s->setCallbacks(new ServerCallbacks());
  NimBLEService* svc = s->createService(BLE_SERVICE_UUID);
  liveChar = svc->createCharacteristic(BLE_LIVE_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  svc->start();

  // Name in the advertisement, 128-bit service UUID in the scan response (both don't fit in 31 bytes).
  NimBLEAdvertisementData advData, scanData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.setName("GoodToGrow-Node");
  scanData.addServiceUUID(NimBLEUUID(BLE_SERVICE_UUID));
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->start();
}

// ---------------- main ----------------
void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(I2C_SDA, I2C_SCL);
  rtcOk = rtc.begin();
  if (rtcOk && rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  if (!rtcOk) {
    fallbackBoot = DateTime(F(__DATE__), F(__TIME__)).unixtime();
    Serial.println("DS3231 not found - check SDA/SCL. Using compile time.");
  }

  dht.begin();
  analogReadResolution(12);

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  if (!LittleFS.exists(LOG_PATH)) writeHeader();

  prefs.begin("node", false);
  soilDryRaw = prefs.getInt("dry", soilDryRaw);
  soilWetRaw = prefs.getInt("wet", soilWetRaw);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("Wi-Fi \"%s\" up - open http://%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());

  server.on("/", [] { server.send(200, "text/html; charset=utf-8", PAGE); });
  server.on("/latest.json", handleLatest);
  server.on("/data.json", handleData);
  server.on("/log.csv", handleCsv);
  server.on("/settime", handleSetTime);
  server.on("/cal", handleCal);
  server.on("/clear", handleClear);
  server.begin();

  setupBle();

  delay(1500);  // DHT11 needs a moment after power-up
  live = readSensors();
  logReading(live);
  updateBle(live);
  lastLiveMs = lastLogMs = millis();
}

void loop() {
  server.handleClient();
  uint32_t ms = millis();

  if (ms - lastLiveMs >= LIVE_INTERVAL_S * 1000UL) {
    lastLiveMs = ms;
    live = readSensors();
    updateBle(live);
  }
  if (ms - lastLogMs >= LOG_INTERVAL_S * 1000UL) {
    lastLogMs = ms;
    logReading(live);
  }
  delay(2);
}
