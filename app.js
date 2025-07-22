import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { kv } from '@vercel/kv';

const app = express();

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database setup - Using Vercel KV instead of LowDB
async function initializeDatabase() {
  try {
    // Initialize default data if not exists
    if (await kv.get('dawa') === null) {
      await kv.set('dawa', []);
      await kv.set('watumiaji', []);
      await kv.set('matumizi', []);
    }
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Main application startup
async function startApp() {
  try {
    await initializeDatabase();

    // Security middleware
    app.use(helmet());
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100
    }));

    // App configuration
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // Dashboard
    app.get('/', async (req, res, next) => {
      try {
        const [dawa, matumizi] = await Promise.all([
          kv.get('dawa'),
          kv.get('matumizi')
        ]);

        const ripoti = dawa.map(d => {
          const jumla = matumizi
            .filter(m => m.dawaId === d.id)
            .reduce((sum, m) => sum + Number(m.kiasi), 0);
          return {
            ...d,
            jumlaMatumizi: jumla,
            kilichobaki: d.kiasi - jumla,
          };
        });
        res.render('dashboard', { dawa: ripoti });
      } catch (error) {
        next(error);
      }
    });

    // [Rest of your routes with kv.get/kv.set instead of db.read/db.write]
    // Example for adding medicine:
    app.post('/dawa/ongeza', async (req, res, next) => {
      try {
        const { jina, aina, kiasi } = req.body;
        if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { message: 'All fields are required and kiasi must be positive' });
        }

        const dawa = await kv.get('dawa');
        if (dawa.some(d => d.jina === jina)) {
          return res.status(400).render('error', { message: 'Dawa with this name already exists' });
        }

        const newDawa = [...dawa, { id: nanoid(), jina, aina, kiasi: Number(kiasi) }];
        await kv.set('dawa', newDawa);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // [Other routes similarly modified...]

    // 404 and error handlers remain the same
    app.use((req, res) => {
      res.status(404).render('error', { message: 'Page not found' });
    });

    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).render('error', { message: 'Server error, please try again later' });
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Critical startup error:', error);
    process.exit(1);
  }
}

// Start the application
startApp();
