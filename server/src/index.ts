import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from 'dotenv';
import { campfireWS } from './ws/server.js';
import readsRouter from './routes/reads.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tribe-server', timestamp: Date.now() });
});

// Routes
app.use('/api/reads', readsRouter);

// Demo broadcast endpoint (dev only — allows simulation script to push events)
app.post('/api/demo/broadcast', (req, res) => {
  const { tribeId, fixtureId, event } = req.body;
  if (!tribeId || !fixtureId || !event) {
    return res.status(400).json({ error: 'Missing tribeId, fixtureId, or event' });
  }
  campfireWS.broadcastToTribe(tribeId, fixtureId, event);
  return res.json({ success: true, recipients: campfireWS.getPresenceCount(tribeId, fixtureId) });
});

// Create HTTP server and attach WebSocket
const httpServer = createServer(app);
campfireWS.attach(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[TRIBE] Server running on port ${PORT}`);
});

export { app, httpServer };
