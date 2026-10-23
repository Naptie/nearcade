import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual } from '$lib/schemas/common';
import { activateMachineQuerySchema, activateMachineResponseSchema } from '$lib/schemas/machines';

/**
 * `POST /machines/activate` takes its serial number from the query string, and
 * oRPC's compact input structure only reads the query string for `GET`. The
 * detailed structure keeps the query parameters in the contract instead of
 * hiding them from it.
 */
const activateMachineInputSchema = z.object({
  query: activateMachineQuerySchema
});

export const machinesContract = {
  /**
   * `POST /api/machines/activate` — activate a machine and hand out its API secret.
   *
   * The serial number is **not a credential**: it is the identifier printed on
   * the machine, it travels in the query string, and the operation *issues* the
   * secret rather than asking for one. So the operation has no guard — the
   * serial is a required input, and the schema says so.
   *
   * It is private for the same reason the activation is a one-time handshake
   * between a kiosk and its operator: it is not a surface a third-party client
   * is meant to build on, and publishing it would invite anyone who reads a
   * serial off a device to claim that machine.
   */
  activate: definePrivate({
    method: 'POST',
    path: '/machines/activate',
    operationId: 'postMachinesActivate',
    tags: ['machines'],
    inputStructure: 'detailed',
    summary: bilingual('激活机台', 'Activate machine', true),
    description: bilingual(
      '通过机台序列号激活机台，并返回 API 密钥。',
      'Activate a machine by serial number and return its API secret.'
    )
  })
    .input(activateMachineInputSchema)
    .output(activateMachineResponseSchema)
};
