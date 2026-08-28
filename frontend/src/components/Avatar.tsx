interface Props {
  url?: string | null
  name: string
  size?: number
}

export default function Avatar({ url, name, size = 44 }: Props) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'

  const style = { width: size, height: size, minWidth: size }

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        loading="lazy"
        className="rounded-full object-cover ring-1 ring-slate-700"
      />
    )
  }

  return (
    <div
      style={style}
      aria-hidden
      className="flex items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-slate-200"
    >
      {initials}
    </div>
  )
}
