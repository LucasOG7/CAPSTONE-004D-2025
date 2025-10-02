import { Request, Response, NextFunction } from 'express';
import { getUserFromToken } from '../supabase';

export async function requireAuth(
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ detail: 'Falta token' });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ detail: 'Token inválido' });

  req.user = user; // { id, email, ... }
  next();
}
