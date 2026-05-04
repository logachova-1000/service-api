const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");
const { authRouter, requireAuth } = require("./auth"); // Імпортуємо логіку з auth.js

const app = express();
const PORT = 3000;

// 1. Міддлвари для обробки даних
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Налаштування сесій
app.use(session({
  store: new pgSession({
    pool: pool,
    createTableIfMissing: true, // Автоматично створить таблицю session у базі
  }),
  secret: "my_super_secret_key", 
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // Сесія на 7 днів
}));

// 3. Передача даних сесії в локальні змінні (для фронтенду)
app.use(function (req, res, next) {
  res.locals.sessionUser = req.session.username || null;
  next();
});

// 4. Підключаємо маршрути автентифікації
app.use("/auth", authRouter);

// 5. Захищений головний маршрут (Крок 7)
// Якщо користувач не залогінений, requireAuth перекине його на /auth/login
app.get("/", requireAuth, function (req, res, next) {
    res.send(`
        <h1>Вітаємо, ${req.session.username}!</h1>
        <p>Ви успішно увійшли в систему.</p>
        <form action="/auth/logout" method="POST">
            <button type="submit">Вийти</button>
        </form>
    `);
});

// 6. Статус API (з першої лаби)
app.get("/api/status", (req, res) => {
  res.json({ status: "ok", message: "Backend is running and DB is connected" });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер працює на http://localhost:${PORT}`);
});