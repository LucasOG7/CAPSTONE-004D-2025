// src/routes/transactions.ts
import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

/* ───────── Schemas ───────── */
const createSchema = z.object({
  amount: z.number(),
  type: z.enum(['income', 'expense']),
  category_id: z.number().optional(),
  description: z.string().optional(),
  occurred_at: z.string().optional(), // YYYY-MM-DD
});
const updateSchema = createSchema.partial();

/* ───────── Helpers ───────── */
function firstLastDayOfMonth(ym: string) {
  const [yy, mm] = ym.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1);
  const last  = new Date(yy, mm, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
}

/* ───────── Listar ───────── */
/** GET /api/transactions?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD[&type=...] */
router.get('/', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { month, from: qFrom, to: qTo, type } = req.query as {
    month?: string; from?: string; to?: string; type?: 'income'|'expense';
  };

  let from = qFrom ?? '';
  let to   = qTo ?? '';
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const r = firstLastDayOfMonth(month);
    from = r.from; to = r.to;
  }

  let q = supabaseAdmin
    .from('transaction')
    .select('id, amount, type, category_id, description, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });

  if (from) q = q.gte('occurred_at', from);
  if (to)   q = q.lte('occurred_at', to);
  if (type) q = q.eq('type', type);

  const { data, error } = await q;
  if (error) return res.status(400).json({ detail: error.message });
  return res.json(data ?? []);
});

/* ───────── Crear ───────── */
router.post('/', requireAuth, async (req: any, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    user_id: userId,
    amount: parsed.data.amount,
    type: parsed.data.type,
    category_id: parsed.data.category_id ?? null,
    description: parsed.data.description ?? null,
    occurred_at: parsed.data.occurred_at || today,
  };

  const { data, error } = await supabaseAdmin
    .from('transaction')
    .insert(payload)
    .select('id, amount, type, category_id, description, occurred_at')
    .single();

  if (error) return res.status(400).json({ detail: error.message });
  return res.status(201).json(data);
});

/* ───────── Actualizar ───────── */
router.patch('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ detail: 'id inválido' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const patch = { ...parsed.data } as any;
  delete patch.user_id;

  const { data, error } = await supabaseAdmin
    .from('transaction')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, amount, type, category_id, description, occurred_at')
    .single();

  if (error) return res.status(400).json({ detail: error.message });
  return res.json(data);
});

/* ───────── Eliminar ───────── */
router.delete('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ detail: 'id inválido' });

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { error } = await supabaseAdmin
    .from('transaction')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return res.status(400).json({ detail: error.message });
  return res.json({ ok: true });
});

/* ───────── Resumen mensual ───────── */
/** GET /api/transactions/summary/month?month=YYYY-MM */
router.get('/summary/month', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { month } = req.query as { month?: string };
  const ym = month && /^\d{4}-\d{2}$/.test(month)
    ? month
    : (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();

  const { from, to } = firstLastDayOfMonth(ym);

  const { data: rows, error } = await supabaseAdmin
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
    if (r.category_id) byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + amt);
  }

  const net = inc - exp;
  const byCategory = Array.from(byCat, ([category_id, total]) => ({ category_id, total }))
    .sort((a, b) => b.total - a.total);

  return res.json({ month: ym, from, to, inc, exp, net, byCategory });
});

export default router;
