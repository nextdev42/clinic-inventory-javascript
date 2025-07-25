import express from 'express';
import { readSheet } from '../utils/excel.js';

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});
