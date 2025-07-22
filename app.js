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

// Database setup - works on both local and Vercel
const dbPath = path.join(process.env.VERCEL ? '/tmp' : __dirname, 'db.json');

async function initializeDatabase() {
  try {
    // Create file if it doesn't exist
    try {
      await fs.access(dbPath);
    } catch {
      await fs.writeFile(dbPath, JSON.stringify({ dawa: [], watumiaji: [], matumizi: [] }));
    }

    const adapter = new JSONFile(dbPath);
    const db = new Low(adapter);
    
    await db.read();
    db.data ||= { dawa: [], watumiaji: [], matumizi: [] };
    await db.write();
    
    return db;
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

// Main application startup
async function startApp() {
  try {
    const db = await initializeDatabase();

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
        await db.read();
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

    // Add medicine form
    app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));

    // Add medicine POST
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
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Add user form
    app.get('/mtumiaji/ongeza', (req, res) => res.render('add-user'));

    // Add user POST
    app.post('/mtumiaji/ongeza', async (req, res, next) => {
      try {
        const { jina } = req.body;
        if (!jina) return res.status(400).render('error', { message: 'Jina is required' });

        await db.read();
        db.data.watumiaji.push({ id: nanoid(), jina });
        await db.write();
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Log usage form
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

    // Log usage POST
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
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).render('error', { message: 'Page not found' });
    });

    // Global error handler
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
