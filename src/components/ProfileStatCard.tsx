export function ProfileStatCard({ label, value, accent = 'neutral' }: {
  label: string; value: string; accent?: 'up' | 'down' | 'neutral'
}) {
  const color = accent === 'up' ? 'text-green-700' : accent === 'down' ? 'text-red-600' : 'text-green-900'
  return <div className="rounded-xl border border-green-200 bg-white px-3 py-3 shadow-sm sm:px-4">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`mt-1 break-words text-xl font-bold sm:text-2xl ${color}`}>{value}</p>
  </div>
}
