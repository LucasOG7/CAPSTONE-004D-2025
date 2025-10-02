// src/routes/transactions.ts
import { Router } from 'express';
import { z } from 'zod';
import { supabase, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

/* ─────────────── Schemas ─────────────── */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

const createSchema = z.object({
  amount: z.coerce.number().finite('Monto inválido'),
  type: z.enum(['income', 'expense']),
  category_id: z.coerce.number().int().positive().optional(),
  description: z.string().trim().max(200).optional(),
  occurred_at: z.string().regex(YMD, 'Fecha inválida (YYYY-MM-DD)').optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  month: z.string().regex(YM).optional(),
  from: z.string().regex(YMD).optional(),
  to: z.string().regex(YMD).optional(),
  type: z.enum(['income', 'expense']).optional(),
});

/* ─────────────── Helpers ─────────────── */

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function firstLastDayOfMonth(ym: string) {
  // ym = 'YYYY-MM'
  const [yy, mm] = ym.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1);
  const last = new Date(yy, mm, 0); // día 0 del mes siguiente = último día del mes
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
}

/* ─────────────── Listar ─────────────── */
/**
 * GET /api/transactions?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD&[type=income|expense]
 */
router.get('/', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  let { month, from, to, type } = parsed.data;

  // Si viene month, lo convertimos a rango
  if (month) {
    const r = firstLastDayOfMonth(month);
    from = r.from;
    to = r.to;
  }

  let q = supabase
    .from('transaction')
    .select('id, amount, type, category_id, description, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });

  if (from) q = q.gte('occurred_at', from);
  if (to) q = q.lte('occurred_at', to);
  if (type) q = q.eq('type', type);

  const { data, error } = await q;
  if (error) return res.status(400).json({ detail: error.message });
  res.json(data ?? []);
});

/* ─────────────── Crear ─────────────── */

router.post('/', requireAuth, async (req: any, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const occurred_at = parsed.data.occurred_at && YMD.test(parsed.data.occurred_at)
    ? parsed.data.occurred_at
    : todayYmd();

  const payload = {
    user_id: userId,
    amount: parsed.data.amount,
    type: parsed.data.type,
    category_id: parsed.data.category_id ?? null,
    description: parsed.data.description ?? null,
    occurred_at,
  };

  const { data, error } = await supabase
    .from('transaction')
    .insert(payload)
    .select('id, amount, type, category_id, description, occurred_at')
    .single();

  if (error) return res.status(400).json({ detail: error.message });
  res.status(201).json(data);
});

/* ─────────────── Actualizar ─────────────── */

router.patch('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ detail: 'id inválido' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const patch: any = { ...parsed.data };
  delete patch.user_id; // nunca permitir cambiar el owner

  // Si mandan occurred_at, validar formato
  if (patch.occurred_at && !YMD.test(patch.occurred_at)) {
    return res.status(400).json({ detail: 'Fecha inválida (YYYY-MM-DD)' });
  }

  const { data, error } = await supabase
    .from('transaction')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId) // seguridad extra además de RLS
    .select('id, amount, type, category_id, description, occurred_at')
    .single();

  if (error) return res.status(400).json({ detail: error.message });
  res.json(data);
});

/* ─────────────── Eliminar ─────────────── */

router.delete('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ detail: 'id inválido' });

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { error } = await supabase
    .from('transaction')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return res.status(400).json({ detail: error.message });
  res.json({ ok: true });
});

/* ─────────────── Resumen mensual ─────────────── */
/**
 * GET /api/transactions/summary/month?month=YYYY-MM
 * Devuelve: { month, from, to, inc, exp, net, byCategory: [{category_id, total}] }
 */
router.get('/summary/month', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const month = typeof req.query.month === 'string' && YM.test(req.query.month)
    ? req.query.month
    : (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();

  const { from, to } = firstLastDayOfMonth(month);

  const { data: rows, error } = await supabase
    .from('transaction')
    .select('type, amount, category_id')
    .eq('user_id', userId)
    .gte('occurred_at', from)
    .lte('occurred_at', to);

  if (error) return res.status(400).json({ detail: error.message });

  let inc = 0, exp = 0;
  const byCat = new Map<number, number>();

  for (const r of rows ?? []) {
    const amt = Number(r.amount);
    if (r.type === 'income') inc += amt;
    else exp += amt;
    if (r.category_id != null) {
      byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + amt);
    }
  }

  const net = inc - exp;
  const byCategory = Array.from(byCat.entries())
    .map(([category_id, total]) => ({ category_id, total }))
    .sort((a, b) => b.total - a.total);

  return res.json({ month, from, to, inc, exp, net, byCategory });
});

export default router;
