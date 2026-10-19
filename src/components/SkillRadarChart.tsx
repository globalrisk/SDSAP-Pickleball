import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { radarPoint, type SkillGroup, type SkillSummary } from '../lib/playerSkills'

export function SkillRadarChart({ summary, group }: { summary: SkillSummary; group: SkillGroup }) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const { skills } = group
  const pointAt = (index: number, score: number, radius?: number) => radarPoint(index, score, skills.length, radius)
  const points = skills.map((skill, index) => {
    const score = summary.skills[skill].average
    return score == null ? null : pointAt(index, score)
  })
  const complete = points.every(point => point !== null)
  return <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-[400px]" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
    <title id={titleId}>{t('skills.chartTitle', { group: t(`skills.groups.${group.id}`) })}</title>
    <desc id={descriptionId}>{t('skills.chartDescription', { count: skills.length })}</desc>
    {[25, 50, 75, 100].map(ring => <g key={ring}>
      <polygon points={skills.map((_, index) => pointAt(index, ring).join(',')).join(' ')} fill={ring === 100 ? '#f0fdf4' : 'none'} stroke="#bbf7d0" strokeWidth="1" />
    </g>).reverse()}
    {skills.map((skill, index) => {
      const [x, y] = pointAt(index, 100)
      const [labelX, labelY] = pointAt(index, 100, 151)
      const lines = t(`skills.chartNames.${skill}`).split('|')
      return <g key={skill}>
        <line x1="200" y1="200" x2={x} y2={y} stroke="#bbf7d0" />
        <text textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="600" fill="#14532d">{lines.map((line, lineIndex) => <tspan key={lineIndex} x={labelX} y={labelY + (lineIndex - (lines.length - 1) / 2) * 16}>{line}</tspan>)}</text>
      </g>
    })}
    {[25, 50, 75, 100].map(ring => <text key={ring} x="205" y={200 - 112 * ring / 100 + 4} fontSize="9" fill="#64748b">{ring}</text>)}
    {complete ? <polygon data-skill-shape="complete" points={points.map(point => point!.join(',')).join(' ')} fill="#16a34a" fillOpacity="0.18" stroke="#15803d" strokeWidth="2.5" /> : points.map((point, index) => {
      const next = points[(index + 1) % points.length]
      return point && next ? <line data-skill-segment="true" key={index} x1={point[0]} y1={point[1]} x2={next[0]} y2={next[1]} stroke="#15803d" strokeWidth="2.5" /> : null
    })}
    {points.map((point, index) => point ? <circle key={skills[index]} cx={point[0]} cy={point[1]} r="4" fill="#15803d" stroke="white" strokeWidth="1.5"><title>{`${t(`skills.names.${skills[index]}`)}: ${summary.skills[skills[index]!].average}/100`}</title></circle> : null)}
  </svg>
}
