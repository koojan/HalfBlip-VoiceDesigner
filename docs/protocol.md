# Line protocol

One ASCII command per line (`\n`, `\r\n` accepted), at most 255 bytes, 115200 baud on USB serial or the same framing over BLE UART. Every command gets exactly one response line. `+` is success, `- E <CODE> <message>` is failure. A player never sends unsolicited lines. Implemented by `players/common/blip_player.h` and tested in `players/host/test_player.c`.

| Command | Meaning | Response |
|---|---|---|
| `I` | identify | `+ I blip 1 tier=a fw=0.2.0` |
| `V?` / `V <id>` | query / select voice | `+ V chirp` / `+ V chirp ok` / `- E NOVOICE x` |
| `P <score-id> [gain]` | play a score already on the player; a new `P` replaces the old one | `+ P playing 2322ms` / `- E NOSCORE x` |
| `P?` | playing state | `+ P playing <id> t=640` / `+ P idle` |
| `X` | stop | `+ X stopped` |
| `G` | status | `+ G v=chirp p=1 t=640 fw=0.2.0` |
| `T mute=0\|1`, `T oct=-2..2` | settings | `+ T oct=-1 ok` / `- E BADKEY gain` / `- E RANGE` |
| `N hz/ms hz/ms ...` | **live phrase**: play these notes now (`hz` 0 is a rest; extra `/field`s are ignored) | `+ N playing 800ms` |
| `N+ hz/ms ...` | append notes to the live phrase that is still playing | `+ N+ ok` / `- E NOSCORE no live phrase` |

Error codes: `BADCMD`, `BADKEY`, `RANGE`, `NOVOICE`, `NOSCORE`. A player must answer an unsupported key with `BADKEY` rather than ignore it. A Tier A player rejects `T gain=` because a buzzer has no volume; a Tier B or C player may accept it.

`N` is the one addition over the earlier proposal. It is what lets a smart client echo a speaker without making the player smart: the client composes the phrase (`blip encodeN`, or `node tools/blip.js emit score.json`), splitting it across `N` and `N+` lines if it is longer than one line. There is no upload command: voices and banks are compiled in or flashed.

```
→ I                               ← + I blip 1 tier=a fw=0.2.0
→ P chirp-happy-1                 ← + P playing 2322ms
→ P?                              ← + P playing chirp-happy-1 t=640
→ N 523/200 587/200 0/100 659/300 ← + N playing 800ms
→ X                               ← + X stopped
```

Piping from a shell: `node tools/blip.js emit reply.score.json > /dev/ttyUSB0`.
