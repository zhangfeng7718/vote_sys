const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer')
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

// 使用绝对路径  相对路径不保险
const dbp = sqlite.open({
    filename: __dirname + './static/votes.sqlite3',
    driver: sqlite3.Database
})

let db;

const app = express();

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

app.use(express.json())

app.use(express.static(__dirname + '/static'));

app.use(express.urlencoded({
    extended: true
}));


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

app.post('/create-vote', async(req, res, next)=>{
    var params = req.body;
    // 如果直接使用字符串拼接会有sql注入的风险
    await db.run('INSERT INTO votes (title, desc, userid, singleSelection, deadline, anonymouse) VALUES (?,?,?,?,?,?)' ,
    params.title, params.desc, req.signedCookies.userid, params.singleSelection, new Date(params.deadline).getTime() , params.anonymouse)

    var vote = await db.get('SELECT * FROM votes ORDER BY id DESC LIMIT 1')
    console.log(params.options)
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

app.route('/register')
    .get((req, res, next)=>{
        res.send(`
            <form action:"/register" method="post">
                用户名： <input type = "text" name="name">
                邮箱:    <input type = "email" name="email">
                密码:    <input type = "password" name="password">
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

        console.log('Message sent: %s', info.messageId);
        console.log('Preview URL: %s ', nodemailer.getTestMessageUrl(info))

        // 将链接打印到控制台这样可以更简单的直接得到链接并修改密码
        console.log(link)
        res.end('已向您的邮箱发送密码重置连接')
    })

app.route('/change-password/:token')
    .get(async (req, res, next)=>{
        var token = req.params.token;
        var user = await db.get('SELECT * FROM users WHERE email = ?', changePasswordTokenMap[token])
        console.log(user);
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
    res.clearCookie('user');
    res.redirect('/');
})


dbp.then(dbObject =>{
    db = dbObject;
    app.listen(port ,()=>{
        console.log('app is run on port ', port)
    })
}).catch()

