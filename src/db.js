import mysql from 'mysql2/promise';
import { AppError } from './lib/errors.js';

export function createDatabase(url = process.env.DATABASE_URL) {
  const pool = url ? mysql.createPool({ uri: url, connectionLimit: 10, timezone: 'Z', charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }) : null;
  // Driver date conversion alone does not change MySQL's CURRENT_TIMESTAMP timezone.
  if(pool)pool.on('connection',connection=>connection.query("SET time_zone = '+00:00'",error=>{if(error)connection.destroy();}));
  return {
    pool,
    async query(sql, values = []) {
      if (!pool) throw new AppError(503, 'Configure DATABASE_URL and run the database migration first.');
      return (await pool.execute(sql, values))[0];
    },
    async transaction(work) {
      if (!pool) throw new AppError(503, 'Configure DATABASE_URL and run the database migration first.');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const query = async (sql, values = []) => (await connection.execute(sql, values))[0];
        const result = await work(query);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
    async close() { if (pool) await pool.end(); }
  };
}
