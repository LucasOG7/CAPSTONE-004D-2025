// src/routes/push.ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getProfileIdByAuthId, supabaseAdmin } from '../supabase';

const router = Router();

// Valida formato Expo: ExponentPushToken[xxxxxxxx]
const isExpoToken = (t: string) => /^ExponentPushToken\[\S+\]$/.test(t);

const registerSchema = z.object({
  token: z.string().min(10).refine(isExpoToken, { message: 'Token de Expo inválido' }),
  platform: z.enum(['ios', 'android', 'web']),
});

// REGISTRAR / ACTUALIZAR TOKEN
router.post('/register', requireAuth, async (req: any, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { token, platform } = parsed.data;

  // upsert por token: si reinstala, se reasigna y se marca activo
  const { error } = await supabaseAdmin
    .from('push_token')
    .upsert(
      { user_id: userId, token, platform, active: true },
      { onConflict: 'token' }
    );

  if (error) return res.status(400).json({ detail: error.message });
  res.json({ ok: true });
});

// DESACTIVAR TOKEN (logout / eliminar dispositivo)
router.post('/unregister', requireAuth, async (req: any, res) => {
  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { token } = parsed.data;

  const { error } = await supabaseAdmin
    .from('push_token')
    .update({ active: false })
    .match({ token, user_id: userId }); // sólo si pertenece al usuario

  if (error) return res.status(400).json({ detail: error.message });
  res.json({ ok: true });
});

// LISTAR DISPOSITIVOS DEL USUARIO (debug / UI)
router.get('/devices', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { data, error } = await supabaseAdmin
    .from('push_token')
    .select('token, platform, active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ detail: error.message });
  res.json({ devices: data ?? [] });
});

export default router;
