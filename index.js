const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");
const { authRouter, requireAuth } = require("./auth");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({ pool: pool, createTableIfMissing: true }),
  secret: "my_super_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(function (req, res, next) {
  res.locals.sessionUser = req.session.username || null;
  next();
});

app.use("/auth", authRouter);

// --- МАРШРУТИ ДЛЯ НОТАТОК (CRUD) ---

// 1. Отримати всі нотатки користувача
app.get("/notes", requireAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM notes WHERE user_id = $1 ORDER BY id DESC", [req.session.userId]);
        let notesHtml = result.rows.map(n => `
            <div style="border: 1px solid #ccc; padding: 10px; margin-bottom: 10px;">
                <h3>${n.title}</h3>
                <p>${n.content}</p>
                <form action="/notes/${n.id}/delete" method="POST" style="display:inline;">
                    <button type="submit" style="color:red;">Видалити</button>
                </form>
            </div>
        `).join("");

        res.send(`
            <h1>Ваші нотатки, ${req.session.username}</h1>
            <a href="/notes/new">+ Додати нову нотатку</a> | <a href="/">На головну</a>
            <hr>
            ${notesHtml || "<p>У вас ще немає нотаток.</p>"}
        `);
    } catch (err) {
        res.status(500).send("Помилка завантаження нотаток: " + err.message);
    }
});

// 2. Форма створення нотатки
app.get("/notes/new", requireAuth, (req, res) => {
    res.send(`
        <h1>Нова нотатка</h1>
        <form action="/notes" method="POST">
            <input type="text" name="title" placeholder="Заголовок" required><br><br>
            <textarea name="content" placeholder="Текст нотатки" required></textarea><br><br>
            <button type="submit">Зберегти</button>
        </form>
        <br><a href="/notes">Назад до списку</a>
    `);
});

// 3. Збереження нової нотатки
app.post("/notes", requireAuth, async (req, res) => {
    const { title, content } = req.body;
    try {
        await pool.query("INSERT INTO notes (title, content, user_id) VALUES ($1, $2, $3)", [title, content, req.session.userId]);
        res.redirect("/notes");
    } catch (err) {
        res.status(500).send("Помилка збереження: " + err.message);
    }
});

// 4. Видалення нотатки
app.post("/notes/:id/delete", requireAuth, async (req, res) => {
    try {
        await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
        res.redirect("/notes");
    } catch (err) {
        res.status(500).send("Помилка видалення: " + err.message);
    }
});

// --- ГОЛОВНА СТОРІНКА ---
app.get("/", requireAuth, function (req, res) {
    res.send(`
        <h1>Вітаємо, ${req.session.username}!</h1>
        <p>Ви успішно увійшли в систему.</p>
        <a href="/notes" style="font-size: 20px; font-weight: bold;">Перейти до моїх нотаток 📝</a>
        <br><br>
        <form action="/auth/logout" method="POST">
            <button type="submit">Вийти</button>
        </form>
    `);
});

app.get("/api/status", (req, res) => {
  res.json({ status: "ok", message: "Backend is running and DB is connected" });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер працює на http://localhost:${PORT}`);
});