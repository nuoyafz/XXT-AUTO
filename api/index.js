const express = require('express')
const cors = require('cors')
const compression = require('compression')
const cookieParser = require('cookie-parser')
const fetch = require('node-fetch')
const { CookieJar } = require('tough-cookie')
const crypto = require('crypto')
const cheerio = require('cheerio')

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(compression())
app.use(express.json())
app.use(cookieParser())

// ---------- 全局 Cookie 罐 ----------
const cookieJar = new CookieJar()

const UA_MOBILE = 'Dalvik/2.1.0 (Linux; U; Android 10; SM-G975F Build/QP1A.190711.020) okhttp/3.12.0'
const AES_KEY = Buffer.from('u2oh6Vu^HWe4_AES', 'utf8')

// ---------- 缓存 ----------
const cache = new Map()
const cacheSet = (key, val, ttlMs) => {
  cache.set(key, { val, exp: Date.now() + ttlMs })
}
const cacheGet = (key) => {
  const item = cache.get(key)
  if (!item) return null
  if (Date.now() > item.exp) { cache.delete(key); return null }
  return item.val
}

// ---------- 签到类型 ----------
const SIGNIN_ACTIVE_TYPE = 2
const NON_SIGNIN_TYPES = [11, 42, 13, 14, 15]
const OTHERID_TYPE_MAP = { 0: '普通签到', 2: '签到码', 3: '拍照签到', 4: '位置签到', 5: '手势签到', 6: '二维码签到' }

function mapSigninType(a) {
  const subType = OTHERID_TYPE_MAP[a.otherId] || null
  if (subType) return subType
  if (a.nameOne?.includes('签到码')) return '签到码签到'
  if (a.nameOne?.includes('拍照')) return '拍照签到'
  if (a.nameOne?.includes('位置')) return '位置签到'
  if (a.nameOne?.includes('手势')) return '手势签到'
  if (a.nameOne?.includes('二维码')) return '二维码签到'
  return '普通签到'
}

function filterSignin(activeList) {
  return activeList.filter(a => a.activeType === SIGNIN_ACTIVE_TYPE && !NON_SIGNIN_TYPES.includes(a.activeType))
}

// ---------- AES 加密 ----------
function aesEncrypt(plaintext) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_KEY)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}

// ---------- 带 Cookie 的请求 ----------
async function cxFetch(url, opts = {}) {
  const cookies = await cookieJar.getCookies('https://chaoxing.com')
  const cookieStr = cookies.map(c => `${c.key}=${c.value}`).join('; ')
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Cookie': cookieStr,
      'User-Agent': UA_MOBILE,
    }
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    for (const c of cookies) {
      try {
        await cookieJar.setCookie(c.replace(/Domain=[^;]+;/i, 'Domain=.chaoxing.com;'), 'https://chaoxing.com')
      } catch (e) {}
    }
  }
  return res
}

// ---------- API 路由 ----------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.json({ success: false, msg: '请输入账号和密码' })
  try {
    await cookieJar.removeAllCookies()
    const encryptedPwd = aesEncrypt(password)
    const loginRes = await cxFetch('https://passport2.chaoxing.com/fanyalogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        fid: '-1',
        uname: username,
        password: encryptedPwd,
        refer: 'http%3A%2F%2Fi.chaoxing.com',
        t: 'true',
        forythere: '',
        allowJoin: '0',
        isCheckToken: 'true',
      }).toString()
    })
    const loginData = await loginRes.json()
    if (loginData.status) {
      const uidRes = await cxFetch('https://passport2.chaoxing.com/mooc/accountManage?refer=http://i.chaoxing.com')
      const uidText = await uidRes.text()
      const uidMatch = uidText.match(/uid["']?\s*[:=]\s*["']?(\d+)/)
      const uid = uidMatch ? uidMatch[1] : ''
      res.json({ success: true, uid, msg: '登录成功' })
    } else {
      res.json({ success: false, msg: loginData.msg || '登录失败' })
    }
  } catch (e) {
    res.json({ success: false, msg: e.message })
  }
})

