import { it, expect } from 'vitest';
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { RandomBot } from 'boardgame.io/ai';
import { SPIKE_GAME } from './spikeGame.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

it('debug: bot 对局卡点', async () => {
  const local = Local({ bots: { '0': RandomBot, '1': RandomBot } });
  const client = Client({ game: SPIKE_GAME, multiplayer: local, debug: false });
  client.start();

  let last = '';
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const { ctx, G } = client.getState();
    const line = `t=${i * 200}ms phase=${ctx.phase} turn=${ctx.turn} cur=${ctx.currentPlayer} moves=${ctx.numMoves} hp=${G.players['0'].hp}/${G.players['1'].hp} leader=${G.players['0'].leader}/${G.players['1'].leader} gameover=${JSON.stringify(ctx.gameover)}`;
    if (line === last) {
      console.log('STALLED at:', line);
      break;
    }
    last = line;
    console.log(line);
    if (ctx.gameover) break;
  }
  expect(true).toBe(true);
}, 20000);
