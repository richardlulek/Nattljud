# Nattljud – lugna ljud för bebis (PWA)

Installerbar webbapp som spelar lugnande ljud hela natten: med släckt skärm,
utan internet och utan avbrott. Byggd för att hanteras med en hand i mörker av
en halvsovande förälder. Ingen backend, ingen inloggning, ingen tracking.

## Snabbstart

```bash
npm install
npm run dev        # utvecklingsserver
npm test           # enhetstester (DSP, triggerlogik, persistens)
npm run build      # typkontroll + produktionsbygge till dist/
npm run preview    # servera dist/ lokalt
npm run icons      # regenerera PNG-ikonerna (checkas in)
node scripts/smoke.mjs  # röktest i headless Chromium (kräver preview på :4173)
```

## Arkitektur

Ljudmotorn och detektionslogiken är **fristående moduler utan React-beroende**
så att de kan återanvändas i en framtida Capacitor-app (version 2).

```
src/
  audio/
    sounds.ts        8 ljud, syntetiserade i ren TS (deterministiska frön)
    filters.ts       Biquad-filter (RBJ) – ingen Web Audio behövs för rendering
    loop.ts          sömlös loop via inbakad crossfade + normalisering
    wav.ts           16-bit PCM WAV-kodare
    library.ts       blob-hantering, IndexedDB-cache, förgenerering
    engine.ts        uppspelningsmotorn: <audio>-element, Media Session,
                     fades, timer, iPhone-fallback ("bakad volym")
    volume.ts        perceptuella volym-/fadekurvor
  detect/
    triggerLogic.ts  ren beslutslogik för skriksensorn (testbar i Node)
    micMonitor.ts    getUserMedia → högpass 300 Hz → AnalyserNode (endast nivå)
    wakeLock.ts      håller skärmen tänd i vaktläget
  state/             localStorage-persistens (inställningar, vaktlogg)
  ui/                React-komponenter (nattläge, superdark, vaktläge, info)
public/
  spike.html         fristående testsida för bakgrundsljud (byggordningens steg 1)
```

### Så uppfylls de kritiska kraven

1. **Ljud vid låst skärm.** Uppspelning sker uteslutande via vanliga
   `<audio>`-element med riktiga WAV-blobbar och `loop=true`. Web Audio används
   aldrig för uppspelning (suspenderas vid skärmlås på iOS) – bara för
   mikrofonens nivåmätning i vaktläget, där skärmen ändå är tänd. Media Session
   ger titel/artist/timer och play/paus på låsskärmen.
2. **Gapless loop.** Ljuden genereras med `loopLängd + 0,6 s` material och
   crossfaden **bakas in i filen** (equal power). WAV (PCM) valdes för att
   MP3/AAC har kodar-padding som ger hörbara glapp vid loop. Men filnivån
   räcker inte: `<audio loop>` startar om via en **sökning** som tar ~100 ms
   (uppmätt i Chromium, hörbart även på iOS). Därför spelar motorn **stafett
   med två element**: filens första/sista sekunder har en inbakad equal
   power-fade, och strax före filslutet startas systerelementet – summan över
   skarven är nivåkonstant utan att elementvolymen behöver röras (fungerar
   därmed även på iPhone). `loop=true` behålls som skyddsnät: uteblir
   JS-ticken faller elementet tillbaka till nativ loop i stället för tystnad.
   Periodiska ljud (hjärtslag, hyssjande) är exakta multiplar av sin period
   och slutar i tystnad – där loopar elementet nativt och sökglappet hamnar i
   det tysta partiet.
3. **Offline first.** `vite-plugin-pwa` (Workbox) precachar hela appen.
   Ljudfilerna behöver aldrig laddas ner – de genereras lokalt och cachas i
   IndexedDB (`v<GEN_VERSION>:<ljud-id>`; gamla versioner rensas automatiskt).
4. **Installerbar PWA.** Manifest med ikoner (även maskable), standalone,
   portrait, temafärg; apple-touch-icon för iOS.
5. **Användargest.** Play-knappen är alltid första interaktionen. Vid första
   gesten "välsignas" dessutom alla audio-element med en tyst WAV så att
   senare programmatiska `play()` tillåts (behövs för vaktläget och för
   iPhone-volymbyten).

### Volym och fades på iPhone

iPhone tillåter inte att JS sätter `HTMLMediaElement.volume`. Motorn
detekterar detta ("bakat läge") och löser det genom att **skala om samplen och
byta blob** via ett andra, synkroniserat `<audio>`-element:

- Volymreglaget verkställs med ~0,4 s fördröjning (omrendering + byte).
- Timerns fade-ut sker i steg (var ~20:e sekund) i stället för kontinuerligt.
- Fade-in vid start hoppas över (stegvisa byten på 3 s låter sämre än ingen fade).

På Android/desktop/iPad används `element.volume` direkt med mjuk kurva
(kvadratisk ≈ logaritmisk) och kontinuerliga fades i dB-domän.

### Skriksensorn (vaktläge)

- Kalibrerar rummets baslinje i 10 s vid aktivering (med bruset igång om det
  spelar).
- Rullande EMA-baslinje (τ 30 s) som nästan fryser när nivån är förhöjd, så
  att långvarigt gråt inte "äts upp". När appen själv börjar/slutar spela
  reseedas baslinjen efter några sekunder.
