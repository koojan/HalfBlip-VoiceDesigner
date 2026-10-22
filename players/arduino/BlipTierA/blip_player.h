/* Blip Tier A player: one buzzer, one tone at a time, no floating point, no heap, no delay().
 *
 * It plays scores that were baked into a C header by `node tools/blip.js header`, and speaks the
 * line protocol in docs/protocol.md. It is deliberately dumb: all of the expression (which feeling,
 * which phrase, how to echo the user) was decided upstream. Your sketch only has to
 *   1. feed it lines:   blip_command(&p, line, millis(), reply, sizeof reply)
 *   2. ask what to play: hz = blip_tone(&p, millis());  then tone(pin, hz) or noTone(pin)
 *
 * Only <stdint.h> and <string.h>. Compiles on AVR, ESP32, RP2040, SAMD and on a PC (see players/host).
 */
#ifndef BLIP_PLAYER_H
#define BLIP_PLAYER_H
#include <stdint.h>
#include <string.h>

#define BLIP_FW "0.2.0"
#define BLIP_LIVE_MAX 48            /* events in one live (N) phrase */
#define BLIP_LINE_MAX 255

typedef struct { uint16_t t, d, hz; uint8_t k; } blip_ev;      /* hz == 0 and k == 0 is a rest */
typedef struct { const char *id; const blip_ev *ev; uint8_t n; uint16_t dur_ms; } blip_score;
typedef struct { const char *voice; const blip_score *scores; uint8_t n; } blip_bank;

typedef struct {
  const blip_bank *bank;
  const blip_ev *ev; uint16_t n; const char *id; uint16_t dur;  /* what is playing / last played */
  uint32_t t0; uint8_t playing, mute; int8_t oct;
  blip_ev live[BLIP_LIVE_MAX]; uint16_t live_n, live_t; uint8_t live_on;
} blip_player;

static inline void blip_init(blip_player *p, const blip_bank *b) { memset(p, 0, sizeof *p); p->bank = b; }

/* what a buzzer does for a drum hit (hz, ms): kick, snare, hat. Must match engine DRUM_A. */
static const uint16_t blip_drum_hz[4] = {0, 80, 220, 3000};
static const uint8_t blip_drum_ms[4] = {0, 60, 40, 15};

static inline uint16_t blip_shift(uint16_t hz, int8_t oc) { return oc >= 0 ? (uint16_t)(hz << oc) : (uint16_t)((hz + (1u << (-oc - 1))) >> -oc); }

/* tone for a given millisecond of a score, 0 = silence. Pure function: this is what the golden tests check. */
static inline uint16_t blip_tone_at(const blip_ev *ev, uint16_t n, uint32_t ms, int8_t oct) {
  for (uint16_t i = 0; i < n; i++) {
    const blip_ev *e = &ev[i];
    if (e->hz == 0 && e->k == 0) continue;
    uint32_t len;
    if (e->k) { len = blip_drum_ms[e->k]; if (e->d < len) len = e->d; }
    else if (e->d > 40) { uint32_t a = e->d - 8, b = ((uint32_t)e->d * 7 + 5) / 10; len = a > b ? a : b; }
    else len = e->d;
    if (ms >= e->t && ms < e->t + len) return blip_shift(e->k ? blip_drum_hz[e->k] : e->hz, oct);
  }
  return 0;
}

static inline uint16_t blip_tone(blip_player *p, uint32_t now) {
  if (!p->playing) return 0;
  uint32_t el = now - p->t0;
  if (el >= p->dur) { p->playing = 0; return 0; }
  return p->mute ? 0 : blip_tone_at(p->ev, p->n, el, p->oct);
}

/* ---- tiny formatting helpers (no printf) ---- */
static inline int blip__put(char *o, int cap, int len, const char *s) { while (*s && len < cap - 1) o[len++] = *s++; o[len] = 0; return len; }
static inline int blip__num(char *o, int cap, int len, uint32_t v) { char b[11]; int i = 10; b[i] = 0; do { b[--i] = '0' + v % 10; v /= 10; } while (v); return blip__put(o, cap, len, b + i); }
static inline const char *blip__skip(const char *s) { while (*s == ' ') s++; return s; }
static inline int blip__eq(const char *a, const char *b) { while (*b) if (*a++ != *b++) return 0; return 1; }
static inline const char *blip__word_end(const char *s) { while (*s && *s != ' ') s++; return s; }
static inline uint32_t blip__uint(const char **s) { uint32_t v = 0; while (**s >= '0' && **s <= '9') v = v * 10 + (*(*s)++ - '0'); return v; }
static inline int blip__err(char *o, int cap, const char *code, const char *msg) { int l = blip__put(o, cap, 0, "- E "); l = blip__put(o, cap, l, code); if (msg && *msg) { l = blip__put(o, cap, l, " "); l = blip__put(o, cap, l, msg); } return l; }

static inline const blip_score *blip__find(const blip_player *p, const char *id, int len) {
  for (uint8_t i = 0; i < p->bank->n; i++) { const char *s = p->bank->scores[i].id; if ((int)strlen(s) == len && !strncmp(s, id, len)) return &p->bank->scores[i]; }
  return 0;
}
static inline void blip__start(blip_player *p, const blip_ev *ev, uint16_t n, const char *id, uint16_t dur, uint32_t now) { p->ev = ev; p->n = n; p->id = id; p->dur = dur; p->t0 = now; p->playing = 1; }

/* Handle one protocol line (no newline). Writes exactly one response line (no newline) into out; returns its length.
 * Never blocks. The sketch decides what to do with the answer (usually Serial.println). */
