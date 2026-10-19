import { useState } from 'react'
import Shortcuts from './Shortcuts'

function CommandBox({ command, label }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await window.mc.runShortcut({ kind: 'copy', label: 'Copy', text: command })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded bg-black/40 ring-1 ring-zinc-800 px-2.5 py-1.5">
      {label && <span className="text-[10px] text-zinc-500 pt-0.5">{label}</span>}
      <code className="flex-1 text-[11px] text-sky-200 break-all selectable">{command}</code>
      <button onClick={copy} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function FixGuide({ result }) {
  const [note, setNote] = useState(null)
  const flash = (text) => { setNote(text); setTimeout(() => setNote(null), 2500) }

  const ask = async () => {
    const res = await window.mc.runShortcut(result.assist)
    flash(res.ok ? 'Opening Claude Code in a new terminal…' : res.error)
  }
  const copyBrief = async () => {
    await window.mc.runShortcut({ kind: 'copy', label: 'Copy', text: result.assist.prompt })
    flash('Report copied — paste it into Claude')
  }

  return (
    <section className="rounded-lg ring-1 ring-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">How to fix</h4>

      {result.guide?.steps?.length ? (
        <ol className="space-y-3">
          {result.guide.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[13px]">
              <span className="w-5 h-5 shrink-0 rounded-full bg-zinc-800 text-[11px] grid place-items-center text-zinc-300">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-zinc-200 selectable">{s.text}</p>
                {s.commands?.length > 1 && <p className="mt-1 text-[11px] text-zinc-500">Run each line in order. If one fails, stop there and use Ask Claude.</p>}
                {s.commands?.map((c) => <CommandBox key={c} command={c} />)}
                {s.sql && <CommandBox command={s.sql} label="SQL" />}
                {s.url && (
                  <div className="mt-1.5"><Shortcuts shortcuts={[{ kind: 'openUrl', label: 'Open link', url: s.url }]} /></div>
                )}
                {s.shortcut && <div className="mt-1.5"><Shortcuts shortcuts={[s.shortcut]} /></div>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-zinc-500">No written steps for this one.</p>
      )}

      <p className="text-[11px] text-zinc-500">After fixing, press ↻ on the check to confirm.</p>

      {result.assist && (
        <div className="border-t border-zinc-800 pt-3">
          <p className="text-[11px] text-zinc-400 mb-2">
            Still stuck? Hand it to Claude with the full context. Claude Code opens in the right folder, reads this report, and asks before changing anything.
          </p>
          <div className="flex gap-2">
            <button onClick={ask} className="text-xs px-3 py-1.5 rounded bg-orange-700 hover:bg-orange-600 text-white">✦ Ask Claude</button>
            <button onClick={copyBrief} className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700">Copy for Claude</button>
          </div>
          {note && <p className="text-[11px] text-emerald-400 mt-2">{note}</p>}
        </div>
      )}
    </section>
  )
}
