/**
 * Spike：验证 boardgame.io 关键能力组合（阶段 0 可行性测试）
 *
 * 验证点：
 * 1. 隐藏信息：playerView 按席位裁剪对手手牌
 * 2. 两阶段流程：pick → battle（对应选人 → 战斗）
 * 3. move 纯函数校验：非法出牌返回 INVALID_MOVE 且状态不变
 * 4. bot 自动对局直至分出胜负
 *
 * 用法：`vitest run app/src/spike`。验证通过后整个目录删除。
 */
import { TurnOrder, INVALID_MOVE } from 'boardgame.io/core';

const HAND_SIZE = 3;

function makeDeck() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: i,
    cost: (i % 3) + 1,
    dmg: (i % 4) + 1,
  }));
}

export const SPIKE_GAME = {
  name: 'spike',

  setup: ({ ctx, random }) => {
    const deck = random.Shuffle(makeDeck());
    const players = {};
    for (let i = 0; i < ctx.numPlayers; i++) {
      players[String(i)] = { hp: 10, energy: 3, leader: null, hand: [] };
    }
    for (let i = 0; i < HAND_SIZE; i++) {
      for (const id of Object.keys(players)) {
        players[id].hand.push(deck.pop());
      }
    }
    return { deck, players, winner: null };
  },

  // 按观众席位裁剪：本人手牌完整，对手手牌只留计数
  playerView: ({ G, playerID }) => {
    if (playerID === null) return G;
    const players = {};
    for (const [id, p] of Object.entries(G.players)) {
      players[id] =
        id === playerID
          ? p
          : { ...p, handCount: p.hand.length, hand: undefined };
    }
    return { ...G, players };
  },

  phases: {
    pick: {
      start: true,
      moves: {
        pickLeader: ({ G, playerID }, cardId) => {
          const p = G.players[playerID];
          if (p.leader !== null) return INVALID_MOVE;
          if (!p.hand.some((c) => c.id === cardId)) return INVALID_MOVE;
          p.leader = cardId;
        },
      },
      // 每位玩家依次获得一个回合，完成一次选人
      turn: {
        order: TurnOrder.ALL,
        maxMoves: 1,
      },
      endIf: ({ G }) =>
        Object.values(G.players).every((p) => p.leader !== null) && {
          next: 'battle',
        },
    },

    battle: {
      turn: {
        order: TurnOrder.DEFAULT,
        onBegin: ({ G, ctx }) => {
          const p = G.players[ctx.currentPlayer];
          p.energy = 3;
          if (G.deck.length > 0) {
            p.hand.push(G.deck.pop());
          } else {
            // 牌库耗尽的疲劳伤害：保证对局必然收敛
            p.hp -= 1;
          }
        },
      },
      moves: {
        playCard: ({ G, playerID }, cardId) => {
          const p = G.players[playerID];
          const idx = p.hand.findIndex((c) => c.id === cardId);
          if (idx < 0) return INVALID_MOVE;
          const card = p.hand[idx];
          if (card.cost > p.energy) return INVALID_MOVE;
          const opp = G.players[playerID === '0' ? '1' : '0'];
          p.energy -= card.cost;
          opp.hp -= card.dmg;
          p.hand.splice(idx, 1);
        },
        endTurn: ({ events }) => events.endTurn(),
      },
    },
  },

  endIf: ({ G }) => {
    const dead = Object.entries(G.players).find(([, p]) => p.hp <= 0);
    if (!dead) return;
    return { winner: Object.keys(G.players).find((id) => id !== dead[0]) };
  },

  ai: {
    enumerate: (G, ctx, playerID) => {
      if (ctx.phase === 'pick') {
        return G.players[playerID].hand.map((c) => ({
          move: 'pickLeader',
          args: [c.id],
        }));
      }
      const p = G.players[playerID];
      const plays = p.hand
        .filter((c) => c.cost <= p.energy)
        .map((c) => ({ move: 'playCard', args: [c.id] }));
      return [...plays, { event: 'endTurn' }];
    },
  },
};
