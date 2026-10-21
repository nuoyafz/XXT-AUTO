import express from 'express'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import fetch from 'node-fetch'
import { CookieJar } from 'tough-cookie'
import crypto from 'crypto'
import * as cheerio from 'cheerio'

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
  const name = a.nameOne || a.name || ''
  if (name.includes('二维码')) return '二维码签到'
  if (name.includes('签到码')) return '签到码'
  if (name.includes('位置')) return '位置签到'
  if (name.includes('手势')) return '手势签到'
  if (name.includes('拍照')) return '拍照签到'
  return '普通签到'
}

function filterSignin(activeList) {
  return activeList
    .filter(a => a.activeType === SIGNIN_ACTIVE_TYPE)
    .filter(a => !NON_SIGNIN_TYPES.includes(a.activeType))
}

// ---------- AES 加密 ----------
function aesEncrypt(plaintext) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_KEY)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}

// ---------- Cookie 工具 ----------
function cookieHeader(cookies) {
  if (!cookies || cookies.length === 0) return ''
  return cookies.map(c => `${c.key}=${c.value}`).join('; ')
}

async function getSessionInfo() {
  const cookies = await cookieJar.getCookies('https://chaoxing.com')
  const ck = cookieHeader(cookies)
  const uidMatch = ck.match(/_uid=([^;]+)/) || ck.match(/(?:^|;\s*)uid=([^;]+)/)
  const fidMatch = ck.match(/fid=([^;]+)/)
  return {
    uid: uidMatch ? uidMatch[1] : '',
    fid: fidMatch ? fidMatch[1] : '',
    raw: ck
  }
}

// ---------- 带 Cookie 的请求（多子域合并，匹配 server.js） ----------
async function cxFetch(url, options = {}) {
  const allCookies = await cookieJar.getCookies('https://chaoxing.com')
  const subdomains = ['passport2.chaoxing.com', 'i.chaoxing.com', 'mooc2-ans.chaoxing.com', 'mobilelearn.chaoxing.com', 'app.chaoxing.com']
  for (const sub of subdomains) {
    try {
      const subCookies = await cookieJar.getCookies(`https://${sub}`)
      for (const c of subCookies) {
        if (!allCookies.find(ac => ac.key === c.key)) allCookies.push(c)
      }
    } catch (e) {}
  }
  const ck = cookieHeader(allCookies)
  const headers = {
    'User-Agent': UA_MOBILE,
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(ck ? { Cookie: ck } : {}),
    ...(options.headers || {})
  }
  const res = await fetch(url, { ...options, headers })
  const setCookie = res.headers.raw()['set-cookie']
  if (setCookie) {
    const targetUrl = new URL(url)
    for (const sc of setCookie) {
      try {
        let cookieStr = sc
        if (!/domain=/i.test(sc)) {
          const parts = sc.split(';')
          parts.push(' Domain=.chaoxing.com')
          cookieStr = parts.join(';')
        }
        await cookieJar.setCookie(cookieStr, targetUrl.origin)
      } catch (e) {}
    }
  }
  return res
}

// ============ API: 登录 ============
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.json({ success: false, msg: '请输入账号和密码' })
  try {
    await cookieJar.removeAllCookies()

    // 同步 server.js: 用户名也要 AES 加密
    const encUname = aesEncrypt(username.trim())
    const encPwd = aesEncrypt(password)

    const body = new URLSearchParams({
      fid: '-1',
      uname: encUname,
      password: encPwd,
      refer: 'http://i.chaoxing.com',
      t: 'true',
      forbidotherlogin: '0',
      validate: '',
      doubleFactorLogin: '0',
      independentId: '0',
      independentNameId: '0'
    })

    const resp = await cxFetch('https://passport2.chaoxing.com/fanyalogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA_MOBILE,
      },
      body: body.toString()
    })

    const text = await resp.text()
    let data
    try { data = JSON.parse(text) } catch (e) { data = { msg2: text } }

    if (data.status) {
      const uid = data.uid || ''
      const name = data.name || ''
      const redirectUrl = data.url ? decodeURIComponent(data.url) : ''

      // 跟随跳转建立完整会话 cookie
      if (redirectUrl) {
        try {
          const jumpResp = await cxFetch(redirectUrl, {
            redirect: 'manual',
            headers: { 'User-Agent': UA_MOBILE }
          })
          let nextLoc = jumpResp.headers.get('location')
          let hops = 0
          while (nextLoc && hops < 10) {
            const absUrl = nextLoc.startsWith('http') ? nextLoc : new URL(nextLoc, redirectUrl).href
            const r2 = await cxFetch(absUrl, {
              redirect: 'manual',
              headers: { 'User-Agent': UA_MOBILE }
            })
            nextLoc = r2.headers.get('location')
            hops++
          }
        } catch (e) {}
      }

      res.json({ success: true, uid, name, msg: '登录成功' })
    } else {
      res.json({ success: false, msg: data.msg2 || data.msg || '登录失败' })
    }
  } catch (e) {
    res.json({ success: false, msg: '登录请求失败: ' + e.message })
  }
})