static inline int blip_command(blip_player *p, const char *line, uint32_t now, char *out, int cap) {
  if (strlen(line) > BLIP_LINE_MAX) return blip__err(out, cap, "BADCMD", "line too long");
  const char *s = blip__skip(line); int l;
  if (blip__eq(s, "I") && !s[1]) { l = blip__put(out, cap, 0, "+ I blip 1 tier=a fw="); return blip__put(out, cap, l, BLIP_FW); }
  if (blip__eq(s, "V?")) { l = blip__put(out, cap, 0, "+ V "); return blip__put(out, cap, l, p->bank->voice); }
  if (s[0] == 'V' && s[1] == ' ') {
    s = blip__skip(s + 1); int n = blip__word_end(s) - s;
    if (n && (int)strlen(p->bank->voice) == n && !strncmp(p->bank->voice, s, n)) { l = blip__put(out, cap, 0, "+ V "); l = blip__put(out, cap, l, p->bank->voice); return blip__put(out, cap, l, " ok"); }
    l = blip__put(out, cap, 0, "- E NOVOICE "); return blip__put(out, cap, l, s);
  }
  if (blip__eq(s, "P?")) {
    if (p->playing && now - p->t0 < p->dur) { l = blip__put(out, cap, 0, "+ P playing "); l = blip__put(out, cap, l, p->id); l = blip__put(out, cap, l, " t="); return blip__num(out, cap, l, now - p->t0); }
    p->playing = 0; return blip__put(out, cap, 0, "+ P idle");
  }
  if (s[0] == 'P' && s[1] == ' ') {
    s = blip__skip(s + 1); int n = blip__word_end(s) - s; const blip_score *sc = n ? blip__find(p, s, n) : 0;   /* optional gain argument is accepted and ignored: no volume on a buzzer */
    if (!sc) { l = blip__put(out, cap, 0, "- E NOSCORE "); char b[40]; int k = n < 39 ? n : 39; memcpy(b, s, k); b[k] = 0; return blip__put(out, cap, l, b); }
    blip__start(p, sc->ev, sc->n, sc->id, sc->dur_ms, now);
    l = blip__put(out, cap, 0, "+ P playing "); l = blip__num(out, cap, l, sc->dur_ms); return blip__put(out, cap, l, "ms");
  }
  if (blip__eq(s, "X") && !s[1]) { p->playing = 0; return blip__put(out, cap, 0, "+ X stopped"); }
  if (blip__eq(s, "G") && !s[1]) {
    int pl = p->playing && now - p->t0 < p->dur; l = blip__put(out, cap, 0, "+ G v="); l = blip__put(out, cap, l, p->bank->voice);
    l = blip__put(out, cap, l, pl ? " p=1 t=" : " p=0 t="); l = blip__num(out, cap, l, pl ? now - p->t0 : 0); l = blip__put(out, cap, l, " fw="); return blip__put(out, cap, l, BLIP_FW);
  }
  if (s[0] == 'T' && s[1] == ' ') {
    s = blip__skip(s + 1);
    if (blip__eq(s, "mute=")) { s += 5; if ((*s == '0' || *s == '1') && !s[1]) { p->mute = *s - '0'; l = blip__put(out, cap, 0, "+ T mute="); l = blip__put(out, cap, l, s); return blip__put(out, cap, l, " ok"); } return blip__err(out, cap, "RANGE", "mute 0 or 1"); }
    if (blip__eq(s, "oct=")) {
      s += 4; const char *vs = s; int neg = 0; if (*s == '-') { neg = 1; s++; } else if (*s == '+') s++;
      if (*s < '0' || *s > '2' || s[1]) return blip__err(out, cap, "RANGE", "oct -2 to 2");
      p->oct = neg ? -(*s - '0') : (*s - '0'); l = blip__put(out, cap, 0, "+ T oct="); l = blip__put(out, cap, l, vs); return blip__put(out, cap, l, " ok");
    }
    int n = 0; while (s[n] && s[n] != '=' && s[n] != ' ') n++;
    l = blip__put(out, cap, 0, "- E BADKEY "); char b[24]; int k = n < 23 ? n : 23; memcpy(b, s, k); b[k] = 0; return blip__put(out, cap, l, b);
  }
  /* N hz/ms ... : live phrase composed by the client (for echoing a speaker). N+ appends to the phrase that is playing. */
  if (s[0] == 'N' && (s[1] == ' ' || (s[1] == '+' && s[2] == ' '))) {
    int more = s[1] == '+';
    if (more && !(p->live_on && p->playing)) return blip__err(out, cap, "NOSCORE", "no live phrase");
    if (!more) { p->live_n = 0; p->live_t = 0; }
    s += more ? 2 : 1;
    while (*(s = blip__skip(s))) {
      uint32_t hz = blip__uint(&s); if (*s != '/') return blip__err(out, cap, "BADCMD", "expected hz/ms");
      s++; uint32_t ms = blip__uint(&s); while (*s && *s != ' ') s++;           /* ignore extra fields such as /vel */
      if (p->live_n >= BLIP_LIVE_MAX || hz > 20000 || ms == 0 || ms > 9999) return blip__err(out, cap, "RANGE", "note");
      blip_ev *e = &p->live[p->live_n++]; e->t = p->live_t; e->d = ms; e->hz = hz; e->k = 0; p->live_t += ms;
    }
    if (!more) { p->live_on = 1; blip__start(p, p->live, p->live_n, "live", p->live_t, now); }
    else { p->n = p->live_n; p->dur = p->live_t; }
    l = blip__put(out, cap, 0, more ? "+ N+ ok" : "+ N playing "); if (!more) { l = blip__num(out, cap, l, p->live_t); l = blip__put(out, cap, l, "ms"); } return l;
  }
  return blip__err(out, cap, "BADCMD", "unknown command");
}
#endif
