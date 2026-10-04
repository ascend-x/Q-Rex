// Architecture + state-machine diagrams as inline SVG in the Q-Rex neo-brutalist theme (hard borders, offset shadows).
const INK = '#111', NAVY = '#0d1b2a', ORANGE = '#ff5400', CREAM = '#fff3eb', GREEN = '#059669'
const FONT = "'Space Grotesk', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace"

function Box({ x, y, w, h, title, sub, fill = '#fff', color = INK, accent }) {
  const lines = Array.isArray(sub) ? sub : [sub]
  return (
    <g>
      <rect x={x + 4} y={y + 4} width={w} height={h} rx="8" fill={INK} />
      <rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke={INK} strokeWidth="2.2" />
      {accent && <rect x={x} y={y} width="7" height={h} rx="3" fill={accent} stroke={INK} strokeWidth="2" />}
      <text x={x + w / 2 + (accent ? 3 : 0)} y={y + 24} textAnchor="middle" fontFamily={FONT} fontWeight="700" fontSize="14" fill={color} style={{ textTransform: 'uppercase' }}>{title}</text>
      {lines.map((l, i) => <text key={i} x={x + w / 2 + (accent ? 3 : 0)} y={y + 44 + i * 15} textAnchor="middle" fontFamily={MONO} fontSize="10.5" fill={color} opacity=".85">{l}</text>)}
    </g>
  )
}

function Group({ x, y, w, h, label, fill = 'rgba(255,255,255,.55)', right, note }) {
  const lw = label.length * 7.4 + 22, lx = right ? x + w - 14 - lw : x + 14
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill={fill} stroke={INK} strokeWidth="2.2" />
      <rect x={lx} y={y - 13} width={lw} height="26" rx="13" fill="#fff" stroke={INK} strokeWidth="2" />
      {note && <text x={x + w / 2} y={y + h - 10} textAnchor="middle" fontFamily={MONO} fontSize="10.5" fill="#475569">{note}</text>}
      <text x={lx + 11} y={y + 4.5} fontFamily={MONO} fontWeight="700" fontSize="11" fill={ORANGE} style={{ textTransform: 'uppercase' }}>{label}</text>
    </g>
  )
}

function Arrow({ d, label, lx, ly, dashed, color = INK, anchor = 'middle' }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth="2.6" strokeDasharray={dashed ? '7 6' : undefined} markerEnd={`url(#${dashed ? 'arrD' : color === ORANGE ? 'arrO' : 'arr'})`} strokeLinejoin="round" />
      {label && (
        <g>
          <rect x={lx - label.length * 3.35 - 6} y={ly - 11} width={label.length * 6.7 + 12} height="18" rx="9" fill="#f4f4f0" stroke={color} strokeWidth="1.3" />
          <text x={lx} y={ly + 2} textAnchor={anchor} fontFamily={MONO} fontWeight="600" fontSize="10" fill={color}>{label}</text>
        </g>
      )}
    </g>
  )
}

function Defs() {
  return (
    <defs>
      <marker id="arr" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1l10 5-10 5z" fill={INK} /></marker>
      <marker id="arrD" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1l10 5-10 5z" fill="#6b7280" /></marker>
      <marker id="arrO" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1l10 5-10 5z" fill={ORANGE} /></marker>
    </defs>
  )
}

