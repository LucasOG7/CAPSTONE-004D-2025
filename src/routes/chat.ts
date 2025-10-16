// src/routes/chat.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Groq from 'groq-sdk';
import { supabase, supabaseAdmin, getProfileIdByAuthId } from '../supabase';
import { requireAuth } from '../middleware/auth';
import { calcBudget_50_30_20 } from '../utils/finance';

const router = Router();

// ─────────── Groq client ───────────
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️ Falta GROQ_API_KEY en .env (el chatbot no podrá responder).');
}
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// Helpers
const sendSchema = z.object({ message: z.string().min(1) });

function systemPrompt() {
  return `
Eres un asistente de EDUCACIÓN financiera en español.
- No das asesoría profesional ni recomendaciones de compra/venta de activos específicas.
- Da fundamentos: presupuesto (50/30/20 como referencia), fondo de emergencia (3–6 meses), control de deudas, metas SMART, diversificación.
- Respuestas claras, breves y accionables; usa checklists cuando aporte valor.
- Adapta ejemplos según ingreso/meta si están disponibles.
Cierra con: "Esto es educación financiera, no asesoría profesional."
`.trim();
}

async function buildMessages({
  uid,
  userId,
  userText,
}: {
  uid: string;
  userId: number;
  userText: string;
}) {
  // Perfil
  const { data: profile } = await supabase
    .from('user_profile')
    .select('name, age_range, experience, montly_income, finance_goal')
    .eq('id_supabase', uid)
    .single();

  // Historial breve
  const { data: history } = await supabaseAdmin
    .from('chat_message')
    .select('sender,message')
    .eq('user_id', userId)
    .order('timestamp', { ascending: true })
    .limit(20);

  // Posible cálculo 50/30/20
  const lower = (userText || '').toLowerCase();
  const isBudgetIntent =
    lower.includes('presupuesto') ||
    lower.includes('50/30/20') ||
    lower.includes('ahorro mensual') ||
    lower.includes('como ahorrar') ||
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
        `(Solo referencia ilustrativa; ajustable según tu realidad)`;
    }
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt() },
  ];

  if (profile) {
    messages.push({
      role: 'user',
      content:
        `Perfil (si disponible):
- Nombre: ${profile.name ?? 'N/D'}
- Rango etario: ${profile.age_range ?? 'N/D'}
- Nivel finanzas: ${profile.experience ?? 'N/D'}
- Ingreso mensual aprox: ${profile.montly_income ?? 'N/D'}
- Meta principal: ${profile.finance_goal ?? 'N/D'}`,
    });
  }

  (history ?? []).forEach((m) =>
    messages.push({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.message,
    }),
  );

  messages.push({
    role: 'user',
    content: userText + (budgetExample ? `\n\n${budgetExample}` : ''),
  });

  return messages;
}

// ---------------------------
// GET: historial
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

// ---------------------------------------------
// POST: usuario envía mensaje -> Groq responde
// (alias en "/message" y "/" para compatibilidad)
// ---------------------------------------------
async function handlePostMessage(req: any, res: Response) {
  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const userText = parsed.data.message.trim();

  // Guarda mensaje del usuario (RLS exige user_id correcto)
  const { data: userMsg, error: insErr } = await supabaseAdmin
    .from('chat_message')
    .insert({ user_id: userId, sender: 'user', message: userText })
    .select()
    .single();
  if (insErr) return res.status(400).json({ detail: insErr.message });

  if (!process.env.GROQ_API_KEY) {
    return res.status(201).json({
      user: userMsg,
      bot: {
        id: null,
        user_id: userId,
        sender: 'bot',
        message:
          'Por ahora no puedo responder con IA (falta GROQ_API_KEY en el servidor).',
        timestamp: new Date().toISOString(),
      },
    });
  }

  try {
    const messages = await buildMessages({ uid, userId, userText });

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.3,
      messages,
    });

    const botText =
      completion.choices?.[0]?.message?.content?.trim() ||
      'No pude generar una respuesta en este momento.';

    // Guarda respuesta del bot
    const { data: botMsg, error: botErr } = await supabaseAdmin
      .from('chat_message')
      .insert({ user_id: userId, sender: 'bot', message: botText })
      .select()
      .single();
    if (botErr) return res.status(400).json({ detail: botErr.message });

    return res.status(201).json({ user: userMsg, bot: botMsg });
  } catch (e: any) {
    console.error('Groq error:', e?.message || e);
    const msg =
      e?.status === 401
        ? 'Clave de Groq inválida'
        : e?.status === 404
        ? 'Modelo de Groq no encontrado'
        : e?.status === 429
        ? 'Groq: límite de velocidad alcanzado, intenta en unos segundos'
        : 'Error generando respuesta del bot';
    return res.status(500).json({ detail: msg });
  }
}

router.post('/message', requireAuth, handlePostMessage);
// Alias de compatibilidad (por si el front aún hace POST /api/chat)
router.post('/', requireAuth, handlePostMessage);

// ---------------------------------------------
// GET /chat/stream  →  SSE con Groq (streaming)
// ---------------------------------------------
router.get('/stream', requireAuth, async (req: any, res: Response) => {
  if (!process.env.GROQ_API_KEY) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ delta: 'El servidor no tiene GROQ_API_KEY.' })}\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
    return res.end();
  }

  const uid = req.user.id;
  const userId = await getProfileIdByAuthId(uid);
  if (!userId) return res.status(404).json({ detail: 'Perfil no encontrado' });

  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ detail: 'Falta parámetro q' });

  // Cabeceras SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Guarda mensaje del usuario antes de llamar a Groq
  const { error: insErr } = await supabaseAdmin
    .from('chat_message')
    .insert({ user_id: userId, sender: 'user', message: q });
  if (insErr) {
    res.write(`data: ${JSON.stringify({ delta: '', error: insErr.message })}\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
    return res.end();
  }

  try {
    const messages = await buildMessages({ uid, userId, userText: q });

    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.3,
      messages,
      stream: true,
    });

    let acc = '';

    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content || '';
      if (delta) {
        acc += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    // Guarda el texto final del bot
    if (acc.trim().length > 0) {
      await supabase
        .from('chat_message')
        .insert({ user_id: userId, sender: 'bot', message: acc.trim() });
    }

    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (e: any) {
    console.error('groq stream error:', e?.message || e);
    // Notifica error al cliente y cierra
    res.write(`data: ${JSON.stringify({ delta: '', error: 'stream_failed' })}\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  }
});

export default router;
