import React from 'react'
import ReactDOM from 'react-dom/client'
import 'dayjs/locale/ko'
import dayjs from 'dayjs'
import App from './App'
import { setupDesktop } from './desktop'
import './styles.css'

dayjs.locale('ko')

// Tauri 환경에서만 트레이/창닫기 처리 (브라우저에서 열었을 때는 건너뜀)
if ('__TAURI_INTERNALS__' in window) {
  void setupDesktop().catch((e) => console.error('desktop setup failed', e))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
