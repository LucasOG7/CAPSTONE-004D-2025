// src/utils/push.ts
import {
  Expo,
  ExpoPushMessage,
  ExpoPushTicket,
  ExpoPushReceipt,
} from 'expo-server-sdk';
import { supabaseAdmin } from '../supabase';

const expo = new Expo();

/** Helper: valida formato de token de Expo */
export function isExpoToken(token: string) {
  return Expo.isExpoPushToken(token);
}

/** Obtiene todos los tokens activos (para broadcast) */
export async function getAllActivePushTokens(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('push_token')
    .select('token')
    .eq('active', true);
  if (error) {
    console.error('[push] getAllActivePushTokens error', error);
    return [];
  }
  return (data || []).map((r) => r.token);
}

/**
 * Enviar un lote arbitrario de mensajes (misma interfaz que veníamos usando en el cron)
 * - Filtra tokens inválidos
 * - Chunks automáticos de expo-server-sdk
 * - Desactiva tokens con DeviceNotRegistered en tickets y receipts
 */
export async function sendExpoPush(
  batch: { to: string; title?: string; body: string; data?: any; sound?: 'default' | null }[]
) {
  if (!batch?.length) return;

  // 1) Normaliza a ExpoPushMessage y filtra tokens no-Expo
  const messages: ExpoPushMessage[] = batch
    .filter((m) => isExpoToken(m.to))
    .map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      data: m.data,
      sound: m.sound ?? 'default',
    }));

  if (messages.length === 0) return;

  // 2) Envía en chunks y procesa tickets inmediatos
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  const receiptIdToToken = new Map<string, string>(); // mapea receiptId -> token

  for (const chunk of chunks) {
    try {
      const tk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...tk);

      // Relaciona cada ticket con su mensaje (y por ende token)
      for (let i = 0; i < tk.length; i++) {
        const ticket = tk[i];
        const msg = chunk[i];
        if (ticket.status === 'error') {
          const err = (ticket as any)?.details?.error || (ticket as any)?.message;
          if (err === 'DeviceNotRegistered') {
            console.warn('[push] DeviceNotRegistered (ticket) -> deactivating', msg.to);
            await supabaseAdmin.from('push_token').update({ active: false }).eq('token', msg.to as string);
          } else {
            console.warn('[push] ticket error', err);
          }
        } else if (ticket.id) {
          // guardamos para consultar receipts luego
          receiptIdToToken.set(ticket.id, msg.to as string);
        }
      }
    } catch (e) {
      console.error('[push] error sending chunk', e);
    }
  }

  // 3) (Opcional recomendado) Consultar receipts para errores diferidos
  const receiptIds = Array.from(receiptIdToToken.keys());
  if (receiptIds.length) {
    // Expo sugiere esperar unos segundos; aquí lo hacemos inline de forma simple
    await sleep(4000);

    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
    for (const idChunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(idChunk);
        // receipts es un objeto { [receiptId]: { status, message, details } }
        for (const [id, receipt] of Object.entries(receipts)) {
          const r = receipt as ExpoPushReceipt;
          if (r.status === 'error') {
            const err = (r.details as any)?.error || r.message;
            const badToken = receiptIdToToken.get(id);
            if (err === 'DeviceNotRegistered' && badToken) {
              console.warn('[push] DeviceNotRegistered (receipt) -> deactivating', badToken);
              await supabaseAdmin.from('push_token').update({ active: false }).eq('token', badToken);
            } else {
              console.warn('[push] receipt error', err);
            }
          }
        }
      } catch (e) {
        console.error('[push] get receipts error', e);
      }
    }
  }

  console.log('[push] sent', messages.length);
}

/** Broadcast simple (conserva tu API actual) */
export async function sendPushBroadcast(title: string, body: string, data?: any) {
  const tokens = await getAllActivePushTokens();
  if (!tokens.length) return;

  const batch = tokens.map((t) => ({
    to: t,
    title,
    body,
    data,
    sound: 'default' as const,
  }));
  await sendExpoPush(batch);
}

/** Helper: pausa async */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
