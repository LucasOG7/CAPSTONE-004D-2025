// src/routes/chat.ts
import { Router } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { supabase, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';
import { calcBudget_50_30_20 } from '../utils/finance';

const router = Router();

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ Falta OPENAI_API_KEY en .env (el chatbot no podrá responder).');
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------
// GET: historial del usuario
// ---------------------------
router.get('/', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const { data, error } = await supabase
    .from('chat_message')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: true });

  if (error) return res.status(400).json({ detail: error.message });
  res.json(data);
});

const sendSchema = z.object({ message: z.string().min(1) });

// ---------------------------------------------
// POST: usuario envía mensaje -> IA responde
// ---------------------------------------------
router.post('/', requireAuth, async (req: any, res) => {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const userText = parsed.data.message.trim();

  // 1) Guardar mensaje del usuario
  const { data: userMsg, error: insErr } = await supabase
    .from('chat_message')
    .insert({ user_id: userId, sender: 'user', message: userText })
    .select()
    .single();
  if (insErr) return res.status(400).json({ detail: insErr.message });

  // Si no hay API key, corta acá (historial funciona igual)
  if (!process.env.OPENAI_API_KEY) {
    return res.status(201).json({
      user: userMsg,
      bot: {
        id: null,
        user_id: userId,
        sender: 'bot',
        message:
          'Por ahora no puedo responder con IA. (Falta OPENAI_API_KEY en el servidor).',
        timestamp: new Date().toISOString(),
      },
    });
  }

  try {
    // 2) Traer perfil para personalizar
    const { data: profile } = await supabase
      .from('user_profile')
      .select('name, age_range, experience, montly_income, finance_goal')
      .eq('id_supabase', uid)
      .single();

    // 3) Historial breve (últimos 20)
    const { data: history } = await supabase
      .from('chat_message')
      .select('sender,message')
      .eq('user_id', userId)
      .order('timestamp', { ascending: true })
      .limit(20);

    const historyText =
      (history ?? [])
        .map((m) => `${m.sender === 'user' ? 'Usuario' : 'Bot'}: ${m.message}`)
        .join('\n') || 'Sin historial previo.';

    // 3.1) Si la consulta es de presupuesto y tenemos ingreso, calcula 50/30/20
    const lower = userText.toLowerCase();
    const isBudgetIntent =
      lower.includes('presupuesto') ||
      lower.includes('50/30/20') ||
      lower.includes('ahorro mensual') ||
      lower.includes('cómo ahorrar');

    let budgetExample = '';
    if (isBudgetIntent && profile?.montly_income) {
      const b = calcBudget_50_30_20(Number(profile.montly_income));
      if (b) {
        budgetExample =
          `\nEjemplo 50/30/20 con ingreso ${profile.montly_income}:\n` +
          `- Necesidades (~50%): ${b.needs}\n` +
          `- Gustos (~30%): ${b.wants}\n` +
          `- Ahorro/Meta (~20%): ${b.savings}\n` +
          `(Solo referencia ilustrativa; ajustable según realidad del usuario)`;
      }
    }

    // 4) Prompt del sistema (educación financiera segura)
    const systemPrompt = `
Eres un asistente de EDUCACIÓN financiera en español. Tu misión es enseñar y orientar con buenas prácticas.
Límites importantes:
- No entregas asesoría financiera profesional ni recomendaciones específicas de compra/venta de activos.
- No garantizas rendimientos ni das instrucciones obligatorias.
- Si el usuario pide recomendaciones específicas (por ejemplo, "¿compro X hoy?"), RESPONDE con educación general sobre cómo evaluar ese tipo de decisiones, riesgos y horizonte temporal, y sugiere consultar a un asesor certificado.

Estilo:
- Respuestas claras, breves y accionables.
- Prioriza fundamentos: presupuesto (regla 50/30/20 como referencia), fondo de emergencia (3-6 meses), control de deudas, metas SMART, diversificación, horizonte de inversión, costo/beneficio, y revisión periódica.
- Usa PORCENTAJES y RANGOS; evita cifras absolutas cerradas, salvo ejemplos didácticos.
- Incluye, cuando aporte valor, micro-pasos o checklist (bullets).

Personalización:
- Si conoces ingreso mensual aproximado, meta principal, nivel de experiencia o rango etario, adapta el lenguaje y da EJEMPLOS NUMÉRICOS ILUSTRATIVOS, indicando que son de referencia y pueden variar.

Cierre:
- Termina con una breve nota: "Esto es educación financiera, no asesoría profesional."
`.trim();

    const profileText = profile
      ? `Perfil del usuario (si disponible):
- Nombre: ${profile.name ?? 'N/D'}
- Rango etario: ${profile.age_range ?? 'N/D'}
- Nivel finanzas: ${profile.experience ?? 'N/D'}
- Ingreso mensual aprox: ${profile.montly_income ?? 'N/D'}
- Meta principal: ${profile.finance_goal ?? 'N/D'}`
      : 'Perfil del usuario: No disponible.';

    // 5) Llamada a OpenAI (Responses API)
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini', // ajusta al modelo disponible en tu cuenta
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `Contexto:\n${profileText}`,
            `Historial reciente:\n${historyText}`,
            budgetExample ? `Referencia de presupuesto:\n${budgetExample}` : '',
            `Nueva consulta:\n${userText}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
      temperature: 0.3,
    });

    // 6) Extraer texto de la respuesta
    const botText =
      (response as any).output_text?.trim() ||
      ((response as any).output?.[0]?.content?.[0]?.text ?? '').trim() ||
      'No pude generar una respuesta en este momento.';

    // 7) Guardar respuesta del bot
    const { data: botMsg, error: botErr } = await supabase
      .from('chat_message')
      .insert({ user_id: userId, sender: 'bot', message: botText })
      .select()
      .single();

    if (botErr) return res.status(400).json({ detail: botErr.message });

    // 8) Devolver ambos
    return res.status(201).json({ user: userMsg, bot: botMsg });
  } catch (e: any) {
    console.error('OpenAI error:', e?.message || e);
    return res.status(500).json({ detail: 'Error generando respuesta del bot' });
  }
});

export default router;
