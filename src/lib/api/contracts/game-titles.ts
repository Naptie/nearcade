import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';

export const gameTitlesContract = {
  /** `GET /api/game-titles` — every arcade game title the app knows. */
  list: definePublic({
    method: 'GET',
    path: '/game-titles',
    operationId: 'listGameTitles',
    tags: ['game-titles'],
    scope: 'open',
    summary: bilingual('获取游戏系列列表。', 'List the game titles.', true),
    description: bilingual(
      '返回所有机台游戏系列及其座位数，名称按当前语言本地化。',
      'Returns every arcade game title with its seat count; the names are localized.'
    )
  })
    .input(z.object({}))
    .output(
      z.object({
        titles: z
          .array(
            z.object({
              id: z.number().describe(bilingual('游戏系列 ID。', 'Game title ID.')),
              key: z.string().describe(bilingual('游戏系列标识。', 'Game title key.')),
              name: z.string().describe(bilingual('游戏系列名称。', 'Game title name.')),
              seats: z.number().describe(bilingual('每个机台的座位数。', 'Seats per machine.'))
            })
          )
          .describe(bilingual('游戏系列列表。', 'Game titles.'))
      })
    )
};
