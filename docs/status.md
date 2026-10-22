# Status

## Tested here

- The all-in-one page `halfblip.html` (`tests/app-chromium.js`): character switching, Respond wizard saving, simulated situations, reload persistence, fake microphone. The Respond temperaments: distinct reactions per archetype in simulation (`tests/listen.test.js`).

- `tests/engine.test.js`: determinism, score structure, rendering is finite and soft-limited, WAV round trip, MIDI parses with matching note on/off, zip opens in Python, bank and pick, `N` line sizes.
- `tests/listen.test.js` (synthetic speech): silence gives nothing; one utterance found with pitch within 8%, rise and fall contours, duration, rate; two utterances stay separate; arousal separates after a baseline; reply rules (de-escalate, soft, warm, cooldown, murmur); mimic follows rising and falling speech and strength 0 equals the plain phrase.
- `players/host/run.sh`: the C player compiled with `-Wall -Wextra` and also run under AddressSanitizer and UBSan; every millisecond of every score at three octave settings equals the JS reference, plus a protocol conversation including malformed lines.
- `tests/designer-chromium.js` (headless Chromium): the designer loads without errors, plays one voice at a time, learns from ratings, round-trips saves, respects phrase range, produces the same sound as the engine for the same character file, and its export buttons produce valid zips.
- `tests/demo-chromium.js`: the Listen page runs with a fake microphone playing synthetic speech and reports what it heard and decided.
- `tests/parity-chromium.js`: the new synth against the old Web Audio synth through an OfflineAudioContext.

## How well does Like/Nope work? (simulated)

`npm run test:sim` runs a simulated listener with a hidden target voice who votes by closeness. Distance to the target, relative to the start (1.00 = no progress), mean of 30 runs, learning rate 0.25, a listener who cares about five dials:

| ratings | 0 | 25 | 50 | 100 | 200 | 400 |
|---|---|---|---|---|---|---|
| clean votes | 1.00 | 0.88 | 0.72 | 0.51 | 0.31 | 0.23 |
| 25% of votes flipped | 1.00 | 0.98 | 0.91 | 0.85 | 0.73 | 0.58 |
| random votes (control) | 1.00 | 1.01 | 1.03 | 1.05 | 1.03 | 1.00 |

What this says: the rule does steer a character, and random voting does nothing, so the loop is not fooling itself. But it is **slow**: about 50 clean ratings gets you roughly a quarter of the way, and inconsistent voting slows it a lot. If the listener cares about all 29 dials equally it barely moves in 100 ratings (0.95). Raising the learning rate made it worse (overshoot, spread collapsing), so it stays at 0.25. Practical reading: the archetype and sketch questions set most of the voice, manual dials fix the rest, and Like/Nope is for polishing over a session or two. This tests the rule, not people: real listeners are less consistent than this simulation, and nobody has measured that yet.

## Not tested

- Whether the response personalities feel right to real people (they are design choices, tested only in simulation).

- **Any physical hardware**: a real microphone in a real room, real speakers, an Arduino or ESP32 running the sketch (`BlipTierA.ino` has not been compiled with an Arduino toolchain, only the header on a PC), a robot.
- **Real speech.** The listener was tested on synthetic voiced signals. Real voices, accents, whispers and noisy rooms will behave worse. Thresholds (`minRms`, noise-floor factor, 500 ms hangover) will need tuning.
- **How it sounds.** The synth was matched to the old one by numbers (envelopes, level), and nobody has listened to a side-by-side. Expect small timbre differences from the older designer; please report any you dislike.
- **Web Serial** in the Listen page (experimental).
- Browsers other than Chromium; Safari's audio rules in particular.

## Known limits

- Mimicry uses energy peaks as syllables, so slow or mumbled speech yields fewer, longer notes.
- A score can be longer than a single protocol line; use `N` then `N+`. Very long live phrases are capped at 48 notes on Tier A.
- The Tier A bank lives in RAM on AVR boards.
- Labels' learned meaning is project-level, not in the character file; the CLI reads them from a project file with `--labels`.

## Next steps, in the order that gives the most for the least

1. Real-world pass: run the demo with real voices and a Pi or phone, tune the listener thresholds, record what breaks.
2. A Tier B player: a C port of `renderScore` for ESP32 I2S, checked against the JS output.
3. The reaction log (utterance, decision, outcome) and a loop that learns from it, as sketched in the earlier proposal.
4. Speech-to-text adapters for the interpreter slot (on-device first).
