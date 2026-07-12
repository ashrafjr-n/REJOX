interface FeatureCardProps {
  icon: string
  title: string
  description: string
}

/** Small marketing card used on the home page feature row. */
export default function FeatureCard({
  icon,
  title,
  description,
}: FeatureCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-5 ring-1 ring-slate-200 transition-shadow hover:shadow-md">
      <span className="text-2xl">{icon}</span>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  )
}
