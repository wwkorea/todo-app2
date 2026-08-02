import { defaultWindowIcon } from '@tauri-apps/api/app'
import { Menu } from '@tauri-apps/api/menu'
import { TrayIcon } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 창 닫기 = 트레이로 숨김 + 트레이 아이콘 (Electron 메인의 tray/close 처리 대체) */
export async function setupDesktop(): Promise<void> {
  const win = getCurrentWindow()

  await win.onCloseRequested(async (e) => {
    e.preventDefault()
    await win.hide()
  })

  const show = async (): Promise<void> => {
    await win.show()
    await win.setFocus()
  }

  const menu = await Menu.new({
    items: [
      { id: 'open', text: '열기', action: () => void show() },
      { item: 'Separator' },
      { id: 'quit', text: '종료', action: () => void win.destroy() }
    ]
  })

  await TrayIcon.new({
    menu,
    icon: (await defaultWindowIcon()) ?? undefined,
    tooltip: 'Todo',
    showMenuOnLeftClick: true,
    action: (e) => {
      if (e.type === 'DoubleClick') void show()
    }
  })
}
