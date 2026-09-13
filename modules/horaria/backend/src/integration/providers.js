import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { signEnvelope, bodyHash } from './signature.js';

// Identity is inherited from the verified request, never from prompts or customer data.
export const aiIdentity = new AsyncLocalStorage();
export function createAiClient() {
  return { messages: { async create(params) {
    if (process.env.HORARIA_ALLOW_AI !== '1') throw new Error('La generació amb IA encara no està activada.');
    const identity = aiIdentity.getStore();
    if (!identity || identity.kind !== 'user') throw new Error('Cal executar la IA des del xat o una automatització autoritzada d’AiBrain.');
    const target = '/api/horaria-codex';
    const body = Buffer.from(JSON.stringify({ system: params.system, messages: params.messages, tools: params.tools, tool_choice: params.tool_choice }));
    const token = signEnvelope({ v: 1, kind: 'user', installationId: process.env.HORARIA_INSTALLATION_ID,
      actorId: identity.actorId, employeeId: identity.employeeId, method: 'POST', target,
      timestamp: Date.now(), nonce: randomUUID(), contentType: 'application/json', bodyHash: bodyHash(body),
    }, process.env.HORARIA_BRIDGE_SECRET);
    const response = await fetch(new URL(target, process.env.HORARIA_CODEX_URL), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-aibrain-authorization': token },
      body, redirect: 'error', signal: AbortSignal.timeout(20 * 60_000),
    });
    if (!response.ok) throw new Error(`Codex d’AiBrain no ha completat el càlcul (${response.status}).`);
    return response.json();
  } } };
}

export function requireDelivery() {
  if (process.env.HORARIA_ALLOW_DELIVERY !== '1') throw new Error('Els enviaments de WhatsApp encara no estan activats.');
  if (process.env.WHATSAPP_MOCK === 'true') throw new Error('El mode de simulació no pot fer enviaments reals.');
  const env = process.env;
  const explicit = (env.WHATSAPP_PROVIDER || '').toLowerCase();
  const provider = ['meta', '360dialog', 'twilio'].includes(explicit) ? explicit : env.D360_API_KEY ? '360dialog' : !env.WHATSAPP_TOKEN && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? 'twilio' : 'meta';
  const ready = provider === 'twilio' ? env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
    : provider === '360dialog' ? env.D360_API_KEY : env.WHATSAPP_TOKEN && (env.WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_PHONE_ID);
  if (!ready) throw new Error('Falten les credencials del proveïdor de WhatsApp.');
}
