import { useState } from 'react'
import ScanScreen from './ScanScreen'

const API = '/api'

export default function App() {
  const [step, setStep] = useState('login')
  const [user, setUser] = useState({ username: '', uid: '', fid: '', password: '' })

  const isScanRoute = window.location.hash.startsWith('#/scan')
  if (isScanRoute) return <ScanScreen />

  const handleLoginSuccess = (data) => {
    setUser({ username: data.username, uid: data.uid, fid: data.fid, password: data.password })
    setStep('dashboard')
  }

  const handleLogout = () => {
    setUser({ username: '', uid: '', fid: '', password: '' })
    setStep('login')
  }

  return (
    <div className="app-root">
      {step === 'login' && (
        <LoginScreen onSuccess={handleLoginSuccess} />
      )}
      {step === 'dashboard' && (
        <DashboardPanel user={user} onBack={handleLogout} />
      )}
    </div>
  )
}

// ============ 登录页：学习通账号密码 ============
function LoginScreen({ onSuccess }) {
  const saved = JSON.parse(localStorage.getItem('xby_cred') || '{}')
  const [username, setUsername] = useState(saved.username || '')
  const [password, setPassword] = useState(saved.password || '')
  const [remember, setRemember] = useState(!!saved.username)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('')

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setMsg('请输入账号和密码')
      setMsgType('error')
      return
    }
    if (remember) {
      localStorage.setItem('xby_cred', JSON.stringify({ username: username.trim(), password: password.trim() }))
    } else {
      localStorage.removeItem('xby_cred')
    }
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() })
      })
      const data = await res.json()
      if (data.success) {
        setMsg(data.msg || '登录成功')
        setMsgType('ok')
        setTimeout(() => onSuccess({ username: username.trim(), uid: data.uid, fid: data.fid, password: password.trim() }), 500)
      } else {
        setMsg(data.msg || '登录失败')
        setMsgType('error')
      }
    } catch (e) {
      setMsg('网络错误: ' + e.message)
      setMsgType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-bg">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
      </div>

      <div className="login-card">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
        </div>
        <h1 className="login-title">学习通签到</h1>
        <p className="login-subtitle">超星学习通 · 课程签到助手</p>

        <div className="input-group">
          <label>学习通账号</label>
          <input
            type="text"
            placeholder="手机号 / 学号"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <div className="input-group">
          <label>密码</label>
          <input
            type="password"
            placeholder="学习通密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <div className="remember-row">
          <label className="remember-label" onClick={() => setRemember(!remember)}>
            <span className={`remember-box ${remember ? 'checked' : ''}`}>
              {remember && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>}
            </span>
            记住密码
          </label>
        </div>

        {msg && <div className={`login-msg ${msgType}`}>{msg}</div>}

        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>

        <p className="login-hint">登录后一键扫描所有课程签到任务</p>
        <p className="login-version">v2.6</p>
      </div>
    </div>
  )
}

