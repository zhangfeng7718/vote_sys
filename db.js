const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

// 使用绝对路径  相对路径不保险
const dbp = sqlite.open({
    filename: __dirname + './static/votes.sqlite3',
    driver: sqlite3.Database
})

module.exports = dbp;