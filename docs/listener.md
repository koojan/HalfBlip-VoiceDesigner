# Listener

What it does: reads audio in 20 ms frames, tracks a noise floor, finds **utterances** (speech bursts ended by half a second of quiet), and summarises each (see `blip-heard` in formats.md). Nothing is stored unless your code stores it.

```js
const ls = BlipListen.createListener({ sr: 16000 });
ls.on('utterance', u => { /* u.summary, u.frames */ });
ls.push(float32Chunk);                       // feed it any size of chunk
```

## From sound to feeling

Several **interpreters** each return `{v, a, cv, ca, src}`: valence and arousal in -1..1, and how sure each is (0..1). `fuse()` weights them by confidence.

- **prosodyInterpreter**: arousal from pitch, pitch range, loudness and speed *relative to that speaker's own running average*. Valence is almost zero with very low confidence on purpose.
- **lexiconInterpreter**: a toy word list, there to show where text plugs in.
- **llmPrompt / parseLLM**: build a prompt from a transcript and the voice summary, parse a JSON answer. You supply the speech-to-text and the model.

Add your own: any function that takes a heard utterance and returns that shape.

## What you can and cannot know

- **Arousal (calm versus energetic) is readable from the voice.** Quiet, low and slow versus loud, high and fast is a real signal, especially against the speaker's own baseline.
- **Valence (pleasant versus unpleasant) mostly is not.** Angry and happy voices can look alike in pitch and loudness. Blip reports it as unknown rather than guessing, and the reply policy treats unknown valence by staying warm and mirroring only energy. Words, a camera or an LLM can add valence; the fuse step uses them in proportion to how sure they are.
- **Speech-emotion models** trained on acted speech do worse on everyday speech. If you plug one in, give it a modest confidence.
- **Pitch tracking fails** on whispers, creaky voice, music and loud room noise, so an utterance with few voiced frames gets low confidence.
- **Latency:** an utterance is only known to have ended after about 500 ms of quiet, so replies cannot be faster than that. The brain adds a human-feeling delay on top.
- **Echo:** the demo stops listening while it speaks and for half a second after. Use headphones or keep volume low.
- **Privacy:** audio is analysed in the browser or process you run it in. Keep it that way unless you decide otherwise; if you add cloud speech-to-text, tell your users.

## The reply policy

`createBrain({personality})` turns an utterance and an affect estimate into a decision: reply, stay quiet, or (after a long silence) murmur. Its rules, in order: respect a cooldown; sometimes stay silent (more often if it is not chatty or the utterance was a short noise); mirror the speaker's energy in proportion to how sure it is; if the speaker sounds upset and tense, **de-escalate** (lower energy, neutral mood) rather than match; if low, be soft and gentle; if valence is unknown, be warm; a rising end reads as a question and nudges the reply curious. `decision.why` always says which rule fired. Personality knobs: `mirror`, `warmth`, `empathy`, `chattiness`.

## Mimic

`mimic({heard, char, v, a, seed, strength})` builds a phrase from the character's generator and the speaker's contour: one note per energy peak, pitch from the speaker's pitch relative to their own median (stretched about two times so it reads as melody), durations from the gaps, loudness from the peaks. `strength` blends from 0 (the character's own phrase) to 1 (an echo of the speaker in the character's timbre). Short utterances get short answers. The result is an ordinary sound: `toScore` it, render it, or send it as `N` lines.

## Temperament: how the character decides what to do

The reply policy is now a **temperament** (`createBrain({temperament})` in `engine/blip-listen.js`). Each character has one, set from its archetype and adjustable in the Respond page with seven wizard questions (when you sound upset, when you sound excited, how talkative, how much it copies, whether it disagrees, mood, taste) and five groups of sliders.

For every utterance the brain scores these modes: match, soothe, cheer, tease, contradict, complain, sulk, perk up, backchannel, own thing, stay quiet. Scores come from what was heard (energy, and mood when known), the character's temper, its **taste** (it likes some energies, pitches, paces and loudness more than others, so your voice pleases or annoys it), its **mood** and its **bond** with you (both drift; shouting and rambling lower the bond, calm raises it). A softmax with a little noise picks the mode, so the same words do not always get the same answer; the **why** is shown. The mode sets the reply's target energy and mood, how much it copies you, how much it exaggerates, length and delay. When nothing is said for a while it may murmur, sulk or perk up on its own.

State (`moodV`, `moodA`, `bond`) is saved with the character as `relationship`. Without a microphone you can test with `fakeUtterance(kind)`.

Honest limit: these personalities are design choices, tuned and tested in simulation only. Whether they feel right to people is untested.
