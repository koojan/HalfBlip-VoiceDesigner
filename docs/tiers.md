# Tiers

Hardware varies a lot, so a score is an *intent* and each player renders what it can.

| Tier | Typical hardware | Plays | Does not do |
|---|---|---|---|
| **A** | Arduino or any board with one buzzer pin | One tone at a time, pitches and timing, drums as short clicks (kick 80 Hz 60 ms, snare 220 Hz 40 ms, hat 3 kHz 15 ms) | Volume, bends, timbre, noise, choir |
| **B** | ESP32 with I2S DAC or amp | Everything in the score if you render with the engine's algorithm in C (not written yet) | |
| **C** | Raspberry Pi, phone, laptop | Everything: run the JS engine, render a WAV, play it | |
| **Bring-your-own synth** | Anything with its own sound source | MIDI export, or read score JSON | Blip's exact timbre |

## Tier A rules (the golden reference)

For a pitched event with duration `d` ms: sound for `d` if `d <= 40`, otherwise for `max(d - 8, floor((7d + 5) / 10))` ms, so repeated notes stay separate. Pitch is `round(hz)`, shifted by `T oct` with integer maths. A drum plays its click for `min(click, d)`. If events overlap, the earlier one wins. `engine.tierA()` and `blip_tone_at()` implement exactly this and `players/host/test_player.c` checks them against each other for every millisecond of every score, at three octave settings.

## Honest note on Tier B

The browser synth is a plain sample-by-sample renderer (`renderScore`), written so it can be ported: oscillators, wave tables, biquad filters, an envelope per voice and one master compressor. A C port for ESP32 is the obvious next player; it is not written, so today Tier B means "render on a nearby computer and stream or store the WAV".
