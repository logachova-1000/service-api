const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");
const { authRouter, requireAuth } = require("./auth");

// --- ПІДКЛЮЧЕННЯ МОДУЛІВ ДЛЯ ЛАБИ №6 ---
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises; // Для роботи з файлами (читання JSON та видалення старих аватарок)

const app = express();
const PORT = 3000;

// ==========================================
// НАЛАШТУВАННЯ MULTER ДЛЯ АВАТАРОК
// ==========================================
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/avatars/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
});

const avatarFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Недопустимий формат файлу! Дозволено лише JPEG, PNG та WebP.'), false);
    }
};

const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // Обмеження 2 МБ
    fileFilter: avatarFilter
});

// ==========================================
// НАЛАШТУВАННЯ MULTER ДЛЯ ІМПОРТУ JSON
// ==========================================
const importStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/imports/');
    },
    filename: (req, file, cb) => {
        cb(null, `import-${Date.now()}-${file.originalname}`);
    }
});

const importFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.json') {
        cb(null, true);
    } else {
        cb(new Error('Помилка: Дозволено завантажувати лише файли формату JSON!'), false);
    }
};

const uploadImport = multer({
    storage: importStorage,
    limits: { fileSize: 1 * 1024 * 1024 }, // Обмеження 1 МБ
    fileFilter: importFilter
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Робимо папку uploads доступною для браузера (статичний маршрут)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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


// ==========================================
// ЛАБА №6: МАРШРУТИ ДЛЯ АВАТАРОК КОРИСТУВАЧА
// ==========================================

// 1. СТОРИНКА ПРОФІЛЮ (Відображення даних та аватара)
app.get("/profile", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const result = await pool.query("SELECT email, avatar FROM users WHERE id = $1", [userId]);
        const user = result.rows[0];

        const avatarHtml = user.avatar 
            ? `<img src="/uploads/avatars/${user.avatar}" alt="Avatar" style="width:150px; height:150px; border-radius:50%; object-fit:cover; border: 2px solid #ccc;"><br>`
            : `<div style="width:150px; height:150px; border-radius:50%; background:#ddd; display:flex; align-items:center; justify-content:center; color:#666; font-weight:bold; margin-bottom:10px;">Немає аватара</div>`;

        res.send(`
            <h1>👤 Профіль користувача</h1>
            <a href="/notes">← До нотаток</a> | <a href="/">На головну</a>
            <hr>
            
            <div style="margin-bottom: 20px;">
                ${avatarHtml}
                <p><b>Ваш Email:</b> ${user.email}</p>
                <p><b>Ваш логін:</b> ${req.session.username}</p>
            </div>

            <hr>
            <h3>Завантажити новий аватар (макс. 2МБ, тільки JPEG/PNG/WebP):</h3>
            <form action="/profile/avatar" method="POST" enctype="multipart/form-data">
                <input type="file" name="avatar" accept="image/*" required><br><br>
                <button type="submit">Оновити аватарку</button>
            </form>

            ${user.avatar ? `
                <br>
                <form action="/profile/avatar/delete" method="POST">
                    <button type="submit" style="color:red;">Видалити аватарку ❌</button>
                </form>
            ` : ''}
        `);
    } catch (err) {
        res.status(500).send("Помилка завантаження профілю: " + err.message);
    }
});

// 2. ОБРОБКА ЗАВАНТАЖЕННЯ АВАТАРА
app.post("/profile/avatar", requireAuth, (req, res) => {
    uploadAvatar.single('avatar')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send("Помилка: Файл занадто великий! Максимальний розмір — 2 МБ.");
            }
            return res.status(400).send("Помилка завантаження: " + err.message);
        } else if (err) {
            return res.status(400).send(err.message);
        }

        if (!req.file) {
            return res.status(400).send("Будь ласка, виберіть файл для завантаження.");
        }

        try {
            const userId = req.session.userId;
            const userResult = await pool.query("SELECT avatar FROM users WHERE id = $1", [userId]);
            const oldAvatar = userResult.rows[0].avatar;

            if (oldAvatar) {
                const oldPath = path.join(__dirname, 'uploads', 'avatars', oldAvatar);
                await fs.unlink(oldPath).catch(() => console.log("Старий файл не знайдено на диску"));
            }

            await pool.query("UPDATE users SET avatar = $1 WHERE id = $2", [req.file.filename, userId]);
            res.redirect("/profile");
        } catch (dbErr) {
            res.status(500).send("Помилка збереження в БД: " + dbErr.message);
        }
    });
});

// 3. ВИДАЛЕННЯ АВАТАРА
app.post("/profile/avatar/delete", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const userResult = await pool.query("SELECT avatar FROM users WHERE id = $1", [userId]);
        const currentAvatar = userResult.rows[0].avatar;

        if (currentAvatar) {
            const filePath = path.join(__dirname, 'uploads', 'avatars', currentAvatar);
            await fs.unlink(filePath).catch(() => console.log("Файл на диску не знайдено"));
            await pool.query("UPDATE users SET avatar = NULL WHERE id = $1", [userId]);
        }
        res.redirect("/profile");
    } catch (err) {
        res.status(500).send("Помилка видалення аватара: " + err.message);
    }
});


