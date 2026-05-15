const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const rateLimit = require("express-rate-limit");

const app = express();
app.set('trust proxy', 1);
const JWT_SECRET = "webboard_secret_key";

app.use(cors({
  origin: [
    'https://watcharapongxweb.github.io',
    'https://darling-douhua-b5a67d.netlify.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.options('*', cors());
app.use(express.json());

// ===========================
// RATE LIMITING
// ===========================
const postLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: { message: "คุณสร้างโพสต์บ่อยเกินไป กรุณารอสักครู่" }
});
const commentLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: { message: "คุณส่งความคิดเห็นบ่อยเกินไป กรุณารอสักครู่" }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที" }
});

// ===========================
// CLOUDINARY CONFIG
// ===========================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cloudStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        console.log("Cloudinary upload start:", file.originalname);
       return {
    folder: "webboard",
};
    },
});
        

const upload = multer({
    storage: cloudStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น"));
    },
});

// ===========================
// DATABASE CONNECTION
// ===========================
const db = mysql.createPool({
    host: process.env.MYSQLHOST || "localhost",
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "",
    database: process.env.MYSQLDATABASE || "webboard_db",
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.log("MYSQL CONNECT ERROR => ", err);
    } else {
        console.log("MySQL Connected");
        connection.release();

        // Auto-create tables if not exists
       db.query(`CREATE TABLE IF NOT EXISTS bookmarks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            post_id INT NOT NULL,
            user_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_bookmark (post_id, user_id)
        )`, (err) => {
            if (err) console.error('Create bookmarks table error:', err);
            else console.log('bookmarks table ready');
        });
    }
});



// ===========================
// JWT MIDDLEWARE
// ===========================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ" });
        req.user = decoded;
        next();
    });
};

const adminOnly = (req, res, next) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    next();
};

// ===========================
// HOME
// ===========================
app.get("/", (req, res) => {
    res.json({ message: "Modern Web Board API is running 🚀", version: "1.0.0" });
});

// ===========================
// REGISTER
// ===========================
app.post("/api/auth/register", authLimiter, async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    if (password.length < 6)
        return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });

    try {
        db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username], async (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            if (results.length > 0)
                return res.status(409).json({ message: "อีเมลหรือชื่อผู้ใช้นี้ถูกใช้แล้ว" });

            const hashedPassword = await bcrypt.hash(password, 10);
            db.query("INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
                [username, email, hashedPassword],
                (err, result) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.status(201).json({ message: "สมัครสมาชิกสำเร็จ", userId: result.insertId });
                }
            );
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===========================
// LOGIN
// ===========================
app.post("/api/auth/login", authLimiter, (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ message: "กรุณากรอกอีเมลและรหัสผ่าน" });

    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0)
            return res.status(401).json({ message: "ไม่พบอีเมลนี้ในระบบ" });

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: "7d" }
        );
        res.json({
            message: "เข้าสู่ระบบสำเร็จ", token,
            user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
    });
});

