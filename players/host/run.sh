#!/bin/sh
# Builds the Tier A player on this computer and checks it against the JS reference. Needs gcc or cc.
set -e
cd "$(dirname "$0")"
node ../../tools/blip.js bake ../../examples/chirp.character.json --per 2 --out /tmp/blip-host-bank --no-wav >/dev/null
node ../../tools/blip.js golden /tmp/blip-host-bank/bank.json --out golden >/dev/null
cp /tmp/blip-host-bank/blip_bank.h blip_bank.h
${CC:-cc} -Wall -Wextra -O1 -I../common test_player.c -o /tmp/blip-test-player
/tmp/blip-test-player golden | grep -v '^ok' || true
/tmp/blip-test-player golden >/dev/null && echo "player: all checks passed"
