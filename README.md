# SalsaCount

Find the **1-2-3, 5-6-7** in a salsa song, on your phone.

**Live app:** https://achints29.github.io/salsacount/

## Using it on iPhone

1. Open the link above in Safari.
2. Tap Share → **Add to Home Screen**. It then opens full-screen like a normal app.
3. With a song playing, press **🎤 Listen** and allow the microphone. After a few seconds it finds the beat and starts counting.
4. Press **This is 1** exactly on the 1 (or use **−1 / +1**) to put the count in the right place.
5. If it's clicking on the offbeat ("and"s), tap along a few times on the real beat and it flips over.
6. No mic? Tap the big **TAP** pad on every beat instead, **starting on the 1**. After 3–4 taps it locks on; **BPM − / +** fine-tune it.

4 and 8 are shown dimmed (the pauses). The break steps are highlighted: 1 and 5 for **On1**, 2 and 6 for **On2**.

Settings (⚙︎): an optional metronome click (accent on 1, silent on 4 and 8; muted while listening) to check the count against the music, and a visual offset if the numbers feel early or late.

## Roadmap

1. ✅ Tap-tempo counter
2. ✅ Listen through the mic: detect tempo and beats automatically (first version; being tuned on real songs)
3. Detect the 1 automatically (conga open tones on 4 and 8, cowbell on 1 and 5, clave, phrase changes)
4. Optional native iPhone app, for haptics in your pocket

## Development

Plain HTML/CSS/JS, no build step.

```sh
npm run serve   # http://localhost:8000
npm test        # unit tests: timing math + beat tracker on synthetic salsa
node tools/synth-eval.mjs                 # beat tracker scores on synthetic salsa
./tools/fetch-dataset.sh                  # beat annotations for 40 salsa songs (Salsa-dataset)
node tools/eval.mjs clips/*.mp3 --clicks  # run on real songs; scores vs annotations when the song matches,
                                          # and writes <song>.clicks.mp3 with the detected beats as clicks
```

Put audio in `clips/` (git-ignored; songs stay on your machine). On a laptop, **space** taps and **1** sets the 1.

Files: `beat.js` (onset detection + beat tracking), `tempo.js` (timing math), `app.js` (UI, mic, metronome, wake lock), `capture-worklet.js` (mic capture), `sw.js` (offline cache), `index.html`, `styles.css`.

## Deploying

GitHub Pages serves the `main` branch root (Settings → Pages → Deploy from a branch → `main` / `/ (root)`). Pushing to `main` updates the live app within a minute or two.
