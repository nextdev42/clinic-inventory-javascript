import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const { readFile, writeFile, utils } = xlsx;
const app = express();

// Configure proxy settings
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database setup
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// Database functions (same as your existing implementation)
async function initializeDatabase() { /* ... */ }
async function readSheet(sheetName) { /* ... */ }
async function writeSheet(sheetName, data) { /* ... */ }

// Main application
async function startApp() {
  try {
    await initializeDatabase();

    // Security middleware
    app.use(helmet());
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false
    }));

    // App config
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // ===== ROUTES ===== //

    // Dashboard
    app.get('/', async (req, res, next) => {
      try {
        const [dawa, matumizi] = await Promise.all([
          readSheet(SHEETS.DAWA),
          readSheet(SHEETS.MATUMIZI)
        ]);

        const ripoti = dawa.map(d => {
          const jumla = matumizi
            .filter(m => m.dawaId === d.id)
            .reduce((sum, m) => sum + Number(m.kiasi), 0);
          return {
            ...d,
            jumlaMatumizi: jumla,
            kilichobaki: d.kiasi - jumla
          };
        });
        res.render('dashboard', { dawa: ripoti });
      } catch (error) {
        next(error);
      }
    });

    // Add Medicine
    app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));
    app.post('/dawa/ongeza', async (req, res, next) => {
      try {
        const { jina, aina, kiasi } = req.body;
        if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { 
            message: 'Hakikisha umejaza sehemu zote na kiasi ni namba chanya' 
          });
        }

        const dawa = await readSheet(SHEETS.DAWA);
        if (dawa.some(d => d.jina === jina)) {
          return res.status(400).render('error', { 
            message: 'Dawa yenye jina hili tayari ipo kwenye mfumo' 
          });
        }

        const newDawa = [...dawa, { 
          id: nanoid(), 
          jina, 
          aina, 
          kiasi: Number(kiasi) 
        }];
        await writeSheet(SHEETS.DAWA, newDawa);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Add User
    app.get('/mtumiaji/ongeza', (req, res) => res.render('add-user'));
    app.post('/mtumiaji/ongeza', async (req, res, next) => {
      try {
        const { jina } = req.body;
        if (!jina || jina.trim() === '') {
          return res.status(400).render('error', { 
            message: 'Jina la mtumiaji linahitajika' 
          });
        }

        const watumiaji = await readSheet(SHEETS.WATUMIAJI);
        const newWatumiaji = [...watumiaji, { 
          id: nanoid(), 
          jina: jina.trim() 
        }];
        await writeSheet(SHEETS.WATUMIAJI, newWatumiaji);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Log Usage
    app.get('/matumizi/sajili', async (req, res, next) => {
      try {
        const [dawa, watumiaji] = await Promise.all([
          readSheet(SHEETS.DAWA),
          readSheet(SHEETS.WATUMIAJI)
        ]);
        res.render('log-usage', { dawa, watumiaji });
      } catch (error) {
        next(error);
      }
    });

    app.post('/matumizi/sajili', async (req, res, next) => {
      try {
        const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;

        if (!imethibitishwa) return res.redirect('/');
        if (!mtumiajiId || !dawaId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { 
            message: 'Hakikisha umechagua mtumiaji, dawa na kiasi sahihi' 
          });
        }

        const [dawaList, matumizi] = await Promise.all([
          readSheet(SHEETS.DAWA),
          readSheet(SHEETS.MATUMIZI)
        ]);

        const dawa = dawaList.find(d => d.id === dawaId);
        if (!dawa) {
          return res.status(404).render('error', { 
            message: 'Dawa hiyo haipo kwenye mfumo' 
          });
        }

        const usedAmount = matumizi
          .filter(m => m.dawaId === dawaId)
          .reduce((sum, m) => sum + Number(m.kiasi), 0);

        const remaining = dawa.kiasi - usedAmount;
        if (remaining < Number(kiasi)) {
          return res.status(400).render('error', {
            message: `Hakuna dawa ya kutosha. Kiasi kilichobaki: ${remaining}`
          });
        }

        const newMatumizi = [...matumizi, {
          id: nanoid(),
          mtumiajiId,
          dawaId,
          kiasi: Number(kiasi),
          tarehe: new Date().toISOString().slice(0, 10)
        }];

        await writeSheet(SHEETS.MATUMIZI, newMatumizi);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Error handlers
    app.use((req, res) => {
      res.status(404).render('error', { 
        message: 'Ukurasa ulioutafuta haupatikani' 
      });
    });

    app.use((err, req, res, next) => {
      console.error('🔥 Hitilafu:', err.stack);
      res.status(500).render('error', { 
        message: 'Kuna tatizo la seva, tafadhali jaribu tena baadaye' 
      });
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Mfumo wa dawa unakimbia kwenye http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Hitilafu kubwa ya kuanzisha mfumo:', error);
    process.exit(1);
  }
}

startApp();
