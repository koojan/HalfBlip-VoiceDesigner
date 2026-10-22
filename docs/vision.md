# Vision and the larger picture

Half Blip aims to be the **voice layer** for small expressive machines: robots, animatronics, digital puppets, game characters. It is not a robot platform and not a sound library. The idea in one line: *design a character's voice once, then let it speak from a mood, and eventually from what it hears.*

## The three jobs it does

1. **Design.** Make a voice fast, by picking an archetype and answering a few questions, and deep, by turning any of ~29 musical dials. This is the designer.
2. **Generate.** The same character produces endless new phrases that fit a feeling and never repeat exactly: an engine for dynamic situations (a game character, a live robot). For fixed situations on tiny hardware, bake sounds ahead and export WAV, MIDI or C.
3. **Respond.** Listen, estimate how the speaker sounds, choose how to react, and optionally echo their melody and rhythm in the character's own voice.

Everything shares one engine so a voice behaves the same in the designer, in a WAV, on a buzzer and in a live reply.

## Characters: archetypes as the starting point

The twelve Jungian archetypes are a way to *start* a voice from a personality rather than from sliders. They are presets for the dials; the sound that goes with each is a design choice and open to argument.

| Archetype | Feel | What its dials lean toward |
|---|---|---|
| Innocent | light, bright, trusting | high pitch, chip and flute, soft bends, no grit |
| Everyman | plain, friendly | middle everything, chip with a little piano |
| Hero | bold, brassy | trumpet, rising lines, accents, some drums |
| Caregiver | warm, slow, soothing | flute and choir, gentle swell, long notes |
| Explorer | curious, wandering | wide range, octave leaps, wobble |
| Rebel | rough, off-beat | grit, bassoon, drums, chaos, hard accents |
| Lover | sliding, lingering | choir, strong glide and vibrato, long notes |
| Creator | inventive | piano, wobble, wide span, odd groupings |
| Jester | quick, bouncy | high, fast, swing, surprises, hats |
| Sage | slow, airy | low, long pauses, flute and bassoon |
| Magician | shimmering, a little strange | choir, heavy glide, noise, wide range |
| Ruler | deep, measured | low, bassoon and trumpet, slow, heavy |

Each is also a command-line start: `node tools/blip.js new Sage --name Oracle`.

## Where each piece of the plan stands

- **Designer, archetypes, dials, locks, sketch questions, feelings, quirks, labels, save/load:** working.
- **Like/Nope learning:** working, measured in simulation, slow (see `docs/status.md`). The honest framing for users: it polishes a voice, it does not build one from nothing.
- **WAV, MIDI, baked banks, C header, Tier A player:** working and tested on a computer; not yet on a real board.
- **Mimicry:** a first version exists (`mimic`): pitch contour, rhythm and loudness of a recording become a phrase in the character's timbre, blendable from "own phrase" to "pure echo". It does not copy a voice's timbre, which is deliberate, since it is an 8-bit robot. It has been tested on synthetic speech only. Fine-tuning after mimicking works because the result is an ordinary sound: change dials, regenerate.
- **Companion phone app:** the designer and the Listen demo are web pages that run on a phone. A native app, or a bridge from the phone to a robot over serial or Bluetooth, is not built; the Listen page has an experimental Web Serial button for desktop browsers.
- **Hearing emotion:** energy from prosody works in principle; mood does not, and Blip says so rather than guessing. Text, LLM and camera interpreters plug into the same slot.

## Suggestions, in priority order

1. **Get it in front of real hardware and real voices.** Everything unproven is about the physical world. A short testers' checklist (a Pi with a speaker, an ESP32 with a buzzer, a phone) would teach more than any new feature.
2. **Put the listener behind a phone app.** The phone is the one device every hobbyist already has: microphone, speaker, screen for the designer, radio for talking to the robot. Make "phone is the ears and the voice, robot is the body" the default recipe.
3. **Decide the learning story.** Either speed it up (let users drag a dial and have that count as a strong vote; learn from the dials you touch), or keep it as a polish step and say so. The simulation shows the rule works but is slow.
4. **Add a Tier B player.** A C port of the renderer for ESP32 would make the whole voice, not just melody, run on a cheap board with no phone.
5. **Grow the presets.** More archetypes and example characters, shared as JSON, is the cheapest way to make the first five minutes good. Consider a small gallery folder in the repo that accepts pull requests.
6. **Keep non-musical people in mind.** Every dial has a plain-language name and help text. The archetypes, the five questions and "Random" mean nobody has to touch a slider.

## Trade-offs worth stating openly

- More control means more screens. The design answer is layers: archetype first, questions second, dials for the curious.
- A score is an intent, not a recording. Each player renders what it can, so a buzzer sounds simpler than a speaker. That is the price of running anywhere.
- 8-bit and musical by design: it expresses mood through pitch, rhythm and timbre, as people do with their voices, not through words.
