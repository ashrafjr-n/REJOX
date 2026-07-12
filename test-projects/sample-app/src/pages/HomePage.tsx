import Hero from '../components/Hero'
import FeatureCard from '../components/FeatureCard'

const features = [
  {
    icon: '🚚',
    title: 'Fast delivery',
    description: 'Everything ships within 24 hours, tracked end to end.',
  },
  {
    icon: '↩️',
    title: 'Easy returns',
    description: 'Changed your mind? Return anything within 30 days.',
  },
  {
    icon: '🔒',
    title: 'Secure checkout',
    description: 'Your payment details are encrypted and never stored.',
  },
]

/** Landing page: hero + a responsive feature grid. */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <Hero />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {features.map((f) => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>
    </div>
  )
}
