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

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors({ origin: true, credentials: true }));
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

app.listen(PORT, () => console.log(`🚀 API lista en http://localhost:${PORT}`));
