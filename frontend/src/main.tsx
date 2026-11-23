import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import App from './App'
import './styles.css'

const palette = {
  ink: '#1A1918',
  muted: '#6E6A63',
  canvas: '#FAF8F5',
  panel: '#FFFFFF',
  linen: '#F3F0EA',
  subtle: '#F7F4EE',
  line: '#E8E4DC',
  lineStrong: '#D9D1C4',
  accent: '#8C6B48',
  accentInk: '#755437',
  accentSoft: '#F1EAE0',
  selected: '#EAE1D4',
  actionHover: '#4B392B',
  success: '#42583A',
  successSoft: '#EAF0E4',
  warning: '#815621',
  warningSoft: '#F7EDDC',
  danger: '#A13B2E',
  dangerSoft: '#F8EAE6',
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: palette.ink,
          colorPrimaryHover: palette.actionHover,
          colorInfo: palette.accent,
          colorInfoBg: palette.accentSoft,
          colorInfoText: palette.accentInk,
          colorSuccess: palette.success,
          colorSuccessBg: palette.successSoft,
          colorWarning: palette.warning,
          colorWarningBg: palette.warningSoft,
          colorError: palette.danger,
          colorErrorBg: palette.dangerSoft,
          colorText: palette.ink,
          colorTextSecondary: palette.muted,
          colorLink: palette.accentInk,
          colorLinkHover: palette.actionHover,
          colorBorder: palette.lineStrong,
          colorBorderSecondary: palette.line,
          colorBgLayout: palette.canvas,
          colorBgContainer: palette.panel,
          colorFillQuaternary: palette.linen,
          controlItemBgHover: palette.subtle,
          controlItemBgActive: palette.accentSoft,
          controlItemBgActiveHover: palette.selected,
          controlOutline: 'rgba(140, 107, 72, 0.2)',
          blue: palette.accentInk,
          cyan: palette.muted,
          green: palette.success,
          gold: palette.accentInk,
          orange: palette.warning,
          red: palette.danger,
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
          Input: { activeShadow: '0 0 0 3px rgba(140, 107, 72, 0.16)' },
          Select: { optionSelectedBg: palette.accentSoft, optionSelectedColor: palette.ink },
          Collapse: { headerBg: palette.subtle, contentBg: palette.panel },
          Tag: { defaultBg: palette.linen },
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
