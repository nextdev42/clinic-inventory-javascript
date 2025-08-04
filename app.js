import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

const app = express();

app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'siri-yako-hapa',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

const SHEETS = {
  DAWA: { name: 'Dawa', headers: ['id', 'jina', 'aina', 'kiasi', 'UPDATED_AT'] },
  WATUMIAJI: { name: 'Watumiaji', headers: ['id', 'jina', 'maelezo', 'clinicId'] },
  MATUMIZI: { name: 'Matumizi', headers: ['id', 'dawaId', 'mtumiajiId', 'mtumiajiJina', 'maelezo', 'kiasi', 'tarehe', 'clinicId'] },
  CLINICS: { name: 'Clinics', headers: ['id', 'jina'] }
};

// Helper function to filter Kisiwani users
function filterKisiwaniUsers(users) {
  return users.filter(user => user.clinicId === 'C001');
}



async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    let workbook;
    try {
      await fs.access(excelPath);
      workbook = xlsx.readFile(excelPath);
      for (const config of Object.values(SHEETS)) {
        if (!workbook.Sheets[config.name]) {
          const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
          xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
        }
      }
    } catch {
      workbook = xlsx.utils.book_new();
      for (const config of Object.values(SHEETS)) {
        const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
        xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
      }
    }

    // Add default clinics if none exist
    const clinicsSheet = workbook.Sheets[SHEETS.CLINICS.name];
    const clinicsData = clinicsSheet ? xlsx.utils.sheet_to_json(clinicsSheet) : [];
    if (!clinicsData.length) {
      const defaultClinics = [
        { id: 'C001', jina: 'Kisiwani' },
        { id: 'C002', jina: 'Mikwambe' },
        { id: 'C003', jina: 'Kibada' },
        { id: 'C004', jina: 'Jirambe' }
      ];
      const ws = xlsx.utils.json_to_sheet(defaultClinics, { header: SHEETS.CLINICS.headers });
      workbook.Sheets[SHEETS.CLINICS.name] = ws;
    }

    // FIX: Only process medicines if they exist and are valid
    const dawaSheet = workbook.Sheets[SHEETS.DAWA.name];
    if (dawaSheet) {
      try {
        // Read data without assuming header format
        const dawaData = xlsx.utils.sheet_to_json(dawaSheet);
        
        // Filter out invalid/empty medicines
        const validDawaData = dawaData.filter(medicine => 
          medicine.id && medicine.jina && medicine.jina.trim() !== "" && medicine.aina
        );
        
        // Only update if we have valid medicines
        if (validDawaData.length > 0) {
          const updatedDawa = validDawaData.map(medicine => ({
            ...medicine,
            UPDATED_AT: medicine.UPDATED_AT || new Date().toISOString()
          }));
          
          const ws = xlsx.utils.json_to_sheet(updatedDawa, { header: SHEETS.DAWA.headers });
          workbook.Sheets[SHEETS.DAWA.name] = ws;
        }
      } catch (e) {
        console.error('❌ Error processing medicines:', e);
      }
    }

    await xlsx.writeFile(workbook, excelPath);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

    

async function readSheet(sheetKey) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[config.name];
    const sheetHeaders = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const headers = sheetHeaders.length > 0 ? sheetHeaders : config.headers;
    
    return xlsx.utils.sheet_to_json(sheet, { header: headers })
      .slice(1)
      .map(row => {
        const item = {};
        headers.forEach(header => {
          item[header] = row[header] || '';
        });
        return item;
      });
  } catch (error) {
    console.error(`❌ Error reading ${sheetKey}:`, error);
    return [];
  }
}

