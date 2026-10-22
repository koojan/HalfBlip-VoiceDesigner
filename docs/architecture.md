# Architecture

One rule shapes everything: **the engine is the single source of truth, and players are dumb.**

```
character file ─┐
feeling (v, a) ─┼─► generate ─► sound ─► toScore ─► blip-score (JSON) ─┬─► renderScore ─► WAV     (plain-code synth)
seed ───────────┘                                                      ├─► midi          ─► MIDI
                                                                       ├─► tierA         ─► tone timeline ─► C player / buzzer
heard audio ─► Listener ─► utterance ─► interpreters ─► affect ─► Brain ─┴─► mimic (pitch + rhythm of the speaker) ─► toScore
```

## Why one engine

The designer, the WAV exporter, the CLI and the listener all call the same `generate`, `toScore` and `renderScore`. What you hear while designing is what the exported WAV contains, because the designer plays the engine's own render. The older design had a Web Audio synth in the page and nothing else; that is gone. `tests/parity-chromium.js` compares the new synth with the old Web Audio code: envelopes correlate 0.96 to 0.99 and levels agree within about 2 dB. They are close, not identical.

## Why players are dumb

A microcontroller should not need the generator, a bell-curve sampler or a language model. It receives either a **baked score** (decided in advance) or a **live phrase** (composed by a smarter client a moment ago) and plays it. That keeps every player small and lets any client, such as a laptop, a phone, a Pi, a button or another robot, drive any player through the same line protocol.

## Baked versus live

- **Baked:** `bake` renders N sounds for each feeling into a bank. Replies pick the nearest feeling (`pick`). Cheapest, works on a buzzer, but replies can only be chosen, never composed.
- **Live:** a client runs the listener and `mimic`, then plays the WAV itself or sends `N hz/ms` lines to a player. This is how mimicry works; a baked bank cannot echo a specific sentence.

Both use the same scores and the same protocol, so a project can start baked and add live later.

## Timbre travels with the score

Each sound draws its own dial values, so a score carries a small `timbre` block (instrument mix, noise, drive, vibrato) and per-note glide fields. A renderer needs nothing but the score. The bank's `voice` says which instrument leads, for players that can only choose one.

## Layout

```
engine/    blip-engine.js, blip-listen.js     shared logic (UMD, no dependencies)
designer/  index.src.html                     source of the designer page
demo/      listen.src.html                    source of the listening demo
tools/     blip.js (CLI), build.js            command line and page builder
players/   common/ (C), arduino/, host/       Tier A player and its host test
examples/  chirp.character.json, chirp-bank/  a character and what baking it produces
tests/     *.test.js, *-chromium.js           see status.md
docs/
```

## One page or three

`tools/build.js` builds `index.html` (designer), `halfblip.html` (designer, Respond and Listen in one page) and `demo/listen.html` (listener only) from the same sources. One page costs little: the engine loads once and the page is about 60 KB larger than the designer alone; listening only runs while it is on.
