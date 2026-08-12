/* Röktest av Nattljud i headless Chromium: rendering, uppspelning,
   superdark, vaktläge (fejkad mikrofon) och konsolfel. */
import { chromium } from "playwright-core";

const BAS = "http://127.0.0.1:4173";
const UT = process.env.UT ?? "/tmp/shots";
const fel = [];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--no-sandbox",
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 375, height: 750 },
  deviceScaleFactor: 2,
  permissions: ["microphone"],
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") fel.push("console.error: " + m.text());
});
page.on("pageerror", (e) => fel.push("pageerror: " + e.message));

await page.goto(BAS, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${UT}/1-main.png` });

// Spela
await page.getByRole("button", { name: "Spela" }).click();
await page.waitForTimeout(2500);
const uiLäge = await page.evaluate(() => ({
  playKlass: document.querySelector(".playknapp")?.className,
  status: document.querySelector(".playbar-status")?.textContent,
  antalAudio: document.querySelectorAll("audio").length,
}));
console.log("UI:", JSON.stringify(uiLäge));
const audioLäge = await page.evaluate(() =>
  Array.from(document.querySelectorAll("audio")).map((a) => ({
    paused: a.paused,
    loop: a.loop,
    dur: Number.isFinite(a.duration) ? Math.round(a.duration) : null,
    vol: Math.round(a.volume * 100) / 100,
    ct: Math.round(a.currentTime * 10) / 10,
    srcTyp: a.src.startsWith("blob:") ? "blob" : a.src.slice(0, 24),
  })),
);
console.log("AUDIO:", JSON.stringify(audioLäge, null, 1));
await page.screenshot({ path: `${UT}/2-spelar.png` });

// Volymändring + timerval under uppspelning
await page.locator('input[type="range"]').first().fill("30");
await page.getByRole("radio", { name: "45" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${UT}/3-timer.png` });

// Superdark efter 8 s stillhet
await page.waitForTimeout(8600);
const superdarkSyns = await page.locator(".superdark").count();
console.log("SUPERDARK:", superdarkSyns === 1 ? "ja" : "NEJ");
await page.screenshot({ path: `${UT}/4-superdark.png` });

// Vakna + pausa
await page.locator(".superdark").click({ position: { x: 187, y: 200 } });
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Pausa" }).click();
await page.waitForTimeout(700);
const pausad = await page.evaluate(() =>
  Array.from(document.querySelectorAll("audio")).every((a) => a.paused),
);
console.log("PAUSAD:", pausad ? "ja" : "NEJ");

// Mix-läget
await page.locator(".togglerad input").check();
await page.waitForTimeout(300);
await page.screenshot({ path: `${UT}/5-mix.png` });

// Info-sidan
await page.getByRole("button", { name: "Inställningar och info" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${UT}/6-info.png` });
await page.getByRole("button", { name: "Tillbaka" }).click();

// Vaktläget: intro → aktivera (fejkad mik) → kalibrering → armerad
await page.getByRole("button", { name: /Vaktläge/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${UT}/7-vakt-intro.png` });
await page.getByRole("button", { name: "Aktivera vaktläge" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${UT}/8-vakt-kalibrerar.png` });
await page.waitForTimeout(9000); // kalibrering klar (10 s)
const armerad = await page.locator(".vakt-dot.lyssnar, .vakt-dot.spelar").count();
console.log("VAKT ARMERAD:", armerad >= 1 ? "ja" : "NEJ");
await page.screenshot({ path: `${UT}/9-vakt-armerad.png` });
await page.getByRole("button", { name: "Stäng av vaktläget" }).click();
await page.waitForTimeout(400);

// Ladda om: inställningar ska ha sparats (timer 45, volym 30 %)
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const sparat = await page.evaluate(() => localStorage.getItem("nattljud:settings:v1"));
console.log("SPARAT:", sparat);

// Service worker registrerad?
const sw = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.length;
});
console.log("SW-REGISTRERINGAR:", sw);

console.log("KONSOLFEL:", fel.length === 0 ? "inga" : fel.join("\n"));
await browser.close();
process.exit(fel.length > 0 ? 2 : 0);
