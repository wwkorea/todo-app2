import { useState } from 'react'
import { Button, Divider, Form, Input, InputNumber, Modal, Segmented, Space, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import {
  createTabAction,
  saveSettingsPatch,
  setDataDir,
  setSettingsOpen,
  useAppStore
} from '../store'
import { api } from '../api'

/** 일반 설정 모달. firstRun이면 저장경로를 지정할 때까지 닫을 수 없다. */
export default function SettingsModal({ firstRun }: { firstRun: boolean }): React.ReactNode {
  const open = useAppStore((s) => s.settingsOpen) || firstRun
  const dataDir = useAppStore((s) => s.dataDir)
  const settings = useAppStore((s) => s.settings)
  const [pickedDir, setPickedDir] = useState<string | null>(null)
  const [newTabName, setNewTabName] = useState('')
  const [newTabType, setNewTabType] = useState<'todo' | 'memo'>('todo')
  const [busy, setBusy] = useState(false)

  const effectiveDir = pickedDir ?? dataDir

  const pick = async (): Promise<void> => {
    const dir = await api.pickDir()
    if (dir) setPickedDir(dir)
  }

  const apply = async (): Promise<void> => {
    if (!effectiveDir) return
    setBusy(true)
    try {
      if (pickedDir && pickedDir !== dataDir) {
        await setDataDir(pickedDir)
        message.success('저장 폴더가 설정되었습니다')
      }
      setPickedDir(null)
      setSettingsOpen(false)
    } catch (e) {
      message.error(`폴더 설정 실패: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const addTab = async (): Promise<void> => {
    const name = newTabName.trim()
    if (!name) return
    const folder = name
      .toLowerCase()
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!folder) {
      message.error('폴더명으로 쓸 수 있는 영문/숫자가 이름에 포함되어야 합니다')
      return
    }
    try {
      await createTabAction(folder, name, newTabType)
      setNewTabName('')
      message.success(`'${name}' 탭이 추가되었습니다`)
    } catch (e) {
      message.error(`탭 추가 실패: ${String(e)}`)
    }
  }

  return (
    <Modal
      title={firstRun ? '시작하기 — 데이터 저장 폴더를 선택하세요' : '설정'}
      open={open}
      closable={!firstRun}
      maskClosable={false}
      keyboard={!firstRun}
      onCancel={() => {
        setPickedDir(null)
        setSettingsOpen(false)
      }}
      footer={
        <Button type="primary" onClick={() => void apply()} disabled={!effectiveDir} loading={busy}>
          {firstRun ? '시작' : '확인'}
        </Button>
      }
    >
      {firstRun && (
        <p className="setup-hint">
          모든 문서는 이 폴더에 md 파일로 저장됩니다.
          <br />
          폴더를 지정해야 앱을 시작할 수 있습니다.
        </p>
      )}
      <Form layout="vertical">
        <Form.Item label="데이터 저장 폴더">
          <Space.Compact style={{ width: '100%' }}>
            <Input value={effectiveDir ?? ''} readOnly placeholder="폴더를 선택하세요" />
            <Button icon={<FolderOpenOutlined />} onClick={() => void pick()}>
              찾아보기
            </Button>
          </Space.Compact>
        </Form.Item>

        {!firstRun && (
          <>
            <Form.Item label="테마">
              <Segmented
                value={settings.theme ?? 'light'}
                onChange={(v) => void saveSettingsPatch({ theme: v as 'light' | 'dark' })}
                options={[
                  { label: '라이트', value: 'light' },
                  { label: '다크', value: 'dark' }
                ]}
              />
            </Form.Item>
            <Form.Item label="자동저장 대기 시간 (분)">
              <InputNumber
                min={0.5}
                max={60}
                step={0.5}
                value={settings.autosave_minutes}
                onChange={(v) => v && void saveSettingsPatch({ autosave_minutes: v })}
              />
            </Form.Item>
            <Form.Item label="파일별 롤링 백업 보관 개수">
              <InputNumber
                min={1}
                max={50}
                value={settings.backup_keep}
                onChange={(v) => v && void saveSettingsPatch({ backup_keep: v })}
              />
            </Form.Item>

            <Divider plain>새 탭 추가</Divider>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="탭 이름 (예: Ideas)"
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                onPressEnter={() => void addTab()}
              />
              <Segmented
                value={newTabType}
                onChange={(v) => setNewTabType(v as 'todo' | 'memo')}
                options={[
                  { label: 'Todo형', value: 'todo' },
                  { label: '메모형', value: 'memo' }
                ]}
              />
              <Button onClick={() => void addTab()}>추가</Button>
            </Space.Compact>
          </>
        )}
      </Form>
    </Modal>
  )
}
