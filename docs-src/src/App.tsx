import { Hero } from './components/Hero'
import { Pipeline } from './components/Pipeline'
import { AnimatedDemo } from './components/AnimatedDemo'
import { RuleHierarchy } from './components/RuleHierarchy'
import { Config } from './components/Config'
import { Footer } from './components/Footer'

export function App() {
  return (
    <>
      <Hero />
      <Pipeline />
      <AnimatedDemo />
      <RuleHierarchy />
      <Config />
      <Footer />
    </>
  )
}
