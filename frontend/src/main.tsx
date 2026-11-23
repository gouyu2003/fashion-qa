import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0F625F',
          colorInfo: '#0F625F',
          colorSuccess: '#2A7A5E',
          colorWarning: '#93691F',
          colorError: '#B3341F',
          colorText: '#203342',
          colorTextSecondary: '#5B6B77',
          colorBorder: '#DDE4E6',
          colorBorderSecondary: '#E8EDEE',
          colorBgLayout: '#F4F6F7',
          colorBgContainer: '#ffffff',
          colorFillQuaternary: '#F7F9FA',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontSize: 14,
          controlHeight: 38,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          lineHeight: 1.65,
        },
        components: {
          Button: { controlHeight: 38, fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
          Card: { bodyPadding: 20, headerFontSize: 16 },
          Input: { activeShadow: '0 0 0 3px rgba(15, 98, 95, 0.14)' },
          Select: { optionSelectedBg: '#E7EFEE', optionSelectedColor: '#203342' },
          Collapse: { headerBg: '#F7F9FA', contentBg: '#ffffff' },
          Tag: { defaultBg: '#F1F4F5' },
          Drawer: { paddingLG: 20 },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
