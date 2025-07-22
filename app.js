import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database setup
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'db.json');
const adapter = new JSONFile(dbPath);
const db = new Low(adapter);

// Security middleware
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await db.read();

    // Log current DB state
    console.log('📦 Initial DB state:', db.data);

    if (!db.data || Object.keys(db.data).length === 0) {
      db.data = { dawa: [], watumiaji: [], matumizi: [] };
      await db.write();
      console.log('✅ Database initialized with default data');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function startServer() {
  try {
    await initializeDatabase();

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // Dashboard
    app.get('/', async (req, res, next) => {
      try {
        await db.read();
        console.log('📊 Dashboard Load DB:', db.data);
        const ripoti = db.data.dawa.map(d => {
          const jumla = db.data.matumizi
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

    app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));

    app.post('/dawa/ongeza', async (req, res, next) => {
      try {
        const { jina, aina, kiasi } = req.body;
        if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { message: 'All fields are required and kiasi must be positive' });
        }

        await db.read();
        if (db.data.dawa.some(d => d.jina === jina)) {
          return res.status(400).render('error', { message: 'Dawa with this name already exists' });
        }

        db.data.dawa.push({ id: nanoid(), jina, aina, kiasi: Number(kiasi) });
        await db.write();
        console.log('🆕 Dawa added:', db.data.dawa);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    app.get('/mtumiaji/ongeza', (req, res) => res.render('add-user'));

    app.post('/mtumiaji/ongeza', async (req, res, next) => {
      try {
        const { jina } = req.body;
        if (!jina) return res.status(400).render('error', { message: 'Jina is required' });

        await db.read();
        db.data.watumiaji.push({ id: nanoid(), jina });
        await db.write();
        console.log('👤 Mtumiaji added:', db.data.watumiaji);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    app.get('/matumizi/sajili', async (req, res, next) => {
      try {
        await db.read();
        res.render('log-usage', {
          dawa: db.data.dawa,
          watumiaji: db.data.watumiaji
        });
      } catch (error) {
        next(error);
      }
    });

    app.post('/matumizi/sajili', async (req, res, next) => {
      try {
        const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;

        if (!imethibitishwa) return res.redirect('/');
        if (!mtumiajiId || !dawaId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { message: 'All fields are required and kiasi must be positive' });
        }

        await db.read();

        const dawa = db.data.dawa.find(d => d.id === dawaId);
        if (!dawa) return res.status(404).render('error', { message: 'Medicine not found' });

        const usedAmount = db.data.matumizi
          .filter(m => m.dawaId === dawaId)
          .reduce((sum, m) => sum + Number(m.kiasi), 0);

        const remaining = dawa.kiasi - usedAmount;
        if (remaining < Number(kiasi)) {
          return res.status(400).render('error', {
            message: `Insufficient stock. Only ${remaining} units available`
          });
        }

        db.data.matumizi.push({
          id: nanoid(),
          mtumiajiId,
          dawaId,
          kiasi: Number(kiasi),
          tarehe: new Date().toISOString().slice(0, 10)
        });

        await db.write();
        console.log('📝 Matumizi logged:', db.data.matumizi);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    app.use((req, res) => {
      res.status(404).render('error', { message: 'Page not found' });
    });

    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).render('error', { message: 'Server error, please try again later' });
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
