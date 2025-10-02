import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

const createSchema = z.object({
  amount: z.number().positive(),
  note: z.string().optional(),
});

router.get('/:goalId', requireAuth, async (req: any, res) => {
  const goalId = Number(req.params.goalId);
  if (Number.isNaN(goalId)) return res.status(400).json({ detail: 'goalId inválido' });

  const { data, error } = await supabase
    .from('goal_contribution')
    .select('*')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ detail: error.message });
  res.json(data);
});

router.post('/:goalId', requireAuth, async (req: any, res) => {
  const goalId = Number(req.params.goalId);
  if (Number.isNaN(goalId)) return res.status(400).json({ detail: 'goalId inválido' });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { data, error } = await supabase
    .from('goal_contribution')
    .insert({ goal_id: goalId, ...parsed.data })
    .select()
    .single();

  if (error) return res.status(400).json({ detail: error.message });
  res.status(201).json(data);
});

export default router;

