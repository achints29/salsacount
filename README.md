# SalsaCount

Find the **1-2-3, 5-6-7** in a salsa song, on your phone.

**Live app:** https://achints29.github.io/salsacount/

## Using it on iPhone

1. Open the link above in Safari.
2. Tap Share → **Add to Home Screen**. It then opens full-screen like a normal app.
3. With a song playing, tap the big **TAP** pad on every beat, **starting on the 1**. After 3–4 taps it locks onto the tempo and keeps counting by itself.
4. If the count is off, press **This is 1** exactly on the 1, or use **−1 / +1** to slide the count.
5. **BPM − / +** fine-tune the tempo if it drifts. Tap again at any time to re-lock.

4 and 8 are shown dimmed (the pauses). The break steps are highlighted: 1 and 5 for **On1**, 2 and 6 for **On2**.

Settings (⚙︎): an optional metronome click (accent on 1) to check the count against the music, and a visual offset if the numbers feel early or late.

## Roadmap

1. ✅ Tap-tempo counter (this version)
2. Listen through the mic: detect tempo and beats automatically (keep "This is 1" to resync)
3. Detect the 1 automatically (conga open tones on 4 and 8, cowbell on 1 and 5, clave, phrase changes)
4. Optional native iPhone app, for haptics in your pocket

## Development

Plain HTML/CSS/JS, no build step.

```sh
npm run serve   # http://localhost:8000
npm test        # unit tests for the timing math (tempo.js)
```

On a laptop, **space** taps and **1** sets the 1.

Files: `tempo.js` (pure timing math), `app.js` (UI, metronome, wake lock), `sw.js` (offline cache), `index.html`, `styles.css`.

## Deploying

GitHub Pages serves the `main` branch root (Settings → Pages → Deploy from a branch → `main` / `/ (root)`). Pushing to `main` updates the live app within a minute or two.