- Högpass 300 Hz före mätningen; trigger kräver ihållande nivå (~2,5 s, ≥75 %
  av fönstret) över baslinje + marginal (känslighet låg/mellan/hög = 14/10/7 dB);
  45 s cooldown.
- Nytt gråt under uppspelning förlänger speltiden. Statusloggen sparas i
  localStorage så att morgonen kan granskas.

## Deploy

Appen är en ren statisk sajt (`dist/`). PWA kräver HTTPS.

**GitHub Pages (automatiskt):** varje push bygger, testar och deployar via
`.github/workflows/pages.yml` till
<https://richardlulek.github.io/Nattljud/> (byggd med
`NATTLJUD_BASE=/Nattljud/`). Spike-sidan ligger på
`…/Nattljud/spike.html`.

Står Pages-källan i repo-inställningarna på *Deploy from a branch* gör
GitHub dessutom en parallell deploy av branchens råa filer; workflowen
väntar ut den så att den byggda appen alltid vinner. Byt gärna källan till
*GitHub Actions* (Settings → Pages) så försvinner dubbeldeployen helt.

**Vercel (alternativ, t.ex. för egen domän):** `vercel.json`
innehåller redan rätt cache-headers (bl.a. `sw.js` utan cache så att
uppdateringar når installerade användare, hashade assets som `immutable`).

**Skapa Vercel-projektet (engångssteg i dashboarden):**

1. [vercel.com/new](https://vercel.com/new) → importera repot
   `richardlulek/nattljud`. Framework förifylls som *Vite* – rör inte
   build/output (styrs av `vercel.json` och `package.json`).
2. Döp projektet till t.ex. `nattljud` och tryck **Deploy**. Klart:
   appen ligger på `https://nattljud-<konto>.vercel.app` (HTTPS, PWA
   fungerar direkt).
3. *(Valfritt)* Settings → Domains → lägg till t.ex. `nattljud.estera.se`
   och skapa CNAME-posten som visas.

Ska appen i stället ligga under en undermapp på en befintlig sajt:
`NATTLJUD_BASE=/nattljud/ npm run build`.

## Testprotokoll (kör i denna ordning)

### Steg 1 – spike på riktig iPhone (viktigast, gör detta först)

1. Öppna `https://<din-deploy>/spike.html` i Safari på iPhone.
2. Tryck **Spela**, lås skärmen, vänta 10 minuter.
3. Ljudet ska fortsätta oavbrutet och låsskärmen visa "Spike – vitt brus".
4. Lås upp och läs loggen: en rad "spelar fortfarande ✓" per minut, inga
   pause/stalled-händelser.

Upprepa i Chrome på Android. **Gå inte vidare med skarp användning förrän
detta är verifierat** – sidan loggar allt som behövs för felsökning.

### Fullständig acceptans

- [ ] Ljud i minst 8 h med låst skärm (iPhone Safari + Android Chrome) –
      använd appen en natt med timern på "Natt"; spike-loggen ger minutupplöst
      facit.
- [ ] Inget hörbart glapp vid loop (lyssna aktivt i 2–3 loopvarv per ljud,
      t.ex. hjärtslag 36 s och vågor 55 s).
- [ ] Flygplansläge: installera, starta om telefonen i flygplansläge, öppna
      från hemskärmen → appen laddar och spelar.
- [ ] Hemskärmsikon → ljud igång på max 2 tryck (1 tryck: play; favoriter
      startar också direkt vid tryck).
- [ ] Timer: fade-ut är gradvis (2–5 min, inställbart) – aldrig tvärstopp.
- [ ] Vaktläge: testa med inspelat bebisgråt på olika avstånd, med bruset
      igång samtidigt; kontrollera statusloggen på morgonen.

### Öppna frågor att mäta tidigt (från kravspecen)

- Batteri över 8 h med låst skärm (bör vara försumbart med audio-element).
- Dödar iOS PWA:n i standalone-läge under natten vid minnesbrist? Jämför
  standalone-läge mot Safari-flik med spike-sidan. Om standalone visar sig
  opålitligt: kör i Safari-flik, ev. med Hjälpmedel → Guidad åtkomst, eller
  wrappa i Capacitor (motorn är förberedd som fristående modul).

## Kända begränsningar

- **iPhone-volym:** se "bakat läge" ovan. Telefonens volymknappar fungerar
  alltid direkt.
- **Vaktläget kräver tänd skärm** – webbappar förlorar mikrofonen vid låst
  skärm (särskilt iOS). Detta är avsiktligt designat som ett "telefonen på
  laddaren i rummet"-läge. Skriksensor med låst skärm kräver Capacitor
  (version 2).
- Wake Lock saknas i äldre webbläsare – appen visar då en uppmaning att
  stänga av autolås manuellt.

## Utveckling

- `scripts/smoke.mjs` kör ett headless-röktest (uppspelning, superdark,
  vaktläge med fejkad mikrofon, persistens, service worker) mot
  `npm run preview`.
- Ljudens DSP ändras? Bumpa `GEN_VERSION` i `src/audio/sounds.ts` så att
  IndexedDB-cachen förnyas hos användarna.
- All ljudrendering är deterministisk (seedade PRNG) och enhetstestad även på
  låg samplerate.
