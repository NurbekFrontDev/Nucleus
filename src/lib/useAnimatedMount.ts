import { useEffect, useState } from 'react'

// Держит элемент в DOM ещё немного после закрытия, чтобы успела проиграться
// анимация исчезновения, а затем убирает его из дерева.
//
//   open      — целевое состояние (true = открыт/виден).
//   duration  — длительность анимации закрытия в мс (должна совпадать с CSS).
//
// Возвращает mounted — нужно ли рендерить элемент прямо сейчас.
// В разметке класс выбирается по open:
//   className={open ? 'animate-pop' : 'animate-pop-out'}
// так появление и исчезновение играют разные keyframes.
export function useAnimatedMount(open: boolean, duration = 200): boolean {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    // Закрываемся: оставляем в DOM на время анимации, затем размонтируем.
    const id = window.setTimeout(() => setMounted(false), duration)
    return () => window.clearTimeout(id)
  }, [open, duration])

  return mounted
}
