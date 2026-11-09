/**
 * Research Panel UI component for DeepSeek Harness.
 * Uses React.createElement to remain 100% buildless and compatible with DSH module loader.
 */
import { formatByteSize, statusColor, formatStatus } from './format.js'

function ensureStyles() {
  if (typeof document === 'undefined') return
  const id = 'dsh-openresearch-styles'
  if (document.getElementById(id)) return

  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .orx-panel {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 12px;
      gap: 12px;
      font-size: 13px;
      color: var(--dsh-color-text-primary, #e2e8f0);
      background: var(--dsh-color-bg-primary, #0f172a);
      overflow-y: auto;
    }
    .orx-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--dsh-color-border, #334155);
    }
    .orx-select {
      flex: 1;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--dsh-color-border, #334155);
      background: var(--dsh-color-bg-secondary, #1e293b);
      color: inherit;
      font-size: 12px;
    }
    .orx-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .orx-card {
      background: var(--dsh-color-bg-secondary, #1e293b);
      border: 1px solid var(--dsh-color-border, #334155);
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .orx-card-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--dsh-color-text-muted, #94a3b8);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .orx-tree-item {
      padding: 6px 8px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .orx-tree-item:hover {
      background: var(--dsh-color-bg-hover, #334155);
    }
    .orx-tree-item.selected {
      background: var(--dsh-color-bg-active, #2563eb33);
      border-left: 2px solid #3b82f6;
    }
    .orx-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .orx-table th {
      text-align: left;
      padding: 4px 6px;
      color: var(--dsh-color-text-muted, #94a3b8);
      border-bottom: 1px solid var(--dsh-color-border, #334155);
    }
    .orx-table td {
      padding: 6px;
      border-bottom: 1px solid var(--dsh-color-border-subtle, #1e293b);
      cursor: pointer;
    }
    .orx-table tr:hover td {
      background: var(--dsh-color-bg-hover, #334155);
    }
    .orx-table tr.selected td {
      background: var(--dsh-color-bg-active, #2563eb33);
    }
    .orx-log-box {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      max-height: 220px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .orx-btn {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      border: 1px solid var(--dsh-color-border, #334155);
      background: var(--dsh-color-bg-secondary, #1e293b);
      color: inherit;
      cursor: pointer;
    }
    .orx-btn:hover {
      background: var(--dsh-color-bg-hover, #334155);
    }
  `
  document.head.appendChild(style)
}

export function createResearchPanel(React) {
  const { createElement: h, useState, useEffect } = React

  return function ResearchPanel(props) {
    const t = props.t || ((key) => key)

    const [projects, setProjects] = useState([])
    const [selectedProjectId, setSelectedProjectId] = useState('')
    const [tree, setTree] = useState(null)
    const [selectedExpId, setSelectedExpId] = useState('')
    const [runs, setRuns] = useState([])
    const [selectedRunId, setSelectedRunId] = useState('')
    const [logSummary, setLogSummary] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
      ensureStyles()
      // Fetch projects on mount
      fetch('api/openresearch/projects')
        .then((r) => r.json())
        .then((res) => {
          if (res.ok && Array.isArray(res.value) && res.value.length > 0) {
            setProjects(res.value)
            setSelectedProjectId(res.value[0].id)
          }
        })
        .catch((err) => setError(err.message))
    }, [])

    useEffect(() => {
      if (!selectedProjectId) return
      setLoading(true)
      setSelectedExpId('')
      setSelectedRunId('')
      setLogSummary(null)

      // Fetch tree and runs in parallel
      Promise.all([
        fetch(`api/openresearch/tree?project=${encodeURIComponent(selectedProjectId)}`).then((r) => r.json()),
        fetch(`api/openresearch/runs?project=${encodeURIComponent(selectedProjectId)}`).then((r) => r.json()),
      ])
        .then(([treeRes, runsRes]) => {
          if (treeRes.ok) setTree(treeRes.value)
          if (runsRes.ok) {
            setRuns(runsRes.value || [])
            if (runsRes.value?.length > 0) {
              setSelectedRunId(runsRes.value[0].id)
            }
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }, [selectedProjectId])

    useEffect(() => {
      if (!selectedRunId) return
      fetch(`api/openresearch/logs?run=${encodeURIComponent(selectedRunId)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.ok) setLogSummary(res.value)
        })
        .catch(() => {})
    }, [selectedRunId])

    return h(
      'div',
      { className: 'orx-panel' },
      // Header with Project Dropdown
      h(
        'div',
        { className: 'orx-header' },
        h(
          'select',
          {
            className: 'orx-select',
            value: selectedProjectId,
            onChange: (e) => setSelectedProjectId(e.target.value),
          },
          projects.length === 0
            ? h('option', { value: '' }, t('empty.projects'))
            : projects.map((p) =>
                h('option', { key: p.id, value: p.id }, `${p.name} (${p.baselineBranch || 'main'})`),
              ),
        ),
      ),

      error &&
        h('div', { style: { color: '#ef4444', fontSize: '11px', padding: '4px' } }, `Error: ${error}`),

      // 1. Experiment Tree Card
      h(
        'div',
        { className: 'orx-card' },
        h(
          'div',
          { className: 'orx-card-title' },
          h('span', null, t('tree.title')),
          tree && h('span', { style: { fontWeight: 400 } }, `baseline: ${tree.branch}`),
        ),
        !tree || !tree.experiments || tree.experiments.length === 0
          ? h('div', { style: { color: '#94a3b8', fontSize: '11px' } }, t('tree.empty'))
          : tree.experiments.map((exp) =>
              h(
                'div',
                {
                  key: exp.id,
                  className: `orx-tree-item ${selectedExpId === exp.id ? 'selected' : ''}`,
                  onClick: () => setSelectedExpId(exp.id === selectedExpId ? '' : exp.id),
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  h('span', null, exp.isRoot ? '🌱' : '🌿'),
                  h('span', { style: { fontWeight: 500 } }, exp.title),
                ),
                h(
                  'span',
                  {
                    className: 'orx-badge',
                    style: {
                      background: `${statusColor(exp.status)}22`,
                      color: statusColor(exp.status),
                    },
                  },
                  formatStatus(exp.status),
                ),
              ),
            ),
      ),

      // 2. Runs Table Card
      h(
        'div',
        { className: 'orx-card' },
        h(
          'div',
          { className: 'orx-card-title' },
          h('span', null, t('runs.title')),
          runs.length > 0 && h('span', { style: { fontWeight: 400 } }, `${runs.length} runs`),
        ),
        runs.length === 0
          ? h('div', { style: { color: '#94a3b8', fontSize: '11px' } }, t('runs.empty'))
          : h(
              'table',
              { className: 'orx-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('runs.th.id')),
                  h('th', null, t('runs.th.status')),
                  h('th', null, t('runs.th.commit')),
                  h('th', null, t('runs.th.duration')),
                ),
              ),
              h(
                'tbody',
                null,
                runs.map((r) =>
                  h(
                    'tr',
                    {
                      key: r.id,
                      className: selectedRunId === r.id ? 'selected' : '',
                      onClick: () => setSelectedRunId(r.id),
                    },
                    h('td', { style: { fontFamily: 'monospace' } }, r.id.slice(0, 14)),
                    h(
                      'td',
                      null,
                      h(
                        'span',
                        {
                          className: 'orx-badge',
                          style: {
                            background: `${statusColor(r.status)}22`,
                            color: statusColor(r.status),
                          },
                        },
                        r.status,
                      ),
                    ),
                    h('td', { style: { fontFamily: 'monospace', color: '#94a3b8' } }, r.commit || '—'),
                    h('td', null, r.duration || '—'),
                  ),
                ),
              ),
            ),
      ),

      // 3. Log Output Viewer Card
      h(
        'div',
        { className: 'orx-card' },
        h(
          'div',
          { className: 'orx-card-title' },
          h('span', null, t('logs.title')),
          logSummary &&
            h(
              'button',
              {
                className: 'orx-btn',
                onClick: () => {
                  if (selectedRunId) {
                    fetch(`api/openresearch/logs?run=${encodeURIComponent(selectedRunId)}`)
                      .then((r) => r.json())
                      .then((res) => res.ok && setLogSummary(res.value))
                  }
                },
              },
              t('logs.refresh'),
            ),
        ),
        !logSummary
          ? h('div', { style: { color: '#94a3b8', fontSize: '11px' } }, t('logs.empty'))
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h(
                'div',
                { style: { fontSize: '10px', color: '#94a3b8' } },
                `${logSummary.path} (${formatByteSize(logSummary.size)})`,
              ),
              h('div', { className: 'orx-log-box' }, logSummary.tail || '(empty log file)'),
            ),
      ),
    )
  }
}
