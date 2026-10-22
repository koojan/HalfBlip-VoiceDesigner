/* Blip Tier A: a buzzer that speaks the Blip line protocol.
 *
 * 1. node tools/blip.js bake my-character.json --out my-bank
 * 2. copy my-bank/blip_bank.h and players/common/blip_player.h into this sketch folder
 * 3. set BUZZER_PIN, upload, open the serial monitor at 115200 and type:  I   then   P <score-id>
 *
 * Written to compile on ESP32, RP2040, SAMD and AVR cores (tone()/noTone()). NOT yet tested on real
 * hardware by the author: if it misbehaves on your board, please open an issue with the board name.
 * AVR note: the bank lives in RAM here; a big bank needs PROGMEM (not handled yet).
 */
#include "blip_player.h"
#include "blip_bank.h"

const int BUZZER_PIN = 8;
blip_player player;
char line[BLIP_LINE_MAX + 2];
uint8_t len = 0, overflow = 0;
uint16_t lastHz = 0;

void setup() {
  Serial.begin(115200);
  blip_init(&player, &blip_the_bank);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      char reply[96];
      line[len] = 0;
      if (overflow) strcpy(reply, "- E BADCMD line too long");
      else blip_command(&player, line, millis(), reply, sizeof reply);
      Serial.println(reply);
      len = 0; overflow = 0;
    } else if (len < BLIP_LINE_MAX) line[len++] = c;
    else overflow = 1;
  }
  uint16_t hz = blip_tone(&player, millis());   // never blocks: call it every loop
  if (hz != lastHz) { if (hz) tone(BUZZER_PIN, hz); else noTone(BUZZER_PIN); lastHz = hz; }
}