export function ArchDiagram() {
  return (
    <div className="diagram-wrap">
      <svg viewBox="0 0 1270 690" className="diagram" role="img" aria-label="Q-Rex system architecture">
        <Defs />
        {/* benchmark-2 video */}
        <Box x={545} y={8} w={240} h={58} title="Benchmark 2 · .mp4 video" sub="PTZ camera bypassed" fill={CREAM} accent={ORANGE} />

        {/* world */}
        <Group x={10} y={120} w={230} h={300} label="Virtual world" />
        <Box x={28} y={150} w={194} h={72} title="Target motions" sub={['7 paths · decoys', 'beacon dropouts']} />
        <Box x={28} y={236} w={194} h={72} title="Platform & jitter" sub={['≤ 20 px/frame', '5 platform models']} />
        <Box x={28} y={322} w={194} h={72} title="Atmosphere" sub={['haze · fog · rain', 'low light · turbulence']} />

        {/* sensor */}
        <Group x={300} y={120} w={230} h={300} label="Sensor model" />
        <Box x={318} y={150} w={194} h={72} title="Narrow camera" sub={['640×480 mono / colour', 'sub-pixel exact beacon']} fill={CREAM} />
        <Box x={318} y={236} w={194} h={72} title="Wide view / zoom" sub={['4× overview sensor, or lens', 'zoom-out · search only']} fill={CREAM} />
        <Box x={318} y={322} w={194} h={72} title="Noise chain" sub={['Poisson → Gaussian', '→ salt & pepper → clip']} fill={CREAM} />
        <Arrow d="M226 186 H314" />
        <Arrow d="M226 272 H314" />
        <Arrow d="M226 358 H314" />

        {/* tracker */}
        <Group x={590} y={120} w={600} h={250} label="Coarse tracker" right note="sees only pixels + encoder angle — never ground truth" fill="rgba(13,27,42,.06)" />
        <Box x={606} y={160} w={114} h={106} title="Detector" sub={['median filter', 'matched filter', 'CFAR · centroid']} fill={NAVY} color="#fff" accent={ORANGE} />
        <Box x={752} y={160} w={114} h={106} title="IMM Kalman" sub={['CV + CA models', 'noise learned', 'gating']} fill={NAVY} color="#fff" accent={ORANGE} />
        <Box x={898} y={160} w={114} h={106} title="States" sub={['SEARCH · SLEW', 'TRACK · COAST', 'REACQUIRE']} fill={NAVY} color="#fff" accent={ORANGE} />
        <Box x={1044} y={160} w={114} h={106} title="Control" sub={['feed-forward', '+ feedback', 'stop profile']} fill={NAVY} color="#fff" accent={ORANGE} />
        <Box x={606} y={290} w={260} h={56} title="CNN verifier · optional" sub="37 k params · rejects false alarms" fill="#fff3eb" accent={ORANGE} />
        <Arrow d="M650 270 V286" label="" />
        <Arrow d="M815 286 V270" color={ORANGE} />
        <Arrow d="M724 213 H748" color={ORANGE} />
        <Arrow d="M870 213 H894" color={ORANGE} />
        <Arrow d="M1016 213 H1040" color={ORANGE} />

        {/* sensor -> tracker */}
        <Arrow d="M516 186 H602" label="pixels" lx={560} ly={176} />
        <Arrow d="M516 272 H552 V240 H602" />
        <Arrow d="M665 66 V156" label="video frames" lx={665} ly={112} color={ORANGE} />

        {/* gimbal */}
        <Box x={880} y={405} w={290} h={78} title="Pan-tilt mount (virtual gimbal)" sub={['5–10 °/s rate limit · acceleration limit', 'optional command latency']} fill={ORANGE} color="#fff" />
        <Arrow d="M1101 270 V401" label="velocity command" lx={1101} ly={380} />
        <Arrow d="M955 401 V270" label="encoder angle" lx={955} ly={380} dashed color="#6b7280" />
        {/* gimbal -> sensor loop */}
        <Arrow d="M876 444 H415 V426" label="camera pointing → next exposure" lx={645} ly={444} />

        {/* recorder + metrics */}
        <Box x={300} y={535} w={240} h={78} title="Ground-truth recorder" sub={['truth · detections · errors', 'never visible to the tracker']} />
        <Box x={620} y={535} w={300} h={78} title="Metrics · logs · GUI" sub={['K01–K05 checks · JSON/CSV/HTML', 'live tiles, plots, benchmarks']} fill={NAVY} color="#fff" />
        <Arrow d="M125 424 V574 H296" label="ground truth" lx={175} ly={556} dashed color="#6b7280" />
        <Arrow d="M544 574 H616" />
        <Arrow d="M1190 215 H1236 V574 H924" label="estimates" lx={1236} ly={400} dashed color="#6b7280" />

        {/* legend */}
        <g fontFamily={MONO} fontSize="11" fill={INK}>
          <path d="M20 662 H70" stroke={INK} strokeWidth="2.6" markerEnd="url(#arr)" /><text x="82" y="666">data flow</text>
          <path d="M190 662 H240" stroke="#6b7280" strokeWidth="2.6" strokeDasharray="7 6" markerEnd="url(#arrD)" /><text x="252" y="666">telemetry / ground truth (one way — never into the tracker)</text>
          <path d="M700 662 H750" stroke={ORANGE} strokeWidth="2.6" markerEnd="url(#arrO)" /><text x="762" y="666">tracker internal chain</text>
        </g>
      </svg>
    </div>
  )
}

function State({ x, y, label, fill }) {
  return (
    <g>
      <rect x={x + 4} y={y + 4} width="150" height="52" rx="26" fill={INK} />
      <rect x={x} y={y} width="150" height="52" rx="26" fill={fill} stroke={INK} strokeWidth="2.2" />
      <text x={x + 75} y={y + 32} textAnchor="middle" fontFamily={MONO} fontWeight="700" fontSize="14" fill="#fff">{label}</text>
    </g>
  )
}

export function StateDiagram() {
  return (
    <div className="diagram-wrap">
      <svg viewBox="0 0 1290 300" className="diagram" role="img" aria-label="Tracker state machine">
        <Defs />
        <State x={20} y={120} label="SEARCH" fill="#6b7280" />
        <State x={290} y={120} label="SLEW" fill="#2563eb" />
        <State x={560} y={120} label="TRACK" fill={GREEN} />
        <State x={830} y={120} label="COAST" fill="#d97706" />
        <State x={1100} y={120} label="REACQUIRE" fill="#dc2626" />
        <Arrow d="M174 146 H286" label="2 hits" lx={230} ly={128} />
        <Arrow d="M444 146 H556" label="locked" lx={500} ly={128} />
        <Arrow d="M714 136 H826" label="lost" lx={770} ly={118} />
        <Arrow d="M830 160 Q772 192 714 160" label="re-detected" lx={772} ly={205} />
        <Arrow d="M984 146 H1096" label="20 frames" lx={1040} ly={128} />
        <Arrow d="M1175 178 V258 H365 V180" label="new confirmed candidate" lx={770} ly={258} />
        <Arrow d="M365 116 V52 H1175 V116" label="slew timeout 5 s · arrived-but-unseen · no overview hit" lx={770} ly={52} dashed color="#6b7280" />
      </svg>
    </div>
  )
}
