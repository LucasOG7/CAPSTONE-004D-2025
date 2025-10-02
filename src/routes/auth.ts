// src/routes/auth.ts
import { Router } from 'express';
import { supabase, supabaseAdmin } from '../supabase';
import { registerSchema, loginSchema } from '../utils/validators';
import { getAuthUserFromRequest } from '../utils/auth-helpers';

const router = Router();

/**
 * POST /auth/register
 * Crea el usuario en Supabase Auth y registra/actualiza su perfil en user_profile
 * (NO guarda password en la tabla de perfil).
 */
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }
  const { name, email, password, fecnac } = parsed.data;

  // 1) Crear usuario en Supabase Auth (metadata opcional)
  const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, fecnac: fecnac ?? null } },
  });
  if (signUpErr || !signUp?.user) {
    return res.status(400).json({ detail: signUpErr?.message ?? 'No se pudo crear el usuario' });
  }

  const authUser = signUp.user;

  // 2) Crear/actualizar perfil (usar service role para bypass RLS)
  const profilePayload = {
    id_supabase: authUser.id,
    email,
    name,
  
    created_at: new Date().toISOString(),
  };

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('user_profile')
    .upsert(profilePayload, { onConflict: 'id_supabase' })
    .select()
    .single();

  if (profErr) {
    // rollback best-effort (requiere service role)
    try { await supabaseAdmin.auth.admin.deleteUser(authUser.id); } catch {}
    return res.status(400).json({ detail: profErr.message });
  }

  return res.status(201).json({
    id: authUser.id,
    email: authUser.email,
    profile,
    requires_confirmation: !signUp.session,
    message: signUp.session
      ? 'Usuario registrado y autenticado.'
      : 'Usuario registrado. Revisa tu correo si requiere verificación.',
  });
});

/**
 * POST /auth/login
 * Devuelve { access_token, user } para que el front lo guarde.
 */
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }
  const { email, password } = parsed.data;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session || !data.user) {
    return res.status(401).json({ detail: error?.message ?? 'Credenciales inválidas' });
  }

  const access_token = data.session.access_token;

  // Enriquecer con nombre de perfil (service role para evitar RLS)
  let profileName: string | null = null;
  const { data: p, error: pErr } = await supabaseAdmin
    .from('user_profile')
    .select('name')
    .eq('id_supabase', data.user.id)
    .single();

  if (!pErr) {
    profileName = (p?.name as string | null) ?? (data.user.user_metadata?.name ?? null);
  } else {
    profileName = data.user.user_metadata?.name ?? null;
  }

  const user = {
    id: data.user.id,
    email: data.user.email!,
    name: profileName,
  };

  return res.json({ access_token, user });
});

/**
 * GET /auth/me
 * Requiere Authorization: Bearer <token>
 * Devuelve { id, email, name } (compat con store.refreshMe()).
 */
router.get('/me', async (req, res) => {
  const { user } = await getAuthUserFromRequest(req);
  if (!user) return res.status(401).json({ detail: 'No autenticado' });

  const { data: profile, error } = await supabaseAdmin
    .from('user_profile')
    .select('name')
    .eq('id_supabase', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = not found (sin fila de perfil). Lo toleramos.
    return res.status(400).json({ detail: error.message });
  }

  return res.json({
    id: user.id,
    email: user.email,
    name: profile?.name ?? user.user_metadata?.name ?? null,
  });
});

/**
 * POST /auth/logout
 * (Opcional) El cierre real es borrar el token en el cliente.
 */
router.post('/logout', async (_req, res) => {
  return res.json({ ok: true });
});

/**
 * POST /auth/forgot
 * Envía email de recuperación con deep link (ajústalo si usas otro).
 */
router.post('/forgot', async (req, res) => {
  const email = (req.body?.email as string) ?? '';
  if (!email) return res.status(400).json({ detail: 'Email requerido' });

  const redirectTo = process.env.RESET_REDIRECT_URL ?? 'mygoalfinance://reset';
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return res.status(400).json({ detail: error.message });

  return res.json({ ok: true, message: 'Email de recuperación enviado (si existe una cuenta con ese correo).' });
});

export default router;
