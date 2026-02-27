import { motion } from 'framer-motion'

const stages = [
  { label: 'Intercept', icon: '{}', desc: 'Hook captures Bash tool call' },
  { label: 'Parse', icon: '/>',  desc: 'Split into individual commands' },
  { label: 'Evaluate', icon: '?=', desc: 'Check each against rules' },
  { label: 'Decide', icon: '>>',  desc: 'Allow, deny, or ask' },
]

const stageColors = ['var(--accent-blue)', 'var(--accent-cyan)', 'var(--accent-purple)', 'var(--color-allow)']

export function Pipeline() {
  return (
    <section className="section">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="section-title">How It Works</h2>
        <p className="section-subtitle">
          Every Bash command passes through a 4-stage pipeline before execution.
        </p>
      </motion.div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        position: 'relative',
      }}>
        {stages.map((stage, i) => (
          <motion.div
            key={stage.label}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5, delay: i * 0.15, type: 'spring', stiffness: 200 }}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Glow top border */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${stageColors[i]}, transparent)`,
            }} />

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 18,
                fontWeight: 700,
                color: stageColors[i],
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                background: `${stageColors[i]}15`,
                border: `1px solid ${stageColors[i]}30`,
                flexShrink: 0,
              }}>
                {stage.icon}
              </span>
              <div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}>
                  Step {i + 1}
                </span>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{stage.label}</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {stage.desc}
            </p>

            {/* Arrow indicator (not on last) */}
            {i < stages.length - 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 + 0.4 }}
                style={{
                  position: 'absolute',
                  right: -14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                  color: 'var(--text-muted)',
                  fontSize: 18,
                  display: 'none', // hidden on mobile, shown on larger screens via media query alternative
                }}
                className="pipeline-arrow"
              >
                →
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Animated particle path */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ delay: 0.8 }}
        style={{ marginTop: 32, position: 'relative', height: 40, overflow: 'hidden' }}
      >
        <svg width="100%" height="40" viewBox="0 0 1000 40" preserveAspectRatio="none" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="pathGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent-blue)" />
              <stop offset="50%" stopColor="var(--accent-cyan)" />
              <stop offset="100%" stopColor="var(--color-allow)" />
            </linearGradient>
          </defs>
          <line x1="50" y1="20" x2="950" y2="20" stroke="var(--border)" strokeWidth="2" strokeDasharray="8 4" />
          <motion.circle
            cx="50"
            cy="20"
            r="5"
            fill="url(#pathGrad)"
            initial={{ cx: 50 }}
            whileInView={{ cx: [50, 950] }}
            viewport={{ once: true }}
            transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
          />
          <motion.circle
            cx="50"
            cy="20"
            r="12"
            fill="none"
            stroke="var(--accent-cyan)"
            strokeWidth="1"
            opacity="0.3"
            initial={{ cx: 50 }}
            whileInView={{ cx: [50, 950] }}
            viewport={{ once: true }}
            transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
          />
        </svg>
      </motion.div>
    </section>
  )
}
