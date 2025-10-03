import { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase';

export async function requireAuth(
  req: Request & { user?: any; token?: string },
  res: Response,
  next: NextFunction
) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ detail: 'Falta token' });

  const token = m[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ detail: 'Token inválido' });

  req.user = data.user;    // { id, email, ... }
  req.token = token;       // ← lo usaremos para supabaseAsUser
  next();
}
