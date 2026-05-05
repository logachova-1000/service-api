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

// --- МАРШРУТИ ДЛЯ НОТАТОК ---

// 1. СТАТИСТИКА (Лабораторна №5)
app.get("/notes/stats", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        const statsQuery = `
            SELECT 
                COUNT(*) as total_notes,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7_days,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as last_30_days,
                ROUND(AVG(LENGTH(content))) as avg_length,
                (SELECT title FROM notes WHERE user_id = $1 ORDER BY LENGTH(title) DESC LIMIT 1) as longest_title,
                COUNT(*) FILTER (WHERE id NOT IN (SELECT note_id FROM note_tags)) as notes_without_tags
            FROM notes 
            WHERE user_id = $1;
        `;

        const tagsQuery = `
            SELECT t.name, COUNT(nt.note_id) as count
            FROM tags t
            JOIN note_tags nt ON t.id = nt.tag_id
            WHERE t.user_id = $1
            GROUP BY t.name
            ORDER BY count DESC
            LIMIT 5;
        `;

        const stats = await pool.query(statsQuery, [userId]);
        const topTags = await pool.query(tagsQuery, [userId]);
        const s = stats.rows[0];

        res.send(`
            <h1>📊 Статистика ваших нотаток</h1>
            <a href="/notes">← Назад до нотаток</a>
            <hr>
            <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; line-height: 2;">
                <p><b>Загальна кількість нотаток:</b> ${s.total_notes}</p>
                <p><b>За останні 7 днів:</b> ${s.last_7_days}</p>
                <p><b>За останні 30 днів:</b> ${s.last_30_days}</p>
                <p><b>Нотаток без тегів:</b> ${s.notes_without_tags}</p>
                <p><b>Середня довжина тіла нотатки:</b> ${s.avg_length || 0} символів</p>
                <p><b>Нотатка з найдовшим заголовком:</b> "${s.longest_title || '—'}"</p>
            </div>

            <h3>🔝 Топ-5 найпопулярніших тегів:</h3>
            <ul>
                ${topTags.rows.map(t => `<li><a href="/notes?tag=${t.name}">${t.name}</a> (${t.count})</li>`).join('') || 'Тегів поки немає'}
            </ul>
        `);
    } catch (err) {
        res.status(500).send("Помилка статистики: " + err.message);
    }
});

// 2. Список нотаток (Фільтрація, Пошук, Пагінація)
app.get("/notes", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        let { search = '', period = 'all', sort = 'newest', page = 1, limit = 10, tag = '' } = req.query;

        page = Math.max(1, parseInt(page) || 1);
        limit = [5, 10, 20, 50].includes(parseInt(limit)) ? parseInt(limit) : 10;
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT DISTINCT n.* FROM notes n
            LEFT JOIN note_tags nt ON n.id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.id
            WHERE n.user_id = $1
        `;
        let queryParams = [userId];

        if (search) {
            queryParams.push(`%${search}%`);
            queryText += ` AND (n.title ILIKE $${queryParams.length} OR n.content ILIKE $${queryParams.length})`;
        }

        if (tag) {
            queryParams.push(tag);
            queryText += ` AND t.name = $${queryParams.length}`;
        }

        if (period === '7d') queryText += ` AND n.created_at > NOW() - INTERVAL '7 days'`;
        else if (period === '30d') queryText += ` AND n.created_at > NOW() - INTERVAL '30 days'`;

        const sortOrder = sort === 'oldest' ? 'ASC' : 'DESC';
        queryText += ` ORDER BY n.created_at ${sortOrder} LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const result = await pool.query(queryText, queryParams);

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
            <h1>Ваші нотатки, ${req.session.username} ${tag ? `(Фільтр: #${tag})` : ''}</h1>
            
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
                <button type="submit">Apply</button>
                <a href="/notes">Reset</a>
            </form>

            <a href="/notes/new">+ Додати нотатку</a> | 
            <a href="/notes/stats">Статистика 📊</a> |
            <a href="/notes/export.csv?search=${search}&period=${period}&sort=${sort}">Export CSV 📥</a> |
            <a href="/">На головну</a>
            <hr>

            ${notesHtml || "<p>Нічого не знайдено.</p>"}

            <div style="margin-top: 20px;">
                <a href="/notes?page=${page - 1}&limit=${limit}&search=${search}&period=${period}&sort=${sort}&tag=${tag}" ${page <= 1 ? 'style="pointer-events: none; color: gray;"' : ''}>Prev</a>
                <span> Сторінка ${page} </span>
                <a href="/notes?page=${page + 1}&limit=${limit}&search=${search}&period=${period}&sort=${sort}&tag=${tag}">Next</a>
            </div>
        `);
    } catch (err) {
        res.status(500).send("Помилка завантаження: " + err.message);
    }
});

// 3. Форма створення (з тегами)
app.get("/notes/new", requireAuth, (req, res) => {
    res.send(`
        <h1>Нова нотатка</h1>
        <form action="/notes" method="POST">
            <input type="text" name="title" placeholder="Заголовок" required style="width: 300px;"><br><br>
            <textarea name="content" placeholder="Текст нотатки" required style="width: 300px; height: 100px;"></textarea><br><br>
            <input type="text" name="tags" placeholder="Теги (через кому)" style="width: 300px;"><br><br>
            <button type="submit">Зберегти</button>
        </form>
        <br><a href="/notes">Назад до списку</a>
    `);
});

// 4. Збереження нотатки + теги (Транзакція)
app.post("/notes", requireAuth, async (req, res) => {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const noteResult = await client.query(
            "INSERT INTO notes (title, content, user_id) VALUES ($1, $2, $3) RETURNING id", 
            [title, content, userId]
        );
        const noteId = noteResult.rows[0].id;

        if (tags && tags.trim().length > 0) {
            const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t !== "");
            for (let tagName of tagList) {
                const tagResult = await client.query(
                    "INSERT INTO tags (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                    [userId, tagName]
                );
                const tagId = tagResult.rows[0].id;
                await client.query(
                    "INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    [noteId, tagId]
                );
            }
        }
        await client.query('COMMIT');
        res.redirect("/notes");
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).send("Помилка збереження: " + err.message);
    } finally {
        client.release();
    }
});

// 5. Експорт CSV
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
        let csv = "Title,Content,Date\n";
        result.rows.forEach(r => {
            csv += `"${r.title.replace(/"/g, '""')}","${r.content.replace(/"/g, '""')}","${r.created_at.toISOString()}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=notes.csv');
        res.status(200).send(csv);
    } catch (err) { res.status(500).send("Помилка експорту"); }
});

// 6. Видалення
app.post("/notes/:id/delete", requireAuth, async (req, res) => {
    try {
        await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
        res.redirect("/notes");
    } catch (err) { res.status(500).send("Помилка видалення: " + err.message); }
});

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