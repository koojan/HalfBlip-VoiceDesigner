/* Host test for the Tier A player: compile and run on a PC.
 *   gcc -Wall -Wextra -O1 -I../common test_player.c -o test_player && ./test_player golden
 * Checks (1) every millisecond of every score against the JS reference timelines in golden/,
 * and (2) the protocol conversation from docs/protocol.md. */
#include <stdio.h>
#include <stdlib.h>
#include "blip_player.h"
#include "blip_bank.h"

static int fails = 0;
#define CHECK(c, ...) do { if (!(c)) { fails++; printf("FAIL "); printf(__VA_ARGS__); printf("\n"); } else printf("ok   "), printf(__VA_ARGS__), printf("\n"); } while (0)

static int golden(const char *dir, int oct) {
  char path[256]; snprintf(path, sizeof path, "%s/tierA-oct%d.txt", dir, oct);
  FILE *f = fopen(path, "r"); if (!f) { printf("cannot open %s\n", path); return 1; }
  /* load spans per score */
  static struct { char id[64]; unsigned a, b, hz; } sp[4000]; int n = 0;
  while (n < 4000 && fscanf(f, "%63s %u %u %u", sp[n].id, &sp[n].a, &sp[n].b, &sp[n].hz) == 4) n++;
  fclose(f);
  long checked = 0, bad = 0;
  for (int i = 0; i < blip_the_bank.n; i++) {
    const blip_score *sc = &blip_the_bank.scores[i];
    for (unsigned ms = 0; ms < sc->dur_ms + 50u; ms++) {
      unsigned want = 0; for (int k = 0; k < n; k++) if (!strcmp(sp[k].id, sc->id) && ms >= sp[k].a && ms < sp[k].b) { want = sp[k].hz; break; }
      unsigned got = blip_tone_at(sc->ev, sc->n, ms, (int8_t)oct);
      checked++; if (got != want) { if (bad++ < 5) printf("  mismatch %s @%ums: C=%u JS=%u\n", sc->id, ms, got, want); }
    }
  }
  CHECK(bad == 0, "oct %+d: %ld ms across %d scores match the JS reference", oct, checked, blip_the_bank.n);
  return bad != 0;
}

static void say(blip_player *p, const char *line, uint32_t now, const char *want_prefix) {
  char out[300]; blip_command(p, line, now, out, sizeof out);
  CHECK(!strncmp(out, want_prefix, strlen(want_prefix)), "%-26s -> %s", line, out);
}

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "golden";
  golden(dir, 0); golden(dir, -1); golden(dir, 1);

  blip_player p; blip_init(&p, &blip_the_bank); char out[300];
  say(&p, "I", 0, "+ I blip 1 tier=a fw=");
  say(&p, "V?", 0, "+ V chirp");
  say(&p, "V chirp", 0, "+ V chirp ok");
  say(&p, "V nope", 0, "- E NOVOICE nope");
  say(&p, "P chirp-happy-1", 1000, "+ P playing ");
  CHECK(blip_tone(&p, 1000) != 0 || blip_tone(&p, 1050) != 0 || blip_tone(&p, 1400) != 0, "tone is produced while playing");
  say(&p, "P?", 1640, "+ P playing chirp-happy-1 t=640");
  say(&p, "G", 1640, "+ G v=chirp p=1 t=640 fw=");
  say(&p, "P nothing-here", 1700, "- E NOSCORE nothing-here");
  say(&p, "T mute=1", 1700, "+ T mute=1 ok");
  CHECK(blip_tone(&p, 1700) == 0, "mute silences output");
  say(&p, "T mute=0", 1700, "+ T mute=0 ok");
  say(&p, "T gain=0.5", 1700, "- E BADKEY gain");
  say(&p, "T oct=-1", 1700, "+ T oct=-1 ok");
  say(&p, "T oct=3", 1700, "- E RANGE");
  say(&p, "T oct=0", 1700, "+ T oct=0 ok");
  say(&p, "X", 1800, "+ X stopped");
  CHECK(blip_tone(&p, 1810) == 0, "stopped means silent");
  say(&p, "P?", 1800, "+ P idle");
  say(&p, "Q whatever", 1800, "- E BADCMD unknown command");
  say(&p, "P chirp-happy-1 0.5", 2000, "+ P playing ");          /* gain argument accepted, ignored */
  uint16_t dur = blip_the_bank.scores[0].dur_ms; (void)dur;
  say(&p, "P chirp-sad-1", 2100, "+ P playing ");                   /* a new P replaces the old one */
  say(&p, "P?", 2200, "+ P playing chirp-sad-1 t=100");
  /* live notes */
  say(&p, "N 523/200 587/200 0/100 659/300", 5000, "+ N playing 800ms");
  CHECK(blip_tone(&p, 5100) == 523 && blip_tone(&p, 5250) == 587 && blip_tone(&p, 5450) == 0 && blip_tone(&p, 5550) == 659, "live phrase plays the right pitches");
  say(&p, "N+ 440/100", 5300, "+ N+ ok");
  CHECK(blip_tone(&p, 5850) == 440, "appended note plays");
  say(&p, "N 100/10 200/abc", 6000, "- E RANGE");
  /* malformed lines never wedge it */
  say(&p, "", 6100, "- E BADCMD"); say(&p, "P", 6100, "- E BADCMD"); say(&p, "V", 6100, "- E BADCMD"); say(&p, "I", 6100, "+ I blip 1");
  char big[400]; memset(big, 'A', 300); big[300] = 0; blip_command(&p, big, 0, out, sizeof out); CHECK(!strncmp(out, "- E BADCMD line too long", 24), "line over 255 bytes is rejected");
  /* the player finishes by itself */
  say(&p, "P chirp-happy-1", 10000, "+ P playing "); CHECK(blip_tone(&p, 10000 + 60000) == 0, "playback ends on its own"); say(&p, "P?", 70001, "+ P idle");
  printf(fails ? "%d FAILED\n" : "all player checks passed\n", fails); return fails != 0;
}
