const express = require('express')
const app = express();

const dbp = require('./db')
let db;
dbp.then(dbObject => {
    db = dbObject;
})


/**
 * 投票创建页面
 * 只有已登录的用户才能进入该页面
 * 前端页面中需要校验输入内容是否合法
 */
app.post('/create', async (req, res, next) => {
    var params = req.body;
    // 如果直接使用字符串拼接会有sql注入的风险
    await db.run('INSERT INTO votes (title, desc, userid, singleSelection, deadline, anonymouse) VALUES (?,?,?,?,?,?)',
        params.title, params.desc, req.signedCookies.userid, params.singleSelection, new Date(params.deadline).getTime(), params.anonymouse)

    var vote = await db.get('SELECT * FROM votes ORDER BY id DESC LIMIT 1')
    await Promise.all(params.options.map(option => {
        return db.run('INSERT INTO options (content, voteid) VALUES (?, ?)', option, vote.id)
    }))

    if (req.is('json')) {
        res.json(vote)
    } else {
        res.redirect('/vote/' + vote.id)
    }
})
// 用户投票接口
app.post('/voteup', async (req, res, next) => {
    // 一个用户对一个投票 只能选择一个选项
    var userid = req.signedCookies.userid;
    var body = req.body;


    var voteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, body.voteid)
    // console.log(voteupInfo)
    if (voteupInfo) {
        await db.run('UPDATE voteups SET optionid=? WHERE userid=? AND voteid=?', body.optionid, userid, body.voteid)
    } else {
        await db.run('INSERT INTO voteups (userid, optionid, voteid) VALUES (?,?,?)',
            userid, body.optionid, body.voteid
        )
    }

    ioServer.in(`/vote/${body.voteid}`).emit('new vote', {
        userid: Number(userid),
        voteid: body.voteid,
        optionid: body.optionid,
    })

    ioServer.in(`/vote_vue/${body.voteid}`).emit('new vote', {
        userid: Number(userid),
        voteid: body.voteid,
        optionid: body.optionid,
    })

    var voteups = await db.all('SELECT * FROM voteups WHERE voteid=?', body.voteid)
    console.log(voteups)
    res.json(voteups)
})
// 获取某个投票的基本信息
app.get('/vote/:id', async (req, res, next) => {
    var info = await db.get('SELECT * FROM votes WHERE id=?', req.params.id);
    var options = await db.all('SELECT * FROM options WHERE voteid=?', req.params.id)
    var voteup = await db.all('SELECT * FROM voteups JOIN users ON voteups.userid=users.id  WHERE voteid=?', req.params.id)
    res.json({
        info,
        options,
        voteup
    })
})


module.exports = app;