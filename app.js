import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// 1. Configuration
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

// 2. Sheet Names
const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// 3. Database Initialization
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });

    try {
      await fs.access(excelPath);
      console.log('✅ Database file exists');
    } catch {
      const workbook = xlsx.utils.book_new();
      const headers = {
        [SHEETS.DAWA]: [['id', 'jina', 'aina', 'kiasi']],
        [SHEETS.WATUMIAJI]: [['id', 'jina']],
        [SHEETS.MATUMIZI]: [['dawaId', 'kiasi', 'tarehe', 'mtumiajiId']]
      };

      Object.entries(headers).forEach(([name, headerRow]) => {
        const sheet = xlsx.utils.aoa_to_sheet(headerRow);
        xlsx.utils.book_append_sheet(workbook, sheet, name);
      });

      await xlsx.writeFile(workbook, excelPath);
      console.log('📄 Created new database with headers');
    }
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

// 4. Excel Read/Write Functions
async function readSheet(sheetName) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[sheetName];
    const data = sheet ? xlsx.utils.sheet_to_json(sheet) : [];

    // Debug
    const raw = sheet ? xlsx.utils.sheet_to_json(sheet, { header: 1 }) : [];
    console.log(`${sheetName} headers:`, Object.keys(data[0] || {}));
    console.log(`${sheetName} raw headers:`, raw[0]);
    console.log(`${sheetName} raw rows:`, raw.slice(1));

    return data;
  } catch (error) {
    console.error(`❌ Error reading ${sheetName}:`, error);
    return [];
  }
}

async function writeSheet(sheetName, data) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[sheetName];

    // Safisha sheet kwanza na headers as array-of-arrays
    const headers = Object.keys(data[0] || {});
    const headerRow = [headers];
    const newSheet = xlsx.utils.aoa_to_sheet(headerRow);

    // Ongeza rows kuanzia safu ya 2
    xlsx.utils.sheet_add_json(newSheet, data, { skipHeader: true, origin: -1 });

    workbook.Sheets[sheetName] = newSheet;
    await xlsx.writeFile(workbook, excelPath);
    console.log(`📝 ${sheetName} updated with preserved headers`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetName}:`, error);
    return false;
  }
}

// 5. App Startup
async function startApp() {
  await initializeDatabase();

  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // 6. Routes

  app.get('/', async (req, res, next) => {
    try {
      const [dawa, matumizi] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.MATUMIZI)
      ]);

      const ripoti = dawa.map(medicine => {
        const totalUsed = matumizi
          .filter(m => m.dawaId === medicine.id)
          .reduce((sum, m) => sum + (Number(m.kiasi) || 0), 0);

        return {
          ...medicine,
          jumlaMatumizi: totalUsed,
          kilichobaki: (Number(medicine.kiasi) || 0) - totalUsed
        };
      });

      res.render('dashboard', {
        dawa: ripoti,
        error: ripoti.length === 0 ? 'Hakuna data ya dawa kupatikana' : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/mtumiaji/ongeza', (req, res) => {
    res.render('add-user');
  });

  app.post('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const { jina } = req.body;

      if (!jina || jina.trim().length < 2) {
        return res.status(400).render('error', {
          message: 'Tafadhali jaza jina sahihi la mtumiaji'
        });
      }

      const users = await readSheet(SHEETS.WATUMIAJI);
      const newUser = { id: nanoid(), jina };
      const success = await writeSheet(SHEETS.WATUMIAJI, [...users, newUser]);

      if (!success) {
        return res.status(500).render('error', {
          message: 'Imeshindikana kuhifadhi mtumiaji mpya'
        });
      }

      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.get('/matumizi/sajili', async (req, res) => {
    const dawa = await readSheet(SHEETS.DAWA);
    const watumiaji = await readSheet(SHEETS.WATUMIAJI);
    res.render('log-usage', { dawa, watumiaji });
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
    try {
      const { dawaId, kiasi, mtumiajiId, imethibitishwa } = req.body;
      const tarehe = new Date().toISOString().split('T')[0];

      if (!dawaId || !mtumiajiId || !imethibitishwa || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', {
          message: 'Tafadhali jaza taarifa zote sahihi'
        });
      }

      const matumizi = await readSheet(SHEETS.MATUMIZI);
      const newUsage = { dawaId, kiasi: Number(kiasi), tarehe, mtumiajiId };

      const success = await writeSheet(SHEETS.MATUMIZI, [...matumizi, newUsage]);

      if (!success) {
        return res.status(500).render('error', {
          message: 'Imeshindikana kusajili matumizi'
        });
      }

      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/headers-check', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelPath);
    const results = Object.keys(SHEETS).map(key => {
      const name = SHEETS[key];
      const sheet = workbook.Sheets[name];
      const raw = xlsx.utils.sheet_to_json(sheet || {}, { header: 1 });

      return {
        jinaLaSheet: name,
        headers: raw[0] || [],
        count: raw.length - 1
      };
    });

    res.render('headers-check', { results });
  } catch (error) {
    console.error('❌ Sheet header check failed:', error);
    res.status(500).render('error', { message: 'Hitilafu katika ukaguzi wa headers' });
  }
});
  app.get('/debug', async (req, res) => {
    const dawa = await readSheet(SHEETS.DAWA);
    const matumizi = await readSheet(SHEETS.MATUMIZI);
    res.json({ dawa, matumizi });
  });

  // Error Handlers
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server error:', err);
    res.status(500).render('error', { message: 'Hitilafu ya seva' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo wa dawa unaendeshwa kwenye http://localhost:${PORT}`);
  });
}

startApp().catch(error => {
  console.error('💥 Failed to start application:', error);
  process.exit(1);
});
