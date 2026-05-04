const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "myapp",
  user: "postgres",
  password: "admin", // Твій пароль
});

// Функція для автоматичного створення потрібних таблиць
const initDB = async () => {
  try {
    // 1. Створюємо таблицю користувачів (якщо раптом її немає)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);

    // 2. Створюємо таблицю нотаток для Лабораторної №3
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ База даних налаштована: таблиці users та notes готові.");
  } catch (err) {
    console.error("❌ Помилка при ініціалізації бази даних:", err);
  }
};

initDB();

module.exports = pool;