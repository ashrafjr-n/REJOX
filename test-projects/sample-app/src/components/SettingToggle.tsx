interface SettingToggleProps {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  darkMode?: boolean
}

/** A labelled toggle row used on the Settings page. */
export default function SettingToggle({
  label,
  description,
  checked,
  onChange,
  darkMode = false,
}: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className={`font-medium ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
          {label}
        </p>
        <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : darkMode ? 'bg-slate-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
