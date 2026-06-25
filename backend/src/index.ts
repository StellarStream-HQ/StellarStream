import express, { Express, Request, Response } from 'express';
import apiRoutes from './api/index.js';

const app: Express = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'StellarStream Backend is running' });
});

// API routes
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

export default app;