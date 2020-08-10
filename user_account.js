const express = require('express');
const router = express.Router();
const app = express();
const nodemailer = require('nodemailer')
// const fsp = require('fs').promises;
const svgCaptcha = require('svg-captcha')
const md5 = require('md5');
const multer = require('multer');

const uploader = multer({
    dest: './upload/',
    preservePath: true,
})
const changePasswordTokenMap = {};
app.set('views', __dirname + '/tpl')

const dbp = require('./db')
let db;
dbp.then(dbObject =>{
    db = dbObject;
})

app.route('/register')
    .get((req, res, next)=>{
        res.send(`
            <form action:"/register" method="post" enctype="multipart/form-data">
                用户名： <input type = "text" name="name"><br>
                邮箱:    <input type = "email" name="email"><br>
                密码:    <input type = "password" name="password"><br>
                头像:    <input type = "file" name= "avatar"><br>
                <button>注册</button>
            </from>
        `)
    })
    .post(uploader.single('avatar') ,async (req, res, next)=>{
        var regInfo = req.body;
        var user = await db.get('SELECT * FROM users WHERE name=?' , regInfo.name);
        // 判断req.file上的size是否过大 还需要进行校验
        // var imgBuf = await fsp.readFile(req.file.path);

        // await sharp(imgBuf)
        //     .resize(256)
        //     .File(req.file.path)


        if(user){
            res.end('用户名已经被占用');
        }else{
            await db.run('INSERT INTO users (name, email, password, avatar) VALUES(?, ? , ? , ?)' ,
            regInfo.name, regInfo.email ,md5(md5(regInfo.password)), req.file.path)
            res.end('注册成功');
        }
    })

app.route('/login')
    .get((req, res, next)=>{
        res.render('login.pug',{})
    })
    .post(async (req, res, next)=>{
        var userInfo = req.body;
        if(userInfo.captcha != req.session.captcha){
            res.json({code: -1,})
            return;
        }

        var user = await db.get('SELECT * FROM users WHERE name = ? AND password=?', userInfo.name , md5(md5(userInfo.password)) );
        if(user){
            res.cookie('userid', user.id, {
                signed: true,
            });
            res.json({
                code: 0
            })
            return ;
            // res.end(`
            //     登录成功，<span id="countDown">5</span>秒后将跳转到首页...
            //     <script>
            //         var remain = 4;
            //         var count = document.querySelector('#countDown');
            //         setInterval(()=>{
            //             count.textContent = remain--;
            //         }, 1000)
            //         setTimeout(()=>{
            //             location.href = '/'
            //         }, 5000)
            //     </script>
            // `)
        }else{
            res.json({
                code: -1
            })
            return ;
        }
    })

app.get('/captcha', (req, res, next)=>{
    var captcha = svgCaptcha.create();
    res.type('svg')

    req.session.captcha = captcha.text;

    res.end(captcha.data)
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
    res.clearCookie('sessionid')
    res.redirect('/');
})


module.exports = app;