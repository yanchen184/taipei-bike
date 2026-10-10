import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** 3D 場景（含貼圖載入）失敗時改顯示錯誤訊息，HUD 等其他畫面不受影響 */
export class SceneErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('3D 場景載入失敗', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-neutral-900 text-white">
        街景載入失敗，請重新整理頁面。
      </div>
    )
  }
}
