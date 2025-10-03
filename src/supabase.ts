import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY en .env');
}

export const supabase = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Cliente "como usuario" (inyecta el JWT del usuario para RLS en lecturas)
export function supabaseAsUser(accessToken: string) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getUserFromToken(accessToken: string) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

export async function getProfileIdByAuthId(authUserId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profile')
    .select('id')
    .eq('id_supabase', authUserId)
    .single();
  if (error || !data) return null;
  return data.id as number;
}
