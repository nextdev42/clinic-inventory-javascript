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

// 2. Sheet Configuration
const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// 3. Database Functions
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });

    try {
      await fs.access(excelPath);
      console.log('✅ Database file exists');
    } catch {
      const workbook = xlsx.utils.book_new();
      const emptySheets = {
        [SHEETS.DAWA]: [{ id: '', jina: '', aina: '', kiasi: '' }],
        [SHEETS.MATUMIZI]: [{ dawaId: '', kiasi: '', tarehe: '' }],
        [SHEETS.WATUMIAJI]: [{ id: '', jina: '', kundi: '' }]
      };

      Object.entries(emptySheets).forEach(([sheetName, headers]) => {
        const sheet = xlsx.utils.json_to_sheet(headers);
        xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
      });

      await xlsx.writeFile(workbook, excelPath);
      console.log('📄 Created new database file with seeded headers');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function readSheet(sheetName) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[sheetName];
    const data = sheet ? xlsx.utils.sheet_to_json(sheet) : [];
    console.log(`${sheetName} headers:`, Object.keys(data[0] || {}));
    const raw = xlsx.utils.sheet_to_json(sheet, { header: 1 });
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
    const worksheet = xlsx.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = worksheet;
    await xlsx.writeFile(workbook, excelPath);
    console.log(`📝 Updated ${sheetName} sheet successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetName}:`, error);
    return false;
  }
}

// 4. Application Setup
async function startApp() {
  await initializeDatabase();

  // Middleware
  app.use(helmet());
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // 5. Routes
  app.get('/', async (req, res, next) => {
    try {
      const [dawa, matumizi] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.MATUMIZI)
      ]);

      console.log('Debug - Dawa data:', dawa);
      console.log('Debug - Matumizi data:', matumizi);

      const ripoti = dawa.map(medicine => {
        const totalUsed = matumizi
          .filter(usage => usage.dawaId === medicine.id)
          .reduce((sum, usage) => sum + (Number(usage.kiasi) || 0), 0);

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

  app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));
  app.post('/dawa/ongeza', async (req, res, next) => {
    try {
      const { jina, aina, kiasi } = req.body;

      if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', {
          message: 'Tafadhali jaza taarifa zote sahihi'
        });
      }

      const dawaList = await readSheet(SHEETS.DAWA);

      if (dawaList.some(d => d.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', {
          message: 'Dawa hiyo tayari ipo'
        });
      }

      const newMedicine = {
        id: nanoid(),
        jina,
        aina,
        kiasi: Number(kiasi)
      };

      const success = await writeSheet(SHEETS.DAWA, [...dawaList, newMedicine]);

      if (!success) {
        return res.status(500).render('error', {
          message: 'Imeshindikana kuhifadhi dawa mpya'
        });
      }

      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // 🔍 Debug route for raw data
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
