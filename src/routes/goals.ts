// src/routes/goals.ts
/* eslint-disable no-console */
import { Router } from 'express';
import { z } from 'zod';
// 👇 Usa el cliente admin (service role). Alias a "supabase" para no tocar el resto.
import { supabaseAdmin as supabase, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

/** Validación de fecha 'YYYY-MM-DD' */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)');

/** Schemas */
const createSchema = z.object({
  title: z.string().min(2, 'Título demasiado corto'),
  description: z.string().optional(),
  target_amount: z.coerce.number().positive('Debe ser > 0'),
  // Acepta '', null, undefined -> undefined para no enviar columna
  deadline: z.preprocess((v) => (v === '' || v == null ? undefined : v), dateStr).optional(),
});

const updateSchema = createSchema.partial().extend({
  current_amount: z.coerce.number().min(0).optional(),
});

const contribSchema = z.object({
  amount: z.coerce.number().positive('Debe ser > 0'),
  note: z.string().max(280).optional(),
});

// ─────────────────────────────────────────────
// Listar metas del usuario
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: any, res) => {
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { data, error } = await supabase
    .from('financial_goal')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[goals] list error', error);
    return res.status(400).json({ detail: error.message });
  }
  res.json(data);
});

// Obtener una meta por id (del usuario)
router.get('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { data, error } = await supabase
    .from('financial_goal')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('[goals] get error', { id, error });
    return res.status(404).json({ detail: error.message });
  }
  res.json(data);
});

// ─────────────────────────────────────────────
// Crear meta
// ─────────────────────────────────────────────
router.post('/', requireAuth, async (req: any, res) => {
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) {
    console.error('[goals] perfil no encontrado para uid', req.user.id);
    return res.status(404).json({ detail: 'Perfil no encontrado' });
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[goals] zod error (create)', parsed.error.flatten());
    return res.status(400).json(parsed.error.flatten());
  }

  const payload = { user_id: userId, current_amount: 0, ...parsed.data };

  const { data, error } = await supabase
    .from('financial_goal')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('[goals] insert error', { payload, error });
    return res.status(400).json({ detail: error.message });
  }
  res.status(201).json(data);
});

// ─────────────────────────────────────────────
// Actualizar meta (solo del usuario)
// ─────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[goals] zod error (update)', parsed.error.flatten());
    return res.status(400).json(parsed.error.flatten());
  }

  const { data, error } = await supabase
    .from('financial_goal')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[goals] update error', { id, body: parsed.data, error });
    return res.status(400).json({ detail: error.message });
  }
  res.json(data);
});

// ─────────────────────────────────────────────
// Aportar a una meta (intenta RPC, sino fallback)
// ─────────────────────────────────────────────
router.post('/:id/contribute', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parsed = contribSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[goals] zod error (contribute)', parsed.error.flatten());
    return res.status(400).json(parsed.error.flatten());
  }
  const { amount } = parsed.data;

  const { data: goal, error: eGoal } = await supabase
    .from('financial_goal')
    .select('id,user_id,current_amount')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (eGoal || !goal) {
    console.error('[goals] contribute goal not found', { id, userId, eGoal });
    return res.status(404).json({ detail: 'Meta no encontrada' });
  }

  try {
    const { data, error } = await supabase.rpc('goal_contribute', {
      p_goal_id: id,
      p_amount: amount,
    });
    if (!error && data) return res.json(data);
    if (error) console.warn('[goals] RPC goal_contribute error (continuo con fallback)', error);
  } catch (e) {
    console.warn('[goals] RPC goal_contribute threw', e);
  }

  const next = Number(goal.current_amount || 0) + amount;
  const { data, error } = await supabase
    .from('financial_goal')
    .update({ current_amount: next })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[goals] contribute update error', { id, amount, error });
    return res.status(400).json({ detail: error.message });
  }
  res.json(data);
});

// ─────────────────────────────────────────────
// Eliminar meta (solo del usuario)
// ─────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { error } = await supabase
    .from('financial_goal')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[goals] delete error', { id, userId, error });
    return res.status(400).json({ detail: error.message });
  }
  res.json({ ok: true });
});

export default router;
