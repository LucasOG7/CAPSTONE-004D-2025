// src/index.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import goalsRoutes from './routes/goals';
import contributionsRoutes from './routes/contributions';
import transactionsRoutes from './routes/transactions';
import recommendationsRoutes from './routes/recommendations';
import chatRoutes from './routes/chat';
import newsRoutes from './routes/news';
import pushRoutes from './routes/push';
import { startNewsAndRatesPolling } from './jobs/newsPoller';

const app = express();
const PORT = Number(process.env.PORT || 3000);

/** CORS: abierto para dev (ajusta origin en prod) */
const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/', (_req, res) => res.json({ message: 'MyGoalFinance API (Node + Supabase)' }));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/goals/contributions', contributionsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/push', pushRoutes);

// 👇 IMPORTANTE: escuchar en 0.0.0.0 para que el teléfono pueda conectarse por la IP LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API lista en http://0.0.0.0:${PORT}`);

  if (process.env.ENABLE_CRON === '1') {
    const g = globalThis as any;
    if (g.__pollerStarted) {
      console.log('⏱️ Poller ya estaba iniciado, skip');
    } else {
      g.__pollerStarted = true;
      startNewsAndRatesPolling();
      console.log('⏱️ Poller iniciado (FX [+ News cuando lo habilites])');
    }
  } else {
    console.log('⏱️ Cron deshabilitado (ENABLE_CRON != 1)');
  }
});
