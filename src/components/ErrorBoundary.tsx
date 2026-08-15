import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-200">
            😵 Что-то пошло не так
          </p>
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
          >
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