// ===========================
// CATEGORIES
// ===========================
app.get("/api/categories", (req, res) => {
    db.query("SELECT * FROM categories ORDER BY name", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ===========================
// GET ALL POSTS
// ===========================
app.get("/api/posts", (req, res) => {
    const { search, category, sort = "latest", page = 1, limit = 10, user_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = [], params = [];

    if (search) {
        where.push("(p.title LIKE ? OR p.content LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
        where.push("c.slug = ?");
        params.push(category);
    }
    if (user_id) {
        where.push("p.user_id = ?");
        params.push(parseInt(user_id));
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const orderMap = { latest: "p.created_at DESC", trending: "like_count DESC", views: "p.views DESC" };
    const orderBy = orderMap[sort] || "p.created_at DESC";

    const sql = `
        SELECT p.id, p.title, p.content, p.image, p.views, p.created_at, p.user_id,
               u.id AS author_id, u.username, u.avatar,
               c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
               COUNT(DISTINCT l.id) AS like_count,
               COUNT(DISTINCT cm.id) AS comment_count
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments cm ON p.id = cm.post_id
        ${whereClause}
        GROUP BY p.id
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `;

    db.query(sql, [...params, parseInt(limit), offset], (err, posts) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query(
            `SELECT COUNT(DISTINCT p.id) AS total FROM posts p LEFT JOIN categories c ON p.category_id = c.id ${whereClause}`,
            params,
            (err, countResult) => {
                if (err) return res.status(500).json({ error: err.message });
                const total = countResult[0].total;
                res.json({ posts, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
            }
        );
    });
});

// ===========================
// GET TRENDING POSTS
// ===========================
app.get("/api/posts/trending", (req, res) => {
    const sql = `
        SELECT p.id, p.title, u.username,
               COUNT(l.id) AS like_count,
               COUNT(cm.id) AS comment_count
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments cm ON p.id = cm.post_id
        GROUP BY p.id
        ORDER BY like_count DESC
        LIMIT 5
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ===========================
// GET SINGLE POST + COMMENTS
// ===========================
app.get("/api/posts/:id", (req, res) => {
    db.query("UPDATE posts SET views = views + 1 WHERE id = ?", [req.params.id]);
    const sql = `
        SELECT p.*, u.username, u.avatar,
               c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
               COUNT(DISTINCT l.id) AS like_count
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN likes l ON p.id = l.post_id
        WHERE p.id = ?
        GROUP BY p.id
    `;
    db.query(sql, [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "ไม่พบโพสต์" });
        const post = results[0];
        db.query(
            `SELECT cm.*, u.username, u.avatar FROM comments cm
             LEFT JOIN users u ON cm.user_id = u.id
             WHERE cm.post_id = ? ORDER BY cm.created_at ASC`,
            [req.params.id],
            (err, comments) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ ...post, comments });
            }
        );
    });
});

// ===========================
// CREATE POST (Cloudinary)
// ===========================
app.post("/api/posts", verifyToken, postLimiter, (req, res, next) => {
    upload.single("image")(req, res, (err) => {
        if (err) {
            console.error("Multer/Cloudinary error (POST):", err);
            return res.status(500).json({ message: "อัปโหลดรูปภาพไม่สำเร็จ: " + err.message });
        }
        next();
    });
}, (req, res) => {
    const { title, content, category_id } = req.body;
    if (!title || !content)
        return res.status(400).json({ message: "กรุณากรอกหัวข้อและเนื้อหา" });

    const image = req.file ? (req.file.secure_url || req.file.path) : null;
    console.log("Post image URL:", image);

    db.query(
        "INSERT INTO posts (title, content, image, user_id, category_id) VALUES (?, ?, ?, ?, ?)",
        [title, content, image, req.user.id, category_id || null],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: "สร้างโพสต์สำเร็จ", postId: result.insertId });
        }
    );
});

// ===========================
// EDIT POST (Cloudinary)
// ===========================
app.put("/api/posts/:id", verifyToken, (req, res, next) => {
    upload.single("image")(req, res, (err) => {
        if (err) {
            console.error("Multer/Cloudinary error (PUT):", err);
            return res.status(500).json({ message: "อัปโหลดรูปภาพไม่สำเร็จ: " + err.message });
        }
        next();
    });
}, (req, res) => {
    db.query("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "ไม่พบโพสต์" });

        const post = results[0];
        if (post.user_id !== req.user.id && req.user.role !== "admin")
            return res.status(403).json({ message: "ไม่มีสิทธิ์แก้ไขโพสต์นี้" });

        const title = req.body.title || post.title;
        const content = req.body.content || post.content;
        const category_id = req.body.category_id || post.category_id;
        const image = req.file ? (req.file.secure_url || req.file.path) : post.image;

        db.query(
            "UPDATE posts SET title=?, content=?, image=?, category_id=? WHERE id=?",
            [title, content, image, category_id, req.params.id],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "แก้ไขโพสต์สำเร็จ" });
            }
        );
    });
});

// ===========================
// DELETE POST
// ===========================
app.delete("/api/posts/:id", verifyToken, (req, res) => {
    db.query("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "ไม่พบโพสต์" });

        const post = results[0];
        if (post.user_id !== req.user.id && req.user.role !== "admin")
            return res.status(403).json({ message: "ไม่มีสิทธิ์ลบโพสต์นี้" });

        db.query("DELETE FROM posts WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "ลบโพสต์สำเร็จ" });
        });
    });
});

// ===========================
// LIKE / UNLIKE
// ===========================
app.post("/api/posts/:id/like", verifyToken, (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;

    db.query("SELECT id FROM likes WHERE post_id = ? AND user_id = ?", [postId, userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            db.query("DELETE FROM likes WHERE post_id = ? AND user_id = ?", [postId, userId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.query("SELECT COUNT(*) AS like_count FROM likes WHERE post_id = ?", [postId], (err, countResult) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ liked: false, like_count: countResult[0].like_count });
                });
            });
        } else {
            db.query("INSERT INTO likes (post_id, user_id) VALUES (?, ?)", [postId, userId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.query("SELECT COUNT(*) AS like_count FROM likes WHERE post_id = ?", [postId], (err, countResult) => {
                    if (err) return res.status(500).json({ error: err.message });
                    db.query("SELECT user_id FROM posts WHERE id = ?", [postId], (err, postRows) => {
                        if (!err && postRows.length > 0 && postRows[0].user_id !== userId) {
                            db.query("INSERT IGNORE INTO notifications (user_id, type, post_id, from_user_id) VALUES (?, 'like', ?, ?)",
                                [postRows[0].user_id, postId, userId]);
                        }
                    });
                    res.json({ liked: true, like_count: countResult[0].like_count });
                });
            });
        }
    });
});

app.get("/api/posts/:id/like-status", verifyToken, (req, res) => {
    db.query("SELECT id FROM likes WHERE post_id = ? AND user_id = ?", [req.params.id, req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ liked: results.length > 0 });
    });
});

// ===========================
// COMMENTS
// ===========================
app.post("/api/comments", verifyToken, commentLimiter, (req, res) => {
    const { content, post_id } = req.body;
    if (!content || !post_id)
        return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบ" });

    db.query("INSERT INTO comments (content, post_id, user_id) VALUES (?, ?, ?)",
        [content, post_id, req.user.id],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            db.query(`SELECT cm.*, u.username, u.avatar FROM comments cm LEFT JOIN users u ON cm.user_id = u.id WHERE cm.id = ?`,
                [result.insertId],
                (err, rows) => {
                    if (err) return res.status(500).json({ error: err.message });
                    db.query("SELECT user_id FROM posts WHERE id = ?", [post_id], (err, postRows) => {
                        if (!err && postRows.length > 0 && postRows[0].user_id !== req.user.id) {
                            db.query("INSERT INTO notifications (user_id, type, post_id, from_user_id) VALUES (?, 'comment', ?, ?)",
                                [postRows[0].user_id, post_id, req.user.id]);
                        }
                    });
                    res.status(201).json({ message: "เพิ่มความคิดเห็นสำเร็จ", comment: rows[0] });
                }
            );
        }
    );
});

app.delete("/api/comments/:id", verifyToken, (req, res) => {
    db.query("SELECT * FROM comments WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "ไม่พบความคิดเห็น" });

        const comment = results[0];
        if (comment.user_id !== req.user.id && req.user.role !== "admin")
            return res.status(403).json({ message: "ไม่มีสิทธิ์ลบความคิดเห็นนี้" });

        db.query("DELETE FROM comments WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "ลบความคิดเห็นสำเร็จ" });
        });
    });
});

// แก้ไข comment
app.put("/api/comments/:id", verifyToken, (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ message: "กรุณากรอกเนื้อหา" });

    db.query("SELECT * FROM comments WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "ไม่พบความคิดเห็น" });

        const comment = results[0];
        if (comment.user_id !== req.user.id && req.user.role !== "admin")
            return res.status(403).json({ message: "ไม่มีสิทธิ์แก้ไขความคิดเห็นนี้" });

        db.query("UPDATE comments SET content = ? WHERE id = ?", [content.trim(), req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "แก้ไขความคิดเห็นสำเร็จ" });
        });
    });
});

// ===========================
// REPORTS
// ===========================
app.post("/api/posts/:id/report", verifyToken, (req, res) => {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "กรุณาระบุเหตุผล" });

    db.query(
        "INSERT INTO reports (post_id, user_id, reason) VALUES (?, ?, ?)",
        [req.params.id, req.user.id, reason],
        (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY')
                    return res.status(409).json({ message: "คุณรายงานโพสต์นี้ไปแล้ว" });
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "รายงานสำเร็จ ขอบคุณที่ช่วยดูแลชุมชน" });
        }
    );
});

// ===========================
// ADMIN
// ===========================
app.get("/api/admin/stats", verifyToken, adminOnly, (req, res) => {
    const queries = [
        "SELECT COUNT(*) AS count FROM users",
        "SELECT COUNT(*) AS count FROM posts",
        "SELECT COUNT(*) AS count FROM comments",
        "SELECT COUNT(*) AS count FROM likes",
        "SELECT COUNT(*) AS count FROM reports WHERE status = 'pending'"
    ];
    Promise.all(queries.map(sql => new Promise((resolve, reject) => {
        db.query(sql, (err, results) => err ? reject(err) : resolve(results[0].count));
    }))).then(([users, posts, comments, likes, pending_reports]) => {
        res.json({ users, posts, comments, likes, pending_reports });
    }).catch(err => res.status(500).json({ error: err.message }));
});

app.get("/api/admin/users", verifyToken, adminOnly, (req, res) => {
    db.query("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.delete("/api/admin/users/:id", verifyToken, adminOnly, (req, res) => {
    if (parseInt(req.params.id) === req.user.id)
        return res.status(400).json({ message: "ไม่สามารถลบบัญชีของตัวเองได้" });
    db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "ลบผู้ใช้สำเร็จ" });
    });
});

// Admin - ดู reports ทั้งหมด
// Admin - เปลี่ยน role user
app.put("/api/admin/users/:id/role", verifyToken, adminOnly, (req, res) => {
    const { role } = req.body;
    if (!['user','admin'].includes(role))
        return res.status(400).json({ message: "role ไม่ถูกต้อง" });
    if (parseInt(req.params.id) === req.user.id)
        return res.status(400).json({ message: "ไม่สามารถเปลี่ยน role ของตัวเองได้" });
    db.query("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "เปลี่ยน role สำเร็จ" });
    });
});

// Admin - ดู comments ทั้งหมด
app.get("/api/admin/comments", verifyToken, adminOnly, (req, res) => {
    db.query(`
        SELECT cm.id, cm.content, cm.created_at,
               u.username, p.id AS post_id, p.title AS post_title
        FROM comments cm
        LEFT JOIN users u ON cm.user_id = u.id
        LEFT JOIN posts p ON cm.post_id = p.id
        ORDER BY cm.created_at DESC
        LIMIT 200
    `, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Admin - ลบ comment
app.delete("/api/admin/comments/:id", verifyToken, adminOnly, (req, res) => {
    db.query("DELETE FROM comments WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "ลบความคิดเห็นสำเร็จ" });
    });
});

app.get("/api/admin/reports", verifyToken, adminOnly, (req, res) => {
    const { status } = req.query;
    let sql = `
        SELECT r.*, u.username AS reporter, p.title AS post_title, pu.username AS post_owner
        FROM reports r
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN posts p ON r.post_id = p.id
        LEFT JOIN users pu ON p.user_id = pu.id
    `;
    const params = [];
    if (status && ['pending','reviewed','dismissed'].includes(status)) {
        sql += ' WHERE r.status = ?';
        params.push(status);
    }
    sql += ' ORDER BY r.created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Admin - อัปเดตสถานะ report
app.put("/api/admin/reports/:id", verifyToken, adminOnly, (req, res) => {
    const { status } = req.body;
    if (!['pending','reviewed','dismissed'].includes(status))
        return res.status(400).json({ message: "สถานะไม่ถูกต้อง" });

    db.query("UPDATE reports SET status = ? WHERE id = ?", [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "อัปเดตสถานะสำเร็จ" });
    });
});

// ===========================
// NOTIFICATIONS
// ===========================
app.get("/api/notifications", verifyToken, (req, res) => {
    db.query(
        `SELECT n.*, u.username AS from_username, p.title AS post_title
         FROM notifications n
         LEFT JOIN users u ON n.from_user_id = u.id
         LEFT JOIN posts p ON n.post_id = p.id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC LIMIT 20`,
        [req.user.id],
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            const unread = results.filter(n => !n.is_read).length;
            res.json({ notifications: results, unread });
        }
    );
});

app.put("/api/notifications/read-all", verifyToken, (req, res) => {
    db.query("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "อ่านแจ้งเตือนทั้งหมดแล้ว" });
    });
});

// GET all notifications (no limit) for full notification page
app.get("/api/notifications/all", verifyToken, (req, res) => {
    db.query(
        `SELECT n.*, u.username AS from_username, p.title AS post_title
         FROM notifications n
         LEFT JOIN users u ON n.from_user_id = u.id
         LEFT JOIN posts p ON n.post_id = p.id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC`,
        [req.user.id],
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            const unread = results.filter(n => !n.is_read).length;
            res.json({ notifications: results, unread });
        }
    );
});

// PUT mark single notification as read
app.put("/api/notifications/:id/read", verifyToken, (req, res) => {
    db.query(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "อ่านแจ้งเตือนแล้ว" });
        }
    );
});

// ===========================
// START SERVER
// ===========================
app.listen(process.env.PORT || 7000, () => console.log(`Server running on port ${process.env.PORT || 7000}`));

// ===========================
// FOLLOW SYSTEM
// ===========================
app.post("/api/users/:id/follow", verifyToken, (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ message: "ไม่สามารถติดตามตัวเองได้" });
    db.query("SELECT id FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, targetId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length > 0) {
            db.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, targetId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ following: false });
            });
        } else {
            db.query("INSERT INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, targetId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.query("INSERT IGNORE INTO notifications (user_id, type, from_user_id) VALUES (?, 'follow', ?)", [targetId, req.user.id]);
                res.json({ following: true });
            });
        }
    });
});

app.get("/api/users/:id/follow-status", verifyToken, (req, res) => {
    db.query("SELECT id FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ following: rows.length > 0 });
    });
});

app.get("/api/users/:id/followers", (req, res) => {
    db.query("SELECT COUNT(*) AS count FROM follows WHERE following_id = ?", [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: rows[0].count });
    });
});

// ===========================
// BOOKMARK SYSTEM
// ===========================
app.post("/api/posts/:id/bookmark", verifyToken, (req, res) => {
    const postId = req.params.id;
    db.query("SELECT id FROM bookmarks WHERE post_id = ? AND user_id = ?", [postId, req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length > 0) {
            db.query("DELETE FROM bookmarks WHERE post_id = ? AND user_id = ?", [postId, req.user.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ bookmarked: false });
            });
        } else {
            db.query("INSERT INTO bookmarks (post_id, user_id) VALUES (?, ?)", [postId, req.user.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ bookmarked: true });
            });
        }
    });
});

app.get("/api/bookmarks", verifyToken, (req, res) => {
    db.query(`
        SELECT p.id, p.title, p.content, p.image, p.views, p.created_at,
               u.username, c.name AS category_name, c.color AS category_color,
               COUNT(DISTINCT l.id) AS like_count,
               COUNT(DISTINCT cm.id) AS comment_count
        FROM bookmarks b
        LEFT JOIN posts p ON b.post_id = p.id
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments cm ON p.id = cm.post_id
        WHERE b.user_id = ?
       GROUP BY p.id, b.created_at
        ORDER BY b.created_at DESC
    `, [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ posts: results });
    });
});