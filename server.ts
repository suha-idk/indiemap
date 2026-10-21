import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { apiRouter } from './src/server/api.ts';

dotenv.config();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// In development, the AI Studio container uses Nginx on 8080 which proxies to 3000.
// Dev server must always bind to port 3000 unless explicitly overridden via CLI args.
function resolvePort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  if (isProduction) {
    return process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  }
  return 3000;
}

function resolveHost(): string {
  const hostArgIndex = process.argv.indexOf('--host');
  if (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) {
    return process.argv[hostArgIndex + 1];
  }
  return '0.0.0.0';
}

const PORT = resolvePort();
const HOST = resolveHost();

// Parse JSON and URL-encoded bodies with 25MB limit for speech audio payloads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Error handler for body-parser entity too large
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: 'Payload too large',
      message: 'Request payload exceeded maximum limit (25MB)',
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

// Mount API routes
app.use('/api', apiRouter);

// Health check endpoint for Cloud Run and container probes
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

async function startServer() {
  const server = http.createServer(app);

  if (!isProduction) {
    // In dev: mount vite.middlewares per framework instructions
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production: serve built static files from dist/
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Raahi server running on http://${HOST}:${PORT} (mode: ${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
