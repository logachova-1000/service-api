const rateLimit = require('express-rate-limit');
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("./db");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 10, // максимум 10 спроб
  message: 'Забагато спроб входу. Спробуйте через 15 хвилин.',
  standardHeaders: true,
  legacyHeaders: false,
});
// Форма реєстрації (тимчасова, поки немає EJS)
router.get("/register", (req, res) => {
  res.send(`
    <h2>Реєстрація</h2>
    <form action="/auth/register" method="POST">
      <input type="text" name="username" placeholder="Логін" required><br>
      <input type="email" name="email" placeholder="Email" required><br>
      <input type="password" name="password" placeholder="Пароль" required><br>
      <input type="password" name="confirmPassword" placeholder="Повторіть пароль" required><br>
      <button type="submit">Зареєструватися</button>
    </form>
  `);
});

// Реєстрація користувача
router.post("/register", async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;
  if (password !== confirmPassword) return res.status(400).send("Паролі не співпадають");

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *",
      [username, email, hashedPassword]
    );
    req.session.userId = newUser.rows[0].id;
    req.session.username = newUser.rows[0].username;
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Помилка: користувач вже існує");
  }
});

// Форма входу
router.get("/login", (req, res) => {
  res.send(`
    <h2>Вхід</h2>
    <form action="/auth/login" method="POST">
      <input type="email" name="email" placeholder="Email" required><br>
      <input type="password" name="password" placeholder="Пароль" required><br>
      <button type="submit">Увійти</button>
    </form>
  `);
});

// Вхід користувача
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userResult.rows.length === 0) return res.status(400).send("Користувача не знайдено");

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect("/");
    } else {
      res.status(400).send("Невірний пароль");
    }
  } catch (err) {
    res.status(500).send("Помилка сервера");
  }
});

// Вихід
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/auth/login"));
});

// Middleware для захисту сторінок
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect("/auth/register"); // Якщо не залогінений — на реєстрацію
}

module.exports = { authRouter: router, requireAuth };