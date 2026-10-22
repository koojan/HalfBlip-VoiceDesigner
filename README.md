# Half Blip Voice Designer

An open-source project for creating sounds for robots, animatronics, digital puppets, games and animation: a character-design and voice-design system for expressive 8-bit voices. Little chirps, musical phrases and electronic babble with a personality of their own, and a way to give a character emotional tones from happy to bored, curious to sleepy.

It is both a **designer** (a browser playground, originally meant as a companion phone app for hobbyist robots) and an **engine** (it can generate new "musical sentences" on demand, or export sounds as WAV, MIDI or a tiny C array for fixed situations on low-power microcontrollers and boards). In the code the engine is called Blip.

How a voice gets made:

1. **Pick a character.** Name it first (any choice you leave open is filled in from the letters of the name), then pick who they are: one of twelve Jungian archetypes (Innocent, Hero, Sage, Jester, ...) or one of the sound types. This is the biggest choice, so it comes first. Then answer five quick questions, each with an optional "except when..." moment. Answer any, all or none.
2. **Shape it.** About 29 dials cover pitch, rhythm, instruments, phrase length, vibrato, bends, noise and drums. Lock or switch off any of them. Most people never need to touch them; the control is there for people who want it and either know Music Lingo or want to learn or experiment.
3. **Teach it.** After the initial deisgn or tweaking the dials, there is a basic Teaching process through Like or Nope votes, which will make the generated sounds and the character's dials drift toward what you like (a small reinforcement-learning loop; see `docs/status.md` for how well it works and it's system).
4. **Hear it feel.** The same character in six emotions across a happy/sad, energetic/calm and shallow/deep space.
5. **Take it with you.** Save as JSON, export WAV and MIDI, or bake a bank for a microcontroller.

On top of the designer sits the part that makes a robot voice *respond*: it can listen, "guess" how the speaker sounds based on it's own system of interpretation, and answer, optionally echoing their pitch contour and rhythm (the first version of the mimicry idea; see `docs/vision.md`). *How* it answers depends on who the character is: a Caregiver soothes, a Jester teases, a Rebel pushes back, a Sage listens. Each character has a temperament you can set with a short wizard, much like the voice wizard (see `docs/listener.md`).

Blip is not a set of ready-made sound files and not a finished robot. It is a **voice engine** you drop into your own build, be it Animation, Game Design, digital puppet, Animatronic, or a Robot with whatever hardware you have:

```
 your ears (mic / LLM / Arduino sound detector) ──► how does the human sound? ──┐
 your character (designed in the browser)       ──► how does this robot sound? ─┼─► a phrase ──► your speaker / buzzer / synth
 the situation (silence, speech, mood)          ──► what should it do?        ──┘
```

## What is in the box

| Piece | What it does | Where |
|---|---|---|
| **Half Blip (everything in one page)** | Designer, Respond (how the character reacts) and Listen together, with a character bar at the top to switch characters at any time. Single file, works offline. Start here. | `halfblip.html` |
| **Designer** | Make a character: sketch it with five questions, fine-tune by rating sounds, hear it in six feelings, add quirks. Exports WAV, MIDI, scores, and a baked bank. Single file, works offline. | `index.html` |
| **Listen demo** | The small stand-alone listener. Pick a character at the top (built-in, saved in this browser, or drop a character file), press Start, and it answers in that character's way. | `demo/listen.html` |
| **Engine** | One JavaScript module (no dependencies) behind everything: generator, plain-code synth, WAV, MIDI, zip, bake. Runs in browsers, Node, Deno, Bun. | `engine/blip-engine.js` |
| **Listener** | Pitch and loudness analysis, utterance detection, pluggable emotion interpreters (prosody, text, LLM), a reply policy, and the mimic. | `engine/blip-listen.js` |
| **CLI** | Bake banks, render WAVs, run the listener on a recording, emit protocol lines. | `tools/blip.js` |
| **Tier A player** | About 130 lines of C. One buzzer, no floats, no `delay()`. Speaks a small line protocol over serial. | `players/common/blip_player.h`, `players/arduino/BlipTierA` |

## Five-minute tour

1. Open `halfblip.html` for everything in one page, or `index.html` for the designer alone. Make a character, press Speak, vote Like or Nope for a few sounds. Save it. (Tab "Save/load": **Bake voice bank** gives you a zip.)
2. Press Listen (or open `demo/listen.html`), press Start, say something. Pick the character in the bar at the top; characters saved in the designer appear there on their own, and you can drop a character file onto the page.
3. Or from a terminal:

```sh
node tools/blip.js say   examples/chirp.character.json --feeling Happy --out hello.wav --mid hello.mid
node tools/blip.js bake  examples/chirp.character.json --per 3 --out my-bank --zip
node tools/blip.js listen recording.wav examples/chirp.character.json     # what it heard, what it would do, reply.wav
```

## Using it on a robot

Pick the row that matches your hardware. Everything in the right-hand column exists today unless marked *planned*.

| You have | Do this |
|---|---|
| Arduino / ESP32 / RP2040 with a buzzer | `bake` → copy `blip_bank.h` + `blip_player.h` into `players/arduino/BlipTierA` → upload → send `P chirp-happy-1` over serial. A laptop, Pi or phone running the listener can drive it with the same protocol (`N` lines carry a live echoed phrase). |
| Raspberry Pi / Linux SBC with a speaker | Run the engine in Node: `renderScore` → WAV → `aplay`. Or call `mimic` from your own program. |
| Android phone as the robot's head | Open the demo page in Chrome; or use it as the voice and send reply phrases from your controller. |
| An onboard LLM | Use `llmPrompt` / `parseLLM` to turn a transcript and the voice summary into an affect estimate and `fuse` it with the prosody guess. |
| A microcontroller with its own synth | Read the score JSON (`docs/formats.md`); it is just timed pitches, so you can play it on anything. MIDI export is there too, with the limits noted in the docs. |

## Honest status

Read `docs/status.md` before building on this. In short: the engine, listener, mimic, CLI, C player and both web pages are tested here, including in headless Chromium and with a fake microphone. **Nothing has been run on a physical microphone, speaker, Arduino or robot yet**, and emotion from voice is genuinely limited (see `docs/listener.md`). Hobbyist testers are the most valuable contribution right now.

## Develop

```sh
npm test                 # engine, listener, and the C player against the JS reference (needs node + a C compiler)
npm run test:browser     # designer, demo, all-in-one app and sound parity in headless Chromium (needs Playwright)
npm run test:sim         # does Like/Nope steer a character? a simulated listener (see docs/status.md)
npm run build            # rebuilds index.html, halfblip.html and demo/listen.html from designer/ and demo/ + engine/
```

Edit `designer/index.src.html`, `demo/listen.src.html` and `engine/*.js`, never the built pages.

## Docs

`docs/architecture.md` how the pieces fit · `docs/formats.md` score, voice, bank, character · `docs/protocol.md` the serial protocol · `docs/tiers.md` what each class of hardware can do · `docs/listener.md` hearing, emotion and its limits · `docs/vision.md` the larger picture and what is next · `docs/decisions.md` what changed from the earlier proposals and why · `docs/status.md` tested, untested, next.

MIT licensed, see `LICENSE`.
