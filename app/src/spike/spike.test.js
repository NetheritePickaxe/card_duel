import { describe, it, expect } from 'vitest';
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { RandomBot } from 'boardgame.io/ai';
import { SPIKE_GAME } from './spikeGame.js';

async function twoPlayerLocal() {
  const local = Local();
  const c0 = Client({
    game: SPIKE_GAME,
    multiplayer: local,
    playerID: '0',
    debug: false,
  });
  const c1 = Client({
    game: SPIKE_GAME,
    multiplayer: local,
    playerID: '1',
    debug: false,
  });
  c0.start();
  c1.start();
  // Local transport 的首次 sync 是异步的
  await new Promise((r) => setTimeout(r, 50));
  return { c0, c1 };
}

describe('spike: boardgame.io 能力验证', () => {
  it('playerView 按席位隐藏对手手牌', async () => {
    const { c0, c1 } = await twoPlayerLocal();
    const g0 = c0.getState().G;
    const g1 = c1.getState().G;

    // 本人手牌完整
    expect(g0.players['0'].hand).toHaveLength(3);
    expect(g1.players['1'].hand).toHaveLength(3);
    // 对手手牌被裁剪为计数
    expect(g0.players['1'].hand).toBeUndefined();
    expect(g0.players['1'].handCount).toBe(3);
    expect(g1.players['0'].hand).toBeUndefined();
    expect(g1.players['0'].handCount).toBe(3);
    // 公开信息（牌堆/血量）双方一致
    expect(g0.deck).toHaveLength(6);
    expect(g0.players['1'].hp).toBe(g1.players['1'].hp);
  });

  it('pick 阶段两方选人后自动进入 battle', async () => {
    const { c0, c1 } = await twoPlayerLocal();
    expect(c0.getState().ctx.phase).toBe('pick');

    const card0 = c0.getState().G.players['0'].hand[0];
    const card1 = c1.getState().G.players['1'].hand[0];
    c0.moves.pickLeader(card0.id);
    expect(c0.getState().ctx.phase).toBe('pick'); // 另一方未选
    c1.moves.pickLeader(card1.id);

    expect(c0.getState().ctx.phase).toBe('battle');
    expect(c0.getState().G.players['0'].leader).toBe(card0.id);
  });

  it('非法出牌返回 INVALID_MOVE 且状态不变', async () => {
    const { c0, c1 } = await twoPlayerLocal();
    c0.moves.pickLeader(c0.getState().G.players['0'].hand[0].id);
    c1.moves.pickLeader(c1.getState().G.players['1'].hand[0].id);

    const before = structuredClone(c0.getState().G);
    // 手里没有这张牌
    c0.moves.playCard(999);
    expect(c0.getState().G).toEqual(before);

    // 费用不足：若手牌中有费用 > 当前能量(3)的卡，出牌应被拒
    const hand = c0.getState().G.players['0'].hand;
    const expensive = hand.find((c) => c.cost > 3);
    if (expensive) {
      c0.moves.playCard(expensive.id);
      expect(c0.getState().G).toEqual(before);
    } else {
      // 全都打得起时，用不存在的卡覆盖第一条断言已足够
      expect(expensive).toBeUndefined();
    }
  });

  it('bot 自动对局直至分出胜负（Local bots 模式）', async () => {
    // 本地 CPU 对局的目标形态：Local transport 内嵌 bot 驱动双方
    const local = Local({
      bots: {
        '0': RandomBot,
        '1': RandomBot,
      },
    });
    const client = Client({ game: SPIKE_GAME, multiplayer: local, debug: false });
    client.start();

    // bot 由 LocalMaster 自动驱动，轮询等待对局结束
    let waited = 0;
    while (!client.getState().ctx.gameover && waited < 5000) {
      await new Promise((r) => setTimeout(r, 50));
      waited += 50;
    }

    const { ctx } = client.getState();
    expect(ctx.gameover).toBeTruthy();
    expect(['0', '1']).toContain(ctx.gameover.winner);
    expect(waited).toBeLessThan(5000);
  }, 10000);
});
