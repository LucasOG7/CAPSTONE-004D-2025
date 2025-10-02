// src/routes/recommendations.ts
import { Router } from 'express';
import { supabaseAdmin } from '../supabase';
import { getAuthUserFromRequest } from '../utils/auth-helpers';

const router = Router();

type ProfileRow = {
  age_range: string | null;
  experience: 'beginner' | 'intermediate' | 'advanced' | null;
  monthly_income: number | string | null; // Supabase numeric puede venir string
  finance_goal: string | null;
};

type Rec = { id: string; title: string; description: string };

router.get('/', async (req, res) => {
  const { user } = await getAuthUserFromRequest(req);
  if (!user) return res.status(401).json({ detail: 'No autenticado' });

  const { data: profile, error } = await supabaseAdmin
    .from('user_profile')
    .select('age_range, experience, monthly_income, finance_goal')
    .eq('id_supabase', user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ detail: error.message });

  // Si no hay perfil aún, devolvemos una sugerencia genérica
  if (!profile) {
    const fallback: Rec[] = [{
      id: 'profile-more',
      title: 'Completa tu perfil',
      description: 'Actualiza edad, nivel, ingresos y meta para recomendaciones precisas.',
    }];
    return res.json(fallback);
  }

  const p = profile as ProfileRow;

  const exp = String(p.experience || '').toLowerCase();
  const goal = String(p.finance_goal || '').toLowerCase();
  const income =
    p.monthly_income == null
      ? null
      : typeof p.monthly_income === 'number'
        ? p.monthly_income
        : Number(p.monthly_income);

  const recs: Rec[] = [];

  // Reglas simples
  if (income && income > 0) {
    recs.push({
      id: 'emergency',
      title: 'Crea un fondo de emergencia',
      description: 'Ahorra 3–6 meses de gastos en una cuenta líquida.',
    });
  }

  if (income && income >= 100000) {
    recs.push({
      id: 'autosave',
      title: 'Activa ahorro automático',
      description: 'Transfiere 10–20% de tu ingreso cada mes.',
    });
  }

  if (exp === 'beginner') {
    recs.push({
      id: 'simple-invest',
      title: 'Invierte de forma simple',
      description: 'Prefiere instrumentos diversificados y de bajo costo (ETF).',
    });
  } else if (exp === 'intermediate' || exp === 'advanced') {
    recs.push({
      id: 'optimize',
      title: 'Optimiza tu cartera',
      description: 'Rebalancea periódicamente y revisa costos.',
    });
  }

  if (goal.includes('deuda')) {
    recs.push({
      id: 'debts',
      title: 'Plan de pago de deudas',
      description: 'Usa bola de nieve o avalancha y evita nuevas deudas.',
    });
  }

  if (goal.includes('ahorr')) {
    recs.push({
      id: 'save-plan',
      title: 'Plan de ahorro',
      description: 'Define una meta SMART y usa cuentas con mejor rendimiento.',
    });
  }

  // Default si no hubo matches
  if (recs.length === 0) {
    recs.push({
      id: 'profile-more',
      title: 'Completa tu perfil',
      description: 'Ajusta edad, nivel, ingresos y meta para mejorar recomendaciones.',
    });
  }

  return res.json(recs);
});

export default router;
