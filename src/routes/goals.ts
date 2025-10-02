import { Router } from 'express';
import { z } from 'zod';
import { supabase, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: any, res) => {
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { data, error } = await supabase
    .from('financial_goal')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ detail: error.message });
  res.json(data);
});

const createSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  target_amount: z.number().positive(),
  deadline: z.string().optional(), // 'YYYY-MM-DD'
});

router.post('/', requireAuth, async (req: any, res) => {
  const userId = await getProfileIdByAuthId(req.user.id);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json(parse.error.flatten());

  const payload = { user_id: userId, current_amount: 0, ...parse.data };
  const { data, error } = await supabase.from('financial_goal').insert(payload).select().single();
  if (error) return res.status(400).json({ detail: error.message });
  res.status(201).json(data);
});

const updateSchema = createSchema.partial().extend({
  current_amount: z.number().min(0).optional(),
});

router.patch('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json(parse.error.flatten());

  const { data, error } = await supabase.from('financial_goal').update(parse.data).eq('id', id).select().single();
  if (error) return res.status(400).json({ detail: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const { error } = await supabase.from('financial_goal').delete().eq('id', id);
  if (error) return res.status(400).json({ detail: error.message });
  res.json({ ok: true });
});

export default router;