// ============ API: 一键扫描所有课程签到 ============
app.post('/api/scan-all', async (req, res) => {
  try {
    const { uid, fid } = await getSessionInfo()
    if (!uid) return res.json({ success: false, msg: '未登录，请先登录' })

    // 1. 获取课程列表（缓存30分钟）
    let courses = cacheGet('courses')
    if (!courses) {
      const body = new URLSearchParams({
        courseType: '1', courseFolderId: '0', query: '',
        pageHeader: '-1', single: '0', superstarClass: '0',
        isFirefly: '0', filterFid: '', from: ''
      })
      const courseResp = await cxFetch('https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata', {
        method: 'POST',
        headers: {
          'User-Agent': UA_MOBILE,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString()
      })
      const courseText = await courseResp.text()

      const $ = cheerio.load(courseText)
      courses = []
      $('.learnCourse').each((i, el) => {
        const $el = $(el)
        courses.push({
          courseId: $el.find('.courseId').val() || '',
          classId: $el.find('.clazzId').val() || '',
          name: $el.find('.course-name').attr('title') || $el.find('.course-name').text().trim() || '未知课程',
        })
      })
      if (courses.length > 0) cacheSet('courses', courses, 30 * 60 * 1000)
    }

    if (!courses || courses.length === 0) {
      return res.json({ success: false, msg: '未找到课程' })
    }

    // 2. 批量扫描签到（每批10门）
    const BATCH = 10
    const results = []
    for (let i = 0; i < courses.length; i += BATCH) {
      const batch = courses.slice(i, i + BATCH)
      const batchResults = await Promise.all(batch.map(async (course) => {
        const cacheKey = `punch_${course.courseId}_${course.classId}`
        const cached = cacheGet(cacheKey)
        if (cached) return { ...course, punchs: cached }

        try {
          const pResp = await cxFetch(
            `https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist?fid=${fid}&courseId=${course.courseId}&classId=${course.classId}&showNotActive=0`,
            { headers: { 'User-Agent': UA_MOBILE, 'Accept': 'application/json' } }
          )
          const pText = await pResp.text()
          let pData
          try { pData = JSON.parse(pText) } catch (e) {
            return { ...course, punchs: [] }
          }
          const activeList = pData?.data?.activeList || []
          const signinList = filterSignin(activeList)
          const punchs = signinList.map(a => ({
            activeId: a.id,
            name: a.nameOne || a.name || '签到',
            nameOne: a.nameOne,
            type: mapSigninType(a),
            typeName: mapSigninType(a),
            typeCode: a.otherId,
            otherId: a.otherId,
            isSigned: a.isdone === 1 || a.status === 2,
            status: a.status,
            activeType: a.activeType,
            startTime: a.startTime,
            endTime: a.endTime,
            courseId: course.courseId,
            classId: course.classId,
          }))
          cacheSet(cacheKey, punchs, 60 * 1000)
          return { ...course, punchs }
        } catch (e) {
          return { ...course, punchs: [], error: e.message }
        }
      }))
      results.push(...batchResults)
    }

    res.json({ success: true, courses: results, uid, fid })
  } catch (e) {
    res.json({ success: false, msg: '扫描失败: ' + e.message })
  }
})

// ============ API: 普通签到 ============
app.post('/api/do-sign', async (req, res) => {
  const { activeId } = req.body
  try {
    const { uid, fid } = await getSessionInfo()
    if (!uid) return res.json({ success: false, msg: '未登录' })

    const signUrl = `https://mobilelearn.chaoxing.com/pptSign/stuSignajax?activeId=${activeId}&uid=${uid}&clientip=&latitude=0&longitude=0&fid=${fid}&appType=15&ifTiJiao=1`
    const resp = await cxFetch(signUrl, {
      headers: { 'User-Agent': UA_MOBILE, 'Accept': '*/*' }
    })
    const text = await resp.text()
    const success = text.includes('成功') || text.includes('已签')
    res.json({ success, msg: text.slice(0, 200), activeId })
  } catch (e) {
    res.json({ success: false, msg: '签到失败: ' + e.message })
  }
})

// ============ API: 二维码签到（bfmzdx 代理） ============
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

export default app