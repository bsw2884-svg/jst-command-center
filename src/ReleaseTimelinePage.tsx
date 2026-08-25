import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useJstMemberContext } from './AuthGate'
import { getMilestones, releaseCountdown, releaseProgress, type Milestone } from './FeaturePages'
import { ReleaseMixNotes } from './MixNotes'

const fmt = (date: string) => date ? new Date(`${date}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set yet'

type Props = {
  releases: any[]
  onChange: (releases: any[]) => void
  onEdit: (release: any) => void
  onDelete: (id: string) => void
  artworkFor: (song: string) => string
}

export function ReleaseTimelinePage({ releases, onChange, onEdit, onDelete, artworkFor }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const context = useJstMemberContext()
  const update = (release: any, milestones: Milestone[]) => onChange(releases.map(item => item.id === release.id ? { ...item, milestones } : item))

  return <div className="cards releaseTimelineCards">
    {releases.map(release => {
      const milestones = getMilestones(release)
      const progress = releaseProgress(release)
      const next = milestones.find(milestone => milestone.status !== 'Complete')
      const openMilestone = milestones.find(milestone => `${release.id}-${milestone.id}` === open)

      return <article className="record releaseTimelineRecord" key={release.id}>
        <div className="releaseTimelineTop">
          <img src={artworkFor(release.songName)} alt="" />
          <div>
            <span className="eyebrow">{releaseCountdown(release.date)}</span>
            <h2>{release.songName}</h2>
            <strong>RELEASE PROGRESS — {progress}%</strong>
            <div className="progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>
            {next && <p><b>NEXT UP · {next.name.toUpperCase()}</b>{next.targetDate && ` · Target ${fmt(next.targetDate)}`}</p>}
          </div>
          <div className="actions">
            <button className="icon" onClick={() => onEdit(release)}>Edit</button>
            <button className="icon danger" onClick={() => onDelete(release.id)}><Trash2 /></button>
          </div>
        </div>

        <div className="releaseTimeline">
          {milestones.map((milestone, index) => {
            const overdue = Boolean(milestone.targetDate && milestone.status !== 'Complete' && milestone.targetDate < new Date().toISOString().slice(0, 10))
            return <button
              className={`${milestone.status.replaceAll(' ', '-').toLowerCase()} ${overdue ? 'overdue' : ''}`}
              key={milestone.id}
              onClick={() => setOpen(open === `${release.id}-${milestone.id}` ? null : `${release.id}-${milestone.id}`)}
            >
              <i>{milestone.status === 'Complete' ? '✓' : index + 1}</i>
              <b>{milestone.name}</b>
              <span>{overdue ? 'OVERDUE' : milestone.status}</span>
              {milestone.targetDate && <small>{fmt(milestone.targetDate)}</small>}
            </button>
          })}
        </div>

        {openMilestone && <div className="milestoneEditor">
          <label>Status<select value={openMilestone.status} onChange={event => update(release, milestones.map(item => item.id === openMilestone.id ? { ...item, status: event.target.value as Milestone['status'], completionDate: event.target.value === 'Complete' ? (item.completionDate || new Date().toISOString().slice(0, 10)) : item.completionDate } : item))}><option>Not Started</option><option>In Progress</option><option>Complete</option></select></label>
          <label>Target date<input type="date" value={openMilestone.targetDate} onChange={event => update(release, milestones.map(item => item.id === openMilestone.id ? { ...item, targetDate: event.target.value } : item))} /></label>
          <label>Completion date<input type="date" value={openMilestone.completionDate} onChange={event => update(release, milestones.map(item => item.id === openMilestone.id ? { ...item, completionDate: event.target.value } : item))} /></label>
          <label className="grow">Note<input value={openMilestone.note} onChange={event => update(release, milestones.map(item => item.id === openMilestone.id ? { ...item, note: event.target.value } : item))} /></label>
          <button className="primary" onClick={() => update(release, milestones.map(item => item.id === openMilestone.id ? { ...item, status: 'Complete', completionDate: item.completionDate || new Date().toISOString().slice(0, 10) } : item))}>Mark Complete</button>
        </div>}

        <ReleaseMixNotes context={context} releaseId={release.id} releaseName={release.songName} />

        <button className="ghost releaseDetails" onClick={() => setOpen(open === release.id ? null : release.id)}>{open === release.id ? 'Hide' : 'View'} overview & notes</button>
        {open === release.id && <div className="releaseSections">
          <section><span className="eyebrow">OVERVIEW</span><p>Release date: {fmt(release.date)}</p><p>Associated song: {release.songName}</p></section>
          <section><span className="eyebrow">PROMOTION</span><p>{milestones.find(milestone => milestone.name === 'Promotion')?.note || 'No promotion notes yet.'}</p></section>
          <section><span className="eyebrow">NOTES</span><p>{release.notes || 'No release notes yet.'}</p></section>
        </div>}
      </article>
    })}
  </div>
}