// ============ 签到面板 ============
function DashboardPanel({ user, onBack }) {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [results, setResults] = useState({})
  const [filter, setFilter] = useState('all')
  const [hideSigned, setHideSigned] = useState(false)
  const [qrPanel, setQrPanel] = useState(null)
  const [qrData, setQrData] = useState(null)
  const [qrEnc, setQrEnc] = useState('')
  const [qrSubmitting, setQrSubmitting] = useState(false)

  const allUnsigned = courses.reduce((s, c) => s + (c.punchs || []).filter(p => !p.isSigned).length, 0)

  const displayCourses = (() => {
    let list = [...courses]
    if (filter === 'unsigned') {
      list = list.filter(c => (c.punchs || []).some(p => !p.isSigned))
    }
    list.sort((a, b) => {
      const ua = (a.punchs || []).filter(p => !p.isSigned).length
      const ub = (b.punchs || []).filter(p => !p.isSigned).length
      if (ua !== ub) return ub - ua
      return (b.punchs || []).length - (a.punchs || []).length
    })
    return list
  })()

  const handleScanAll = async () => {
    setLoading(true)
    setStatus('正在扫描所有课程...')
    setCourses([])
    setResults({})
    setQrPanel(null)
    setQrData(null)
    setQrEnc('')
    try {
      const res = await fetch(`${API}/scan-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (data.success) {
        const list = data.courses || []
        setCourses(list)
        const withPunch = list.filter(c => (c.punchs || []).length > 0)
        const total = withPunch.reduce((s, c) => s + (c.punchs || []).length, 0)
        if (withPunch.length > 0) {
          setStatus(`扫描完成：共 ${list.length} 门课，${withPunch.length} 门有签到任务，共 ${total} 个签到`)
        } else {
          setStatus(`扫描完成：共 ${list.length} 门课，暂无签到任务`)
        }
      } else {
        setStatus(data.msg || '扫描失败')
      }
    } catch (e) {
      setStatus('扫描失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSign = async (punch) => {
    const key = `${punch.activeId}`
    setResults(p => ({ ...p, [key]: 'loading' }))
    try {
      const res = await fetch(`${API}/do-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeId: punch.activeId,
          courseId: punch.courseId,
          classId: punch.classId,
          lat: 0,
          lng: 0
        })
      })
      const data = await res.json()
      setResults(p => ({ ...p, [key]: data.success ? 'ok' : 'fail', msg: data.msg }))
    } catch (e) {
      setResults(p => ({ ...p, [key]: 'err', msg: e.message }))
    }
  }

  const handleSignAll = async () => {
    const tasks = []
    for (const c of courses) {
      for (const p of (c.punchs || [])) {
        if (!p.isSigned && !isQrType(p)) tasks.push(p)
      }
    }
    // 限制并发数为3，避免被学习通限流
    const LIMIT = 3
    for (let i = 0; i < tasks.length; i += LIMIT) {
      await Promise.all(tasks.slice(i, i + LIMIT).map(p => handleSign(p)))
    }
  }

  const handleGenerateQr = (punch) => {
    setQrPanel(punch.activeId)
    setQrData(null)
    setQrEnc('')
    // 生成我们自己的扫码页链接（部署到公网后别人可访问）
    const params = new URLSearchParams({
      activeId: punch.activeId,
      courseId: punch.courseId,
      classId: punch.classId,
      uid: user.uid || '',
      username: user.username,
      password: user.password,
    })
    const scanUrl = `${window.location.origin}${window.location.pathname}#/scan?${params.toString()}`
    setQrData({ url: scanUrl })
  }

  const handleQrSignWithEnc = async (punch) => {
    if (!qrEnc.trim()) return
    setQrSubmitting(true)
    try {
      const res = await fetch(`${API}/qr-sign-with-enc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeId: punch.activeId,
          courseId: punch.courseId,
          classId: punch.classId,
          uid: user.uid || '',
          username: user.username,
          password: user.password,
          enc: qrEnc.trim(),
        })
      })
      const data = await res.json()
      if (data.success) {
        setResults(p => ({ ...p, [punch.activeId]: 'ok', msg: data.msg }))
        setQrPanel(null)
        setQrData(null)
        setQrEnc('')
        setStatus(data.msg || '签到成功')
      } else {
        setStatus(data.msg || '签到失败')
      }
    } catch (e) {
      setStatus('签到失败: ' + e.message)
    } finally {
      setQrSubmitting(false)
    }
  }

  const typeTag = (t) => {
    const map = {
      '普通签到': { c: '#fff3e0', tc: '#e65100', i: '✏️' },
      '签到码':   { c: '#e3f2fd', tc: '#1565c0', i: '🔢' },
      '拍照签到': { c: '#e3f2fd', tc: '#1565c0', i: '📷' },
      '位置签到': { c: '#e8f5e9', tc: '#2e7d32', i: '📍' },
      '手势签到': { c: '#f3e5f5', tc: '#7b1fa2', i: '✋' },
      '二维码签到': { c: '#e3f2fd', tc: '#1565c0', i: '🔳' },
      '密码签到': { c: '#fff3e0', tc: '#e65100', i: '🔑' },
    }
    const v = map[t] || { c: '#f5f5f5', tc: '#666', i: '📌' }
    return <span className="type-badge" style={{ background: v.c, color: v.tc }}>{v.i} {t}</span>
  }

  const isQrType = (punch) => punch.type === '二维码签到' || punch.typeCode === 6 || (punch.name && punch.name.includes('二维码'))

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-header-left">
          <div className="app-logo-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
          </div>
          <span className="dash-title">签到面板</span>
        </div>
        <button className="dash-back" onClick={onBack}>退出</button>
      </header>

      <div className="dash-body">
        <div className="user-info">
          <span className="user-name">{user.username}</span>
          <span className="user-stat">
            {courses.length > 0 ? `${courses.length}门课 · ${allUnsigned}个未签` : ''}
          </span>
        </div>

        <div className="dash-actions">
          <button className="dash-btn dash-btn-scan" onClick={handleScanAll} disabled={loading}>
            {loading ? '扫描中...' : '一键扫描所有课程签到'}
          </button>
          {courses.length > 0 && allUnsigned > 0 && (
            <button className="dash-btn dash-btn-sign" onClick={handleSignAll}>
              一键签到全部 ({allUnsigned}个)
            </button>
          )}
        </div>

        {courses.length > 0 && (
          <div className="filter-bar">
            <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              全部 ({courses.length})
            </button>
            <button className={`filter-chip ${filter === 'unsigned' ? 'active' : ''}`} onClick={() => setFilter('unsigned')}>
              有未签到 ({courses.filter(c => (c.punchs||[]).some(p=>!p.isSigned)).length})
            </button>
            <label className="hide-signed-label" title="隐藏已签任务，只看未签到">
              <input type="checkbox" checked={hideSigned} onChange={e => setHideSigned(e.target.checked)} />
              <span>隐藏已签到</span>
            </label>
          </div>
        )}

        {status && (
          <div className={`dash-status ${status.includes('失败') || status.includes('没有') ? 'warn' : 'ok'}`}>
            {status}
          </div>
        )}

        <div className="dash-list">
          {displayCourses.map(c => {
            const unsignedCount = (c.punchs || []).filter(p => !p.isSigned).length
            return (
            <div key={c.courseId} className="course-item">
              <div
                className="course-item-head"
                onClick={() => setExpanded(expanded === c.courseId ? null : c.courseId)}
              >
                <div className="course-item-info">
                  <span className="course-name">{c.name}</span>
                </div>
                <div className="course-item-meta">
                  {unsignedCount > 0 && <span className="unsigned-badge">{unsignedCount}</span>}
                  {(c.punchs || []).length > 0 && <span className="punch-count">{(c.punchs || []).length}个签到</span>}
                  <span className="expand-arrow">{expanded === c.courseId ? '▾' : '▸'}</span>
                </div>
              </div>

              {expanded === c.courseId && (
                <div className="punch-sublist">
                  {c.punchs && c.punchs.length > 0 ? c.punchs.sort((a,b) => (a.isSigned ? 1 : 0) - (b.isSigned ? 1 : 0)).filter(p => !hideSigned || !p.isSigned).map(p => {
                    const r = results[p.activeId]
                    return (
                      <div key={p.activeId} className={`punch-row ${!p.isSigned ? 'punch-urgent' : ''}`}>
                        <div className="punch-row-left">
                          {typeTag(p.type)}
                          <span className="punch-name">{p.name}</span>
                          {!p.isSigned && <span className="dot-danger" />}
                        </div>
                        <div className="punch-row-right">
                          {p.isSigned ? <span className="result-tag ok">已签到</span> :
                           r === 'ok' ? <span className="result-tag ok">签到成功</span> :
                           r === 'fail' && !isQrType(p) ? <span className="result-tag fail">失败</span> :
                           r === 'loading' ? <span className="result-tag loading">签到中</span> :
                           <button className={`punch-sign-btn ${isQrType(p) ? 'qr-btn' : ''}`} onClick={() => isQrType(p) ? handleGenerateQr(p) : handleSign(p)}>签到</button>}
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="punch-row no-punch">
                      <span className="punch-name" style={{ color: '#999' }}>暂无签到任务</span>
                    </div>
                  )}

                  {qrPanel && c.punchs && c.punchs.some(p => p.activeId === qrPanel && isQrType(p)) && (() => {
                    const qp = c.punchs.find(p => p.activeId === qrPanel)
                    return (
                      <div className="qr-panel">
                        <div className="qr-panel-title">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M12 2v20M2 12h20"/></svg>
                          二维码签到 · {qp?.name || ''}
                          <button className="qr-close" onClick={() => { setQrPanel(null); setQrData(null); setQrEnc('') }}>✕</button>
                        </div>
                        {qrData ? (
                          <>
                            <div className="qr-info">
                              <div className="qr-info-step">1. 复制下面的链接发给教室里的人</div>
                              <div className="qr-info-step">2. 对方用手机浏览器打开链接</div>
                              <div className="qr-info-step">3. 页面会自动打开相机，扫描老师屏幕上的签到二维码</div>
                              <div className="qr-info-step">4. 扫描后自动完成签到</div>
                            </div>
                            <div className="qr-url-row">
                              <input className="qr-url-input" value={qrData.url} readOnly onClick={e => e.target.select()} />
                              <button className="qr-copy-btn" onClick={() => { navigator.clipboard.writeText(qrData.url); setStatus('链接已复制！') }}>复制链接</button>
                            </div>
                            <div className="qr-divider">或手动输入 enc</div>
                            <div className="qr-enc-row">
                              <input
                                className="qr-enc-input"
                                value={qrEnc}
                                onChange={e => setQrEnc(e.target.value)}
                                placeholder="粘贴 enc 参数的值..."
                              />
                              <button
                                className="punch-sign-btn qr-submit-btn"
                                disabled={!qrEnc.trim() || qrSubmitting}
                                onClick={() => handleQrSignWithEnc(qp)}
                              >
                                {qrSubmitting ? '签到中...' : '提交签到'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="qr-loading">正在生成签到链接...</div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )})}

          {!loading && courses.length === 0 && (
            <div className="empty-dash">
              <span className="empty-icon">📋</span>
              <p>点击上方按钮开始扫描</p>
            </div>
          )}
          {!loading && courses.length > 0 && displayCourses.length === 0 && filter === 'unsigned' && (
            <div className="empty-dash">
              <span className="empty-icon">🎉</span>
              <p>全部已签到，很棒！</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}