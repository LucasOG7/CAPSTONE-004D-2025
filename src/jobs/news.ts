import cron from 'node-cron';
import Parser from 'rss-parser';
import { supabaseAdmin } from '../supabase';
import { Expo } from 'expo-server-sdk';

const expo = new Expo();
const parser = new Parser();

// RSS de finanzas (puedes sumar más)
const FEEDS = [
  'https://news.google.com/rss/search?q=finanzas+OR+econom%C3%ADa&hl=es-419&gl=CL&ceid=CL:es-419',
  'https://www.df.cl/rss' // Diario Financiero
];

// Envía push a todos los tokens registrados
async function pushAll(title: string, body: string, data?: any) {
  const { data: tokens } = await supabaseAdmin.from('push_token').select('token');
  if (!tokens?.length) return;
  const messages = tokens
    .map(t => t.token)
    .filter(Expo.isExpoPushToken)
    .map(token => ({ to: token, sound: 'default', title, body, data }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try { await expo.sendPushNotificationsAsync(chunk); }
    catch (e) { console.error('push error', e); }
  }
}

// 1) Poll indicadores (cada 15 min)
cron.schedule('*/15 * * * *', async () => {
  try {
    const r = await fetch('https://mindicador.cl/api'); // gratis
    const j = await r.json();
    const usd = Number(j?.dolar?.valor ?? 0);
    const eur = Number(j?.euro?.valor ?? 0);
    const uf  = Number(j?.uf?.valor ?? 0);
    if (!usd || !eur || !uf) return;

    // último snapshot
    const { data: last } = await supabaseAdmin
      .from('market_snapshot')
      .select('usd,eur,uf,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // guarda siempre
    await supabaseAdmin.from('market_snapshot').insert({ usd, eur, uf });

    // notifica si hubo cambio relevante (ej: variación >= 0.5%)
    const changed = last ? (
      Math.abs((usd - Number(last.usd)) / last.usd) >= 0.005 ||
      Math.abs((eur - Number(last.eur)) / last.eur) >= 0.005 ||
      Math.abs((uf  - Number(last.uf )) / last.uf ) >= 0.005
    ) : true;

    if (changed) {
      await pushAll('Mercado actualizado',
        `USD $${usd.toFixed(0)} • EUR $${eur.toFixed(0)} • UF $${uf.toFixed(0)}`,
        { type: 'market' }
      );
    }
  } catch (e) {
    console.error('[cron] market error', e);
  }
});

// 2) Poll noticias (cada 10 min)
cron.schedule('*/10 * * * *', async () => {
  try {
    for (const url of FEEDS) {
      const feed = await parser.parseURL(url);
      for (const item of feed.items ?? []) {
        if (!item.link || !item.title) continue;

        // inserta si es nueva
        const { data, error } = await supabaseAdmin
          .from('finance_news')
          .insert({
            title: item.title,
            url: item.link,
            source: feed.title ?? 'RSS',
            published_at: item.isoDate ? new Date(item.isoDate) : new Date()
          })
          .select()
          .maybeSingle();

        // si no es nueva => unique constraint; ignora
        if (error?.code === '23505') continue;
        if (error) { console.error('news insert error', error.message); continue; }

        // notifica cada noticia nueva
        await pushAll('Nueva noticia financiera', item.title, { type: 'news', url: item.link });
      }
    }
  } catch (e) {
    console.error('[cron] news error', e);
  }
});
