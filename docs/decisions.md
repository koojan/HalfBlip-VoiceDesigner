# Decisions, and where this departs from the earlier proposals

The roadmap and documents draft (Blip-Roadmap v3, Blip-Documents v1) set the right backbone and most of it is kept: the designer as the source of truth, tiers, dumb players, golden fixtures, honest limits, an append-only reaction log (planned), and the idea that a client chooses and a player plays. These points changed, each because of something the project wants that the draft ruled out.

| Draft said | Now | Why |
|---|---|---|
| "No MIDI compatibility" | MIDI export exists, labelled lossy | Makers with their own synth want the melody in a format their tools read. It is an export, not the format. |
| The designer is the only renderer; players follow | The engine owns generation **and** a plain-code synth; the designer plays the engine's render | One source of truth for sound, a WAV that matches what you designed, and a renderer that can be ported to hardware. |
| Sounds are baked ahead; a bank is the product | Baked **and** live. `mimic` composes a phrase from what was just heard and an `N` command plays it | The vision is a voice that depends on what it hears, which a fixed bank cannot do. |
| Emotion comes from the companion app | Pluggable interpreters returning `{v, a, cv, ca}`; prosody is built in, text/LLM/camera plug in | Hobbyists have very different hardware. Each source states its own confidence. |
| `blip-voice` per character | Timbre travels in each score (`timbre` block plus glide fields); the voice names the lead instrument | Each generated sound draws its own dial values, so one frozen voice would lose character variety. |
| Character field `gain` | Engine name `pull`; files carry both | `gain` collided with volume in the protocol and player. |
| Score events: `t d hz vel k f l` | Added `h0`, `h1`, `r` per event | Glides and bends are part of the voice and need to survive the bake. |
| Protocol: `V P X G T I` | Added `N`, `N+` | Live phrases without making players smart. |

Not decided yet: how the append-only reaction log and the learning loop from it should look (the data contract in the draft is a sound starting point); whether Tier B should be a C port of `renderScore` or a different, simpler synth; whether banks should be signed or versioned beyond `version`.
