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
    console.log(req.signedCookies)
    if(! req.signedCookies.userid){
        res.json({
            code : -1,
            msg: '没有登录无法创建投票，请先去登录'
        })
    }
    // 如果直接使用字符串拼接会有sql注入的风险
    await db.run('INSERT INTO votes (title, desc, userid, singleSelection, deadline, anonymouse) VALUES (?,?,?,?,?,?)',
        params.title, params.desc, req.signedCookies.userid, params.singleSelection, new Date(params.deadline).getTime(), params.anonymouse)

    var vote = await db.get('SELECT * FROM votes ORDER BY id DESC LIMIT 1')
    await Promise.all(params.options.map(option => {
        return db.run('INSERT INTO options (content, voteid) VALUES (?, ?)', option, vote.id)
    }))

    res.json(vote)
})
// 用户投票接口
app.post('/voteup', async (req, res, next) => {
    // 一个用户对一个投票 只能选择一个选项
    var userid = req.signedCookies.userid;
    var body = req.body;

    if(!userid){
        res.json({
            code: 0,
            msg: '请登录后再进行投票'
        })
        return ;
    }
    
    // 后端验证投票是否还在deline
    var deadline = await db.get('SELECT deadline FROM votes WHERE id = ?', body.voteid)
    console.log(deadline)
    if(deadline.deadline < Date.now()){
        res.json({
            code: -1,
            msg: '投票已经截止'
        })
        return ;
    }

    // 单选
    if(body.singleSelection === 1){
        var voteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, body.voteid)
        console.log(voteupInfo)
        if (voteupInfo) {
            // 判断投票项是已经投票项取消还是替换
            if(voteupInfo.optionid === body.optionid){
                // 这里应该进行删除操作
                await db.run('DELETE FROM voteups WHERE userid=? AND voteid=? AND optionid=?', userid, body.voteid , body.optionid)
            }else{
                // 进行替换
                await db.run('UPDATE voteups SET optionid=? WHERE userid=? AND voteid=?', body.optionid, userid, body.voteid)
            }
        } else {
            await db.run('INSERT INTO voteups (userid, optionid, voteid) VALUES (?,?,?)',
                userid, body.optionid, body.voteid
            )
        }
    }else{
        // 多选
        var voteupInfo = await db.all('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, body.voteid)
        if(voteupInfo){
            // 已经投票想要取消
            if(voteupInfo.some(it => it.optionid === body.optionid)){

                await db.run('DELETE FROM voteups WHERE userid=? AND voteid=? AND optionid=?', userid, body.voteid , body.optionid)

            }else{
                // 没有投票想要投票
                await db.run('INSERT INTO voteups (userid, optionid, voteid) VALUES (?,?,?)',
                    userid, body.optionid, body.voteid
                )
            }
        }else{
            // 没有的投票的情况
            await db.run('INSERT INTO voteups (userid, optionid, voteid) VALUES (?,?,?)',
                userid, body.optionid, body.voteid
            )
        }
    }


    var voteups = await db.all('SELECT avatar,email,name,optionid,userid, voteid  FROM voteups INNER JOIN users ON voteups.userid = users.id WHERE voteid=?', body.voteid)


    ioServer.to('/vote-view/' + body.voteid).emit('newvote', voteups);

    res.json(voteups)
})
// 获取某个投票的基本信息
app.get('/vote/:id', async (req, res, next) => {
    var info = await db.get('SELECT * FROM votes WHERE id=?', req.params.id);
    var options = await db.all('SELECT * FROM options WHERE voteid=?', req.params.id)
    // var voteup = await db.all('SELECT * FROM voteups  WHERE voteid=?', req.params.id)

    var voteup = await db.all('SELECT avatar,email,name,optionid,userid, voteid  FROM voteups INNER JOIN users ON voteups.userid = users.id WHERE voteid=?', req.params.id)
    res.json({
        info,
        options,
        voteup
    })
})


app.get('/votelistnum', async (req, res, next) => {
    var num = await db.get('SELECT count(id) FROM votes');
    res.json({
        num
    })
})

app.get('/votelist/:page' , async (req, res, next) => {
    var votelist = await db.all('SELECT votes.id,avatar,deadline,desc,name,title FROM votes INNER JOIN users ON votes.userid = users.id  ORDER BY votes.id DESC limit ?, 5', (req.params.page - 1) * 5)

    res.json({
        votelist
    })
})

app.get('/hasvoted/:voteid', async (req, res, next)=>{
    var userid = req.signedCookies.userid;
    if(userid){
        var voteups = await db.all('SELECT * FROM  voteups WHERE userid = ? AND voteid = ?' , userid, req.params.voteid);
        var userInfo = await db.get('SELECT avatar, email, id , name FROM users WHERE id = ?', userid)
        if(voteups){
            res.json({
                code: 1,
                votedata: voteups,
                user: userInfo,
            })
        }else{
            res.json({
                code: 0,
                msg:'未投票',
                user: userInfo,
            })
        }
    }else{
        res.json({
            code: -1,
            msg: '未登录'
        })
    }
})


module.exports = app;