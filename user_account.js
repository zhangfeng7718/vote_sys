const express = require('express');
const router = express.Router();
const app = express();
const nodemailer = require('nodemailer')
// const fsp = require('fs').promises;
const svgCaptcha = require('svg-captcha')
const md5 = require('md5');
const multer = require('multer');
const fsp = require('fs').promises;

const uploader = multer({
    dest: './upload/',
    preservePath: true,
})
const changePasswordTokenMap = {};

const dbp = require('./db')
let db;
dbp.then(dbObject => {
    db = dbObject;
})

app.route('/register')
    .post(uploader.single('avatar'), async (req, res, next) => {
        var regInfo = req.body;
        if (regInfo.captcha != req.session.captcha) {
            res.json({
                code: -1,
                msg: '验证码错误'
            })
            return;
        }

        var user = await db.get('SELECT * FROM users WHERE name=?', regInfo.name);

        if (user) {
            // 如果注册失败了  需要删除文件
            if (regInfo) {
                await fsp.unlink(req.file.path)
            }
            res.json({
                code: -1,
                msg: '用户名已经被占用'
            });
        } else {
            await db.run('INSERT INTO users (name, email, password, avatar) VALUES(?, ? , ? , ?)',
                regInfo.name, regInfo.email, md5(md5(regInfo.password)), req.file.path)
            res.json({
                code: 0,
                msg: '注册成功',
            });
        }
    })

app.route('/login')
    .post(async (req, res, next) => {
        var userInfo = req.body;

        if (userInfo.captcha != req.session.captcha) {
            res.json({
                code: -1,
                msg: '验证码错误'
            })
            return;
        }
        var user = await db.get('SELECT * FROM users WHERE name = ? AND password=?', userInfo.name, md5(md5(userInfo.password)));
        if (user) {
            res.cookie('userid', user.id, {
                signed: true,
            });
            res.json({
                code: 0,
                msg: '登录成功',
            })
        } else {
            res.json({
                code: -1,
                msg: '用户名或密码错误',
            })
        }
    })

app.get('/userinfo', async (req, res, next) => {
    var userid = req.signedCookies.userid;
    if (userid) {
        res.json( {
            code: 0,
            data: await db.get('SELECT id,name,avatar FROM users WHERE id = ?', userid)
        })
    } else {
        res.json({
            code: -1,
            msg :'未登录'
        })
    }
})

app.get('/captcha', (req, res, next) => {
    svgCaptcha.options.width = 100;
    var captcha = svgCaptcha.create();
    res.type('svg')
    
    req.session.captcha = captcha.text;
    console.log(captcha.text)
    console.log(req.session)
    res.end(captcha.data)
})

app.route('/forgot')
    .post(async (req, res, next) => {
        var userInfo = req.body;
        console.log(userInfo)

        if (userInfo.captcha != req.session.captcha) {
            res.json({
                code: -1,
                msg: '验证码错误'
            })
            return;
        }

        var email = userInfo.email;
        var user = await db.get('SELECT * FROM users WHERE email=?', email)
        if (!user) {
            res.json({
                code: -1,
                msg: '不存在此用户'
            })
        }

        var token = Math.random().toString().slice(2);
        changePasswordTokenMap[token] = email;

        setTimeout(() => {
            delete changePasswordTokenMap[token]
        }, 60 * 1000 * 20)

        var link = `http://${req.headers.host}:3005/change-password/${token}`;

        console.log(link)
        // 实现简单的发送邮件
        var transporter = nodemailer.createTransport({
            host: 'smtp.qq.com',
            secure: true,
            auth: {
                user: '771804817@qq.com',
                pass: 'gxbcmtaxxolnbfde',
            }
        })

        var info = await transporter.sendMail({
            from: '"投票系统" <771804817@qq.com>',
            to: `${email}`,
            subject: 'this is a vote link',
            text: `在浏览器中复制这段链接${link}`,
            html: `<a href = ${link} >或者点击这里</a>`
        });
        // 将链接打印到控制台这样可以更简单的直接得到链接并修改密码
        res.json({
            code: 0,
            msg: '已向您的邮箱发送密码重置连接'
        })
    })

app.route('/change-password/:token')
    .post(async (req, res, next) => {
        var token = req.params.token;
        var user = await db.get('SELECT * FROM users WHERE email = ?', changePasswordTokenMap[token])
        var password = req.body.password;
        if (user) {
            await db.run('UPDATE users SET password = ? WHERE email = ?', password, changePasswordTokenMap[token])
            delete changePasswordTokenMap[token]
            res.json({
                code: 0,
                msg: '密码修改成功',
            });
        } else {
            res.json({
                code: -1,
                msg: '此链接失效',
            });
        }
    })

app.get('/logout', (req, res, next) => {
    res.clearCookie('userid');
    res.clearCookie('sessionid')
    res.end();
})


module.exports = app;