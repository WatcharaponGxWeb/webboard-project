require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

db.connect(err => {
  if (err) { console.error('Connect error:', err); process.exit(1); }
  console.log('Connected!');

  const queries = [
    `CREATE TABLE IF NOT EXISTS follows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      follower_id INT NOT NULL,
      following_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_follow (follower_id, following_id)
    )`,
    `CREATE TABLE IF NOT EXISTS bookmarks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_bookmark (post_id, user_id)
    )`,
    `ALTER TABLE notifications MODIFY COLUMN type ENUM('like','comment','follow') NOT NULL`
  ];

  let done = 0;
  queries.forEach((sql, i) => {
    db.query(sql, err => {
      console.log(`Query ${i+1}:`, err ? err.message : 'OK');
      if (++done === queries.length) { db.end(); process.exit(0); }
    });
  });
});