async function writeSheet(sheetKey, data) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    
    const rows = data.map(item => {
      const row = {};
      config.headers.forEach(header => {
        row[header] = item[header] || '';
      });
      return row;
    });

    const worksheet = xlsx.utils.json_to_sheet(rows, { header: config.headers });
    workbook.Sheets[config.name] = worksheet;
    await xlsx.writeFile(workbook, excelPath);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetKey}:`, error);
    return false;
  }
}

async function startApp() {
  await initializeDatabase();

  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Dashboard route
  
app.get('/', async (req, res, next) => {
  try {
    // Read all necessary data
    const [dawa, matumizi, watumiaji, clinics] = await Promise.all([
      readSheet('DAWA'),
      readSheet('MATUMIZI'),
      readSheet('WATUMIAJI'),
      readSheet('CLINICS')
    ]);

    // Calculate medicine usage and stock
    const ripoti = dawa.map(medicine => {
      const totalUsed = matumizi
        .filter(usage => usage.dawaId === medicine.id)
        .reduce((sum, usage) => sum + (Number(usage.kiasi) || 0), 0);
      const remainingStock = (Number(medicine.kiasi) || 0) - totalUsed;
      
      return {
        ...medicine,
        jumlaMatumizi: totalUsed,
        kilichobaki: remainingStock,
        status: remainingStock <= 0 ? 'Zilizoisha' : 
               (remainingStock < 10 ? 'Kidogo' : 'Inatosha')
      };
    });

    // Calculate users per clinic
    const watumiajiPerClinic = {};
    watumiaji.forEach(user => {
      const clinicId = user.clinicId;
      if (clinicId) {
        if (!watumiajiPerClinic[clinicId]) {
          watumiajiPerClinic[clinicId] = 0;
        }
        watumiajiPerClinic[clinicId]++;
      }
    });

    // Prepare clinic data with user counts
    const vituoData = clinics.map(clinic => ({
      ...clinic,
      idadiWatumiaji: watumiajiPerClinic[clinic.id] || 0
    }));

    res.render('dashboard', {
      dawa: ripoti,
      vituo: vituoData,  // Send clinic data to the view
      error: ripoti.length === 0 ? 'Hakuna data ya dawa kupatikana' : null
    });
  } catch (error) {
    next(error);
  }
});
      
  
  // Medicine routes
  app.get('/dawa/ongeza', (req, res) => {
    res.render('add-medicine', { error: null, formData: {} });
  });

  
   app.post('/dawa/ongeza', async (req, res, next) => {
  try {
    const { jina, aina, kiasi } = req.body;
    
    // Validate inputs more strictly
    if (!jina || !jina.trim() || !aina || !aina.trim() || 
        isNaN(kiasi) || Number(kiasi) <= 0) {
      return res.status(400).render('add-medicine', {
        error: 'Tafadhali jaza taarifa zote sahihi',
        formData: req.body
      });
    }

    const cleanJina = jina.trim();
    const cleanAina = aina.trim();
    const cleanKiasi = Number(kiasi);

    // Prevent creating medicine with name "aina"
    if (cleanJina.toLowerCase() === "aina") {
      return res.status(400).render('add-medicine', {
        error: 'Jina "aina" haliruhusiwi. Tafadhali tumia jina lingine.',
        formData: req.body
      });
    }

    const dawa = await readSheet('DAWA');
    const normalizedJina = cleanJina.toLowerCase();
    const existingIndex = dawa.findIndex(d => 
      d.jina?.toLowerCase() === normalizedJina
    );

    if (existingIndex !== -1) {
      return res.status(400).render('add-medicine', {
        error: `Dawa yenye jina "${cleanJina}" tayari ipo kwenye mfumo.`,
        formData: req.body
      });
    }

    // Add new medicine
    const newMedicine = {
      id: nanoid(),
      jina: cleanJina,
      aina: cleanAina,
      kiasi: cleanKiasi,
      UPDATED_AT: new Date().toISOString()
    };

    await writeSheet('DAWA', [...dawa, newMedicine]);
    return res.redirect('/?add=success');
  } catch (error) {
    next(error);
  }
}); 

    
      

  // Restock routes
  app.get('/dawa/ongeza-stock', async (req, res, next) => {
    try {
      const dawa = await readSheet('DAWA');
      const success = req.query.success === '1';
      res.render('restock', { dawa, success });
    } catch (error) {
      next(error);
    }
  });

  app.post('/dawa/ongeza-stock', async (req, res, next) => {
    try {
      const { dawaId, kiasi } = req.body;
      if (!dawaId || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', {
          message: 'Tafadhali chagua dawa na uweke kiasi sahihi'
        });
      }

      const dawa = await readSheet('DAWA');
      const medicineIndex = dawa.findIndex(d => d.id === dawaId);
      
      if (medicineIndex === -1) {
        return res.status(400).render('error', {
          message: 'Dawa hiyo haipo kwenye mfumo'
        });
      }

      // Update stock
      dawa[medicineIndex].kiasi = Number(dawa[medicineIndex].kiasi) + Number(kiasi);
      dawa[medicineIndex].UPDATED_AT = new Date().toISOString();
      
      await writeSheet('DAWA', dawa);
      res.redirect('/dawa/ongeza-stock?success=1');
    } catch (error) {
      next(error);
    }
  });

  // User routes
  app.get('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const clinics = await readSheet('CLINICS');
      res.render('add-user', { clinics, error: null, formData: {} });
    } catch (error) {
      next(error);
    }
  });

  app.post('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const { jina, description, clinicId } = req.body;
      const clinics = await readSheet('CLINICS');
      
      // Validate inputs
      if (!jina || jina.trim().length < 2) {
        return res.render('add-user', {
          clinics,
          error: 'Jina la mtumiaji linahitajika',
          formData: req.body
        });
      }
      
      if (!clinicId) {
        return res.render('add-user', {
          clinics,
          error: 'Tafadhali chagua kliniki',
          formData: req.body
        });
      }

      const watumiaji = await readSheet('WATUMIAJI');
      const normalizedJina = jina.toLowerCase().trim();
      if (watumiaji.some(w => w.jina.toLowerCase() === normalizedJina)) {
        return res.render('add-user', {
          clinics,
          error: 'Tayari kuna mtumiaji mwenye jina hili.',
          formData: req.body
        });
      }

      const newUser = { 
        id: nanoid(), 
        jina: jina.trim(), 
        maelezo: (description || '').trim(), 
        clinicId 
      };
      
      await writeSheet('WATUMIAJI', [...watumiaji, newUser]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // Usage logging routes
  app.get('/matumizi/sajili', async (req, res, next) => {
    try {
      const [dawa, allWatumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      
      // Only show Kisiwani users (clinicId 'C001')
      const watumiaji = filterKisiwaniUsers(allWatumiaji);
      
      res.render('log-usage', { 
        dawa, 
        watumiaji, 
        error: null, 
        mtumiajiId: null 
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
    try {
      const { mtumiajiId, dawaList } = req.body;

      if (!mtumiajiId) {
        return res.status(400).render('error', {
          message: 'Tafadhali chagua mtumiaji.'
        });
      }

      if (!dawaList) {
        return res.status(400).render('error', {
          message: 'Tafadhali chagua angalau dawa moja.'
        });
      }

      const dawaArray = Array.isArray(dawaList)
        ? dawaList
        : Object.values(dawaList);

      const confirmedDawa = [];
      const errors = [];

      for (const d of dawaArray) {
        if (d.confirmed !== 'true') continue;

        const quantity = parseInt(d.kiasi, 10);
        if (isNaN(quantity)) {
          errors.push(`Kiasi cha ${d.id} si namba halali`);
          continue;
        }

        if (quantity <= 0) {
          errors.push(`Kiasi cha ${d.id} kinaweza kuwa chini ya 1`);
          continue;
        }

        confirmedDawa.push({
          ...d,
          kiasi: quantity
        });
      }

      if (errors.length > 0) {
        return res.status(400).render('error', {
          message: `Hitilafu katika kiasi: ${errors.join(', ')}`
        });
      }

      if (confirmedDawa.length === 0) {
        const [dawa, allWatumiaji] = await Promise.all([
          readSheet('DAWA'),
          readSheet('WATUMIAJI')
        ]);
        
        // Only show Kisiwani users in the form
        const watumiaji = filterKisiwaniUsers(allWatumiaji);
        
        return res.render('log-usage', {
          dawa,
          watumiaji,
          error: 'Hakuna dawa zilizothibitishwa kutolewa. Tafadhali chagua angalau dawa moja.',
          mtumiajiId
        });
      }

      const [allDawa, allWatumiaji, existingMatumizi] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI'),
        readSheet('MATUMIZI')
      ]);

      const stockChecks = [];
      const validUsages = [];

      for (const d of confirmedDawa) {
        const medicine = allDawa.find(m => m.id === d.id);

        if (!medicine) {
          stockChecks.push(`Dawa ya ${d.id} haipo kwenye mfumo`);
          continue;
        }

        const totalUsed = existingMatumizi
          .filter(m => m.dawaId === d.id)
          .reduce((sum, m) => sum + (Number(m.kiasi) || 0), 0);

        const remainingStock = (Number(medicine.kiasi) || 0) - totalUsed;

        if (d.kiasi > remainingStock) {
          stockChecks.push(`Dawa ya ${medicine.jina} inabaki ${remainingStock} pekee`);
          continue;
        }

        validUsages.push(d);
      }

      if (stockChecks.length > 0) {
        return res.status(400).render('error', {
          message: `Hitilafu ya hisa: ${stockChecks.join(', ')}`
        });
      }

      const mtumiaji = allWatumiaji.find(w => w.id === mtumiajiId);
      if (!mtumiaji) {
        return res.status(400).render('error', {
          message: 'Mtumiaji aliyechaguliwa hayupo kwenye mfumo'
        });
      }
      
      // Validate user is from Kisiwani
      if (mtumiaji.clinicId !== 'C001') {
        return res.status(400).render('error', {
          message: 'Samahani, mtumiaji huyu sio wa Kisiwani'
        });
      }

      const userClinicId = mtumiaji.clinicId || 'unknown';
      const now = new Date();
      const formattedDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format

      const newMatumizi = validUsages.map(d => ({
        id: nanoid(),
        mtumiajiId,
        mtumiajiJina: mtumiaji.jina,
        maelezo: mtumiaji.maelezo || '',
        dawaId: d.id,
        kiasi: d.kiasi,
        tarehe: d.tarehe || formattedDate, // Standardized date format
        clinicId: userClinicId
      }));

      await writeSheet('MATUMIZI', [...existingMatumizi, ...newMatumizi]);
      return res.redirect('/ripoti/matumizi');

    } catch (error) {
      next(error);
    }
  });

  // User transfer routes
  app.get('/mtumiaji/transfer', async (req, res, next) => {
    try {
      const [watumiaji, clinics] = await Promise.all([
        readSheet('WATUMIAJI'),
        readSheet('CLINICS')
      ]);
      res.render('transfer-user', { watumiaji, clinics });
    } catch (error) {
      next(error);
    }
  });

  app.post('/mtumiaji/transfer', async (req, res, next) => {
    try {
      const { mtumiajiId, newClinicId } = req.body;
      if (!mtumiajiId || !newClinicId) {
        return res.status(400).render('error', { 
          message: 'Mtumiaji na kliniki vipaswa kuchaguliwa' 
        });
      }

      const watumiaji = await readSheet('WATUMIAJI');
      const index = watumiaji.findIndex(u => u.id === mtumiajiId);
      if (index === -1) {
        return res.status(400).render('error', { 
          message: 'Mtumiaji hayupo' 
        });
      }

      watumiaji[index].clinicId = newClinicId;
      await writeSheet('WATUMIAJI', watumiaji);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // Admin users management
  
app.get('/admin/watumiaji', async (req, res, next) => {
  try {
    // Extract query parameters including the new username filter
    const { clinicId, dawaType, dawaContent, selectedMedicine, username } = req.query;

    // 1. Read all data sources
    const [watumiaji, clinics, matumizi, dawa] = await Promise.all([
      readSheet('WATUMIAJI').catch(() => []),
      readSheet('CLINICS').catch(() => []),
      readSheet('MATUMIZI').catch(() => []),
      readSheet('DAWA').catch(() => [])
    ]);

    // 2. Create lookup maps
    const clinicMap = clinics.reduce((map, clinic) => {
      if (clinic?.id) map[clinic.id] = clinic;
      return map;
    }, {});

    const dawaMap = dawa.reduce((map, med) => {
      if (med?.id) map[med.id] = med;
      return map;
    }, {});

    // 3. Initialize statistics
    const stats = {
      totalUsers: watumiaji.length,
      activeUsers: 0,
      inactiveUsers: 0,
      summary: {
        totalConsumption: 0,
        averageUsagePerUser: 0,
        clinicsSummary: []
      },
      medicineUsage: {},
      userUsage: {},
      clinicStats: {},
      usersPerClinic: {},
      allMedicines: dawa.filter(d => d?.id).map(d => ({
        id: d.id,
        jina: d.jina || 'Unknown',
        aina: d.type || 'Unknown',
        remaining: parseInt(d.kilichobaki) || 0
      })),
      mostConsumedMedicines: []
    };

    // 4. Process medicine usage
    const activeUserIds = new Set();
    
    matumizi.forEach(usage => {
      if (!usage?.dawaId || !usage?.mtumiajiId) return;
      
      const medicine = dawaMap[usage.dawaId];
      if (!medicine) return;

      const usageAmount = parseInt(usage.kiasi) || 0;
      const usageDate = usage.tarehe ? new Date(usage.tarehe) : null;
      const user = watumiaji.find(u => u.id === usage.mtumiajiId);
      const clinicId = user?.clinicId;

      if (!user || !clinicId) return;

      // Track active users
      activeUserIds.add(usage.mtumiajiId);

      // Initialize user usage tracking
      if (!stats.userUsage[usage.mtumiajiId]) {
        stats.userUsage[usage.mtumiajiId] = {
          totalUsed: 0,
          medicines: {},
          lastDate: null,
          clinicId: clinicId
        };
      }

      // Update usage totals
      stats.userUsage[usage.mtumiajiId].totalUsed += usageAmount;
      stats.summary.totalConsumption += usageAmount;

      // Track medicine usage per user
      if (!stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId]) {
        stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0,
          lastUsed: null
        };
      }
      
      const userMed = stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId];
      userMed.totalUsed += usageAmount;

      // Update dates
      if (usageDate && !isNaN(usageDate.getTime())) {
        if (!stats.userUsage[usage.mtumiajiId].lastDate || 
            usageDate > stats.userUsage[usage.mtumiajiId].lastDate) {
          stats.userUsage[usage.mtumiajiId].lastDate = usageDate;
        }
        if (!userMed.lastUsed || usageDate > userMed.lastUsed) {
          userMed.lastUsed = usageDate;
        }
      }

      // Track global medicine usage (REMAINING STOCK FIX)
      if (!stats.medicineUsage[usage.dawaId]) {
        stats.medicineUsage[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0,
          remaining: parseInt(dawaMap[usage.dawaId]?.kilichobaki) || 0, // Direct from source
          users: new Set(),
          clinics: new Set()
        };
      }
      
      // Always update remaining from current source
      stats.medicineUsage[usage.dawaId].remaining = parseInt(dawaMap[usage.dawaId]?.kilichobaki) || 0;
      stats.medicineUsage[usage.dawaId].totalUsed += usageAmount;
      stats.medicineUsage[usage.dawaId].users.add(usage.mtumiajiId);
      stats.medicineUsage[usage.dawaId].clinics.add(clinicId);

      // Track clinic-specific usage
      if (!stats.clinicStats[clinicId]) {
        stats.clinicStats[clinicId] = {
          name: clinicMap[clinicId]?.jina || 'Unknown',
          totalUsers: 0,
          activeUsers: 0,
          inactiveUsers: 0,
          medicinesUsed: {},
          totalConsumption: 0
        };
      }
      stats.clinicStats[clinicId].totalConsumption += usageAmount;
      
      if (!stats.clinicStats[clinicId].medicinesUsed[usage.dawaId]) {
        stats.clinicStats[clinicId].medicinesUsed[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0
        };
      }
      stats.clinicStats[clinicId].medicinesUsed[usage.dawaId].totalUsed += usageAmount;
    });

    // 5. Calculate user stats
    stats.activeUsers = activeUserIds.size;
    stats.inactiveUsers = stats.totalUsers - stats.activeUsers;
    
    stats.summary.averageUsagePerUser = stats.activeUsers > 0 
      ? (stats.summary.totalConsumption / stats.activeUsers)
      : 0;

    // 6. Calculate clinic stats
    watumiaji.forEach(user => {
      if (!user?.clinicId) return;
      
      const clinicName = clinicMap[user.clinicId]?.jina || 'Unknown';
      stats.usersPerClinic[clinicName] = (stats.usersPerClinic[clinicName] || 0) + 1;

      if (stats.clinicStats[user.clinicId]) {
        stats.clinicStats[user.clinicId].totalUsers++;
        if (activeUserIds.has(user.id)) {
          stats.clinicStats[user.clinicId].activeUsers++;
        } else {
          stats.clinicStats[user.clinicId].inactiveUsers++;
        }
      }
    });

    // 7. Prepare most consumed medicines
    stats.mostConsumedMedicines = Object.entries(stats.medicineUsage)
      .map(([id, data]) => ({
        id,
        name: data.name,
        totalUsed: data.totalUsed,
        remaining: data.remaining, // Now accurate
        userCount: data.users.size,
        clinicCount: data.clinics.size
      }))
      .sort((a, b) => b.totalUsed - a.totalUsed)
      .slice(0, 5);

    // 8. Prepare clinic summaries
    stats.summary.clinicsSummary = Object.values(stats.clinicStats).map(clinic => {
      const mostUsed = Object.entries(clinic.medicinesUsed)
        .sort((a, b) => b[1].totalUsed - a[1].totalUsed)[0];
      
      return {
        name: clinic.name,
        totalUsers: clinic.totalUsers,
        activeUsers: clinic.activeUsers,
        inactiveUsers: clinic.inactiveUsers,
        totalConsumption: clinic.totalConsumption,
        mostUsedMedicine: mostUsed ? {
          name: mostUsed[1].name,
          amount: mostUsed[1].totalUsed
        } : null,
        usagePercentage: stats.summary.totalConsumption > 0
          ? ((clinic.totalConsumption / stats.summary.totalConsumption) * 100).toFixed(2)
          : '0.00'
      };
    });

    // 9. Prepare user data
    let filteredUsers = watumiaji.map(user => {
      const usage = stats.userUsage[user.id] || {};
      return {
        ...user,
        clinic: clinicMap[user.clinicId]?.jina || 'Unknown',
        totalUsed: usage.totalUsed || 0,
        medicinesUsed: usage.medicines
          ? Object.values(usage.medicines).map(m => `${m.name} (${m.totalUsed})`).join(', ')
          : 'Hajatumia',
        lastUsage: usage.lastDate ? usage.lastDate.toLocaleDateString('sw-TZ') : 'Hajatumia',
        status: usage.totalUsed ? 'Active' : 'Inactive',
        dawaDetails: usage.medicines || {}
      };
    });

    // 10. Apply filters - UPDATED WITH USERNAME SEARCH
    if (clinicId) {
      filteredUsers = filteredUsers.filter(user => user.clinicId === clinicId);
    }
    if (dawaType) {
      filteredUsers = filteredUsers.filter(user => 
        Object.keys(user.dawaDetails).some(dawaId => 
          dawaMap[dawaId]?.type === dawaType
        )
      );
    }
    if (dawaContent) {
  const searchTerm = dawaContent.toLowerCase();
  filteredUsers = filteredUsers.filter(user => 
    Object.values(user.dawaDetails).some(m => 
      m.name.toLowerCase().includes(searchTerm)
    )
  );
}
    // NEW: Username search filter
    if (username) {
  const searchTerm = String(username).trim().toLowerCase();
  filteredUsers = filteredUsers.filter(user => {
    const userName = user.jina ? String(user.jina).trim().toLowerCase() : '';
    return userName.includes(searchTerm);
  });
}

    // 11. Prepare medicine report (with remaining stock fix)
    let selectedMedicineReport = null;
    if (selectedMedicine) {
      const medicineData = dawaMap[selectedMedicine];
      if (medicineData) {
        const medicineUsage = stats.medicineUsage[selectedMedicine] || {
          totalUsed: 0,
          users: new Set(),
          clinics: new Set()
        };

        selectedMedicineReport = {
          name: medicineData.jina || 'Unknown',
          totalUsed: medicineUsage.totalUsed,
          remaining: parseInt(medicineData.kilichobaki) || 0, // Direct from source
          userCount: medicineUsage.users.size,
          clinicCount: medicineUsage.clinics.size,
          users: Array.from(medicineUsage.users).map(userId => {
            const user = watumiaji.find(u => u.id === userId) || {};
            const usage = stats.userUsage[userId]?.medicines[selectedMedicine] || {};
            return {
              id: userId,
              name: user.jina || 'Unknown',
              clinic: clinicMap[user.clinicId]?.jina || 'Unknown',
              amountUsed: usage.totalUsed || 0,
              lastUsed: usage.lastUsed ? usage.lastUsed.toLocaleDateString('sw-TZ') : 'N/A'
            };
          }),
          clinics: Array.from(medicineUsage.clinics).map(clinicId => {
            const clinic = clinicMap[clinicId] || {};
            const clinicUsage = stats.clinicStats[clinicId]?.medicinesUsed[selectedMedicine] || {};
            return {
              id: clinicId,
              name: clinic.jina || 'Unknown',
              amountUsed: clinicUsage.totalUsed || 0
            };
          })
        };
      }
    }

    // 12. Render with all data including username filter
    res.render('wote-watumiaji', {
      watumiaji: filteredUsers,
      clinics: clinics.filter(c => c?.id),
      allMedicines: stats.allMedicines,
      filters: { clinicId, dawaType, dawaContent, selectedMedicine, username }, // Added username
      stats: {
        ...stats,
        selectedMedicine: selectedMedicineReport,
        clinicCount: clinics.length
      },
      formatCount: (count) => count?.toString() || '0',
      formatDecimal: (num) => typeof num === 'number' ? num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : '0.00',
      formatDate: (date) => date ? new Date(date).toLocaleDateString('sw-TZ') : 'N/A'
    });

  } catch (error) {
    console.error('Error in /admin/watumiaji:', error);
    next(error);
  }
});
  
  
    
      
      

    



    
          


  
  
    

    
  

    
// Update the /ripoti/matumizi route

  app.get('/ripoti/matumizi', async (req, res, next) => {
  try {
    const { mode, from, to } = req.query;
    const [allWatumiaji, dawa, matumizi, clinics] = await Promise.all([
      readSheet('WATUMIAJI'),
      readSheet('DAWA'),
      readSheet('MATUMIZI'),
      readSheet('CLINICS')
    ]);

    // Filter users: only show Kisiwani users (clinicId 'C001')
    const watumiaji = allWatumiaji.filter(user => user.clinicId === 'C001');

    let startDate = null;
    let endDate = null;
    const now = new Date();

    // Handle different report modes
    if (mode === 'day' && from) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(from);
      endDate.setHours(23, 59, 59, 999);
    } 
    else if (mode === 'week' && from && to) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    } 
    else if (mode === 'month' && from && to) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    } 
    else if (from && to) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }

    // Filter usage records based on date range
    const filteredMatumizi = startDate
      ? matumizi.filter(m => {
          try {
            const usageDate = new Date(m.tarehe);
            return usageDate >= startDate && usageDate <= endDate;
          } catch (e) {
            return false;
          }
        })
      : matumizi;

    // ... rest of the report generation code ...
    // Format date to Swahili string
    function formatDate(dateStr) {
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Tarehe haijulikani';
        
        return date.toLocaleDateString('sw-TZ', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Africa/Nairobi'
        });
      } catch (e) {
        return 'Tarehe batili';
      }
    }

    // Format time to Swahili string
    function formatTime(dateStr) {
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '--:--';
        
        return date.toLocaleTimeString('sw-TZ', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Nairobi'
        });
      } catch (e) {
        return '--:--';
      }
    }

    const clinicMap = clinics.reduce((acc, c) => {
      acc[c.id] = c.jina;
      return acc;
    }, {});

    // Generate report data
    const report = watumiaji.map(user => {
      const userUsages = filteredMatumizi.filter(m => m.mtumiajiId === user.id);
      const byDate = {};

      userUsages.forEach(usage => {
        const day = formatDate(usage.tarehe);
        if (!byDate[day]) byDate[day] = [];

        const medicine = dawa.find(d => d.id === usage.dawaId);
        const formattedTime = formatTime(usage.tarehe);
        const clinicName = clinicMap[usage.clinicId] || 'Haijulikani';

        byDate[day].push({
          dawa: medicine ? medicine.jina : 'Haijulikani',
          kiasi: usage.kiasi,
          saa: formattedTime,
          kliniki: clinicName
        });
      });

      return {
        jina: user.jina,
        matumiziByDate: byDate
      };
    });

    res.render('report-usage', {
      report,
      mode,
      from,
      to,
      query: {
        aina: mode,
        start: from,
        end: to
      }
    });
  } catch (error) {
    next(error);
  }
});
      

      
      

      

  // Description dump route
  app.get('/admin/maelezo-dump', async (req, res, next) => {
    try {
      const watumiaji = await readSheet('WATUMIAJI');
      const dump = watumiaji.map(u => ({
        jina: u.jina,
        maelezo: u.maelezo || '[hakuna]',
        length: (u.maelezo || '').length
      }));

      res.render('maelezo-dump', { dump });
    } catch (error) {
      next(error);
    }
  });

  // Error handling routes
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err);
    res.status(500).render('error', {
      message: 'Kuna tatizo la seva. Tafadhali jaribu tena baadaye.'
    });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo unatumika kwenye http://localhost:${PORT}`);
  });
}

startApp().catch(error => {
  console.error('💥 Failed to start application:', error);
  process.exit(1);
});
