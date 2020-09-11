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
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
// const sharp = require('sharp'); // 图片压缩处理模块
const session = require('express-session')
const userAccountRouter = require('./user_account')
const voteRouter = require('./vote_router')
const app = express();
const server = http.createServer(app);
const cors = require('cors')
const port = 3005;
const socketIO = require('socket.io')
app.locals.pretty = true;

// 设置渲染资源目录
// app.set('view engine', 'pug')
// app.use((req, res, next) => {
//     res.set('Content-Type', 'text/html; charset=UTF-8');
//     next();
// })
app.use(session({
    secret: 'sercet',
    resave: true,
    saveUninitialized: true,
    cookie: { secure: false , maxAge: 65536}
})) 
// session 中间件  需要写在cookieParser前面
app.use(cookieParser('sercet')) // cookie解析和设置中间件

app.use(express.json()) //解析Json
app.use(express.static(__dirname + '/build'));

app.use(express.static(__dirname + '/static')); // 静态文件默认目录
app.use('/vote-view/upload', express.static(__dirname + '/upload')) // 头像图片二进制文件上传目录
app.use('/upload', express.static(__dirname + '/upload')) // 头像图片二进制文件上传目录
app.use(express.urlencoded({ //解析url编码
    extended: true
}));
app.use(cors({
    maxAge: 86400,
    credentials: true,
    origin: '/'
}))

const ioServer = socketIO(server);
global.ioServer = ioServer;  //被迫无奈放到全局  为了让vote_router.js能访问到
// socketIo 加入组
ioServer.on('connection', socket => {
    // var path = url.parse(socket.request.headers.referer).path;
    socket.on('select room', roomid => {
        socket.join('/vote-view/' + roomid);
    })
})
app.use('/', voteRouter)
// 用户登录注册路由引入
app.use('/', userAccountRouter)

app.get('*', (req, res, next) => {
    console.log(req)
    res.redirect(301, 'http://' + req.headers.host)
})

server.listen(port, () => {
    console.log('app is run on port ', port)
})