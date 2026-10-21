import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const API = '/api'

function getHashParams() {
  const hash = window.location.hash.replace(/^#\/?scan\??/, '')
  const params = new URLSearchParams(hash)
  return {
    activeId: params.get('activeId') || '',
    courseId: params.get('courseId') || '',
    classId: params.get('classId') || '',
    uid: params.get('uid') || '',
    username: params.get('username') || '',
    password: params.get('password') || '',
  }
}

export default function ScanScreen() {
  const [status, setStatus] = useState('idle')
  const [msg, setMsg] = useState('')
  const [enc, setEnc] = useState('')
  const scannerRef = useRef(null)
  const params = useRef(getHashParams())

  const startScanner = async () => {
    try {
      const html5Qr = new Html5Qrcode('qr-reader')
      scannerRef.current = html5Qr
      setStatus('scanning')
      setMsg('请将摄像头对准老师屏幕上的签到二维码...')
      await html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScanSuccess(decodedText)
        },
        () => {}
      )
    } catch (e) {
      setStatus('error')
      setMsg('无法启动摄像头：' + e.message + '。请确保已授权摄像头权限，并使用 HTTPS 或 localhost 访问。')
    }
  }

  const handleScanSuccess = async (text) => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch (e) {}
      scannerRef.current.clear()
    }
    setStatus('processing')
    setMsg('已扫描到二维码，正在签到...')
    setEnc(text)

    let encValue = ''
    try {
      const u = new URL(text)
      encValue = u.searchParams.get('enc') || ''
    } catch (e) {
      const m = text.match(/enc=([^&]+)/)
      if (m) encValue = m[1]
    }

    if (!encValue) {
      setStatus('error')
      setMsg('二维码中未找到 enc 参数，请重新扫描老师的签到二维码。')
      return
    }

    try {
      const res = await fetch(`${API}/qr-sign-with-enc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params.current, enc: encValue })
      })
      const data = await res.json()
      if (data.success) {
        setStatus('success')
        setMsg(data.msg || '签到成功！')
      } else {
        setStatus('error')
        setMsg(data.msg || '签到失败')
      }
    } catch (e) {
      setStatus('error')
      setMsg('签到请求失败：' + e.message)
    }
  }

  useEffect(() => {
    startScanner()
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  return (
    <div className="scan-root">
      <div className="scan-card">
        <div className="scan-title">扫码签到</div>
        <div className="scan-subtitle">扫描老师屏幕上的签到二维码</div>

        {status === 'scanning' && (
          <div id="qr-reader" className="qr-reader-box" />
        )}

        {status === 'processing' && (
          <div className="scan-result processing">
            <div className="scan-spinner" />
            <p>{msg}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="scan-result success">
            <div className="scan-icon ok">✓</div>
            <p className="scan-result-text">{msg}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="scan-result error">
            <div className="scan-icon fail">✕</div>
            <p className="scan-result-text">{msg}</p>
            {enc && <div className="scan-enc-box">enc: {enc.slice(0, 60)}...</div>}
            <button className="scan-retry-btn" onClick={startScanner}>重新扫描</button>
          </div>
        )}

        <div className="scan-tip">
          提示：需要授权摄像头权限，建议使用手机浏览器打开。
        </div>
      </div>
    </div>
  )
}