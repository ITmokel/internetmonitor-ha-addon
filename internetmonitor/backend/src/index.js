import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import apiRoutes from './routes/api.js';
import { startPingService } from './services/ping.js';
import { startSpeedtestService } from './services/speedtest.js';
import { startDnsService } from './services/dns.js';
import { startPublicIpService } from './services/publicip.js';
import { cleanupOldData } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow all origins in development, same-origin only in production
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : true }));
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Serve static frontend files in production
const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../../frontend/dist');
app.use(express.static(staticPath));

// SPA fallback (Express 5 requires named wildcard)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║          Internet Monitor Backend                 ║
║          Running on port ${PORT}                      ║
╚═══════════════════════════════════════════════════╝
  `);

  // Start monitoring services
  startPingService();
  startSpeedtestService();
  startDnsService();
  startPublicIpService();

  // Schedule daily cleanup at 3 AM
  cron.schedule('0 3 * * *', () => {
    try {
      console.log('Running scheduled data cleanup...');
      const result = cleanupOldData();
      console.log(`Cleanup complete: ${result.deleted} entries removed`);
    } catch (err) {
      console.error('Scheduled cleanup failed:', err.message);
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(0);
});
