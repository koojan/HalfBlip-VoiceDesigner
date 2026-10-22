# BlipLab-VoiceDesigner-microduck simulator
an OpenSource project for creating Sounds for Robots, Animatronics, with Character Design and Voice Design System
---
Blip Lab is a browser-based playground for creating expressive, 8-bit robot voices—little chirps, musical phrases, and electronic babble with a personality of their own and Specific sounds designer for emotional tones. Shape a character’s sound, fine-tune it with (RL) Like/Nope feedback, and save or share it as JSON. The designer runs from a single HTML file, Mostly as a Companion Phone app for Hobbyist Robots, Animatronics, Digital Puppets, with no installation, build tools, or server. Hardware playback is the next step: bringing those voices to simple buzzer boards and richer microcontroller-based players, without requiring a phone.
---
Currently the App can generate sounds and voice emotions in different types of musical tones that convey emotions from happy to bored, from curious to sleepy in a continuum all after the **character design** is done, which itself makes the Timbre and type of voice generated, which also contains a general mood and attitude of the character, changing the underlying voice and the reaction and so on

This can be used to generate sounds also for animations and videos or even game design, while it is a basic system, it's a balanced mixed of the general Character Design, which is done in a series of choosing Archetypal character category (based on Jungian ideas) and musical and the way Humans use their Tone, voice and rhythm to convey their mood, it is also both an Engine (which can generate new "musical sentences" on demand, or can be used to export sounds in WAV format to use in fixed situations (like low calculation setups on Arduino like embedded systems) and dynamic ones (like a character in a game, or an actual robot)

full control for Musical specialties (from Pitch, types of Rhythms, Instruments, length of the sentence, Vibrato, and so on)

There is also a simple Reinforcement Learning setup present in the engine, which is basically a simple Yes/No vote to sample generated voices that could fine-tune the Voice of the Characters further based on the data gathered. This is obviously the first draft of the engine, so it has not been tested extensively on how efficient or useful the RL setup is for extended uses and how effective it is.

in further expansions of the system I'm hoping to incorporate a Sound Mimicry system that would be able to receive a Voice Recording and mimic the Rhythm, Pitch and specific voice patterns while still being able to manipulate and fine-tune it further by changing single or multiple parameters.

any suggestion is welcome, although this is obviously a simple proposed system, I've tried to make it as balanced as i can, both in setting up the voice, so that it wouldn't be hard or need extensive time for setting up, but also give the user the ability to tweak it further, while obviously for non-musical users this may seem like too much complexity, which may not even be used or tweaked but also provide as certain level of control, No Product can be perfect and there's always trade-offs, and My try has been to Give any user a certain amount of satisfaction when using this engine.

Thanks for your attention.
