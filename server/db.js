require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL env var is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
});

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function queryOne(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return { rowCount: res.rowCount, rows: res.rows };
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../schema-pg.sql'), 'utf8');
  await pool.query(sql);
  console.log('✓ PostgreSQL schema ready');
}

module.exports = { query, queryOne, run, pool, initSchema };
