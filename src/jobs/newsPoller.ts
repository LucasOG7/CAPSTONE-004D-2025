// src/jobs/newsPoller.ts
import Parser from 'rss-parser';
import { supabaseAdmin } from '../supabase';
import { sendPushBroadcast } from '../utils/push';

const parser = new Parser();

const RATES_INTERVAL_MS = 15 * 60 * 1000;  // 15 min
const NEWS_INTERVAL_MS  = 30 * 60 * 1000;  // 30 min

// misma función de rates que en la ruta
async function fetchRatesCL() {
  const base = 'https://mindicador.cl/api';
  const [dolar, euro, uf] = await Promise.all([
    fetch(`${base}/dolar`).then(r => r.json()).catch(() => null),
    fetch(`${base}/euro`).then(r => r.json()).catch(() => null),
    fetch(`${base}/uf`).then(r => r.json()).catch(() => null),
  ]);
  const usd = Number(dolar?.serie?.[0]?.valor ?? 0);
  const eur = Number(euro?.serie?.[0]?.valor ?? 0);
  const ufv = Number(uf?.serie?.[0]?.valor ?? 0);
  if (!usd || !eur || !ufv) throw new Error('mindicador: datos incompletos');
  return { usd, eur, uf: ufv };
}

async function pollRatesAndNotify() {
  try {
    const now = new Date();
    const cur = await fetchRatesCL();

    // último snapshot (para comparar % cambio)
    const { data: last } = await supabaseAdmin
      .from('fx_snapshot')
      .select('usd, eur, uf, taken_at')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // guarda snapshot actual
    await supabaseAdmin.from('fx_snapshot').insert({
      base: 'CLP', usd: cur.usd, eur: cur.eur, uf: cur.uf
    });

    if (last) {
      const pct = (a: number, b: number) => b ? ((a - b) / b) * 100 : 0;
      const du = pct(cur.usd, Number(last.usd));
      const de = pct(cur.eur, Number(last.eur));
      const df = pct(cur.uf,  Number(last.uf));

      // Regla simple: notifica si variación > |1.0%|
      const threshold = 1.0;
      const hits: string[] = [];
      if (Math.abs(du) >= threshold) hits.push(`USD ${du > 0 ? '↑' : '↓'} ${du.toFixed(2)}%`);
      if (Math.abs(de) >= threshold) hits.push(`EUR ${de > 0 ? '↑' : '↓'} ${de.toFixed(2)}%`);
      if (Math.abs(df) >= threshold) hits.push(`UF ${df > 0 ? '↑' : '↓'} ${df.toFixed(2)}%`);

      if (hits.length) {
        await sendPushBroadcast(
          'Cambios en el mercado',
          hits.join(' · '),
          { type: 'rates', at: now.toISOString(), changes: { du, de, df } }
        );
      }
    }
  } catch (e) {
    console.error('[poller] rates error', e);
  }
}

const GOOGLE_FIN_FEED =
  'https://news.google.com/rss/search?q=finanzas+OR+econom%C3%ADa&hl=es-419&gl=CL&ceid=CL:es-419';

async function pollNewsAndNotify() {
  try {
    const feed = await parser.parseURL(GOOGLE_FIN_FEED);
    const items = (feed.items || []).slice(0, 10);

    for (const it of items) {
      const id = it.guid || it.link || it.id || String(it.isoDate || it.pubDate || it.title);
      if (!it.link) continue;

      // ¿Ya lo vimos?
      const { data: seen } = await supabaseAdmin
        .from('news_seen')
        .select('article_id')
        .eq('article_id', id)
        .maybeSingle();

      if (!seen) {
        // marca como visto
        await supabaseAdmin.from('news_seen').insert({
          article_id: id,
          title: it.title || 'Sin título',
          url: it.link,
          source: it.creator || it.author || 'Google News',
          published_at: it.isoDate || it.pubDate || null,
        });

        // envía push (solo primeras 3 para evitar spam)
        await sendPushBroadcast(
          'Nueva noticia financiera',
          (it.title || 'Titular') + (it.source ? ` · ${it.source}` : ''),
          { type: 'news', url: it.link }
        );
      }
    }
  } catch (e) {
    console.error('[poller] news error', e);
  }
}

export function startNewsAndRatesPolling() {
  // primera ejecución inmediata
  pollRatesAndNotify();
  pollNewsAndNotify();

  // intervalos
  setInterval(pollRatesAndNotify, RATES_INTERVAL_MS);
  setInterval(pollNewsAndNotify,  NEWS_INTERVAL_MS);
}