// ==========================================
// ЛАБА №6: МАРШРУТИ ДЛЯ ІМПОРТУ НОТАТОК (JSON)
// ==========================================

// 1. ФОРМА ІМПОРТУ
app.get("/notes/import", requireAuth, (req, res) => {
    res.send(`
        <h1>📥 Імпорт нотаток з JSON</h1>
        <a href="/notes">← Назад до списку нотаток</a>
        <hr>
        <p>Виберіть файл у форматі <b>.json</b>, який містить масив нотаток.</p>
        <p>Приклад структури файлу:</p>
        <pre style="background: #eee; padding: 10px; inline-size: max-content; border-radius: 5px;">
[
  { "title": "Купити хліб", "content": "Молоко, батон, сир" },
  { "title": "Важливе завдання", "content": "Зробити лабораторну роботу №6" }
]
        </pre>
        <br>
        <form action="/notes/import" method="POST" enctype="multipart/form-data">
            <input type="file" name="importFile" accept=".json" required><br><br>
            <button type="submit">Почати імпорт 🚀</button>
        </form>
    `);
});

// 2. ОБРОБКА ЗАВАНТАЖЕННЯ ТА ІМПОРТУ (ТРАНЗАКЦІЯ)
app.post("/notes/import", requireAuth, (req, res) => {
    uploadImport.single('importFile')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send("Помилка: Файл занадто великий! Максимальний розмір JSON — 1 МБ.");
            }
            return res.status(400).send("Помилка файлу: " + err.message);
        } else if (err) {
            return res.status(400).send(err.message);
        }

        if (!req.file) {
            return res.status(400).send("Будь ласка, виберіть JSON файл для імпорту.");
        }

        const client = await pool.connect();
        try {
            // Читаємо вміст завантаженого файлу з диска
            const fileContent = await fs.readFile(req.file.path, 'utf-8');
            const notesArray = JSON.parse(fileContent);

            // Перевіряємо, чи це дійсно масив
            if (!Array.isArray(notesArray)) {
                throw new Error("Некоректний формат JSON. Корінь файлу повинен бути масивом `[]`.");
            }

            const userId = req.session.userId;

            // --- ЗАПУСКАЄМО SQL ТРАНЗАКЦІЮ ---
            await client.query('BEGIN');

            for (let note of notesArray) {
                if (!note.title || !note.content) {
                    throw new Error("Кожна нотатка в JSON повинна мати обов'язкові поля 'title' та 'content'!");
                }
                
                // Вставляємо нотатку в базу
                await client.query(
                    "INSERT INTO notes (title, content, user_id) VALUES ($1, $2, $3)",
                    [note.title, note.content, userId]
                );
            }

            // Якщо все пройшло успішно — зберігаємо зміни в базі даних
            await client.query('COMMIT');

            // Видаляємо тимчасовий файл з диска, бо дані вже в базі
            await fs.unlink(req.file.path).catch(() => {});

            res.send(`
                <h1 style="color: green;">🎉 Імпорт завершено успішно!</h1>
                <p>Усі нотатки (кількість: <b>${notesArray.length}</b>) були імпортовані в базу даних за допомогою транзакції.</p>
                <br>
                <a href="/notes" style="font-size: 18px; font-weight: bold;">← Перейти до списку нотаток</a>
            `);

        } catch (processErr) {
            // Якщо сталася будь-яка помилка — повністю відкочуємо транзакцію!
            await client.query('ROLLBACK');
            
            // Видаляємо тимчасовий файл з диска у разі невдачі
            if (req.file && req.file.path) {
                await fs.unlink(req.file.path).catch(() => {});
            }

            res.status(400).send(`
                <h1 style="color: red;">❌ Помилка імпорту (Транзакція скасована)</h1>
                <p>Жодна нотатка не була додана в базу даних.</p>
                <p><b>Причина помилки:</b> ${processErr.message}</p>
                <br>
                <a href="/notes/import">Спробувати ще раз</a>
            `);
        } finally {
            client.release();
        }
    });
});


// --- МАРШРУТИ ДЛЯ НОТАТОК (Лаби 1-5) ---

// 1. СТАТИСТИКА
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
            <a href="/notes/import" style="color: green; font-weight: bold;">Імпорт JSON 📥</a> | 
            <a href="/notes/stats">Статистика 📊</a> |
            <a href="/profile">Мій Профіль 👤</a> |
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

// 6. Видалення нотатки
app.post("/notes/:id/delete", requireAuth, async (req, res) => {
    try {
        await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
        res.redirect("/notes");
    } catch (err) { res.status(500).send("Помилка видалення: " + err.message); }
});

// ГОЛОВНА СТОРІНКА
app.get("/", requireAuth, function (req, res) {
    res.send(`
        <h1>Вітаємо, ${req.session.username}!</h1>
        <p>Ви успішно увійшли в систему.</p>
        <a href="/notes" style="font-size: 20px; font-weight: bold;">Перейти до моїх нотаток 📝</a><br><br>
        <a href="/profile" style="font-size: 16px;">Перейти в Профіль (Аватарка) 👤</a>
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