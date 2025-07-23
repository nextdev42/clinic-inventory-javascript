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

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database setup - Excel files
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

// Excel sheet names
const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// Initialize Excel database
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    
    try {
      await fs.access(excelPath);
      console.log('📁 Excel database exists');
    } catch {
      console.log('🆕 Creating new Excel database');
      
      // Create workbook with empty sheets
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, utils.json_to_sheet([]), SHEETS.DAWA);
      utils.book_append_sheet(workbook, utils.json_to_sheet([]), SHEETS.WATUMIAJI);
      utils.book_append_sheet(workbook, utils.json_to_sheet([]), SHEETS.MATUMIZI);
      
      await writeFile(workbook, excelPath);
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Read data from Excel sheet
async function readSheet(sheetName) {
  const workbook = readFile(excelPath);
  return utils.sheet_to_json(workbook.Sheets[sheetName]);
}

// Write data to Excel sheet
async function writeSheet(sheetName, data) {
  const workbook = readFile(excelPath);
  utils.book_append_sheet(workbook, utils.json_to_sheet(data), sheetName, true);
  await writeFile(workbook, excelPath);
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

        const dawa = await readSheet(SHEETS.DAWA);
        if (dawa.some(d => d.jina === jina)) {
          return res.status(400).render('error', { message: 'Dawa with this name already exists' });
        }

        const newDawa = [...dawa, { id: nanoid(), jina, aina, kiasi: Number(kiasi) }];
        await writeSheet(SHEETS.DAWA, newDawa);
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

        const watumiaji = await readSheet(SHEETS.WATUMIAJI);
        const newWatumiaji = [...watumiaji, { id: nanoid(), jina }];
        await writeSheet(SHEETS.WATUMIAJI, newWatumiaji);
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Log usage form
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

    // Log usage POST
    app.post('/matumizi/sajili', async (req, res, next) => {
      try {
        const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;

        if (!imethibitishwa) return res.redirect('/');
        if (!mtumiajiId || !dawaId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { message: 'All fields are required and kiasi must be positive' });
        }

        const [dawaList, matumizi] = await Promise.all([
          readSheet(SHEETS.DAWA),
          readSheet(SHEETS.MATUMIZI)
        ]);

        const dawa = dawaList.find(d => d.id === dawaId);
        if (!dawa) return res.status(404).render('error', { message: 'Medicine not found' });

        const usedAmount = matumizi
          .filter(m => m.dawaId === dawaId)
          .reduce((sum, m) => sum + Number(m.kiasi), 0);

        const remaining = dawa.kiasi - usedAmount;
        if (remaining < Number(kiasi)) {
          return res.status(400).render('error', {
            message: `Insufficient stock. Only ${remaining} units available`
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
