const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const socketIO = require('socket.io')
const url = require('url')
// const sharp = require('sharp'); // 图片压缩处理模块
const session = require('express-session')
const userAccountRouter = require('./user_account')
const dbp = require('./db')
let db;
const app = express();
const server = http.createServer(app);
const ioServer = socketIO(server);
/**
 * 需要补充的东西(页面的补充完成和UI优化 使用Bootstrap)
 * 未登录不能为非匿名问题投票
 *     权限验证
 * 问题过期后不能再投票  只能查看结果
 *     问题过期后投票结果不会实时更新  不需要socketio连接
 * 整站的所有页面都有头部和底部
 * 创建投票的页面交互优化
 * 创建投票的后端需要额外的验证
 *      验证选项的数量
 *      过期时间需要是未来时间点
 * 登录后可以查看自己发起过的投票
 *
 *
 * 登陆时需要输入验证码
 * 注册时可以上传头像
 * 用户密码不能明文存储, md5 存储
 * 各个页面的交互 不能只返回一个由文字组成的页面
 *
 */
const port = 3005;

app.locals.pretty = true;
app.set('views', __dirname + '/tpl') // 设置渲染资源目录
// app.set('view engine', 'pug')

app.use((req,res, next)=>{
    res.set('Content-Type', 'text/html; charset=UTF-8');
    next();
})
app.use(session({
    secret: 'sercet',
    resave: false,
    cookie: {maxAge: 65536},
    saveUninitialized: true,
}))  // session 中间件  需要写在cookieParser前面

app.use(cookieParser('sercet')) // cookie解析和设置中间件

app.use(express.json()) //解析Json

app.use(express.static(__dirname + '/static')); // 静态文件默认目录

app.use('/upload', express.static(__dirname + '/upload')) // 头像图片二进制文件上传目录

app.use(express.urlencoded({ //解析url编码
    extended: true
}));
// 存储对话信息  session 主要做的事情
// var captchaSession = {
// }
// app.use(function session(req, res, next){
//     var sessionid = req.cookies.sessionid;

//     if(!sessionid){
//         sessionid = Math.random().toString(16).slice(2);
//         res.cookie('sessionid', sessionid)
//     }

//     if(!captchaSession[sessionid]){
//         captchaSession[sessionid] = {};
//     }

//     req.session = captchaSession.sessionid;
//     next();
// })
// socketIo 加入组
ioServer.on('connection', socket=>{
    var path = url.parse(socket.request.headers.referer).path;
    socket.join(path);
})
/**
 * 主页面
 * 如果根据cookie中是否存在 userid 判断用户是否登录
 * 已登录   ----->  直接跳转用户个人页面
 * 未登录   ----->  直接跳转登录注册页面
 */
app.get('/', async(req, res, next)=>{
    var user = await db.get('SELECT * FROM users WHERE id = ?' , req.signedCookies.userid)
    if(req.signedCookies.userid){
        res.render('index.pug', {
            user: user,
        })
    }else{
        res.render('start.pug', {})
    }
})
/**
 * 投票创建页面
 * 只有已登录的用户才能进入该页面
 * 前端页面中需要校验输入内容是否合法
 */
app.post('/create-vote', async(req, res, next)=>{
    var params = req.body;
    // 如果直接使用字符串拼接会有sql注入的风险
    await db.run('INSERT INTO votes (title, desc, userid, singleSelection, deadline, anonymouse) VALUES (?,?,?,?,?,?)' ,
    params.title, params.desc, req.signedCookies.userid, params.singleSelection, new Date(params.deadline).getTime() , params.anonymouse)

    var vote = await db.get('SELECT * FROM votes ORDER BY id DESC LIMIT 1')
    await Promise.all(params.options.map(option=>{
        return db.run('INSERT INTO options (content, voteid) VALUES (?, ?)', option, vote.id )
    }))

    res.render('create-success.pug', {
        vote: vote
    })

    setTimeout(()=>{
        res.redirect('/vote/' + vote.id)
    }, 5000)
})
/**
 * 投票详情页面
 * 分为匿名投票和非匿名投票
 * 分为过期和未过期  过期不可以再投票
 * 实时更新投票
 */
app.get('/vote/:id',async (req, res, next)=>{
    var votePromise = db.get('SELECT * FROM votes WHERE id = ?', req.params.id);
    var optionsPromise = db.all('SELECT * FROM options WHERE voteid=?', req.params.id);

    var vote = await votePromise;
    var options = await optionsPromise;
    console.log(vote)

    res.render('vote.pug', {
        vote: vote,
        options: options,
    })

})
// 用户投票接口
app.post('/voteup', async (req ,res ,next)=>{
    // 一个用户对一个投票 只能选择一个选项
    var userid = req.signedCookies.userid;
    var body = req.body;


    var voteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, body.voteid)
    if(voteupInfo){
        // res.end();
        // return;
        await db.run('UPDATE voteups SET optionid=? WHERE userid=? AND voteid=?', body.optionid, userid, body.voteid)
    }else{
        await db.run('INSERT INTO voteups (userid, optionid, voteid) VALUES (?,?,?)',
        userid, body.optionid, body.voteid
        )
    }

    ioServer.in(`/vote/${body.voteid}`).emit('new vote', {
        userid: userid,
        voteid: body.voteid,
        optionid: body.optionid,
    })

    var voteups = await db.all('SELECT * FROM voteups WHERE voteid=?', body.voteid)
    res.json(voteups)
})
// 某个用户获取某个问题的投票信息
app.get('/voteup/:voteid/info' , async(req, res, next)=>{
    var userid = req.signedCookies.userid;
    var voteid = req.params.voteid;
    var userVoteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid , voteid)

    if(userVoteupInfo){
        var voteups = await db.all('SELECT * FROM voteups WHERE voteid=?', voteid);
        res.json(voteups);
    }else{
        res.json(null);
    }
})
// 用户登录注册路由引入
app.use('/', userAccountRouter)

dbp.then(dbObject =>{
    db = dbObject;
    server.listen(port ,()=>{
        console.log('app is run on port ', port)
    })
}).catch()

