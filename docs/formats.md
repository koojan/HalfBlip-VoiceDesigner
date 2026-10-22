# Formats

All formats are JSON with `format` and `version`. Readers should ignore keys they do not know.

## blip-character (v1)

What the designer saves. `name`, `color`, `octave` (-2..2), `seed`, `minN`/`maxN` (phrase length), `quirk` (`amt`, `types`), `params` (for each of 29 dials: `mu` centre 0..1, `sd` spread, `lock`, `off`), `feel` (scores), `book` (kept sounds), optional `photo`.

`gain` in a v1 file is the **feeling pull** (how far a feeling moves the dials, default 0.8). The engine calls it `pull` to avoid confusion with volume; files now write both keys and readers accept either.

`blip-project` holds `chars` (characters) and `labels` (names with tagged examples).

Optional character keys added later: `archetype` (one of the twelve), `temperament` (the response settings from the Respond page, see `listener.md`) and `relationship` (`moodV`, `moodA`, `bond`). Files without them still load; the temperament then comes from the archetype.

## blip-score (v1 draft, with extensions)

```json
{ "format": "blip-score", "version": 1, "id": "chirp-happy-1", "voice": "chirp", "dur_ms": 2322,
  "timbre": { "chip": 0.91, "flute": 0.04, "bass": 0, "trump": 0, "piano": 0.1, "choir": 0, "noise": 0.02, "drive": 0.1, "vib": 0.55 },
  "events": [
    { "t": 0,   "d": 332, "hz": 548.73, "vel": 0.76, "f": 1, "h0": 518.25, "r": 70 },
    { "t": 332, "d": 229, "hz": 548.73, "vel": 0.93 },
    { "t": 561, "d": 223, "k": 2, "vel": 0.9 },
    { "t": 784, "d": 120, "hz": null, "vel": 0 } ],
  "meta": { "seed": 1284711, "source": { "v": 0.8, "a": 0.4, "em": "Happy" } } }
```

- `t`, `d`: onset and length in milliseconds. Events are sorted by `t`.
- `hz`: absolute pitch; `null` is a rest; absent on a drum hit.
- `k`: drum, 1 kick, 2 snare, 3 hat.
- `vel`: loudness 0.15..1.8 (a player may clamp).
- `f` / `l`: first / last event of a rhythmic group.
- **Extensions:** `h0` pitch at the start of a note (a glide or scoop into `hz`), `r` glide length in ms, `h1` pitch the note bends to at its end, and the score-level `timbre` block.
- `meta` is bookkeeping; players ignore it.

**Smallest useful reader:** `t`, `d`, `hz` only. That is a monophonic melody on any buzzer.

## blip-voice (v1)

`{id, name, lead, octave, timbre}`. `lead` is the dominant instrument (`chip`, `flute`, `bass`, `trump`, `piano`), for players that can only pick one.

## blip-bank (v1)

`{voice, scores:[{id, tags:[feeling], v, a, score}], bank_meta}`. `v` and `a` (valence and arousal in -1..1) let a client pick the nearest score for a target feeling.

## blip-heard (v1, not frozen)

An utterance summary from the listener: `dur_ms`, `voiced_ratio`, `pause_ratio`, `pitch_mean_hz`, `pitch_range_semitones`, `rms_mean`, `rms_range`, `rate_per_s` (energy peaks per second, a rough syllable rate), `contour` (`flat`, `rise`, `fall`, `rise-fall`, `fall-rise`). The listener also keeps per-frame `{rms, f0, speech}` for mimicry.

## Export formats

- **WAV:** 16-bit mono PCM, any sample rate; `renderScore(score,{sr})`.
- **MIDI:** format 0, one tick per millisecond, one General MIDI program from the lead instrument, drums on channel 10, glides as pitch bend (range set to 12 semitones), vibrato as mod wheel. **Lossy:** no choir blend, noise or distortion, and a synth's own timbre replaces Blip's. Use it to hand the melody to something that already has voices.
- **C header:** `blip_ev` arrays for the Tier A player.

The designer also saves a `wizard` block (`pick`, `except`, `shortcuts`) so a character can be re-sketched from its choices. Dials the choices do not cover are derived from a hash of the name (`compose` in the designer), so the same name always gives the same starting voice.

`wizard.ranges` holds dial ranges set with the two-handle sliders (`{dial:[low,high]}`, 0 to 1; the middle is the dial's centre and the gap sets its spread). `wizard.seconds` is the sentence-length range in seconds; the designer fits the length dial and phrase-length limits so the median sentence lands in the middle of that range.
