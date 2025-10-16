// src/utils/finance.ts
import fetch from 'cross-fetch';

export type Rates = { base: 'CLP'; usd: number; eur: number; uf: number; updatedAt: string };

/**
 * Regla 50/30/20
 */
export function calcBudget_50_30_20(monthlyIncome?: number) {
  if (!monthlyIncome || monthlyIncome <= 0) return null;
  const needs = monthlyIncome * 0.50;
  const wants = monthlyIncome * 0.30;
  const savings = monthlyIncome * 0.20;
  return {
    needs: Math.round(needs),
    wants: Math.round(wants),
    savings: Math.round(savings),
  };
}

/**
 * Backoff simple para 429/5xx en fetch
 */
export async function fetchWithRetry(
  input: any,
  init?: any,
  tries = 3,
  baseDelayMs = 500
): Promise<Response> {
  let attempt = 0;
  let lastErr: any;
  while (attempt < tries) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
      } else {
        return res; // errores 4xx no transitorios
      }
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
    attempt++;
  }
  if (lastErr) throw lastErr;
  throw new Error('fetchWithRetry: exceeded retries');
}

/**
 * Tasas desde mindicador.cl (CLP por unidad)
 */
export async function getRatesFromMindicador(): Promise<Rates> {
  const urls = {
    usd: 'https://mindicador.cl/api/dolar',
    eur: 'https://mindicador.cl/api/euro',
    uf:  'https://mindicador.cl/api/uf',
  };

  const [usd, eur, uf] = await Promise.all(
    Object.values(urls).map(async (u) => {
      const r = await fetchWithRetry(u, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      const value = j?.serie?.[0]?.valor ?? j?.serie?.[0]?.value;
      const date  = j?.serie?.[0]?.fecha || j?.serie?.[0]?.date;
      return { value: Number(value), date: String(date) };
    })
  );

  return {
    base: 'CLP',
    usd: Number(usd.value),
    eur: Number(eur.value),
    uf:  Number(uf.value),
    updatedAt: new Date().toISOString(),
  };
}
