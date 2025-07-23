import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Properly destructure xlsx methods
const { readFile, writeFile, utils } = xlsx;
const app = express();

// Configure proxy settings for deployment environments
app.set('trust proxy', true);

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

// Enhanced Excel database initialization
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    
    try {
      await fs.access(excelPath);
      const stats = await fs.stat(excelPath);
      if (stats.size === 0) throw new Error('File is empty');
      console.log('📁 Existing Excel database verified');
    } catch {
      console.log('🆕 Creating new Excel database');
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

// Robust sheet reading with error handling
async function readSheet(sheetName) {
  try {
    const workbook = readFile(excelPath);
    if (!workbook.Sheets[sheetName]) {
      throw new Error(`Sheet ${sheetName} not found`);
    }
    return utils.sheet_to_json(workbook.Sheets[sheetName]);
  } catch (error) {
    console.error(`Error reading sheet ${sheetName}:`, error);
    throw error;
  }
}

// Safe sheet writing with error handling
async function writeSheet(sheetName, data) {
  try {
    const workbook = readFile(excelPath);
    const sheetIndex = workbook.SheetNames.indexOf(sheetName);
    
    if (sheetIndex === -1) {
      utils.book_append_sheet(workbook, utils.json_to_sheet(data), sheetName);
    } else {
      workbook.Sheets[sheetName] = utils.json_to_sheet(data);
    }
    
    await writeFile(workbook, excelPath);
  } catch (error) {
    console.error(`Error writing to sheet ${sheetName}:`, error);
    throw error;
  }
}

// Main application startup
async function startApp() {
  try {
    await initializeDatabase();

    // Enhanced security middleware with proxy support
    app.use(helmet());
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      trustProxy: true
    }));

    // App configuration
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // [All your existing routes remain exactly the same...]
    // Dashboard, Add Medicine, Add User, Log Usage routes
    // 404 handler and global error handler

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Critical startup error:', error);
    process.exit(1);
  }
}

// Start the application
startApp();
