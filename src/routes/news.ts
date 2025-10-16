// src/routes/news.ts
import { Router } from 'express';
import Parser from 'rss-parser';
import { supabaseAdmin } from '../supabase';

const router = Router();
const parser = new Parser();

// Cache simple en memoria para reducir llamadas
let lastRates: any = null;
let lastRatesAt = 0;
let lastFeed: any[] = [];
let lastFeedAt = 0;

const RATES_TTL_MS = 5 * 60 * 1000; // 5 min
const FEED_TTL_MS  = 10 * 60 * 1000; // 10 min

// Fuente de tipos de cambio (CLP): https://mindicador.cl
async function fetchRatesCL() {
  // Devuelve { usd, eur, uf } en CLP
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

  return {
    base: 'CLP',
    usd,
    eur,
    uf: ufv,
    updatedAt: new Date().toISOString(),
  };
}

// Fuente de noticias: Google News RSS en español Chile (finanzas/economía)
const GOOGLE_FIN_FEED =
  'https://news.google.com/rss/search?q=finanzas+OR+econom%C3%ADa&hl=es-419&gl=CL&ceid=CL:es-419';

async function fetchFinanceNews() {
  const feed = await parser.parseURL(GOOGLE_FIN_FEED);
  // Normaliza algunos campos
  return (feed.items || []).slice(0, 20).map((it) => ({
    id: it.guid || it.link || it.id || String(it.isoDate || it.pubDate || it.title),
    title: it.title || 'Sin título',
    url: it.link,
    source: (it.creator || it.author || it.source || 'Google News') as string,
    published_at: it.isoDate || it.pubDate || null,
  })).filter(a => !!a.url);
}

// GET /api/news/rates
router.get('/rates', async (_req, res) => {
  try {
    const now = Date.now();
    if (!lastRates || now - lastRatesAt > RATES_TTL_MS) {
      lastRates = await fetchRatesCL();
      lastRatesAt = now;

      // Guarda snapshot para auditoría/alertas
      await supabaseAdmin.from('fx_snapshot').insert({
        base: 'CLP',
        usd: lastRates.usd,
        eur: lastRates.eur,
        uf: lastRates.uf,
      });
    }
    res.json(lastRates);
  } catch (e: any) {
    res.status(400).json({ detail: e?.message || 'No se pudieron cargar los tipos de cambio' });
  }
});

// GET /api/news/feed
router.get('/feed', async (_req, res) => {
  try {
    const now = Date.now();
    if (!lastFeed || now - lastFeedAt > FEED_TTL_MS) {
      lastFeed = await fetchFinanceNews();
      lastFeedAt = now;
    }
    res.json(lastFeed);
  } catch (e: any) {
    res.status(400).json({ detail: e?.message || 'No se pudo cargar el feed' });
  }
});

export default router;
