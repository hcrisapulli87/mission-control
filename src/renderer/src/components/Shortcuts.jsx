import { useState } from 'react'

const ICON = { openPath: '📁', openUrl: '↗', openInCode: '⌨', openTerminal: '>_', copy: '⧉' }

export default function Shortcuts({ shortcuts }) {
  const [flash, setFlash] = useState(null)
  const run = async (s, i) => {
    const res = await window.mc.runShortcut(s)
    setFlash({ i, text: res.ok ? res.message ?? 'Opened' : res.error })
    setTimeout(() => setFlash(null), 1800)
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {shortcuts.map((s, i) => (
        <button key={i} onClick={() => run(s, i)}
          className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          title={s.text ?? s.url ?? s.path}>
          <span className="opacity-70 mr-1">{ICON[s.kind]}</span>
          {flash?.i === i ? flash.text : s.label}
        </button>
      ))}
    </div>
  )
}