app.post('/api/courses', async (req, res) => {
  try {
    const cacheKey = 'courses'
    const cached = cacheGet(cacheKey)
    if (cached) return res.json({ success: true, courses: cached })

    const pageRes = await cxFetch('https://mooc1-api.chaoxing.com/mooc-ans/visit/courselistdata?courseType=1&courseFolderId=0&query=&page=1')
    const pageText = await pageRes.text()
    const $ = cheerio.load(pageText)
    const courses = []
    $('li').each((_, el) => {
      const cid = $(el).attr('courseId')
      const clz = $(el).attr('clazzId')
      const name = $(el).find('.course-name').text().trim() || $(el).find('.overHidden2').text().trim()
      const teacher = $(el).find('.line2').text().trim() || ''
      if (cid && clz) {
        courses.push({ courseId: cid, classId: clz, name, teacher })
      }
    })
    cacheSet(cacheKey, courses, 30 * 60 * 1000)
    res.json({ success: true, courses })
  } catch (e) {
    res.json({ success: false, msg: e.message })
  }
})

app.post('/api/scan-all', async (req, res) => {
  try {
    const coursesRes = await fetch('http://localhost:3001/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const coursesData = await coursesRes.json()
    if (!coursesData.success) return res.json(coursesData)

    const courses = coursesData.courses
    const results = []
    const BATCH_SIZE = 10

    for (let i = 0; i < courses.length; i += BATCH_SIZE) {
      const batch = courses.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(batch.map(async (c) => {
        const cacheKey = `punch_${c.courseId}_${c.classId}`
        const cached = cacheGet(cacheKey)
        if (cached) return { ...c, punchs: cached }

        try {
          const listRes = await cxFetch(`https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist?fid=0&courseId=${c.courseId}&classId=${c.classId}&showNotStartedActive=0`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          })
          const listData = await listRes.json()
          let activeList = listData.data?.activeList || []
          activeList = filterSignin(activeList)
          const punchs = activeList.map(a => ({
            activeId: a.id,
            nameOne: a.nameOne,
            startTime: a.startTime,
            endTime: a.endTime,
            status: a.status,
            activeType: a.activeType,
            otherId: a.otherId,
            typeName: mapSigninType(a),
          }))
          cacheSet(cacheKey, punchs, 60 * 1000)
          return { ...c, punchs }
        } catch (e) {
          return { ...c, punchs: [], error: e.message }
        }
      }))
      results.push(...batchResults)
    }

    res.json({ success: true, courses: results })
  } catch (e) {
    res.json({ success: false, msg: e.message })
  }
})

app.post('/api/do-sign', async (req, res) => {
  const { activeId, courseId, classId, uid, signType } = req.body
  try {
    const url = `https://mobilelearn.chaoxing.com/pptSign/stuSignajax?activeId=${activeId}&uid=${uid || ''}&clientip=&latitude=-1&longitude=-1&appType=15&fid=0&name=`
    const resp = await cxFetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    const text = await resp.text()
    res.json({ success: text.includes('success') || text === 'success', msg: text })
  } catch (e) {
    res.json({ success: false, msg: e.message })
  }
})

app.post('/api/qr-sign-with-enc', async (req, res) => {
  const { activeId, courseId, classId, uid, username, password, enc } = req.body
  if (!enc) return res.json({ success: false, msg: '缺少 enc 参数' })
  try {
    const listPayload = {
      List: [{ activeId: Number(activeId), classId: String(classId), courseId: String(courseId), title1: '', title2: '', uid: String(uid || '') }]
    }
    const ps = new URLSearchParams()
    ps.append('username', username || '')
    ps.append('password', password || '')
    ps.append('List', JSON.stringify(listPayload))
    ps.append('enc', enc)
    const targetUrl = `http://xxtvipline.bfmzdx.cn/freexxtcnm?${ps.toString()}`

    const resp = await fetch(targetUrl, { headers: { 'User-Agent': UA_MOBILE } })
    const text = await resp.text()
    let data
    try { data = JSON.parse(text) } catch (e) { data = { msg: text } }
    res.json({
      success: data.result === 1,
      msg: data.msg || data.errorMsg || (data.result === 1 ? '签到成功' : text || '签到失败')
    })
  } catch (e) {
    res.json({ success: false, msg: e.message })
  }
})

// Vercel Serverless 导出
module.exports = app