const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer')
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const http = require('http');
const socketIO = require('socket.io')
const url = require('url')

const app = express();
const server = http.createServer(app);
const ioServer = socketIO(server);

/**
 * 需要补充的东西(页面的补充完成和UI优化 使用Bootstrap)
 * 用户密码不能明文存储, md5 存储
 * 未登录不能为非匿名问题投票
 *     权限验证
 * 问题过期后不能再投票  只能查看结果
 *     问题过期后投票结果不会实时更新  不需要socketio连接
 * 各个页面的交互 不能只返回一个由文字组成的页面
 * 整站的所有页面都有头部和底部
 * 创建投票的页面交互优化
 * 创建投票的后端需要额外的验证
 *      验证选项的数量
 *      过期时间需要是未来时间点
 * 登录后可以查看自己发起过的投票
 *
 *
 *
 * 登陆时需要输入验证码
 * 注册时可以上传头像
 */

// 使用绝对路径  相对路径不保险
const dbp = sqlite.open({
    filename: __dirname + './static/votes.sqlite3',
    driver: sqlite3.Database
})

let db;

const port = 3005;

const changePasswordTokenMap = {};

app.locals.pretty = true;
app.set('views', __dirname + '/tpl')
// app.set('view engine', 'pug')

app.use((req,res, next)=>{
    res.set('Content-Type', 'text/html; charset=UTF-8');
    next();
})

app.use(cookieParser('sercet'))

app.use(express.json()) //解析Json

app.use(express.static(__dirname + '/static'));

app.use(express.urlencoded({ //解析url编码
    extended: true
}));

ioServer.on('connection', socket=>{
    // console.log(socket.request)
    var path = url.parse(socket.request.headers.referer).path;
    socket.join(path);
})
/**
 * 主页面
 * 如果根据cookie中是否存在 userid 判断用户是否登录
 * 已登录   ----->  直接跳转用户个人页面
 * 未登录   ----->  直接跳转登录注册页面
 */
app.get('/', (req, res, next)=>{
    if(req.signedCookies.userid){
        res.send(`
            <div>
                <span>Welcome, ${req.signedCookies.userid}</span>
                <br>
                <a href= "/create.html">创建投票</a>
                <a href="/logout">退出</a>
            </div>
        `)
    }else{
        res.send(`
        <div>
            <a href = "/register">注册</a>
            <a href = "/login">登录</a>
        </div>
        `)
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

    res.render('vote.pug', {
        vote: vote,
        options: options,
    })

})

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

app.route('/register')
    .get((req, res, next)=>{
        res.send(`
            <form action:"/register" method="post">
                用户名： <input type = "text" name="name">
                邮箱:    <input type = "email" name="email">
                密码:    <input type = "password" name="password">
                头像:    <input type="file" name="avatar">
                <button>注册</button>
            </from>
        `)
    })
    .post(async (req, res, next)=>{
        var regInfo = req.body;
        var user = await db.get('SELECT * FROM users WHERE name=?' , regInfo.name);

        if(user){
            res.end('用户名已经被占用');
        }else{
            await db.run('INSERT INTO users (name, email, password) VALUES(?, ? , ?)' , regInfo.name, regInfo.email ,regInfo.password)
            res.end('注册成功');
        }
    })

app.route('/login')
    .get((req, res, next)=>{
        res.send(`
            <form id="loginFrom" action:"/login" method="post">
                用户名： <input type = "text" name="name">
                密码:    <input type = "password" name="password">
                <a href="/forgot">忘记密码</a>
                <button>登录</button>
            </from>

            <script>
                var loginFrom = document.querySelector('#loginFrom');
                loginFrom.addEventListener('submit', (e)=>{
                    e.preventDefault();
                    var name = document.querySelector('[name="name"]').value;
                    var password = document.querySelector('[name="password"]').value;

                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', '/login');
                    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
                    xhr.onload = ()=>{
                        var data = JSON.parse(xhr.responseText);
                        if(data.code == 0){
                            alert('login success')
                            location.href = '/'
                        }else{
                            alert('login failed')
                        }
                    }
                    xhr.send('name=' + name + '&password=' + password);
                })
            </script>
        `)
    })
    .post(async (req, res, next)=>{
        var userInfo = req.body;
        var user = await db.get('SELECT * FROM users WHERE name = ? AND password=?', userInfo.name , userInfo.password);
        if(user){
            res.cookie('userid', user.id, {
                signed: true,
            });
            res.json({
                code: 0
            })
            return ;
            res.end(`
                登录成功，<span id="countDown">5</span>秒后将跳转到首页...
                <script>
                    var remain = 4;
                    var count = document.querySelector('#countDown');
                    setInterval(()=>{
                        count.textContent = remain--;
                    }, 1000)
                    setTimeout(()=>{
                        location.href = '/'
                    }, 5000)
                </script>
            `)
        }else{
            res.json({
                code: -1
            })
            return ;
            res.end('用户名或密码错误')
        }
    })

app.route('/forgot')
    .get((req, res,next)=>{
        res.end(`
            <form action="/forgot" method="post">
                请输入您的邮箱<input type="text" name="email">
                <button>确定</button>
            </form>
        `)
    })
    .post(async (req, res, next)=>{
        var email = req.body.email;
        var token = Math.random().toString().slice(2);
        changePasswordTokenMap[token] = email;

        setTimeout(()=>{
            delete changePasswordTokenMap[token]
        }, 60 * 1000 * 20)

        var link = `http://localhost:3005/change-password/${token}`;

        // 实现简单的发送邮件
        var transporter = nodemailer.createTransport({
            host: 'smtp.qq.com',
            secure: true,
            auth: {
                user: '771804817@qq.com',
                pass: 'ddfupkjkitbtbbei',
            }
        })

        var info = await transporter.sendMail({
            from: '"投票系统" <771804817@qq.com>',
            to: `${email}`,
            subject: 'this is a vote link',
            text: `在浏览器中复制这段链接${link}`,
            html: `<a href = ${link} >或者点击这里</a>`
        });

        // console.log('Message sent: %s', info.messageId);
        // console.log('Preview URL: %s ', nodemailer.getTestMessageUrl(info))

        // 将链接打印到控制台这样可以更简单的直接得到链接并修改密码
        console.log(link)
        res.end('已向您的邮箱发送密码重置连接')
    })

app.route('/change-password/:token')
    .get(async (req, res, next)=>{
        var token = req.params.token;
        var user = await db.get('SELECT * FROM users WHERE email = ?', changePasswordTokenMap[token])
        // console.log(user);
        res.end(`
            此页面可以重置${user.name}的密码
            <form action="" method="post">
                <input type="password" name="password" />
                <button>提交<button>
            </form>
        `)
    })
    .post(async (req, res, next)=>{
        var token = req.params.token;
        var user = await db.get('SELECT * FROM users WHERE email = ?', changePasswordTokenMap[token])
        var password = req.body.password;
        if(user){
            await db.run('UPDATE users SET password = ? WHERE email = ?',password,changePasswordTokenMap[token])
            delete changePasswordTokenMap[token]
            res.end('密码修改成功');
        }else{
            res.end('此链接失效');
        }
    })

app.get('/logout', (req, res, next)=>{
    res.clearCookie('userid');
    res.redirect('/');
})

dbp.then(dbObject =>{
    db = dbObject;

    server.listen(port ,()=>{
        console.log('app is run on port ', port)
    })
}).catch()

