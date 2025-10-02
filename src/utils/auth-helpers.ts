// src/utils/auth-helpers.ts
import type { Request } from 'express';
import { supabase } from '../supabase';

export async function getAuthUserFromRequest(req: Request) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return { token: null, user: null };

  const token = auth.slice(7);
  // Supabase v2 permite getUser(jwt)
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { token: null, user: null };

  return { token, user: data.user };
}
