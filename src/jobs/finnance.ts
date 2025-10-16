// src/jobs/finance.ts
import cron from 'node-cron';
import { DateTime } from 'luxon';
import { supabaseAdmin } from '../supabase';
import { getRatesFromMindicador, Rates } from '../utils/finance';
import { isExpoToken, sendExpoPush } from '../utils/push';

const DEFAULT_PCT_THRESHOLD = 0.01; // 1%
const COOL_DOWN_MINUTES = 30;

type AlertPrefs = {
  user_id: number;
  usd_threshold: number | null;
  eur_threshold: number | null;
  uf_threshold: number | null;
  pct_threshold: number | null;
  quiet_start: string | null;
  quiet_end: string | null;
  tz: string | null;
};

function inQuietHours(now: DateTime, quiet_start?: string | null, quiet_end?: string | null) {
  if (!quiet_start || !quiet_end) return false;
  const [qsH, qsM] = quiet_start.split(':').map(Number);
  const [qeH, qeM] = quiet_end.split(':').map(Number);
  const start = now.set({ hour: qsH, minute: qsM ?? 0, second: 0 });
  const end   = now.set({ hour: qeH, minute: qeM ?? 0, second: 0 });
  return end <= start ? (now >= start || now <= end) : (now >= start && now <= end);
}

function crossedThreshold(oldV: number, newV: number, abs?: number | null, pct?: number | null) {
  const deltaAbs = Math.abs(newV - oldV);
  const deltaPct = oldV === 0 ? Infinity : Math.abs(deltaAbs / oldV);
  if (abs && deltaAbs >= abs) return true;
  const p = pct ?? DEFAULT_PCT_THRESHOLD;
  return deltaPct >= p;
}

async function storeFxSnapshot(r: Rates) {
  await supabaseAdmin.from('fx_snapshot').insert({
    base: 'CLP', usd: r.usd, eur: r.eur, uf: r.uf, taken_at: new Date().toISOString(),
  });
}

async function getState() {
  const { data, error } = await supabaseAdmin.from('news_state').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) {
    await supabaseAdmin.from('news_state').insert({ id: 1 });
    return { id: 1 } as any;
  }
  return data as any;
}

async function setFxState(r: Rates) {
  await supabaseAdmin.from('news_state').upsert({
    id: 1,
    last_usd: r.usd,
    last_eur: r.eur,
    last_uf: r.uf,
    last_fx_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

let _fxRunning = false;

export async function runFxOnce() {
  if (_fxRunning) { console.log('[cron fx] already running, skip'); return; }
  _fxRunning = true;
  try {
    const state = await getState();

    if (state?.last_fx_at) {
      const last = DateTime.fromISO(state.last_fx_at);
      if (DateTime.now().diff(last, 'minutes').minutes < COOL_DOWN_MINUTES) {
        console.log('[fx] cooldown, skipping');
        return;
      }
    }

    const r = await getRatesFromMindicador();

    // Primera vez: solo persistimos baseline y salimos
    if (state?.last_usd == null || state?.last_eur == null || state?.last_uf == null) {
      await storeFxSnapshot(r);
      await setFxState(r);
      return;
    }

    // Prefs + tokens
    const { data: prefs } = await supabaseAdmin.from('alert_prefs').select('*');
    const { data: tokens } = await supabaseAdmin
      .from('push_token').select('user_id, token').eq('active', true);

    const tokensByUser = new Map<number, string[]>();
    (tokens || []).forEach(t => {
      if (!tokensByUser.has(t.user_id)) tokensByUser.set(t.user_id, []);
      tokensByUser.get(t.user_id)!.push(t.token as string);
    });

    const messages: { to: string; title?: string; body: string; data?: any }[] = [];

    for (const p of (prefs || []) as AlertPrefs[]) {
      const tz = p.tz || 'America/Santiago';
      const now = DateTime.now().setZone(tz);
      if (inQuietHours(now, p.quiet_start, p.quiet_end)) continue;

      let should = false;
      const parts: string[] = [];

      if (crossedThreshold(state.last_usd, r.usd, p.usd_threshold, p.pct_threshold)) {
        parts.push(`USD: ${state.last_usd.toFixed(2)} → ${r.usd.toFixed(2)}`);
        should = true;
      }
      if (crossedThreshold(state.last_eur, r.eur, p.eur_threshold, p.pct_threshold)) {
        parts.push(`EUR: ${state.last_eur.toFixed(2)} → ${r.eur.toFixed(2)}`);
        should = true;
      }
      if (crossedThreshold(state.last_uf, r.uf, p.uf_threshold, p.pct_threshold)) {
        parts.push(`UF: ${state.last_uf.toFixed(2)} → ${r.uf.toFixed(2)}`);
        should = true;
      }

      if (!should) continue;

      const toks = tokensByUser.get(p.user_id) || [];
      for (const t of toks) {
        if (!isExpoToken(t)) continue;
        messages.push({
          to: t,
          title: '📈 Cambio en el mercado',
          body: parts.join(' | '),
          data: { kind: 'fx', usd: r.usd, eur: r.eur, uf: r.uf, at: r.updatedAt },
        });
      }
    }

    if (messages.length > 0) await sendExpoPush(messages);

    await storeFxSnapshot(r);
    await setFxState(r);
  } catch (e) {
    console.error('[cron fx] error', e);
  } finally {
    _fxRunning = false;
  }
}

export function startFxCron() {
  cron.schedule('*/15 * * * *', runFxOnce, { timezone: 'America/Santiago' });
  console.log('⏱️ FX cron started (every 15m)');
}
