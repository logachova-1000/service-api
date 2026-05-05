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

// --- МАРШРУТИ ДЛЯ НОТАТОК (ОНОВЛЕНО ДЛЯ ЛАБ №4) ---

// 1. Отримати список нотаток (Фільтрація, Пошук, Сортування, Пагінація)
app.get("/notes", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        
        // Отримуємо параметри з посилання (query params)
        let { search = '', period = 'all', sort = 'newest', page = 1, limit = 10 } = req.query;

        // Нормалізація значень (вимога лаби)
        page = Math.max(1, parseInt(page) || 1);
        limit = [5, 10, 20, 50].includes(parseInt(limit)) ? parseInt(limit) : 10;
        const offset = (page - 1) * limit;

        // Базовий SQL запит (Ізоляція по user_id)
        let queryText = `SELECT * FROM notes WHERE user_id = $1`;
        let queryParams = [userId];

        // Додаємо пошук по title та content (в твоєму коді поле називається content)
        if (search) {
            queryParams.push(`%${search}%`);
            queryText += ` AND (title ILIKE $${queryParams.length} OR content ILIKE $${queryParams.length})`;
        }

        // Додаємо фільтр за періодом
        if (period === '7d') {
            queryText += ` AND created_at > NOW() - INTERVAL '7 days'`;
        } else if (period === '30d') {
            queryText += ` AND created_at > NOW() - INTERVAL '30 days'`;
        }

        // Додаємо сортування
        const sortOrder = sort === 'oldest' ? 'ASC' : 'DESC';
        queryText += ` ORDER BY created_at ${sortOrder}`;

        // Додаємо пагінацію
        queryParams.push(limit, offset);
        queryText += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;

        const result = await pool.query(queryText, queryParams);

        // Малюємо форму фільтрів та список (Дизайн згідно ТЗ)
        let notesHtml = result.rows.map(n => `
            <div style="border: 1px solid #ccc; padding: 10px; margin-bottom: 10px;">
                <h3>${n.title}</h3>
                <p>${n.content}</p>
                <small>${n.created_at.toLocaleString()}</small>
                <form action="/notes/${n.id}/delete" method="POST" style="display:inline;">
                    <button type="submit" style="color:red;">Видалити</button>
                </form>
            </div>
        `).join("");

        res.send(`
            <h1>Ваші нотатки, ${req.session.username}</h1>
            
            <form action="/notes" method="GET" style="background: #f4f4f4; padding: 15px; margin-bottom: 20px;">
                <input type="text" name="search" placeholder="Пошук..." value="${search}">
                <select name="period">
                    <option value="all" ${period === 'all' ? 'selected' : ''}>За весь час</option>
                    <option value="7d" ${period === '7d' ? 'selected' : ''}>Останні 7 днів</option>
                    <option value="30d" ${period === '30d' ? 'selected' : ''}>Останні 30 днів</option>
                </select>
                <select name="sort">
                    <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Нові спочатку</option>
                    <option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Старі спочатку</option>
                </select>
                <select name="limit">
                    <option value="5" ${limit === 5 ? 'selected' : ''}>5</option>
                    <option value="10" ${limit === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${limit === 20 ? 'selected' : ''}>20</option>
                </select>
                <button type="submit">Apply</button>
                <a href="/notes">Reset</a>
            </form>

            <a href="/notes/new">+ Додати нову нотатку</a> | 
            <a href="/notes/export.csv?search=${search}&period=${period}&sort=${sort}">Export CSV 📥</a> |
            <a href="/">На головну</a>
            <hr>

            ${notesHtml || "<p>Нічого не знайдено.</p>"}

            <div style="margin-top: 20px;">
                <a href="/notes?page=${page - 1}&limit=${limit}&search=${search}&period=${period}&sort=${sort}" ${page <= 1 ? 'style="pointer-events: none; color: gray;"' : ''}>Prev</a>
                <span> Сторінка ${page} </span>
                <a href="/notes?page=${page + 1}&limit=${limit}&search=${search}&period=${period}&sort=${sort}">Next</a>
            </div>
        `);
    } catch (err) {
        res.status(500).send("Помилка завантаження: " + err.message);
    }
});

// 2. Експорт у CSV
app.get("/notes/export.csv", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        let { search = '', period = 'all', sort = 'newest' } = req.query;

        let queryText = `SELECT title, content, created_at FROM notes WHERE user_id = $1`;
        let queryParams = [userId];

        if (search) {
            queryParams.push(`%${search}%`);
            queryText += ` AND (title ILIKE $${queryParams.length} OR content ILIKE $${queryParams.length})`;
        }
        if (period === '7d') queryText += ` AND created_at > NOW() - INTERVAL '7 days'`;
        if (period === '30d') queryText += ` AND created_at > NOW() - INTERVAL '30 days'`;
        
        const sortOrder = sort === 'oldest' ? 'ASC' : 'DESC';
        queryText += ` ORDER BY created_at ${sortOrder}`;

        const result = await pool.query(queryText, queryParams);

        // Формуємо CSV контент
        let csv = "Title,Content,Date\n";
        result.rows.forEach(r => {
            csv += `"${r.title.replace(/"/g, '""')}","${r.content.replace(/"/g, '""')}","${r.created_at.toISOString()}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=notes.csv');
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).send("Помилка експорту");
    }
});

// 3. Форма створення нотатки
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

// 4. Збереження нової нотатки
app.post("/notes", requireAuth, async (req, res) => {
    const { title, content } = req.body;
    try {
        await pool.query("INSERT INTO notes (title, content, user_id) VALUES ($1, $2, $3)", [title, content, req.session.userId]);
        res.redirect("/notes");
    } catch (err) {
        res.status(500).send("Помилка збереження: " + err.message);
    }
});

// 5. Видалення нотатки
app.post("/notes/:id/delete", requireAuth, async (req, res) => {
    try {
        await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
        res.redirect("/notes");
    } catch (err) {
        res.status(500).send("Помилка видалення: " + err.message);
    }
});

// --- ІНШІ МАРШРУТИ (БЕЗ ЗМІН) ---

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